// SYNTHETIC VALIDATOR DATA ONLY. Never runs a producer, package, build or browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT,sha256,hashFile,json } from '../scripts/source.mjs';
import { PHASES,STAGES,GROUPS,BUILD_FILES,REQUIRED_FILES,canonical,producerFiles,commandArguments,commandEnvironment } from '../scripts/evidence.mjs';
import { SCENARIOS,expectedCheckpoints } from '../scripts/spec.mjs';
import { classify } from '../scripts/classify.mjs';
const put=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
const baseEnv={...process.env,GIT_AUTHOR_NAME:'Synthetic validator fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Synthetic validator fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
const g=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',env:baseEnv,stdio:['ignore','pipe','pipe']}).trim();
const ref=async(dir,name)=>({path:name,sha256:await hashFile(path.join(dir,name))});
export async function fixture(parent) {
  await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'synthetic-positive-'));
  for(const file of REQUIRED_FILES) if(!['candidate.patch'].includes(file)) {
    await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.copyFile(path.join(ROOT,file),path.join(root,file));
  }
  await put(path.join(root,'SYNTHETIC.txt'),'SYNTHETIC ONLY: invented inert artifacts for validator testing. No real product or browser evidence.\n');
  await put(path.join(root,'.gitignore'),'work/\nevidence/\nnode_modules/\ntoolchain/node_modules/\n');
  const repo=path.join(root,'work/source-repo');await fs.mkdir(repo,{recursive:true});g(repo,'init','-q');
  const hook='components/Slider/hooks/useLegalValue.ts',testFile='components/Slider/__test__/index.test.tsx',slider='components/Slider/index.tsx',plugin='components/style/theme/color/palette.js';
  await put(path.join(repo,'package.json'),{name:'synthetic-source-only',version:'0.0.0',scripts:{'build:css':'arco-scripts build:component:css'}});
  await put(path.join(repo,'yarn.lock'),'SYNTHETIC source lock; never installed\n');
  for(const [file,text] of [[hook,'// SYNTHETIC baseline hook; never executed\n'],[testFile,'// SYNTHETIC baseline tests; never executed\n'],[slider,'// SYNTHETIC Slider marker; never executed\n'],[plugin,'// SYNTHETIC inert color plugin\n']])await put(path.join(repo,file),text);
  g(repo,'add','.');const baseTree=g(repo,'write-tree'),base=g(repo,'commit-tree',baseTree,'-m','Synthetic baseline');g(repo,'update-ref','HEAD',base);
  await put(path.join(repo,hook),'// SYNTHETIC candidate hook; never executed\n');await put(path.join(repo,testFile),'// SYNTHETIC candidate tests; never executed\n');
  g(repo,'add','.');const fixedTree=g(repo,'write-tree'),fixed=g(repo,'commit-tree',fixedTree,'-p',base,'-m','Synthetic candidate');g(repo,'update-ref','HEAD',fixed);
  const patch=execFileSync('git',['-C',repo,'diff',base,fixed],{env:baseEnv});await fs.writeFile(path.join(root,'candidate.patch'),patch);
  const sourceLock=await hashFile(path.join(repo,'yarn.lock'));
  const cssText='/* SYNTHETIC inert CSS */ .arco-slider-button{} .arco-input{} .arco-tooltip{}\n';
  const cssOutputs=['dist/css/arco.min.css','es/style/theme/color/palette.js'];
  const cssAudit={outputFiles:cssOutputs,expectedCopies:{'es/style/theme/color/palette.js':{source:plugin,sha256:await hashFile(path.join(repo,plugin))}},permittedEmptyOutputs:{},sourceInputs:{[plugin]:await hashFile(path.join(repo,plugin))}};
  await put(path.join(root,'css-source-audit.json'),cssAudit);
  const manifest=await json(path.join(root,'source-manifest.json'));
  manifest.syntheticFixture=true;manifest.state='frozen-audited';manifest.baseline={repository:'arco-design/arco-design',sha:base,tree:baseTree};
  manifest.candidate={repository:'dvd233/arco-design',sha:fixed,tree:fixedTree,parents:[base],files:{[hook]:await hashFile(path.join(repo,hook)),[testFile]:await hashFile(path.join(repo,testFile))}};
  manifest.allowedChangedFiles=[hook,testFile];manifest.sourceLockSha256=sourceLock;manifest.candidatePatchSha256=sha256(patch);
  manifest.execution={repository:'dvd233/arco-design',repositoryId:'1407419356',ownerId:'111864431',ref:'refs/heads/validation/slider-negative-marks'};
  manifest.preparation.nativeNodeVersion=process.versions.node;
  manifest.runtime={harnessNodeVersion:process.versions.node,harnessNodeSha256:await hashFile(process.execPath),nativeNodeSha256:await hashFile(process.execPath),chromiumVersion:'999.0.0.0',maxEvidenceAgeSeconds:3600,toolingVersions:{esbuild:'0.25.12',playwright:'1.56.1',yarn:'1.22.22'}};
  manifest.css={state:'audited-native-css',mainOutput:cssOutputs[0],outputFiles:cssOutputs,environment:{},auditRecordSha256:await hashFile(path.join(root,'css-source-audit.json')),packageScript:'arco-scripts build:component:css',requiredCompilerFiles:{}};
  await put(path.join(root,'source-manifest.json'),manifest);
  await put(path.join(root,'toolchain/node_modules/yarn/bin/yarn.js'),'SYNTHETIC inert Yarn entry; never executed\n');
  const frozenNames=[...REQUIRED_FILES,'.gitignore','SYNTHETIC.txt'];const publication={schemaVersion:1,files:{}};
  for(const file of frozenNames)publication.files[file]={sha256:await hashFile(path.join(root,file)),bytes:(await fs.stat(path.join(root,file))).size};
  await put(path.join(root,'publication-manifest.json'),publication);g(root,'init','-q');g(root,'add',...frozenNames,'publication-manifest.json');const pubTree=g(root,'write-tree'),commit=g(root,'commit-tree',pubTree,'-m','SYNTHETIC validator publication');g(root,'update-ref','HEAD',commit);
  const env={...baseEnv,GITHUB_ACTIONS:'true',CI:'true',GITHUB_REPOSITORY:manifest.execution.repository,GITHUB_REPOSITORY_ID:manifest.execution.repositoryId,GITHUB_REPOSITORY_OWNER_ID:manifest.execution.ownerId,GITHUB_REF:manifest.execution.ref,GITHUB_EVENT_NAME:'push',GITHUB_RUN_ID:'77777777777',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:commit};
  const scope={runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,validationCommit:commit,manifestSha256:await hashFile(path.join(root,'source-manifest.json')),publicationSha256:await hashFile(path.join(root,'publication-manifest.json'))};
  const files=Object.fromEntries(Object.entries(publication.files).map(([name,data])=>[name,data.sha256])),trust={root,manifest,scope,files};
  const tools={nativeNodeVersion:manifest.preparation.nativeNodeVersion,nativeNodeSha256:manifest.runtime.nativeNodeSha256,yarnVersion:manifest.preparation.yarnVersion,yarnEntrySha256:await hashFile(path.join(root,'toolchain/node_modules/yarn/bin/yarn.js')),harnessLockSha256:manifest.harnessLockSha256,toolchainLockSha256:manifest.toolchainLockSha256};
  let time=Date.now()-120000;const stamp=()=>new Date(time+=100).toISOString();
  const sourceTools=await import(pathToFileURL(path.join(root,'scripts/source.mjs')).href);
  for(const variant of ['baseline','fixed']) {
    const source=path.join(root,'work',variant);g(root,'clone','-q','--no-hardlinks',repo,source);g(source,'checkout','-q','--detach',variant==='baseline'?base:fixed);
    const directory=path.join(root,'evidence',variant),dist=path.join(root,'work',`dist-${variant}`);await fs.mkdir(directory,{recursive:true});await fs.mkdir(dist,{recursive:true});
    const dependencyFiles={},versions={...manifest.preparation.nativePackageVersions,'number-precision':'1.6.0'};
    for(const [name,version]of Object.entries(versions)) {const file=`node_modules/${name}/package.json`,entry=`node_modules/${name}/index.js`;await put(path.join(source,file),{name,version,main:'index.js',synthetic:true});await put(path.join(source,entry),'// SYNTHETIC inert dependency entry; never executed\n');dependencyFiles[file]={type:'file',sha256:await hashFile(path.join(source,file))};dependencyFiles[entry]={type:'file',sha256:await hashFile(path.join(source,entry))};}
    const groupFiles={dependencies:dependencyFiles,'icons-es':{},'icons-cjs':{},css:{}};
    for(const label of ['icons-es','icons-cjs']){const file=`icon/${label==='icons-es'?'react-icon':'react-icon-cjs'}/context.js`;await put(path.join(source,file),'SYNTHETIC inert icon\n');groupFiles[label][file]={type:'file',sha256:await hashFile(path.join(source,file))};}
    await put(path.join(source,cssOutputs[0]),cssText);await put(path.join(source,cssOutputs[1]),await fs.readFile(path.join(source,plugin),'utf8'));
    for(const file of cssOutputs)groupFiles.css[file]={type:'file',sha256:await hashFile(path.join(source,file))};
    const summaries=Object.fromEntries(Object.entries(groupFiles).map(([label,entries])=>[label,{count:Object.keys(entries).length,sha256:sha256(canonical(entries))}]));
    const sourceRecord=await sourceTools.verifySource(source,variant),target=variant==='baseline'?manifest.baseline:manifest.candidate;
    const baseContext={variant,commit:target.sha,tree:target.tree,sourceLockSha256:sourceLock,scope};
    const modules=[];for(const [name,version]of Object.entries(manifest.preparation.nativePackageVersions)){const packagePath=`node_modules/${name}/package.json`;modules.push({name,version,packagePath,sha256:dependencyFiles[packagePath].sha256});}
    const nativePackages={tools,modules};await put(path.join(directory,'native-packages.json'),nativePackages);
    const compiler='node_modules/arco-scripts/package.json';
    const resolutionPairs=[[compiler,'gulp-less'],['node_modules/gulp-less/package.json','less'],...['less-plugin-npm-import','less-plugin-autoprefix','gulp-clean-css'].map(name=>[compiler,name]),...['components','es','lib'].flatMap(prefix=>['palette.js','palette-dark.js','getRgbStr.js'].map(name=>[`${prefix}/style/theme/color/${name}`,'@arco-design/color']))];
    await put(path.join(directory,'css-package-resolution.json'),{sourceCommit:target.sha,sourceTree:target.tree,sourceLockSha256:sourceLock,resolutions:resolutionPairs.map(([from,name])=>{const packagePath=`node_modules/${name}/package.json`,entryPath=`node_modules/${name}/index.js`;return {from,name,version:versions[name],packagePath,packageSha256:dependencyFiles[packagePath].sha256,entryPath,entrySha256:dependencyFiles[entryPath].sha256};})});
    const auditors=Object.fromEntries(['scripts/phase.mjs','scripts/source.mjs','scripts/input-inventory.py','scripts/evidence.mjs'].map(name=>[name,files[name]]));
    let provenance,report;
    async function buildPayload(predecessor) {
      provenance={schemaVersion:2,...sourceRecord,scope,predecessor,harnessFiles:files,node:process.version,sourcePackageJsonSha256:sourceRecord.sourceFiles['package.json'],harnessLockSha256:manifest.harnessLockSha256,inputAnchors:summaries,nativePackages,nativeCss:{output:manifest.css.mainOutput,sha256:groupFiles.css[manifest.css.mainOutput].sha256,command:manifest.preparation.cssArgs,packageScript:manifest.css.packageScript,auditRecordSha256:manifest.css.auditRecordSha256},dependencyVersions:{react:versions.react,'react-dom':versions['react-dom'],'number-precision':versions['number-precision']},toolingVersions:manifest.runtime.toolingVersions};
      await put(path.join(dist,'runtime-provenance.json'),provenance);await put(path.join(dist,'native-source.css'),cssText);
      await put(path.join(dist,'index.html'),'SYNTHETIC inert HTML; never served\n');await put(path.join(dist,'bundle.js'),'SYNTHETIC inert bundle; never executed\n');await put(path.join(dist,'bundle.css'),cssText);
      await put(path.join(dist,'bundle.js.map'),{sources:['source/'+hook],sourcesContent:[await fs.readFile(path.join(source,hook),'utf8')]});await put(path.join(dist,'bundle.css.map'),{synthetic:true});
      provenance.artifactHashes={};for(const file of ['index.html','bundle.js','bundle.css','bundle.js.map','bundle.css.map'])provenance.artifactHashes[file]=await hashFile(path.join(dist,file));
      provenance.inputFiles={[`source/${hook}`]:sourceRecord.sourceFiles[hook],[`source/${slider}`]:sourceRecord.sourceFiles[slider],'validation/harness/main.jsx':files['harness/main.jsx'],'validation/harness/style.css':files['harness/style.css'],'validation/scripts/spec.mjs':files['scripts/spec.mjs'],[`source-generated/${manifest.css.mainOutput}`]:groupFiles.css[manifest.css.mainOutput].sha256,'validation/runtime-provenance.json':await hashFile(path.join(dist,'runtime-provenance.json'))};
      provenance.sourceMapHookSha256=sourceRecord.sourceFiles[hook];await put(path.join(dist,'build-provenance.json'),provenance);
      const bindings=Object.fromEntries(Object.keys(provenance.inputFiles).map((label,index)=>[`SYNTHETIC-${index}`,label]));await put(path.join(dist,'esbuild-metafile.json'),{inputs:Object.fromEntries(Object.keys(bindings).map(name=>[name,{synthetic:true}])),outputs:{'bundle.js':{synthetic:true}},inputBindings:bindings});
      for(const file of BUILD_FILES){await fs.mkdir(path.join(directory,'build'),{recursive:true});await fs.copyFile(path.join(dist,file),path.join(directory,'build',file));}
    }
    async function browserPayload() {
      report={schemaVersion:1,variant,completed:true,errors:[],scenarios:[],runId:scope.runId,runAttempt:scope.runAttempt,validationCommit:scope.validationCommit,startedAt:stamp(),finishedAt:stamp(),provenance,browserVersion:manifest.runtime.chromiumVersion};
      const artifact=async name=>{await put(path.join(directory,name),'SYNTHETIC VALIDATOR BYTES: NOT AN IMAGE, TRACE OR BROWSER RESULT\n');return {path:name,sha256:await hashFile(path.join(directory,name))};};
      const codes={ArrowRight:39,ArrowLeft:37,ArrowUp:38,ArrowDown:40};
      for(const scenario of SCENARIOS){const expected=expectedCheckpoints(scenario,variant),keyEvents=[];const entry={id:scenario.id,completed:true,initial:{values:Array.isArray(scenario.initial)?scenario.initial:[scenario.initial],events:[],accepted:[],keyEvents:[]},readyScreenshot:await artifact(`${scenario.id}-ready.png`),trace:await artifact(`${scenario.id}-trace.zip`),checkpoints:[]};
        for(const[index,step]of scenario.steps.entries()){if(step.action==='key')keyEvents.push({key:step.press,keyCode:codes[step.press],trusted:true});entry.checkpoints.push({step,actual:{...expected[index],keyEvents:structuredClone(keyEvents)},screenshot:await artifact(`${scenario.id}-${String(index+1).padStart(2,'0')}.png`)});}report.scenarios.push(entry);}
      Object.assign(report,classify(report));await put(path.join(directory,'results.json'),report);
    }
    for(const[index,phase]of PHASES.entries()){
      const predecessor=index?await ref(directory,`${PHASES[index-1]}.phase.json`):null;const stage=Object.keys(STAGES).find(key=>STAGES[key][1]===phase);let producer=null;
      if(stage){const start=stamp();if(stage==='build')await buildPayload(predecessor);if(stage==='browser')await browserPayload();const finish=stamp();
        await put(path.join(directory,`${stage}.log`),`SYNTHETIC ${stage} log; no producer was run\n${stage==='css'?'Build css success!\n':''}`);
        const outputs={};if(stage==='build')for(const file of BUILD_FILES)outputs[`build/${file}`]=await hashFile(path.join(directory,'build',file));if(stage==='browser')outputs['results.json']=await hashFile(path.join(directory,'results.json'));
        const exit=stage==='browser'&&variant==='baseline'?1:0;
        const command={schemaVersion:2,kind:'command',stage,variant,scope,predecessor,producerFiles:producerFiles(trust,stage),command:commandArguments(stage,variant,manifest),environment:commandEnvironment(stage,manifest),sourceCommit:target.sha,sourceTree:target.tree,sourceLockSha256:sourceLock,tools:['build','browser'].includes(stage)?{harnessNodeVersion:process.versions.node,harnessNodeSha256:manifest.runtime.harnessNodeSha256}:tools,startedAt:start,finishedAt:finish,exitCode:exit,signal:null,error:null,diagnosticErrors:[],logSha256:await hashFile(path.join(directory,`${stage}.log`)),outputs};
        if(stage==='css')command.packageResolutionSha256=await hashFile(path.join(directory,'css-package-resolution.json'));
        await put(path.join(directory,`${stage}.command.json`),command);await put(path.join(directory,`${stage}.exit-code`),`${exit}\n`);producer=await ref(directory,`${stage}.command.json`);
        for(const[label,anchorPhase]of Object.entries(GROUPS))if(anchorPhase===phase)await put(path.join(directory,`${phase}.${label}.files.json`),{...summaries[label],files:groupFiles[label],context:{...baseContext,commandRecordSha256:producer.sha256,predecessor}});
      }
      const startedAt=stamp(),context={schemaVersion:2,phase,variant,scope,predecessor,producer,startedAt,auditorFiles:auditors};await put(path.join(directory,`${phase}.context.json`),context);await put(path.join(directory,`${phase}.source.json`),sourceRecord);
      const inventory={context:baseContext,phase,chain:{contextSha256:await hashFile(path.join(directory,`${phase}.context.json`)),predecessor,producer},errors:[],unexpectedUntracked:[]};
      for(const[label,anchorPhase]of Object.entries(GROUPS))inventory[label]=index<PHASES.indexOf(anchorPhase)?{count:0,sha256:sha256(canonical({}))}:summaries[label];
      await put(path.join(directory,`${phase}.integrity.json`),inventory);await put(path.join(directory,`${phase}.inventory.log`),'SYNTHETIC inventory transcript; no producer run\n');
      const receipt={schemaVersion:2,kind:'phase',phase,variant,scope,predecessor,producer,startedAt,finishedAt:stamp(),source:await ref(directory,`${phase}.source.json`),integrity:await ref(directory,`${phase}.integrity.json`),context:await ref(directory,`${phase}.context.json`),auditorFiles:auditors,success:true};await put(path.join(directory,`${phase}.phase.json`),receipt);
      if(['build','browser'].includes(stage)){const exit=stage==='browser'&&variant==='baseline'?1:0;await put(path.join(directory,`${stage}.wrapper.json`),{schemaVersion:2,scope,stage,variant,command:producer,postPhase:await ref(directory,`${phase}.phase.json`),actualExitCode:exit,exitCode:exit,success:true,error:null});await put(path.join(directory,`${stage}.wrapper-exit-code`),`${exit}\n`);}
    }
  }
  return {root,env,manifest,scope};
}
export function runValidator(value){return execFileSync(process.execPath,[path.join(value.root,'scripts/verify-pair.mjs'),'--baseline','evidence/baseline','--fixed','evidence/fixed','--out','evidence/VERDICT.json'],{cwd:value.root,env:value.env,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
// Rehash references after an intentional synthetic mutation. Values are NOT repaired:
// this lets negative probes reach cross-record semantic checks instead of only stale hashes.
export async function reseal(value,variant='baseline') {
  const dir=path.join(value.root,'evidence',variant),dist=path.join(value.root,'work',`dist-${variant}`);
  const read=name=>json(path.join(dir,name));const write=(name,data)=>put(path.join(dir,name),data);
  async function refreshReference(reference){if(reference)reference.sha256=await hashFile(path.join(dir,reference.path));return reference;}
  for(const phase of PHASES){
    const receipt=await read(`${phase}.phase.json`);await refreshReference(receipt.predecessor);
    const stage=Object.keys(STAGES).find(name=>STAGES[name][1]===phase);
    if(stage){
      const command=await read(`${stage}.command.json`);await refreshReference(command.predecessor);
      if(stage==='build'){
        const prov=await read('build/build-provenance.json');prov.predecessor=command.predecessor;
        if(prov.inputAnchors&&Object.keys(prov.inputAnchors).length)for(const[label,at]of Object.entries(GROUPS)){const a=await read(`${at}.${label}.files.json`);prov.inputAnchors[label]={sha256:a.sha256,count:a.count};}
        const runtime={...prov};delete runtime.artifactHashes;delete runtime.inputFiles;delete runtime.sourceMapHookSha256;await write('build/runtime-provenance.json',runtime);
        if(prov.inputFiles?.['validation/runtime-provenance.json'])prov.inputFiles['validation/runtime-provenance.json']=await hashFile(path.join(dir,'build/runtime-provenance.json'));
        await write('build/build-provenance.json',prov);const report=await read('results.json');report.provenance=prov;await write('results.json',report);
        for(const file of BUILD_FILES){await fs.copyFile(path.join(dir,'build',file),path.join(dist,file));command.outputs[`build/${file}`]=await hashFile(path.join(dir,'build',file));}
      }
      if(stage==='browser')command.outputs['results.json']=await hashFile(path.join(dir,'results.json'));
      command.logSha256=await hashFile(path.join(dir,`${stage}.log`));if(stage==='css')command.packageResolutionSha256=await hashFile(path.join(dir,'css-package-resolution.json'));
      await write(`${stage}.command.json`,command);receipt.producer=await ref(dir,`${stage}.command.json`);
      for(const[label,at]of Object.entries(GROUPS))if(at===phase){const anchor=await read(`${at}.${label}.files.json`);anchor.context.commandRecordSha256=receipt.producer.sha256;await refreshReference(anchor.context.predecessor);await write(`${at}.${label}.files.json`,anchor);}
    }
    const context=await read(`${phase}.context.json`);context.predecessor=receipt.predecessor;context.producer=receipt.producer;await write(`${phase}.context.json`,context);
    const inventory=await read(`${phase}.integrity.json`);inventory.chain={contextSha256:await hashFile(path.join(dir,`${phase}.context.json`)),predecessor:receipt.predecessor,producer:receipt.producer};
    for(const[label,at]of Object.entries(GROUPS))if(PHASES.indexOf(phase)>=PHASES.indexOf(at)){const anchor=await read(`${at}.${label}.files.json`);inventory[label]={count:anchor.count,sha256:anchor.sha256};}
    await write(`${phase}.integrity.json`,inventory);
    for(const key of ['source','integrity','context'])await refreshReference(receipt[key]);await write(`${phase}.phase.json`,receipt);
    if(['build','browser'].includes(stage)){const wrapper=await read(`${stage}.wrapper.json`);await refreshReference(wrapper.command);await refreshReference(wrapper.postPhase);await write(`${stage}.wrapper.json`,wrapper);}
  }
}
