// Inactive hosted-only preparation draft. Never invoked during local drafting.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, argsOf, json, hashFile, writeJson, auditedCssOutputs } from './source.mjs';
import { executionScope, auditPhase } from './phase.mjs';
import { loadTrust, reference, producerFiles, STAGES } from './evidence.mjs';

const manifest = await executionScope();
const args = argsOf(), source = path.resolve(args.source), variant = args.variant;
assert.ok(['baseline','fixed'].includes(variant));
assert.ok(['icons','css'].includes(args.through));
const evidence = path.join(ROOT,'evidence',variant);
await fs.mkdir(evidence,{ recursive:true });
const nativeNode = await fs.realpath(path.resolve(args['native-node']));
const yarn = path.join(ROOT,'toolchain/node_modules/yarn/bin/yarn.js');
assert.equal(execFileSync(nativeNode,['--version'],{ encoding:'utf8' }).trim(),`v${manifest.preparation.nativeNodeVersion}`);
assert.equal(execFileSync(nativeNode,[yarn,'--version'],{ encoding:'utf8' }).trim(),manifest.preparation.yarnVersion);
const tools = { nativeNodeVersion:manifest.preparation.nativeNodeVersion,nativeNodeSha256:await hashFile(nativeNode),yarnVersion:manifest.preparation.yarnVersion,yarnEntrySha256:await hashFile(yarn),harnessLockSha256:await hashFile(path.join(ROOT,'package-lock.json')),toolchainLockSha256:await hashFile(path.join(ROOT,'toolchain/package-lock.json')) };
assert.equal(tools.harnessLockSha256,manifest.harnessLockSha256);
assert.equal(tools.toolchainLockSha256,manifest.toolchainLockSha256);
assert.equal(tools.nativeNodeSha256,manifest.runtime.nativeNodeSha256,'Native runtime differs before source execution');
const env = {
  ...process.env, CI:'true',NODE_ENV:'test',TZ:'Asia/Singapore',FORCE_COLOR:'0',GIT_TERMINAL_PROMPT:'0',
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',PUPPETEER_SKIP_DOWNLOAD:'true',HUSKY:'0',
  PATH:`${path.dirname(nativeNode)}:${path.join(ROOT,'toolchain/node_modules/.bin')}:${process.env.PATH}`,
};
for (const key of Object.keys(env)) if (key.startsWith('BUILD_ENV_') || ['NODE_OPTIONS','NODE_PATH'].includes(key)) delete env[key];
const identity = manifest[variant === 'baseline' ? 'baseline' : 'candidate'];
async function command(label,argv,normalizedArgv,commandEnv=env) {
  const trust=await loadTrust();
  const predecessor=await reference(evidence,`${STAGES[label][0]}.phase.json`);
  const log = path.join(evidence,`${label}.log`);
  const handle = await fs.open(log,'wx');
  const startedAt = new Date().toISOString();
  let result;
  try { result = spawnSync(nativeNode,[yarn,...argv],{ cwd:source,env:commandEnv,stdio:['ignore',handle.fd,handle.fd] }); }
  finally { await handle.close(); }
  const plainLog = (await fs.readFile(log,'utf8')).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
  const diagnosticErrors = label === 'css' ? ['Failed to build css','Failed to inject arco dependencies style','Failed to append/prepend additional data'].filter(marker => plainLog.includes(marker)) : [];
  if (label === 'css' && !plainLog.includes('Build css success!')) diagnosticErrors.push('Native CSS success marker absent');
  const environment = Object.fromEntries(['CI','NODE_ENV','TZ','FORCE_COLOR','GIT_TERMINAL_PROMPT','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD','PUPPETEER_SKIP_DOWNLOAD','HUSKY','BUILD_ENV_MODE','BUILD_ENV_DIST_FILENAME_CSS'].filter(key => commandEnv[key] !== undefined).map(key => [key,commandEnv[key]]));
  const record = { schemaVersion:2,kind:'command',stage:label,variant,scope:trust.scope,predecessor,producerFiles:producerFiles(trust,label),command:['<native-node>','<pinned-yarn>',...normalizedArgv],environment,sourceCommit:identity.sha,sourceTree:identity.tree,sourceLockSha256:manifest.sourceLockSha256,tools,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status ?? 125,signal:result.signal ?? null,error:result.error?.message ?? null,diagnosticErrors,logSha256:await hashFile(log),outputs:{} };
  if (label === 'css') record.packageResolutionSha256 = await hashFile(path.join(evidence,'css-package-resolution.json'));
  await fs.writeFile(path.join(evidence,`${label}.command.json`),`${JSON.stringify(record,null,2)}\n`,{flag:'wx'});
  await fs.writeFile(path.join(evidence,`${label}.exit-code`),`${record.exitCode}\n`,{flag:'wx'});
  return record.exitCode;
}
async function stage(label,before,after,argv,normalizedArgv=argv,commandEnv=env) {
  await auditPhase(source,variant,before,evidence);
  const status = await command(label,argv,normalizedArgv,commandEnv);
  let gateError;
  try { await auditPhase(source,variant,after,evidence); } catch(error) { gateError=error; }
  assert.equal(status,0,`${label} failed; preserve its log and failed post-stage gate`);
  if (gateError) throw gateError;
}
await auditPhase(source,variant,'prepared',evidence);
const cache = path.join(ROOT,'work',`yarn-cache-${variant}`);
await stage('install','pre-install','post-install',[...manifest.preparation.installArgs,'--cache-folder',cache],[...manifest.preparation.installArgs,'--cache-folder','<isolated-cache>']);
const modules = [];
for (const [name,version] of Object.entries(manifest.preparation.nativePackageVersions)) {
  const filename = path.join(source,'node_modules',name,'package.json');
  assert.equal(await fs.realpath(filename),filename);
  const metadata = await json(filename);
  assert.equal(metadata.version,version);
  modules.push({ name,version,packagePath:`node_modules/${name}/package.json`,sha256:await hashFile(filename) });
}
await writeJson(path.join(evidence,'native-packages.json'),{ tools,modules });
await stage('icon','pre-icon','post-icon',manifest.preparation.iconArgs);
if (args.through === 'css') {
  assert.equal(manifest.css.state,'audited-native-css','Stop before CSS until locked compiler source and exact outputs are audited');
  auditedCssOutputs(manifest);
  assert.equal(await hashFile(path.join(ROOT,'css-source-audit.json')),manifest.css.auditRecordSha256);
  const cssAudit = await json(path.join(ROOT,'css-source-audit.json'));
  assert.deepEqual(cssAudit.outputFiles,manifest.css.outputFiles);
  for (const [file,hash] of Object.entries(cssAudit.sourceInputs)) assert.equal(await hashFile(path.join(source,file)),hash);
  assert.equal((await json(path.join(source,'package.json'))).scripts['build:css'],manifest.css.packageScript);
  for (const [file,hash] of Object.entries(manifest.css.requiredCompilerFiles)) assert.equal(await hashFile(path.join(source,file)),hash);
  const resolutions = [];
  async function resolvePackage(fromFile,name) {
    const resolver = createRequire(fromFile);
    const metadataPath = await fs.realpath(resolver.resolve(`${name}/package.json`));
    const entryPath = await fs.realpath(resolver.resolve(name));
    for (const file of [metadataPath,entryPath]) assert.ok(file.startsWith(path.join(source,'node_modules') + path.sep),'CSS package resolved outside the frozen source dependency tree');
    const metadata = await json(metadataPath);
    assert.equal(metadata.version,manifest.preparation.nativePackageVersions[name]);
    resolutions.push({ from:path.relative(source,fromFile),name,version:metadata.version,packagePath:path.relative(source,metadataPath),packageSha256:await hashFile(metadataPath),entryPath:path.relative(source,entryPath),entrySha256:await hashFile(entryPath) });
    return metadataPath;
  }
  const compilerPackage = path.join(source,'node_modules/arco-scripts/package.json');
  const gulpLessPackage = await resolvePackage(compilerPackage,'gulp-less');
  await resolvePackage(gulpLessPackage,'less');
  for (const name of ['less-plugin-npm-import','less-plugin-autoprefix','gulp-clean-css']) await resolvePackage(compilerPackage,name);
  for (const prefix of ['components','es','lib']) for (const plugin of ['palette.js','palette-dark.js','getRgbStr.js']) await resolvePackage(path.join(source,prefix,'style/theme/color',plugin),'@arco-design/color');
  await writeJson(path.join(evidence,'css-package-resolution.json'),{ sourceCommit:identity.sha,sourceTree:identity.tree,sourceLockSha256:manifest.sourceLockSha256,resolutions });
  assert.ok(manifest.css.environment && typeof manifest.css.environment === 'object');
  for (const key of Object.keys(manifest.css.environment)) assert.ok(['NODE_ENV','BUILD_ENV_MODE','BUILD_ENV_DIST_FILENAME_CSS'].includes(key));
  const cssEnv = { ...env }; delete cssEnv.NODE_ENV;
  Object.assign(cssEnv,manifest.css.environment);
  await stage('css','pre-css','post-css',manifest.preparation.cssArgs,manifest.preparation.cssArgs,cssEnv);
}
