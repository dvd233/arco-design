// Synthetic Git repositories only. These unexecuted unit tests are not Arco evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, sha256, verifyPatchTree } from '../scripts/source.mjs';

async function fixture() {
  await fs.mkdir(path.join(ROOT,'work'),{ recursive:true });
  const directory = await fs.mkdtemp(path.join(ROOT,'work','synthetic-binding-'));
  const env = { ...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid' };
  const git = (...args) => execFileSync('git',['-C',directory,...args],{ env,encoding:'utf8' }).trim();
  git('init','--quiet');
  await fs.writeFile(path.join(directory,'value.txt'),'baseline\n');
  git('add','value.txt');
  const baselineTree = git('write-tree');
  const baseline = git('commit-tree',baselineTree,'-m','Synthetic baseline');
  git('update-ref','HEAD',baseline);
  await fs.writeFile(path.join(directory,'value.txt'),'candidate\n');
  git('add','value.txt');
  const candidateTree = git('write-tree');
  const candidate = git('commit-tree',candidateTree,'-p',baseline,'-m','Synthetic candidate');
  git('update-ref','HEAD',candidate);
  // --binary would imply full-index output; this text-only fixture deliberately
  // matches the abbreviated-index form of the approved product patch.
  const patch = execFileSync('git',['-C',directory,'diff','--abbrev=7','--no-ext-diff','--no-textconv',baseline,candidate],{ env });
  const manifest = { baseline:{ sha:baseline,tree:baselineTree },candidate:{ sha:candidate,tree:candidateTree },candidatePatchSha256:sha256(patch) };
  return { directory,patch,manifest,git };
}
async function snapshot(directory) {
  const files = {};
  async function walk(root,relative='') {
    for (const entry of await fs.readdir(root,{ withFileTypes:true })) {
      const label = path.join(relative,entry.name),file = path.join(root,entry.name);
      if (entry.isDirectory()) await walk(file,label);
      else files[label] = sha256(await fs.readFile(file));
    }
  }
  await walk(directory);
  return files;
}
test('abbreviated frozen patch reconstructs tree without modifying source index, objects or worktree',async () => {
  const value = await fixture();
  try {
    assert.match(value.patch.toString(),/index [0-9a-f]{7}\.\.[0-9a-f]{7}/);
    const before = await snapshot(value.directory);
    const result = await verifyPatchTree(value.directory,value.manifest,value.patch);
    assert.equal(result.reconstructedTree,value.manifest.candidate.tree);
    assert.deepEqual(await snapshot(value.directory),before);
  } finally { await fs.rm(value.directory,{ recursive:true,force:true }); }
});
test('changed digest, inapplicable patch and applicable wrong-tree patch are rejected',async () => {
  const value = await fixture();
  try {
    const before = await snapshot(value.directory);
    await assert.rejects(verifyPatchTree(value.directory,value.manifest,Buffer.from('changed bytes')));
    const invalid = Buffer.from('This is not an applicable patch.\n');
    await assert.rejects(verifyPatchTree(value.directory,{ ...value.manifest,candidatePatchSha256:sha256(invalid) },invalid));
    const wrong = Buffer.from(value.patch.toString().replace('+candidate\n','+different\n'));
    await assert.rejects(verifyPatchTree(value.directory,{ ...value.manifest,candidatePatchSha256:sha256(wrong) },wrong));
    assert.deepEqual(await snapshot(value.directory),before);
  } finally { await fs.rm(value.directory,{ recursive:true,force:true }); }
});
