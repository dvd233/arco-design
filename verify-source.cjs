const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const manifest = require('./SOURCE.json');
for (const file of manifest.files) {
  const actual = createHash('sha256').update(readFileSync(join(__dirname, file.path))).digest('hex');
  assert.equal(actual, file.sha256, `Upstream source changed: ${file.path}`);
}
console.log(`Verified ${manifest.files.length} unmodified upstream files from ${manifest.commit}`);
