// Hosted-only producer wrapper. Never import or invoke this from local validator tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT,argsOf,hashFile } from './source.mjs';
import { executionScope,auditPhase } from './phase.mjs';
import { loadTrust,STAGES,BUILD_FILES,reference,producerFiles,commandArguments,identity } from './evidence.mjs';
await executionScope();
const trust=await loadTrust(),args=argsOf(),stage=args.stage,variant=args.variant;
assert.ok(['build','browser'].includes(stage)); assert.ok(['baseline','fixed'].includes(variant));
const source=path.resolve(args.source),dist=path.join(ROOT,'work',`dist-${variant}`),evidence=path.join(ROOT,'evidence',variant);
const write=(file,value) => fs.writeFile(path.join(evidence,file),`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});
const before=await auditPhase(source,variant,STAGES[stage][0],evidence);
const predecessor=await reference(evidence,`${STAGES[stage][0]}.phase.json`);
const argv=stage === 'build' ? [path.join(ROOT,'scripts/build.mjs'),'--source',source,'--variant',variant,'--out',dist] : [path.join(ROOT,'scripts/browser.mjs'),'--variant',variant,'--source',source,'--dist',dist,'--out',evidence];
const log=await fs.open(path.join(evidence,`${stage}.log`),'wx');
const startedAt=new Date().toISOString();
let result;
try { result=spawnSync(process.execPath,argv,{cwd:ROOT,env:process.env,stdio:['ignore',log.fd,log.fd]}); }
finally { await log.close(); }
const finishedAt=new Date().toISOString(),actualExitCode=result.status ?? 2,outputs={},diagnosticErrors=[];
try {
  if (stage === 'build') {
    await fs.mkdir(path.join(evidence,'build'),{recursive:true});
    for (const file of BUILD_FILES) {
      await fs.copyFile(path.join(dist,file),path.join(evidence,'build',file),1);
      outputs[`build/${file}`]=await hashFile(path.join(evidence,'build',file));
    }
  } else outputs['results.json']=await hashFile(path.join(evidence,'results.json'));
} catch(error) { diagnosticErrors.push(`Missing producer output: ${error.message}`); }
const target=identity(trust.manifest,variant);
const record={schemaVersion:2,kind:'command',stage,variant,scope:trust.scope,predecessor,producerFiles:producerFiles(trust,stage),command:commandArguments(stage,variant,trust.manifest),environment:{CI:process.env.CI},sourceCommit:target.sha,sourceTree:target.tree,sourceLockSha256:trust.manifest.sourceLockSha256,tools:{harnessNodeVersion:process.versions.node,harnessNodeSha256:await hashFile(process.execPath)},startedAt,finishedAt,exitCode:actualExitCode,signal:result.signal ?? null,error:result.error?.message ?? null,diagnosticErrors,logSha256:await hashFile(path.join(evidence,`${stage}.log`)),outputs};
await write(`${stage}.command.json`,record);
await fs.writeFile(path.join(evidence,`${stage}.exit-code`),`${actualExitCode}\n`,{flag:'wx'});
let postPhase=null,error=null,exitCode=actualExitCode;
try { await auditPhase(source,variant,STAGES[stage][1],evidence); postPhase=await reference(evidence,`${STAGES[stage][1]}.phase.json`); }
catch(caught) { error=String(caught.stack || caught); exitCode=2; }
await write(`${stage}.wrapper.json`,{schemaVersion:2,scope:trust.scope,stage,variant,command:await reference(evidence,`${stage}.command.json`),postPhase,actualExitCode,exitCode,success:error === null,error});
await fs.writeFile(path.join(evidence,`${stage}.wrapper-exit-code`),`${exitCode}\n`,{flag:'wx'});
process.exitCode=exitCode;
