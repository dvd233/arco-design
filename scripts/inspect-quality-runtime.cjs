#!/usr/bin/env node
'use strict';
// Metadata-only observer. Resolves and parses manifests; never loads application/package JS.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
function hash(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function resolveMetadata(name, req, boundary, root, pin) {
  const allowed = path.join(root, boundary);
  function checked(file) {
    const real = fs.realpathSync(file);
    const relative = path.relative(allowed, real);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw Error('Package escaped ' + boundary + ': ' + name);
    }
    return real;
  }
  let file;
  try {
    file = checked(req.resolve(name + '/package.json'));
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    // Respect public exports. Resolve, never require/execute, the permitted entry.
    // Read metadata only while walking its real ancestry inside this dependency root.
    let directory = path.dirname(checked(req.resolve(name)));
    while (directory !== allowed) {
      const candidate = path.join(directory, 'package.json');
      if (fs.existsSync(candidate)) {
        const manifest = checked(candidate);
        const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (value.name === name) { file = manifest; break; }
        if (value.name !== undefined) throw Error('Unexpected package name for ' + name + ': ' + value.name);
      }
      directory = path.dirname(directory);
    }
    if (!file) throw Error('No matching package manifest for public entry: ' + name);
  }
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (metadata.name !== name) throw Error('Unexpected package name for ' + name + ': ' + metadata.name);
  if (typeof metadata.version !== 'string' || !metadata.version) throw Error('Missing package version: ' + name);
  if (pin && metadata.version !== pin) throw Error('Unexpected pin ' + name + ': ' + metadata.version);
  return { file, record: { name, version: metadata.version, packagePath: path.relative(root, file), sha256: hash(file) } };
}
function inspect(rootArg, evidenceArg) {
const root = fs.realpathSync(rootArg);
const evidence = path.resolve(evidenceArg);
const bundle = path.resolve(__dirname, '..');
const fromRoot = createRequire(path.join(root, 'package.json'));
const fromSite = createRequire(path.join(root, 'site/package.json'));
const modules = [];
function observe(name, req, boundary, pin) {
  const result = resolveMetadata(name, req, boundary, root, pin);
  modules.push(result.record);
  return result.file;
}
const pins = { eslint: '7.32.0', prettier: '2.5.0', typescript: '4.4.4', 'arco-scripts': '1.27.14',
  jest: '26.6.3', react: '16.14.0', 'react-dom': '16.14.0', '@testing-library/react': '12.1.5',
  '@testing-library/dom': '8.13.0', 'jest-config': '26.6.3' };
for (const [name, pin] of Object.entries(pins)) observe(name, fromRoot, 'node_modules', pin);
for (const name of ['jest-environment-jsdom', 'jest-environment-node', 'less', 'gulp-less',
  'less-plugin-autoprefix', 'less-plugin-npm-import', 'node-typescript-compiler']) observe(name, fromRoot, 'node_modules');
const arcoManifest = fromRoot.resolve('arco-scripts/package.json');
const fromArco = createRequire(arcoManifest);
observe('ts-jest', fromArco, 'node_modules', '26.5.6');
const compilerManifest = observe('node-typescript-compiler', fromArco, 'node_modules');
observe('typescript', fromArco, 'node_modules', '4.6.4');
observe('typescript', createRequire(compilerManifest), 'node_modules');
const site = JSON.parse(fs.readFileSync(path.join(root, 'site/package.json'), 'utf8'));
for (const name of Object.keys({ ...site.dependencies, ...site.devDependencies }).sort()) {
  observe(name, fromSite, 'site/node_modules');
}
const localTsc = fs.realpathSync(path.join(root, 'node_modules/.bin/tsc'));
if (localTsc !== path.join(root, 'node_modules/typescript/bin/tsc')) throw Error('Hooks npx tsc would not use pinned root TypeScript');
const contract = JSON.parse(fs.readFileSync(path.join(bundle, 'quality-css-contract.json'), 'utf8'));
const runtimeContract = JSON.parse(fs.readFileSync(path.join(bundle, 'quality-runtime-contract.json'), 'utf8'));
const tooling = {};
for (const [rel, sha] of Object.entries({ ...contract.package.compilerFiles, ...runtimeContract.files })) {
  const file = path.join(root, rel);
  if (hash(file) !== sha) throw Error('Verified native tooling byte mismatch: ' + rel);
  tooling[rel] = sha;
  const target = path.join(evidence, 'tooling-source', rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}
for (const [rel, sha] of Object.entries(contract.sourceInputs)) {
  if (hash(path.join(root, rel)) !== sha) throw Error('CSS config/source contract differs: ' + rel);
}
const report = { node: process.version, modules, tooling,
  localHooksTsc: path.relative(root, localTsc), hooksNpxPolicy: 'npm_config_offline=true; root local .bin; no fetch',
  buildOverrides: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('BUILD_ENV_'))),
  buildNodeEnv: process.env.NODE_ENV || null };
if (Object.keys(report.buildOverrides).length || report.buildNodeEnv) throw Error('Build override present');
fs.writeFileSync(path.join(evidence, 'runtime.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

}
module.exports = { resolveMetadata, inspect };
if (require.main === module) inspect(process.argv[2], process.argv[3]);
