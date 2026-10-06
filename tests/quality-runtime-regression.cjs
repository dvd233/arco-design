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
  console.log(JSON.stringify({checks, passed: checks, nativeExecuted: false}));
} finally { fs.rmSync(root, {recursive: true, force: true}); }
