// Build only: this script never creates a server, opens a port, or starts a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { ROOT, argsOf, hashFile, writeJson, json, sha256, auditedCssOutputs, sourceInputKind } from './source.mjs';
import { executionScope, readAttestedPhase } from './phase.mjs';
import { reference, requiredBuildInputs } from './evidence.mjs';
const manifest = await executionScope();
assert.equal(manifest.css.state,'audited-native-css','Native CSS compiler source/output audit is unresolved');
auditedCssOutputs(manifest);
const args = argsOf();
const source = path.resolve(args.source), out = path.resolve(args.out), variant = args.variant;
assert.ok(['baseline','fixed'].includes(variant));
assert.ok(out.startsWith(path.join(ROOT,'work') + path.sep), 'Output must be inside validation work directory');
const evidence = path.join(ROOT,'evidence',variant);
const before = await readAttestedPhase(source,variant,'pre-harness',evidence);
const sourceBefore = before.source;
const sourceRequire = createRequire(path.join(source,'package.json'));
await fs.mkdir(out,{ recursive:true });
const cssAnchor = await json(path.join(evidence,'post-css.css.files.json'));
const inputAnchors={dependencies:await json(path.join(evidence,'post-install.dependencies.files.json')),'icons-es':await json(path.join(evidence,'post-icon.icons-es.files.json')),'icons-cjs':await json(path.join(evidence,'post-icon.icons-cjs.files.json'))};
const nativeCss = path.join(source,manifest.css.mainOutput);
assert.equal(await fs.realpath(nativeCss),nativeCss);
const nativeCssSha256 = await hashFile(nativeCss);
assert.equal(nativeCssSha256,cssAnchor.files[manifest.css.mainOutput].sha256);
assert.equal(await hashFile(path.join(ROOT,'css-source-audit.json')),manifest.css.auditRecordSha256);
await fs.copyFile(nativeCss,path.join(out,'native-source.css'));
const harnessHashes = before.trust.files;
const harnessFiles = Object.keys(harnessHashes);
const provenance = {
  schemaVersion:2, ...sourceBefore, scope:before.trust.scope,predecessor:await reference(evidence,'pre-harness.phase.json'),harnessFiles:harnessHashes,
  node:process.version,
  sourcePackageJsonSha256:await hashFile(path.join(source,'package.json')),
  harnessLockSha256:await hashFile(path.join(ROOT,'package-lock.json')),
  inputAnchors:Object.fromEntries(['dependencies','icons-es','icons-cjs','css'].map(label => [label,before.inventory[label]])),
  nativePackages:await json(path.join(evidence,'native-packages.json')),
  nativeCss:{ output:manifest.css.mainOutput,sha256:nativeCssSha256,command:manifest.preparation.cssArgs,packageScript:manifest.css.packageScript,auditRecordSha256:manifest.css.auditRecordSha256 },
  dependencyVersions:Object.fromEntries(['react','react-dom','number-precision'].map(name => [name,sourceRequire(`${name}/package.json`).version])),
  toolingVersions:{ esbuild:(await json(path.join(ROOT,'node_modules/esbuild/package.json'))).version, playwright:(await json(path.join(ROOT,'node_modules/playwright-core/package.json'))).version,yarn:(await json(path.join(ROOT,'toolchain/node_modules/yarn/package.json'))).version },
};
await writeJson(path.join(out,'runtime-provenance.json'),provenance);
const result = await build({
  absWorkingDir:ROOT, entryPoints:['harness/main.jsx'], outfile:path.join(out,'bundle.js'),
  bundle:true, platform:'browser', format:'iife', sourcemap:true, sourcesContent:true, metafile:true,
  define:{ 'process.env.NODE_ENV':'"production"' },
  nodePaths:[path.join(source,'node_modules')],
  alias:{ '@source':path.join(source,'components'), '@validation/provenance':path.join(out,'runtime-provenance.json'), '@validation/native-css':path.join(out,'native-source.css'), react:path.dirname(sourceRequire.resolve('react/package.json')), 'react-dom':path.dirname(sourceRequire.resolve('react-dom/package.json')) },
});
const inputFiles = Object.keys(result.metafile.inputs).map(file => path.resolve(ROOT,file));
const ledger = {};
const inputBindings = {};
for (const file of inputFiles) {
  const real = await fs.realpath(file);
  let label;
  if (file.startsWith(source + path.sep)) {
    const relative = path.relative(source,file);
    const kind=sourceInputKind(relative,sourceBefore.sourceFiles);
    if(kind !== 'committed') {
      assert.equal(inputAnchors[kind].files[relative]?.type,'file');
      assert.equal(await hashFile(file),inputAnchors[kind].files[relative].sha256);
    }
    assert.equal(real,file,`Unexpected symlinked source/dependency input: ${relative}`);
    label = `source/${relative}`;
  } else if (harnessFiles.some(relative => path.join(ROOT,relative) === file)) label = `validation/${path.relative(ROOT,file)}`;
  else if (file === path.join(out,'runtime-provenance.json')) label = 'validation/runtime-provenance.json';
  else if (file === path.join(out,'native-source.css')) {
    assert.equal(await hashFile(file),nativeCssSha256,'Native CSS bytes changed while copied into bundle inputs');
    label = `source-generated/${manifest.css.mainOutput}`;
  }
  else throw new Error(`Unapproved build input: ${file}`);
  ledger[label] = await hashFile(file);
  inputBindings[path.relative(ROOT,file)] = label;
}
const hook = 'components/Slider/hooks/useLegalValue.ts';
for(const input of requiredBuildInputs(manifest)) assert.ok(Object.hasOwn(ledger,input),`Required real build input missing: ${input}`);
assert.equal(ledger[`source/${hook}`],sourceBefore.sourceFiles[hook],'Actual source hook was not consumed');
const sourceMap = await json(path.join(out,'bundle.js.map'));
const hookIndices = sourceMap.sources.flatMap((file,index) => file.endsWith('/' + hook) ? [index] : []);
assert.equal(hookIndices.length,1);
assert.equal(sha256(sourceMap.sourcesContent[hookIndices[0]]),sourceBefore.sourceFiles[hook]);
const css = await fs.readFile(path.join(out,'bundle.css'),'utf8');
assert.ok(css.includes('.arco-slider-button'));
assert.ok(!/@import|url\s*\(/i.test(css),'External/imported CSS resources are not permitted');
await fs.copyFile(path.join(ROOT,'harness/index.html'),path.join(out,'index.html'));
// The outer stage runner captures this process exit before its post-harness gate.
const artifactHashes = {};
for (const file of ['index.html','bundle.js','bundle.css','bundle.js.map','bundle.css.map']) artifactHashes[file] = await hashFile(path.join(out,file));
await writeJson(path.join(out,'build-provenance.json'),{ ...provenance, artifactHashes, inputFiles:ledger, sourceMapHookSha256:sourceBefore.sourceFiles[hook] });
// Normalize local absolute locations before evidence is eligible for publication.
const normalize = value => JSON.parse(JSON.stringify(value).replaceAll(source,'source').replaceAll(ROOT,'validation'));
await writeJson(path.join(out,'esbuild-metafile.json'),normalize({...result.metafile,inputBindings}));
console.log(JSON.stringify({ variant, source:sourceBefore.commit, inputs:inputFiles.length, artifactHashes }));
