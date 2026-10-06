#!/usr/bin/env node
'use strict';
// Dependency-free fake package-metadata resolution tests; no package code is loaded.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { resolveMetadata } = require('../scripts/inspect-quality-runtime.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-metadata-synthetic-'));
let checks = 0;
try {
  const put = (rel, value) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, JSON.stringify(value)); };
  put('package.json', {name: 'fixture'});
  put('node_modules/arco-scripts/package.json', {name: 'arco-scripts', version: '1.27.14'});
  put('node_modules/arco-scripts/node_modules/ts-jest/package.json', {name: 'ts-jest', version: '26.5.6'});
  const fromRoot = createRequire(path.join(root, 'package.json'));
  const fromArco = createRequire(path.join(root, 'node_modules/arco-scripts/package.json'));
  assert.throws(() => resolveMetadata('ts-jest', fromRoot, 'node_modules', root, '26.5.6'), {code: 'MODULE_NOT_FOUND'}); checks++;
  const result = resolveMetadata('ts-jest', fromArco, 'node_modules', root, '26.5.6');
  assert.strictEqual(result.record.packagePath, 'node_modules/arco-scripts/node_modules/ts-jest/package.json'); checks++;
  assert.throws(() => resolveMetadata('ts-jest', fromArco, 'node_modules', root, '0.0.0'), /Unexpected pin/); checks++;
  assert.throws(() => resolveMetadata('ts-jest', fromArco, 'site/node_modules', root), /escaped/); checks++;
  const source = fs.readFileSync(path.join(__dirname, '../scripts/inspect-quality-runtime.cjs'), 'utf8');
  assert(source.includes("observe('ts-jest', fromArco, 'node_modules', '26.5.6')")); checks++;
  // The package.json subpath is hidden, while the public entry remains resolvable.
  put('site/package.json', {name: 'site-fixture'});
  put('site/node_modules/exported-entry/package.json', {name: 'exported-entry', version: '3.5.3', exports: {'.': './dist/entry.js'}});
  const hiddenRoot = path.join(root, 'site/node_modules/exported-entry');
  fs.mkdirSync(path.join(hiddenRoot, 'dist'));
  fs.writeFileSync(path.join(hiddenRoot, 'dist/entry.js'), "throw new Error('Package entry must never be executed');\n");
  put('site/node_modules/exported-entry/dist/package.json', {type: 'commonjs'});
  const fromSite = createRequire(path.join(root, 'site/package.json'));
  assert.throws(() => fromSite.resolve('exported-entry/package.json'), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'}); checks++;
  const hidden = resolveMetadata('exported-entry', fromSite, 'site/node_modules', root, '3.5.3');
  assert.strictEqual(hidden.record.packagePath, 'site/node_modules/exported-entry/package.json'); checks++;
  assert.strictEqual(hidden.record.version, '3.5.3'); checks++;
  assert.match(hidden.record.sha256, /^[a-f0-9]{64}$/); checks++;
  assert.throws(() => resolveMetadata('exported-entry', fromSite, 'site/node_modules', root, '9.9.9'), /Unexpected pin/); checks++;
  put('site/node_modules/missing-entry/package.json', {name: 'missing-entry', version: '1.0.0', exports: {'.': './absent.js'}});
  assert.throws(() => resolveMetadata('missing-entry', fromSite, 'site/node_modules', root), {code: 'MODULE_NOT_FOUND'}); checks++;
  put('site/node_modules/no-public-entry/package.json', {name: 'no-public-entry', version: '1.0.0', exports: {'./feature': './entry.js'}});
  assert.throws(() => resolveMetadata('no-public-entry', fromSite, 'site/node_modules', root), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'}); checks++;
  put('site/node_modules/wrong-name/package.json', {name: 'different-package', version: '1.0.0', exports: {'.': './entry.js'}});
  fs.writeFileSync(path.join(root, 'site/node_modules/wrong-name/entry.js'), "throw new Error('Do not execute');\n");
  assert.throws(() => resolveMetadata('wrong-name', fromSite, 'site/node_modules', root), /Unexpected package name/); checks++;
  put('site/node_modules/escaped-entry/package.json', {name: 'escaped-entry', version: '1.0.0', exports: {'.': './entry.js'}});
  fs.writeFileSync(path.join(root, 'outside-entry.js'), "throw new Error('Do not execute');\n");
  fs.symlinkSync(path.join(root, 'outside-entry.js'), path.join(root, 'site/node_modules/escaped-entry/entry.js'));
  assert.throws(() => resolveMetadata('escaped-entry', fromSite, 'site/node_modules', root), /escaped/); checks++;
  put('node_modules/wrong-visible-name/package.json', {name: 'different-package', version: '1.0.0'});
  assert.throws(() => resolveMetadata('wrong-visible-name', fromRoot, 'node_modules', root), /Unexpected package name/); checks++;
  const denied = {resolve() { const error = new Error('Synthetic filesystem denial'); error.code = 'EACCES'; throw error; }};
  assert.throws(() => resolveMetadata('denied', denied, 'node_modules', root), {code: 'EACCES'}); checks++;
  console.log(JSON.stringify({checks, passed: checks, nativeExecuted: false}));
} finally { fs.rmSync(root, {recursive: true, force: true}); }
