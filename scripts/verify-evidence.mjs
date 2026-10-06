// Dependency-free evidence verification. No producer/build/browser code is invoked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { json,hashFile,sha256,git,verifySource,sourceInputKind } from './source.mjs';
import { classify } from './classify.mjs';
import { PHASES,STAGES,GROUPS,BUILD_FILES,loadTrust,exactKeys,relative,hash,reference,checkReference,identity,phasePredecessor,stageForPhase,validateCommand,validateInventory,canonical,timestamp,requiredBuildInputs } from './evidence.mjs';

export async function verifyEvidencePair(root,trust=undefined) {
  trust ||= await loadTrust(root); assert.equal(trust.root,root);
  const evidenceFiles={},results=[];
  async function retain(directory,file) {
    const digest=await hashFile(path.join(directory,file)); evidenceFiles[path.relative(root,path.join(directory,file))]=digest; return digest;
  }
  for (const variant of ['baseline','fixed']) {
    const directory=path.join(root,'evidence',variant),source=path.join(root,'work',variant),dist=path.join(root,'work',`dist-${variant}`);
    const current=await verifySource(source,variant),target=identity(trust.manifest,variant);
    const baseContext={variant,commit:target.sha,tree:target.tree,sourceLockSha256:trust.manifest.sourceLockSha256,scope:trust.scope};
    const commands={},receipts={},inventories={};
    const auditors=Object.fromEntries(['scripts/phase.mjs','scripts/source.mjs','scripts/input-inventory.py','scripts/evidence.mjs'].map(file => [file,trust.files[file]]));
    for (const phase of PHASES) {
      const receipt=await json(path.join(directory,`${phase}.phase.json`));
      exactKeys(receipt,['schemaVersion','kind','phase','variant','scope','predecessor','producer','startedAt','finishedAt','source','integrity','context','auditorFiles','success'],'phase receipt');
      assert.equal(receipt.schemaVersion,2); assert.equal(receipt.kind,'phase'); assert.equal(receipt.phase,phase); assert.equal(receipt.variant,variant); assert.equal(receipt.success,true);
      assert.deepEqual(receipt.scope,trust.scope); assert.deepEqual(receipt.auditorFiles,auditors);
      const previous=phasePredecessor(phase),predecessor=previous ? await reference(directory,`${previous}.phase.json`) : null;
      assert.deepEqual(receipt.predecessor,predecessor);
      const start=timestamp(receipt.startedAt,trust),end=timestamp(receipt.finishedAt,trust); assert.ok(start <= end);
      if (previous) assert.ok(timestamp(receipts[previous].finishedAt,trust) <= start);
      assert.deepEqual(await checkReference(directory,receipt.source,`${phase}.source.json`),current,'Archived source phase differs from current verified source');
      const context=await checkReference(directory,receipt.context,`${phase}.context.json`);
      assert.deepEqual(context,{schemaVersion:2,phase,variant,scope:trust.scope,predecessor,producer:receipt.producer,startedAt:receipt.startedAt,auditorFiles:auditors});
      const stage=stageForPhase(phase);
      if (stage) {
        assert.deepEqual(receipt.producer,await reference(directory,`${stage}.command.json`));
        commands[stage]=await validateCommand(directory,stage,variant,trust,predecessor);
        assert.ok(timestamp(commands[stage].finishedAt,trust) <= start);
      } else assert.equal(receipt.producer,null);
      const inventory=await checkReference(directory,receipt.integrity,`${phase}.integrity.json`);
      exactKeys(inventory,['context','phase','chain','errors','unexpectedUntracked',...Object.keys(GROUPS)],'phase inventory');
      assert.deepEqual(inventory.context,baseContext); assert.equal(inventory.phase,phase); assert.deepEqual(inventory.errors,[]); assert.deepEqual(inventory.unexpectedUntracked,[]);
      assert.deepEqual(inventory.chain,{contextSha256:receipt.context.sha256,predecessor,producer:receipt.producer});
      receipts[phase]=receipt; inventories[phase]=inventory;
      for (const file of [`${phase}.phase.json`,`${phase}.context.json`,`${phase}.source.json`,`${phase}.integrity.json`,`${phase}.inventory.log`]) await retain(directory,file);
    }
    const anchors={},currentUntracked=git(source,'ls-files','--others','-z').split('\0').filter(Boolean);
    for (const [label,anchorPhase] of Object.entries(GROUPS)) {
      const filename=`${anchorPhase}.${label}.files.json`,anchor=await json(path.join(directory,filename)); validateInventory(anchor);
      const producingStage={dependencies:'install','icons-es':'icon','icons-cjs':'icon',css:'css'}[label];
      assert.deepEqual(anchor.context,{...baseContext,commandRecordSha256:await hashFile(path.join(directory,`${producingStage}.command.json`)),predecessor:commands[producingStage].predecessor});
      const prefix={dependencies:'node_modules/','icons-es':'icon/react-icon/','icons-cjs':'icon/react-icon-cjs/'}[label];
      const actualSet=prefix ? currentUntracked.filter(file => file.startsWith(prefix)) : trust.manifest.css.outputFiles;
      assert.deepEqual(Object.keys(anchor.files).sort(),[...actualSet].sort(),`${label} inventory file set differs`);
      for (const [file,entry] of Object.entries(anchor.files)) {
        const absolute=path.join(source,relative(file)),stat=await fs.lstat(absolute);
        if (entry.type === 'symlink') {
          assert.ok(prefix && stat.isSymbolicLink()); assert.equal(await fs.readlink(absolute),entry.target);
          assert.ok((await fs.realpath(absolute)).startsWith(path.join(source,prefix)),'Input symlink escapes its anchored root');
        } else { assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(await hashFile(absolute),entry.sha256); }
      }
      for (const phase of PHASES) {
        const expected=PHASES.indexOf(phase)<PHASES.indexOf(anchorPhase) ? {count:0,sha256:sha256(canonical({}))} : {count:anchor.count,sha256:anchor.sha256};
        assert.deepEqual(inventories[phase][label],expected,`${phase} does not preserve ${label}`);
      }
      anchors[label]=anchor; await retain(directory,filename);
    }
    const cssAudit=await json(path.join(root,'css-source-audit.json')); assert.deepEqual(cssAudit.outputFiles,trust.manifest.css.outputFiles);
    for (const [output,input] of Object.entries(cssAudit.expectedCopies)) { assert.deepEqual(anchors.css.files[output],{type:'file',sha256:input.sha256}); assert.equal(current.sourceFiles[input.source],input.sha256); }
    const permittedEmpty=cssAudit.permittedEmptyOutputs || {};
    for (const file of trust.manifest.css.outputFiles) if ((await fs.stat(path.join(source,file))).size===0) {
      assert.ok(permittedEmpty[file],`Unexpected empty CSS output: ${file}`); assert.equal(anchors.css.files[file].sha256,permittedEmpty[file].sha256);
    }
    for (const stage of Object.keys(STAGES)) for (const file of [`${stage}.command.json`,`${stage}.log`,`${stage}.exit-code`]) await retain(directory,file);
    for (const stage of ['build','browser']) {
      const wrapper=await json(path.join(directory,`${stage}.wrapper.json`));
      exactKeys(wrapper,['schemaVersion','scope','stage','variant','command','postPhase','actualExitCode','exitCode','success','error'],'outer producer receipt');
      assert.equal(wrapper.schemaVersion,2); assert.deepEqual(wrapper.scope,trust.scope); assert.equal(wrapper.stage,stage); assert.equal(wrapper.variant,variant);
      assert.deepEqual(wrapper.command,await reference(directory,`${stage}.command.json`)); assert.deepEqual(wrapper.postPhase,await reference(directory,`${STAGES[stage][1]}.phase.json`));
      const exit=stage==='browser' && variant==='baseline' ? 1:0;
      assert.equal(wrapper.actualExitCode,exit); assert.equal(wrapper.exitCode,exit); assert.equal(wrapper.success,true); assert.equal(wrapper.error,null);
      assert.equal(await fs.readFile(path.join(directory,`${stage}.wrapper-exit-code`),'utf8'),`${exit}\n`);
      await retain(directory,`${stage}.wrapper.json`); await retain(directory,`${stage}.wrapper-exit-code`);
    }
    const buildDirectory=path.join(directory,'build'),provenance=await json(path.join(buildDirectory,'build-provenance.json'));
    const sourceFields=Object.keys(current);
    exactKeys(provenance,['schemaVersion',...sourceFields,'scope','predecessor','harnessFiles','node','sourcePackageJsonSha256','harnessLockSha256','inputAnchors','nativePackages','nativeCss','dependencyVersions','toolingVersions','artifactHashes','inputFiles','sourceMapHookSha256'],'build provenance');
    assert.equal(provenance.schemaVersion,2); for (const field of sourceFields) assert.deepEqual(provenance[field],current[field]);
    assert.deepEqual(provenance.scope,trust.scope); assert.deepEqual(provenance.predecessor,commands.build.predecessor); assert.deepEqual(provenance.harnessFiles,trust.files);
    assert.equal(provenance.node,`v${trust.manifest.runtime.harnessNodeVersion}`); assert.equal(provenance.sourcePackageJsonSha256,current.sourceFiles['package.json']);
    assert.equal(provenance.harnessLockSha256,trust.manifest.harnessLockSha256); assert.deepEqual(provenance.toolingVersions,trust.manifest.runtime.toolingVersions);
    exactKeys(provenance.inputAnchors,Object.keys(GROUPS)); for (const label of Object.keys(GROUPS)) assert.deepEqual(provenance.inputAnchors[label],{count:anchors[label].count,sha256:anchors[label].sha256});
    const nativePackages=await json(path.join(directory,'native-packages.json')); exactKeys(nativePackages,['tools','modules']);
    assert.deepEqual(nativePackages.tools,commands.install.tools); assert.deepEqual(provenance.nativePackages,nativePackages);
    assert.equal(nativePackages.modules.length,Object.keys(trust.manifest.preparation.nativePackageVersions).length);
    const names=[];
    for (const module of nativePackages.modules) {
      exactKeys(module,['name','version','packagePath','sha256']); names.push(module.name);
      assert.equal(module.version,trust.manifest.preparation.nativePackageVersions[module.name]); assert.equal(module.packagePath,`node_modules/${module.name}/package.json`);
      assert.equal(module.sha256,anchors.dependencies.files[module.packagePath].sha256); assert.equal((await json(path.join(source,module.packagePath))).version,module.version);
    }
    assert.deepEqual(names.sort(),Object.keys(trust.manifest.preparation.nativePackageVersions).sort()); await retain(directory,'native-packages.json');
    exactKeys(provenance.dependencyVersions,['react','react-dom','number-precision']);
    for (const [name,version] of Object.entries(provenance.dependencyVersions)) { const file=`node_modules/${name}/package.json`; assert.ok(anchors.dependencies.files[file]); assert.equal((await json(path.join(source,file))).version,version); }
    const resolution=await json(path.join(directory,'css-package-resolution.json'));
    exactKeys(resolution,['sourceCommit','sourceTree','sourceLockSha256','resolutions']); assert.equal(resolution.sourceCommit,target.sha); assert.equal(resolution.sourceTree,target.tree); assert.equal(resolution.sourceLockSha256,trust.manifest.sourceLockSha256);
    const compiler='node_modules/arco-scripts/package.json';
    const gulpLess=path.relative(source,createRequire(path.join(source,compiler)).resolve('gulp-less/package.json'));
    const expectedResolutionPairs=[[compiler,'gulp-less'],[gulpLess,'less'],...['less-plugin-npm-import','less-plugin-autoprefix','gulp-clean-css'].map(name=>[compiler,name]),...['components','es','lib'].flatMap(prefix=>['palette.js','palette-dark.js','getRgbStr.js'].map(name=>[`${prefix}/style/theme/color/${name}`,'@arco-design/color']))];
    assert.deepEqual(resolution.resolutions.map(item=>[item.from,item.name]).sort(),expectedResolutionPairs.sort(),'CSS package-resolution chain is incomplete or duplicated');
    for (const item of resolution.resolutions) {
      exactKeys(item,['from','name','version','packagePath','packageSha256','entryPath','entrySha256']); assert.equal(item.version,trust.manifest.preparation.nativePackageVersions[item.name]);
      const resolver=createRequire(path.join(source,relative(item.from)));
      assert.equal(item.packagePath,path.relative(source,await fs.realpath(resolver.resolve(`${item.name}/package.json`))));
      assert.equal(item.entryPath,path.relative(source,await fs.realpath(resolver.resolve(item.name))));
      for (const [field,hashField] of [['packagePath','packageSha256'],['entryPath','entrySha256']]) assert.equal(anchors.dependencies.files[relative(item[field])]?.sha256,item[hashField]);
    }
    await retain(directory,'css-package-resolution.json');
    const nativeCssHash=anchors.css.files[trust.manifest.css.mainOutput].sha256;
    assert.deepEqual(provenance.nativeCss,{output:trust.manifest.css.mainOutput,sha256:nativeCssHash,command:trust.manifest.preparation.cssArgs,packageScript:trust.manifest.css.packageScript,auditRecordSha256:trust.manifest.css.auditRecordSha256});
    const served=['index.html','bundle.js','bundle.css','bundle.js.map','bundle.css.map']; exactKeys(provenance.artifactHashes,served);
    for (const name of BUILD_FILES) { const digest=await hashFile(path.join(buildDirectory,name)); assert.equal(await hashFile(path.join(dist,name)),digest); assert.equal(commands.build.outputs[`build/${name}`],digest); if (served.includes(name)) assert.equal(provenance.artifactHashes[name],digest); await retain(directory,`build/${name}`); }
    assert.equal(await hashFile(path.join(buildDirectory,'native-source.css')),nativeCssHash);
    const runtime={...provenance}; delete runtime.artifactHashes; delete runtime.inputFiles; delete runtime.sourceMapHookSha256;
    assert.deepEqual(await json(path.join(buildDirectory,'runtime-provenance.json')),runtime);
    const hook='components/Slider/hooks/useLegalValue.ts'; assert.equal(provenance.sourceMapHookSha256,current.sourceFiles[hook]);
    const sourceMap=await json(path.join(buildDirectory,'bundle.js.map'));
    const indices=sourceMap.sources.flatMap((file,index)=>file.endsWith('/'+hook)?[index]:[]); assert.equal(indices.length,1); assert.equal(sha256(sourceMap.sourcesContent[indices[0]]),current.sourceFiles[hook]);
    assert.ok(provenance.inputFiles && Object.keys(provenance.inputFiles).length>0);
    for(const input of requiredBuildInputs(trust.manifest)) assert.ok(Object.hasOwn(provenance.inputFiles,input),`Required build input absent: ${input}`);
    assert.equal(provenance.inputFiles[`source/${hook}`],current.sourceFiles[hook]); assert.equal(provenance.inputFiles['source/components/Slider/index.tsx'],current.sourceFiles['components/Slider/index.tsx']);
    for (const [label,digest] of Object.entries(provenance.inputFiles)) {
      relative(label); hash(digest); let input;
      if (label.startsWith('source/')) {
        const sourceFile=label.slice(7),kind=sourceInputKind(sourceFile,current.sourceFiles);
        if(kind === 'committed') assert.equal(digest,current.sourceFiles[sourceFile]);
        else { assert.equal(anchors[kind].files[sourceFile]?.type,'file'); assert.equal(digest,anchors[kind].files[sourceFile].sha256); }
        input=path.join(source,sourceFile); assert.equal(await fs.realpath(input),input,'Source input symlink differs from the build contract');
      }
      else if (label.startsWith('source-generated/')) { assert.equal(label,`source-generated/${trust.manifest.css.mainOutput}`); input=path.join(source,trust.manifest.css.mainOutput); }
      else if (label==='validation/runtime-provenance.json') input=path.join(buildDirectory,'runtime-provenance.json');
      else { assert.ok(label.startsWith('validation/')); const file=label.slice(11); assert.equal(trust.files[file],digest); input=path.join(root,file); }
      assert.equal(await hashFile(input),digest);
    }
    const meta=await json(path.join(buildDirectory,'esbuild-metafile.json'));
    assert.ok(Object.keys(meta.inputs).length>0 && Object.keys(meta.outputs).length>0); assert.deepEqual(Object.keys(meta.inputs).sort(),Object.keys(meta.inputBindings).sort()); assert.deepEqual(Object.values(meta.inputBindings).sort(),Object.keys(provenance.inputFiles).sort());
    const report=await json(path.join(directory,'results.json')),verdict=classify(report);
    assert.equal(report.variant,variant); for (const [key,value] of Object.entries(verdict)) assert.equal(report[key],value);
    assert.deepEqual(report.provenance,provenance); assert.equal(report.browserVersion,trust.manifest.runtime.chromiumVersion);
    for (const field of ['runId','runAttempt','validationCommit']) assert.equal(report[field],trust.scope[field]);
    assert.ok(timestamp(commands.browser.startedAt,trust)<=timestamp(report.startedAt,trust)); assert.ok(timestamp(report.finishedAt,trust)<=timestamp(commands.browser.finishedAt,trust));
    assert.equal(report.exitCode,commands.browser.exitCode); assert.equal(await retain(directory,'results.json'),commands.browser.outputs['results.json']);
    const used=new Set();
    async function artifact(ref,expectedName) { assert.equal(ref.path,expectedName); assert.ok(!used.has(ref.path)); used.add(ref.path); assert.equal(await retain(directory,relative(ref.path)),hash(ref.sha256)); }
    for (const scenario of report.scenarios) {
      await artifact(scenario.readyScreenshot,`${scenario.id}-ready.png`); await artifact(scenario.trace,`${scenario.id}-trace.zip`);
      for (const [index,checkpoint] of scenario.checkpoints.entries()) await artifact(checkpoint.screenshot,`${scenario.id}-${String(index+1).padStart(2,'0')}.png`);
    }
    results.push({report,provenance});
  }
  assert.deepEqual(results[0].provenance.inputAnchors,results[1].provenance.inputAnchors); assert.deepEqual(results[0].provenance.nativePackages,results[1].provenance.nativePackages);
  return {schemaVersion:2,status:'source-bound-browser-pair-verified',...trust.scope,baseline:trust.manifest.baseline.sha,candidate:trust.manifest.candidate.sha,baselineSemanticDifferences:results[0].report.semanticDifferences,fixedSemanticDifferences:results[1].report.semanticDifferences,trustedFiles:trust.files,evidenceFiles,verifiedAt:new Date().toISOString()};
}
