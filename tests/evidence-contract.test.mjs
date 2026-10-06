// Pure-validator probes against synthetic artifacts. No producer/product/browser run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT,json,hashFile,sha256 } from '../scripts/source.mjs';
import { PHASES,canonical } from '../scripts/evidence.mjs';
import { fixture,runValidator,reseal } from './evidence-fixture.mjs';
const parent=path.join(ROOT,'evidence/synthetic-tests');
const write=(p,value)=>fs.writeFile(p,JSON.stringify(value,null,2)+'\n');
const change=async(value,name,fn,variant='baseline')=>{const file=path.join(value.root,'evidence',variant,name),data=await json(file);fn(data);await write(file,data);};
async function clone(base,name){const root=path.join(parent,`synthetic-probe-${name}`);await fs.rm(root,{recursive:true,force:true});await fs.cp(base.root,root,{recursive:true});return {...base,root};}
const pairResults=[],phaseResults=[];
test('complete synthetic chain passes and value/absence/cross-binding probes fail',async()=>{
  const base=await fixture(parent);try{runValidator(base);}catch(error){console.error(error.stderr?.toString());throw error;}
  const verdict=await json(path.join(base.root,'evidence/VERDICT.json'));assert.equal(verdict.status,'source-bound-browser-pair-verified');assert.ok(Object.keys(verdict.evidenceFiles).length>100);
  pairResults.push({name:'complete-positive-contract',exit:0,synthetic:true});
  const cases=[
    ['missing-whole-chain',async v=>{for(const p of PHASES)await fs.rm(path.join(v.root,'evidence/baseline',`${p}.phase.json`));await fs.rm(path.join(v.root,'evidence/baseline/build'),{recursive:true});},false],
    ['empty-binding-records-and-actual-exit-2',async v=>{await change(v,'build/build-provenance.json',p=>{for(const k of ['harnessFiles','dependencyVersions','toolingVersions','inputAnchors','nativePackages'])p[k]={};});await fs.writeFile(path.join(v.root,'evidence/baseline/browser.exit-code'),'2\n');},true],
    ['changed-current-runner',async v=>fs.appendFile(path.join(v.root,'scripts/browser.mjs'),'\n// SYNTHETIC tampering\n'),false],
    ['wrong-execution-scope',async v=>{v.env={...v.env,GITHUB_REPOSITORY:'unapproved/synthetic'};},false],
    ['old-run-producer',v=>change(v,'install.command.json',p=>{p.scope.runId='OLD-RUN';}),true],
    ['wrong-validation-commit-producer',v=>change(v,'icon.command.json',p=>{p.scope.validationCommit='f'.repeat(40);}),true],
    ['old-producer-timestamp',v=>change(v,'install.command.json',p=>{p.startedAt='2000-01-01T00:00:00Z';p.finishedAt='2000-01-01T00:01:00Z';}),true],
    ['failed-predecessor',v=>change(v,'pre-install.phase.json',p=>{p.success=false;}),true],
    ['wrong-predecessor',v=>change(v,'install.command.json',p=>{p.predecessor.path='prepared.phase.json';}),true],
    ['wrong-native-command',v=>change(v,'css.command.json',p=>{p.command=['<native-node>','unapproved-command'];}),true],
    ['wrong-command-environment',v=>change(v,'css.command.json',p=>{p.environment.BUILD_ENV_MODE='development';}),true],
    ['unknown-native-runtime',v=>change(v,'install.command.json',p=>{p.tools.nativeNodeSha256='f'.repeat(64);}),true],
    ['compiler-failure-log-cannot-be-restamped',async v=>fs.appendFile(path.join(v.root,'evidence/baseline/css.log'),'Failed to build css: SYNTHETIC failure\n'),true],
    ['raw-native-exit-disagrees',async v=>fs.writeFile(path.join(v.root,'evidence/baseline/icon.exit-code'),'2\n'),true],
    ['raw-browser-exit-disagrees',async v=>fs.writeFile(path.join(v.root,'evidence/baseline/browser.exit-code'),'2\n'),true],
    ['wrapper-misstates-exit',v=>change(v,'browser.wrapper.json',p=>{p.actualExitCode=2;}),true],
    ['wrapper-skips-post-phase',v=>change(v,'browser.wrapper.json',p=>{p.postPhase.path='pre-browser.phase.json';}),true],
    ['anchor-count-recomputed',v=>change(v,'post-install.dependencies.files.json',p=>{p.count++;}),true],
    ['anchor-digest-recomputed',v=>change(v,'post-install.dependencies.files.json',p=>{p.sha256='f'.repeat(64);}),true],
    ['anchor-entry-real-bytes-bound',v=>change(v,'post-install.dependencies.files.json',p=>{p.files[Object.keys(p.files)[0]].sha256='f'.repeat(64);p.sha256=sha256(canonical(p.files));}),true],
    ['empty-anchor',v=>change(v,'post-install.dependencies.files.json',p=>{p.files={};p.count=0;p.sha256=sha256(canonical({}));}),true],
    ['old-anchor-scope',v=>change(v,'post-icon.icons-es.files.json',p=>{p.context.scope.runAttempt='OLD';}),true],
    ['source-phase-blobs-bound',v=>change(v,'post-css.source.json',p=>{p.sourceFiles['components/Slider/index.tsx']='f'.repeat(64);}),true],
    ['phase-errors-are-fatal',v=>change(v,'post-css.integrity.json',p=>{p.errors=['SYNTHETIC unexpected source drift'];}),true],
    ['unknown-tooling-version',v=>change(v,'build/build-provenance.json',p=>{p.toolingVersions.esbuild='999.0.0';}),true],
    ['empty-native-package-provenance',async v=>{await write(path.join(v.root,'evidence/baseline/native-packages.json'),{});await change(v,'build/build-provenance.json',p=>{p.nativePackages={};});},true],
    ['incomplete-css-resolution-chain',v=>change(v,'css-package-resolution.json',p=>{p.resolutions.pop();}),true],
    ['unknown-dependency-version',v=>change(v,'build/build-provenance.json',p=>{p.dependencyVersions['number-precision']='999.0.0';}),true],
    ['missing-build-inputs',v=>change(v,'build/build-provenance.json',p=>{p.inputFiles={};}),true],
    ['changed-build-source-input',v=>change(v,'build/build-provenance.json',p=>{p.inputFiles['source/components/Slider/hooks/useLegalValue.ts']='f'.repeat(64);}),true],
    ['source-git-config-is-not-an-authorized-build-input',async v=>{
      const label='source/.git/config',digest=await hashFile(path.join(v.root,'work/baseline/.git/config'));
      await change(v,'build/build-provenance.json',p=>{p.inputFiles[label]=digest;});
      await change(v,'build/esbuild-metafile.json',p=>{p.inputs['SYNTHETIC-unauthorized-git']={synthetic:true};p.inputBindings['SYNTHETIC-unauthorized-git']=label;});
    },true],
    ['required-main-and-native-css-inputs-cannot-disappear',async v=>{
      const removed=['validation/harness/main.jsx',`source-generated/${v.manifest.css.mainOutput}`];
      await change(v,'build/build-provenance.json',p=>{for(const label of removed)delete p.inputFiles[label];});
      await change(v,'build/esbuild-metafile.json',p=>{for(const[name,label]of Object.entries(p.inputBindings))if(removed.includes(label)){delete p.inputBindings[name];delete p.inputs[name];}});
    },true],
    ['empty-build-graph',v=>change(v,'build/esbuild-metafile.json',p=>{p.inputs={};p.inputBindings={};}),true],
    ['archive-artifact-changed',async v=>fs.appendFile(path.join(v.root,'evidence/baseline/build/bundle.js'),'SYNTHETIC corrupt'),false],
    ['served-build-disagrees',async v=>fs.appendFile(path.join(v.root,'work/dist-baseline/bundle.js'),'SYNTHETIC corrupt'),false],
    ['sourcemap-bound-to-real-hook',async v=>{await change(v,'build/bundle.js.map',p=>{p.sourcesContent[0]='SYNTHETIC different hook';});await change(v,'build/build-provenance.json',async()=>{});const file=path.join(v.root,'evidence/baseline/build/build-provenance.json'),p=await json(file);p.artifactHashes['bundle.js.map']=await hashFile(path.join(v.root,'evidence/baseline/build/bundle.js.map'));await write(file,p);},true],
    ['browser-runtime-frozen',v=>change(v,'results.json',p=>{p.browserVersion='888.0.0.0';}),true],
    ['semantic-payload-still-strict',v=>change(v,'results.json',p=>{p.scenarios[0].checkpoints[0].actual.values=[999];}),true],
    ['screenshot-bytes-bound',async v=>{const r=await json(path.join(v.root,'evidence/baseline/results.json'));await fs.appendFile(path.join(v.root,'evidence/baseline',r.scenarios[0].readyScreenshot.path),'SYNTHETIC corrupt');},false],
    ['trace-bytes-bound',async v=>{const r=await json(path.join(v.root,'evidence/baseline/results.json'));await fs.appendFile(path.join(v.root,'evidence/baseline',r.scenarios[0].trace.path),'SYNTHETIC corrupt');},false],
  ];
  for(const[name,mutate,rehash]of cases){const v=await clone(base,name);await mutate(v);if(rehash)await reseal(v);let result;try{runValidator(v);result={exit:0};}catch(error){result={exit:error.status??1,stderr:error.stderr?.toString().slice(-1400)};}pairResults.push({name,...result,synthetic:true,refsRehashed:rehash});assert.notEqual(result.exit,0,name);}
  await write(path.join(parent,'pair-v2-counterexamples.json'),{method:'Complete positive synthetic contract plus corrupt-value/chain tests; no browser or build run',results:pairResults});
});
test('post-install requires a current successful exact predecessor and producer',async()=>{
  const base=await fixture(parent);
  async function prepare(name){const v=await clone(base,`phase-${name}`),dir=path.join(v.root,'evidence/baseline'),source=path.join(v.root,'work/baseline');
    await fs.rm(path.join(source,'icon'),{recursive:true});await fs.rm(path.join(source,'es'),{recursive:true});await fs.rm(path.join(source,'dist'),{recursive:true});
    for(const file of ['post-install.integrity.json','post-install.dependencies.files.json'])await fs.rm(path.join(dir,file));return {...v,dir,source};}
  async function rescopeRefs(v){const c=await json(path.join(v.dir,'install.command.json'));c.predecessor.sha256=await hashFile(path.join(v.dir,c.predecessor.path));await write(path.join(v.dir,'install.command.json'),c);const p=await json(path.join(v.dir,'post-install.context.json'));p.predecessor.sha256=await hashFile(path.join(v.dir,p.predecessor.path));p.producer.sha256=await hashFile(path.join(v.dir,p.producer.path));await write(path.join(v.dir,'post-install.context.json'),p);}
  function run(v){const r=spawnSync('python3',[path.join(v.root,'scripts/input-inventory.py'),v.source,'baseline','post-install',v.dir],{env:v.env,encoding:'utf8'});return {exit:r.status,stderr:r.stderr?.trim()};}
  const valid=await prepare('positive');let result=run(valid);phaseResults.push({name:'complete-current-predecessor-positive',...result});assert.equal(result.exit,0,result.stderr);
  result=run(valid);phaseResults.push({name:'cannot-overwrite-existing-anchor',...result});assert.notEqual(result.exit,0);
  const mutations=[
    ['no-pre-install',async v=>fs.rm(path.join(v.dir,'pre-install.phase.json')),false],
    ['explicit-old-run-producer',v=>change(v,'install.command.json',p=>{p.scope.runId='OLD-RUN';}),true],
    ['wrong-validation-commit',v=>change(v,'install.command.json',p=>{p.scope.validationCommit='f'.repeat(40);}),true],
    ['old-timestamps-current-run',v=>change(v,'install.command.json',p=>{p.startedAt='2000-01-01T00:00:00Z';p.finishedAt='2000-01-01T00:01:00Z';}),true],
    ['failed-predecessor-current-scope',v=>change(v,'pre-install.phase.json',p=>{p.success=false;}),true],
    ['old-predecessor-current-producer',v=>change(v,'pre-install.phase.json',p=>{p.scope.runId='OLD-RUN';}),true],
    ['skipped-producing-stage',v=>change(v,'install.command.json',p=>{p.stage='icon';}),true],
    ['raw-exit-is-2',async v=>fs.writeFile(path.join(v.dir,'install.exit-code'),'2\n'),true],
    ['changed-log-after-producer',async v=>fs.appendFile(path.join(v.dir,'install.log'),'SYNTHETIC changed'),true],
    ['wrong-command-predecessor',v=>change(v,'install.command.json',p=>{p.predecessor.path='prepared.phase.json';}),true],
  ];
  for(const[name,mutate,rehash]of mutations){const v=await prepare(name);await mutate(v);if(rehash)await rescopeRefs(v);result=run(v);phaseResults.push({name,...result,producerRefsRehashed:rehash});assert.notEqual(result.exit,0,name);}
  await write(path.join(parent,'phase-v2-counterexamples.json'),{method:'Direct pure inventory validator only, with complete synthetic predecessor/producer; no install',results:phaseResults});
});
