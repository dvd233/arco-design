#!/usr/bin/env node
'use strict';
// Load package metadata only. Preserve exact resolved versions and paths in CI evidence.
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const root = path.resolve(process.argv[2]);
const fromSource = createRequire(path.join(root, 'package.json'));
const names = ['arco-scripts', 'jest', 'babel-jest', 'jest-environment-jsdom', 'jest-jasmine2',
  'react', 'react-dom', '@testing-library/react', '@testing-library/dom', 'husky'];
const known = { 'arco-scripts': '1.27.14', jest: '26.6.3', react: '16.14.0', 'react-dom': '16.14.0',
  '@testing-library/react': '12.1.5', '@testing-library/dom': '8.13.0', husky: '7.0.4' };
const modules = [];
for (const name of names) {
  const resolved = fromSource.resolve(name + '/package.json');
  const real = fs.realpathSync(resolved);
  const relative = path.relative(path.join(root, 'node_modules'), real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Package resolves outside this source dependency tree: ' + name);
  }
  const metadata = JSON.parse(fs.readFileSync(real, 'utf8'));
  if (known[name] && metadata.version !== known[name]) {
    throw new Error('Unexpected locked package version: ' + name + '@' + metadata.version);
  }
  modules.push({ name, version: metadata.version, packagePath: 'node_modules/' + relative });
}
console.log(JSON.stringify({ node: process.version, modules }, null, 2));
