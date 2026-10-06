import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, json, verifySource, auditedCssOutputs } from './source.mjs';
import { loadTrust, PHASES, phasePredecessor, stageForPhase, reference, checkReference, validateCommand, timestamp, producerFiles } from './evidence.mjs';
const exclusive = (file,value) => fs.writeFile(file,`${JSON.stringify(value,null,2)}\n`,{ flag:'wx' });
export async function executionScope() {
  const trust=await loadTrust(); auditedCssOutputs(trust.manifest); return trust.manifest;
}
export async function readAttestedPhase(source,variant,phase,evidence) {
  const trust=await loadTrust();
  const receipt=await json(path.join(evidence,`${phase}.phase.json`));
  assert.equal(receipt.success,true); assert.equal(receipt.phase,phase); assert.equal(receipt.variant,variant); assert.deepEqual(receipt.scope,trust.scope);
  const recorded=await checkReference(evidence,receipt.source,`${phase}.source.json`);
  const current=await verifySource(source,variant); assert.deepEqual(recorded,current);
  const inventory=await checkReference(evidence,receipt.integrity,`${phase}.integrity.json`);
  assert.deepEqual(inventory.errors,[]); assert.deepEqual(inventory.context.scope,trust.scope);
  return { source:current,inventory,receipt,trust };
}
export async function auditPhase(source,variant,phase,evidence) {
  const trust=await loadTrust(); assert.ok(PHASES.includes(phase));
  assert.equal(path.resolve(evidence),path.join(ROOT,'evidence',variant)); await fs.mkdir(evidence,{ recursive:true });
  const startedAt=new Date().toISOString();
  const previous=phasePredecessor(phase);
  const predecessor=previous ? await reference(evidence,`${previous}.phase.json`) : null;
  if (previous) {
    const before=await checkReference(evidence,predecessor,`${previous}.phase.json`);
    assert.equal(before.success,true); assert.equal(before.phase,previous); assert.equal(before.variant,variant); assert.deepEqual(before.scope,trust.scope);
    assert.ok(timestamp(before.finishedAt,trust) <= timestamp(startedAt,trust));
  }
  const stage=stageForPhase(phase);
  let producer=null;
  if (stage) {
    const command=await validateCommand(evidence,stage,variant,trust,predecessor);
    assert.ok(timestamp(command.finishedAt,trust) <= timestamp(startedAt,trust));
    producer=await reference(evidence,`${stage}.command.json`);
  }
  const auditorFiles=Object.fromEntries(['scripts/phase.mjs','scripts/source.mjs','scripts/input-inventory.py','scripts/evidence.mjs'].map(file => [file,trust.files[file]]));
  const context={ schemaVersion:2,phase,variant,scope:trust.scope,predecessor,producer,startedAt,auditorFiles };
  await exclusive(path.join(evidence,`${phase}.context.json`),context);
  let record;
  try { record=await verifySource(source,variant); }
  catch(error) {
    await exclusive(path.join(evidence,`${phase}.source-error.json`),{ phase,variant,scope:trust.scope,error:String(error.stack || error) });
    const diff=execFileSync('git',['-C',source,'diff','--binary','--no-ext-diff','--no-textconv','HEAD'],{ maxBuffer:16*1024*1024 });
    await fs.writeFile(path.join(evidence,`${phase}.tracked-diff.patch`),diff,{ flag:'wx' }); throw error;
  }
  await exclusive(path.join(evidence,`${phase}.source.json`),record);
  try {
    const result=execFileSync('python3',[path.join(ROOT,'scripts/input-inventory.py'),source,variant,phase,evidence],{ encoding:'utf8',maxBuffer:4*1024*1024 });
    await fs.writeFile(path.join(evidence,`${phase}.inventory.log`),result,{ flag:'wx' });
  } catch(error) {
    await fs.writeFile(path.join(evidence,`${phase}.inventory.log`),`${error.stdout || ''}${error.stderr || ''}`,{ flag:'wx' }); throw error;
  }
  const inventory=await json(path.join(evidence,`${phase}.integrity.json`)); assert.deepEqual(inventory.errors,[]);
  const receipt={ schemaVersion:2,kind:'phase',phase,variant,scope:trust.scope,predecessor,producer,startedAt,finishedAt:new Date().toISOString(),source:await reference(evidence,`${phase}.source.json`),integrity:await reference(evidence,`${phase}.integrity.json`),context:await reference(evidence,`${phase}.context.json`),auditorFiles,success:true };
  await exclusive(path.join(evidence,`${phase}.phase.json`),receipt);
  return { source:record,inventory,receipt,trust };
}
