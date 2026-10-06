// Pure evidence validation. This module never installs, builds, serves or launches.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, json, hashFile, sha256, git } from './source.mjs';

export const PHASES = ['prepared','pre-install','post-install','pre-icon','post-icon','pre-css','post-css','pre-harness','post-harness','pre-browser','post-browser'];
export const STAGES = { install:['pre-install','post-install'],icon:['pre-icon','post-icon'],css:['pre-css','post-css'],build:['pre-harness','post-harness'],browser:['pre-browser','post-browser'] };
export const GROUPS = { dependencies:'post-install','icons-es':'post-icon','icons-cjs':'post-icon',css:'post-css' };
export const BUILD_FILES = ['index.html','bundle.js','bundle.css','bundle.js.map','bundle.css.map','build-provenance.json','esbuild-metafile.json','runtime-provenance.json','native-source.css'];
export const requiredBuildInputs = manifest => ['source/components/Slider/index.tsx','source/components/Slider/hooks/useLegalValue.ts','validation/harness/main.jsx','validation/harness/style.css','validation/scripts/spec.mjs','validation/runtime-provenance.json',`source-generated/${manifest.css.mainOutput}`];
export const REQUIRED_FILES = ['source-manifest.json','candidate.patch','package.json','package-lock.json','toolchain/package.json','toolchain/package-lock.json','css-source-audit.json','harness/main.jsx','harness/index.html','harness/style.css','scripts/source.mjs','scripts/evidence.mjs','scripts/verify-evidence.mjs','scripts/phase.mjs','scripts/input-inventory.py','scripts/prepare.mjs','scripts/build.mjs','scripts/browser.mjs','scripts/run-stage.mjs','scripts/spec.mjs','scripts/classify.mjs','scripts/verify-pair.mjs'];
const HASH = /^[a-f0-9]{64}$/;
export function exactKeys(object, keys, label='record') {
  assert.ok(object && typeof object === 'object' && !Array.isArray(object),`${label} must be an object`);
  assert.deepEqual(Object.keys(object).sort(),[...keys].sort(),`${label} schema differs`);
}
export function relative(file) {
  assert.ok(typeof file === 'string' && file.length > 0 && !path.isAbsolute(file) && path.posix.normalize(file) === file && !file.startsWith('../') && !/[\\\0\r\n]/.test(file));
  return file;
}
export function hash(value) { assert.match(value,HASH); return value; }
export function canonical(value) {
  const quote = text => JSON.stringify(text).replace(/[\u007f-\uffff]/g,character => `\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return quote(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b))).map(key => `${quote(key)}:${canonical(value[key])}`).join(',')}}`;
}
export async function reference(directory,file) { return { path:relative(file),sha256:await hashFile(path.join(directory,file)) }; }
export async function checkReference(directory,ref,expected) {
  exactKeys(ref,['path','sha256'],'file reference'); assert.equal(ref.path,expected); hash(ref.sha256);
  const full=path.join(directory,relative(expected)); assert.equal(await fs.realpath(full),full,'Evidence symlink is forbidden');
  assert.equal(await hashFile(full),ref.sha256,`Evidence bytes changed: ${expected}`);
  return json(full);
}
export function identity(manifest,variant) {
  assert.ok(['baseline','fixed'].includes(variant)); return manifest[variant === 'baseline' ? 'baseline' : 'candidate'];
}
export function phasePredecessor(phase) {
  const index=PHASES.indexOf(phase); assert.ok(index >= 0); return index ? PHASES[index-1] : null;
}
export function stageForPhase(phase) { return Object.keys(STAGES).find(stage => STAGES[stage][1] === phase) || null; }
export function timestamp(value,trust) {
  const result=Date.parse(value); assert.ok(Number.isFinite(result),'Invalid evidence timestamp');
  const age=(Date.now()-result)/1000;
  assert.ok(age >= -30 && age <= trust.manifest.runtime.maxEvidenceAgeSeconds,'Evidence is outside the frozen job observation window');
  return result;
}
export async function loadTrust(root=ROOT,env=process.env) {
  const manifest=await json(path.join(root,'source-manifest.json'));
  assert.equal(manifest.state,'frozen-audited'); assert.equal(env.GITHUB_ACTIONS,'true'); assert.equal(env.CI,'true');
  for (const [key,variable] of [['repository','GITHUB_REPOSITORY'],['repositoryId','GITHUB_REPOSITORY_ID'],['ownerId','GITHUB_REPOSITORY_OWNER_ID'],['ref','GITHUB_REF']]) {
    assert.ok(manifest.execution[key]); assert.equal(env[variable],manifest.execution[key]);
  }
  assert.ok(['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME));
  assert.match(env.GITHUB_RUN_ID || '',/^\d+$/); assert.match(env.GITHUB_RUN_ATTEMPT || '',/^\d+$/); assert.match(env.GITHUB_SHA || '',/^[a-f0-9]{40}$/);
  const runtime=manifest.runtime;
  exactKeys(runtime,['harnessNodeVersion','harnessNodeSha256','nativeNodeSha256','chromiumVersion','maxEvidenceAgeSeconds','toolingVersions']);
  assert.equal(process.versions.node,runtime.harnessNodeVersion); assert.equal(await hashFile(process.execPath),runtime.harnessNodeSha256);
  hash(runtime.nativeNodeSha256); assert.match(runtime.chromiumVersion,/^\d+\.\d+\.\d+\.\d+$/);
  assert.ok(Number.isInteger(runtime.maxEvidenceAgeSeconds) && runtime.maxEvidenceAgeSeconds > 0 && runtime.maxEvidenceAgeSeconds <= 7200);
  exactKeys(runtime.toolingVersions,['esbuild','playwright','yarn']);
  const packageJson=await json(path.join(root,'package.json'));
  assert.deepEqual(runtime.toolingVersions,{ esbuild:packageJson.dependencies.esbuild,playwright:packageJson.dependencies['playwright-core'],yarn:manifest.preparation.yarnVersion });
  assert.equal(git(root,'rev-parse','--show-toplevel'),root); assert.equal(git(root,'rev-parse','HEAD'),env.GITHUB_SHA);
  const publication=await json(path.join(root,'publication-manifest.json'));
  exactKeys(publication,['schemaVersion','files']); assert.equal(publication.schemaVersion,1);
  const files=publication.files; assert.ok(Object.keys(files).length >= REQUIRED_FILES.length);
  for (const file of REQUIRED_FILES) assert.ok(files[file],`Unfrozen required validator input: ${file}`);
  const tracked=git(root,'ls-files','-z').split('\0').filter(Boolean).sort();
  assert.deepEqual(tracked,[...Object.keys(files),'publication-manifest.json'].sort());
  const actualHashes={};
  for (const file of tracked) {
    relative(file); const full=path.join(root,file); assert.equal(await fs.realpath(full),full);
    const bytes=await fs.readFile(full);
    const actualBlob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actualBlob,git(root,'rev-parse',`${env.GITHUB_SHA}:${file}`),`Current validation file differs from trusted commit: ${file}`);
    if (file !== 'publication-manifest.json') {
      exactKeys(files[file],['sha256','bytes']); assert.equal(files[file].bytes,bytes.length); assert.equal(files[file].sha256,sha256(bytes));
      actualHashes[file]=sha256(bytes);
    }
  }
  const extra=git(root,'ls-files','--others','-z').split('\0').filter(Boolean).filter(file => !['evidence/','work/','node_modules/','toolchain/node_modules/'].some(prefix => file.startsWith(prefix)));
  assert.deepEqual(extra,[],'Unfrozen validation input');
  assert.equal(actualHashes['package-lock.json'],manifest.harnessLockSha256);
  assert.equal(actualHashes['toolchain/package-lock.json'],manifest.toolchainLockSha256);
  assert.equal(actualHashes['css-source-audit.json'],manifest.css.auditRecordSha256);
  assert.equal(actualHashes['candidate.patch'],manifest.candidatePatchSha256);
  const scope={ runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,validationCommit:env.GITHUB_SHA,manifestSha256:actualHashes['source-manifest.json'],publicationSha256:await hashFile(path.join(root,'publication-manifest.json')) };
  return { root,manifest,scope,files:actualHashes };
}
export function producerFiles(trust,stage) {
  const names=['scripts/evidence.mjs','scripts/phase.mjs','scripts/source.mjs','scripts/input-inventory.py',stage === 'build' || stage === 'browser' ? 'scripts/run-stage.mjs' : 'scripts/prepare.mjs'];
  return Object.fromEntries(names.map(name => [name,trust.files[name]]));
}
export function commandArguments(stage,variant,manifest) {
  if (['install','icon','css'].includes(stage)) return ['<native-node>','<pinned-yarn>',...manifest.preparation[`${stage}Args`],...(stage === 'install' ? ['--cache-folder','<isolated-cache>'] : [])];
  if (stage === 'build') return ['<harness-node>','scripts/build.mjs','--source','<source>','--variant',variant,'--out','<dist>'];
  assert.equal(stage,'browser'); return ['<harness-node>','scripts/browser.mjs','--variant',variant,'--source','<source>','--dist','<dist>','--out','<evidence>'];
}
export function commandEnvironment(stage,manifest) {
  if (stage === 'build' || stage === 'browser') return {CI:'true'};
  const result={CI:'true',NODE_ENV:'test',TZ:'Asia/Singapore',FORCE_COLOR:'0',GIT_TERMINAL_PROMPT:'0',PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',PUPPETEER_SKIP_DOWNLOAD:'true',HUSKY:'0'};
  if (stage === 'css') { delete result.NODE_ENV; Object.assign(result,manifest.css.environment); }
  return result;
}
export async function validateCommand(directory,stage,variant,trust,predecessor) {
  const file=`${stage}.command.json`,record=await json(path.join(directory,file));
  exactKeys(record,['schemaVersion','kind','stage','variant','scope','predecessor','producerFiles','command','environment','sourceCommit','sourceTree','sourceLockSha256','tools','startedAt','finishedAt','exitCode','signal','error','diagnosticErrors','logSha256','outputs',...(stage === 'css' ? ['packageResolutionSha256'] : [])],'producer command');
  assert.equal(record.schemaVersion,2); assert.equal(record.kind,'command'); assert.equal(record.stage,stage); assert.equal(record.variant,variant);
  assert.deepEqual(record.scope,trust.scope); assert.deepEqual(record.predecessor,predecessor); assert.deepEqual(record.producerFiles,producerFiles(trust,stage));
  const source=identity(trust.manifest,variant);
  assert.equal(record.sourceCommit,source.sha); assert.equal(record.sourceTree,source.tree); assert.equal(record.sourceLockSha256,trust.manifest.sourceLockSha256);
  assert.deepEqual(record.command,commandArguments(stage,variant,trust.manifest));
  assert.deepEqual(record.environment,commandEnvironment(stage,trust.manifest),'Producer environment differs from the frozen command contract');
  assert.equal(record.signal,null); assert.equal(record.error,null); assert.deepEqual(record.diagnosticErrors,[]);
  const exit=stage === 'browser' && variant === 'baseline' ? 1 : 0;
  assert.equal(record.exitCode,exit); assert.equal(await fs.readFile(path.join(directory,`${stage}.exit-code`),'utf8'),`${exit}\n`);
  assert.equal(await hashFile(path.join(directory,`${stage}.log`)),hash(record.logSha256));
  const started=timestamp(record.startedAt,trust),finished=timestamp(record.finishedAt,trust); assert.ok(started <= finished);
  const before=await checkReference(directory,predecessor,`${STAGES[stage][0]}.phase.json`);
  assert.equal(before.success,true); assert.deepEqual(before.scope,trust.scope); assert.ok(timestamp(before.finishedAt,trust) <= started);
  if (['install','icon','css'].includes(stage)) {
    exactKeys(record.tools,['nativeNodeVersion','nativeNodeSha256','yarnVersion','yarnEntrySha256','harnessLockSha256','toolchainLockSha256']);
    assert.equal(record.tools.nativeNodeVersion,trust.manifest.preparation.nativeNodeVersion); assert.equal(record.tools.nativeNodeSha256,trust.manifest.runtime.nativeNodeSha256);
    assert.equal(record.tools.yarnVersion,trust.manifest.preparation.yarnVersion); assert.equal(record.tools.yarnEntrySha256,await hashFile(path.join(trust.root,'toolchain/node_modules/yarn/bin/yarn.js')));
    assert.equal(record.tools.harnessLockSha256,trust.manifest.harnessLockSha256); assert.equal(record.tools.toolchainLockSha256,trust.manifest.toolchainLockSha256);
    assert.deepEqual(record.outputs,{});
  } else {
    exactKeys(record.tools,['harnessNodeVersion','harnessNodeSha256']);
    assert.deepEqual(record.tools,{harnessNodeVersion:trust.manifest.runtime.harnessNodeVersion,harnessNodeSha256:trust.manifest.runtime.harnessNodeSha256});
    const expected=stage === 'build' ? BUILD_FILES.map(name => `build/${name}`) : ['results.json'];
    assert.deepEqual(Object.keys(record.outputs).sort(),expected.sort());
    for (const [name,digest] of Object.entries(record.outputs)) assert.equal(await hashFile(path.join(directory,relative(name))),hash(digest));
  }
  if (stage === 'css') {
    const log=(await fs.readFile(path.join(directory,'css.log'),'utf8')).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
    assert.ok(log.includes('Build css success!'));
    assert.ok(!['Failed to build css','Failed to inject arco dependencies style','Failed to append/prepend additional data'].some(marker => log.includes(marker)));
    assert.equal(record.packageResolutionSha256,await hashFile(path.join(directory,'css-package-resolution.json')));
    for (const [key,value] of Object.entries(trust.manifest.css.environment)) assert.equal(record.environment[key],value);
    assert.ok(!Object.keys(record.environment).some(key => key.startsWith('BUILD_ENV_') && !(key in trust.manifest.css.environment)));
  }
  return record;
}
export function validateInventory(anchor) {
  exactKeys(anchor,['sha256','count','files','context'],'input anchor');
  assert.ok(Number.isInteger(anchor.count) && anchor.count > 0); assert.equal(Object.keys(anchor.files).length,anchor.count);
  for (const [name,entry] of Object.entries(anchor.files)) {
    relative(name);
    if (entry.type === 'file') { exactKeys(entry,['type','sha256']); hash(entry.sha256); }
    else { exactKeys(entry,['type','target']); assert.equal(entry.type,'symlink'); assert.ok(typeof entry.target === 'string' && entry.target.length > 0); }
  }
  assert.equal(anchor.sha256,sha256(canonical(anchor.files)),'Anchor aggregate does not match its entries');
}
