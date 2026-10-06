import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const hashFile = async file => sha256(await fs.readFile(file));
export const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value,null,2)}\n`);
export const git = (source, ...args) => execFileSync('git', ['-C', source, ...args], { encoding:'utf8', maxBuffer:16 * 1024 * 1024, env:{ ...process.env,GIT_NO_REPLACE_OBJECTS:'1' } }).trim();
export function argsOf() {
  const args = {};
  for (let index=2; index<process.argv.length; index+=2) {
    assert.match(process.argv[index], /^--[a-z-]+$/);
    assert.ok(process.argv[index+1], 'Missing option value');
    args[process.argv[index].slice(2)] = process.argv[index+1];
  }
  return args;
}
export function sourceInputKind(file, committedFiles) {
  if (Object.hasOwn(committedFiles,file)) return 'committed';
  if (file.startsWith('node_modules/')) return 'dependencies';
  if (file.startsWith('icon/react-icon/')) return 'icons-es';
  if (file.startsWith('icon/react-icon-cjs/')) return 'icons-cjs';
  throw new Error(`Unapproved source build input: ${file}`);
}
export function auditedCssOutputs(manifest) {
  if (manifest.css?.state !== 'audited-native-css') return [];
  assert.match(manifest.css.auditRecordSha256 || '',/^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(manifest.css.outputFiles) && manifest.css.outputFiles.length > 0);
  assert.ok(manifest.css.outputFiles.includes(manifest.css.mainOutput));
  const outputs = manifest.css.outputFiles;
  assert.equal(new Set(outputs).size,outputs.length);
  for (const file of outputs) {
    assert.ok(typeof file === 'string' && !path.isAbsolute(file) && path.posix.normalize(file) === file && !file.startsWith('../'));
    assert.ok(!/[\0\r\n]/.test(file) && !file.includes('\\'));
    assert.ok(!['.git','node_modules','components','icon','.config','scripts'].includes(file.split('/')[0]),'CSS output may not cover a source/dependency/config root');
  }
  return outputs;
}
export async function verifyPatchTree(source, manifest, patch) {
  assert.equal(sha256(patch),manifest.candidatePatchSha256,'Approved patch bytes changed');
  assert.equal(git(source,'rev-parse',`${manifest.baseline.sha}^{tree}`),manifest.baseline.tree,'Baseline commit/tree mismatch');
  const objectDirectory = git(source,'rev-parse','--path-format=absolute','--git-path','objects');
  assert.ok(path.isAbsolute(objectDirectory));
  assert.ok(!objectDirectory.includes(path.delimiter) && !/[\r\n]/.test(objectDirectory),'Unsupported object-directory separator');
  const work = path.join(ROOT,'work');
  await fs.mkdir(work,{ recursive:true });
  const temporary = await fs.mkdtemp(path.join(work,'patch-tree-'));
  const objects = path.join(temporary,'objects');
  await fs.mkdir(objects);
  const env = {
    ...process.env, GIT_NO_REPLACE_OBJECTS:'1',
    GIT_INDEX_FILE:path.join(temporary,'index'),
    GIT_OBJECT_DIRECTORY:objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES:objectDirectory,
  };
  const run = (args,input) => execFileSync('git',['-C',source,...args],{
    env,input,encoding:'utf8',maxBuffer:16 * 1024 * 1024,
  }).trim();
  try {
    // --cached applies only to this new private index. New tree/blob objects go
    // only to the private object store; the source index/worktree is untouched.
    run(['read-tree',manifest.baseline.tree]);
    run(['apply','--cached','--check','--binary','--whitespace=nowarn','-'],patch);
    run(['apply','--cached','--binary','--whitespace=nowarn','-'],patch);
    const reconstructedTree = run(['write-tree']);
    assert.equal(reconstructedTree,manifest.candidate.tree,'Baseline plus approved patch does not produce the candidate tree');
    return { baselineTree:manifest.baseline.tree,reconstructedTree,patchSha256:sha256(patch) };
  } finally {
    await fs.rm(temporary,{ recursive:true,force:true });
  }
}
export async function verifySource(source, variant) {
  assert.ok(['baseline','fixed'].includes(variant),'Unknown source variant');
  source = path.resolve(source);
  assert.equal(await fs.realpath(source),source,'Source root must not be symlinked');
  assert.equal(git(source,'rev-parse','--show-toplevel'),source,'Source must be the checkout root');
  const manifest = await json(path.join(ROOT,'source-manifest.json'));
  const target = variant === 'baseline' ? manifest.baseline : manifest.candidate;
  assert.ok(target?.sha && target?.tree, 'Variant source is not frozen');
  assert.equal(git(source,'rev-parse','HEAD'), target.sha, 'Source commit mismatch');
  assert.equal(git(source,'rev-parse','HEAD^{tree}'), target.tree, 'Source tree mismatch');
  assert.equal(git(source,'diff','--name-only','--no-ext-diff','--no-textconv','HEAD'), '', 'Tracked source is dirty');
  assert.equal(git(source,'diff','--cached','--name-only','--no-ext-diff','--no-textconv','HEAD'), '', 'Source index differs from its commit');
  // These are exact dependency/generated roots, not an ignored-source wildcard.
  // --exclude-standard is deliberately absent: ignored extra source is rejected too.
  const cssOutputs = auditedCssOutputs(manifest);
  const untracked = git(source,'ls-files','--others','--','.',':!node_modules/',':!icon/react-icon/',':!icon/react-icon-cjs/').split('\n').filter(Boolean).filter(file => !cssOutputs.includes(file));
  assert.deepEqual(untracked, [], 'Untracked or ignored source/config input');
  const entries = git(source,'ls-tree','-rz','--full-tree',target.sha).split('\0').filter(Boolean).map(entry => {
    const separator = entry.indexOf('\t');
    assert.ok(separator > 0);
    const [mode,type,blob] = entry.slice(0,separator).split(' ');
    return { mode,type,blob,file:entry.slice(separator+1) };
  });
  assert.deepEqual(git(source,'ls-files','-z').split('\0').filter(Boolean).sort(),entries.map(entry => entry.file).sort(),'Index paths differ from committed source');
  const sourceFiles = {};
  for (const { mode,type,blob,file } of entries) {
    assert.ok(!cssOutputs.includes(file),'Audited CSS output may not replace a tracked source file');
    assert.equal(type,'blob','Unexpected gitlink/non-file input');
    assert.ok(['100644','100755'].includes(mode),'Unexpected source symlink or file mode');
    const fullPath = path.resolve(source,file);
    assert.ok(fullPath.startsWith(source + path.sep));
    assert.equal(await fs.realpath(fullPath),fullPath,`Symlinked committed source input: ${file}`);
    const stat = await fs.lstat(fullPath);
    assert.ok(stat.isFile(),`Non-file source input: ${file}`);
    assert.equal(!!(stat.mode & 0o111),mode === '100755',`Source executable mode changed: ${file}`);
    const bytes = await fs.readFile(fullPath);
    const actualBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actualBlob,blob,`Source bytes differ from committed blob: ${file}`);
    sourceFiles[file] = sha256(bytes);
  }
  const packageJson = await json(path.join(source,'package.json'));
  const record = {
    variant, repository:target.repository, commit:target.sha, tree:target.tree,
    packageName:packageJson.name, packageVersion:packageJson.version,
    sourceFiles, sourceLockSha256:await hashFile(path.join(source,'yarn.lock')),
  };
  if (manifest.sourceLockSha256) assert.equal(record.sourceLockSha256,manifest.sourceLockSha256);
  if (variant === 'fixed') {
    assert.equal(manifest.state,'frozen-audited');
    assert.deepEqual(git(source,'show','-s','--format=%P',target.sha).split(' '),target.parents,'Candidate sole parent changed');
    assert.deepEqual(git(source,'diff','--name-only','--no-ext-diff','--no-textconv',manifest.baseline.sha,target.sha).split('\n').sort(),manifest.allowedChangedFiles.toSorted());
    const patch = await fs.readFile(path.join(ROOT,'candidate.patch'));
    record.patchBinding = await verifyPatchTree(source,manifest,patch);
    for (const [file,hash] of Object.entries(target.files)) assert.equal(sourceFiles[file],hash);
  }
  return record;
}
