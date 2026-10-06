#!/usr/bin/env node
'use strict';
// Synthetic, dependency-free evidence tests only; no native/build/browser execution.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { STAGES, SOURCE, INVENTORY_ROOTS, inspectJest, assessStage, classifyStage, classifyEvidence,
  normalizeFailure, normalizedJestConfig, inventoryDigest, parseEmbeddedJSON, validatePlan } = require('../scripts/classify-quality.cjs');
const bundle = path.resolve(__dirname, '..');
const expectations = JSON.parse(fs.readFileSync(path.join(bundle, 'quality-expectations.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const report = { scope: 'Synthetic quality-classifier regression checks only; native, build, and browser gates NOT RUN.', checks: [] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arco-quality-classifier-'));
const plan = { stages: STAGES, variants: Object.fromEntries(['candidate', 'baseline'].map(variant => [variant, {
  ...SOURCE[variant], sourceRoot: path.join(dir, 'source-' + variant), evidenceRoot: path.join(dir, variant),
  cacheRoot: path.join(dir, 'cache-' + variant), ...(variant === 'baseline' ? { pristine: true } : {})
}])) };
const context = { identitiesVerified: true, prerequisitesVerified: true };
function check(name, fn) {
  try { fn(); report.checks.push({ name, passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack }); }
}
function write(relative, value) {
  const filename = path.join(dir, relative); fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value));
}
function recount(result) {
  const counts = { passed: 0, failed: 0, pending: 0, todo: 0 };
  for (const suite of result.testResults) {
    for (const item of suite.assertionResults) counts[item.status === 'skipped' || item.status === 'disabled' ? 'pending' : item.status]++;
    suite.status = suite.assertionResults.some(t => t.status === 'failed') ? 'failed' : 'passed';
  }
  Object.assign(result, { numPassedTests: counts.passed, numFailedTests: counts.failed,
    numPendingTests: counts.pending, numTodoTests: counts.todo,
    numTotalTests: Object.values(counts).reduce((a, b) => a + b, 0),
    numTotalTestSuites: result.testResults.length,
    numPassedTestSuites: result.testResults.filter(s => s.status === 'passed').length,
    numFailedTestSuites: result.testResults.filter(s => s.status === 'failed').length,
    numPendingTestSuites: 0, numRuntimeErrorTestSuites: 0,
    success: counts.failed === 0 && !result.snapshot.failure });
}
function fixture(variant, stage = 'slider-client') {
  const roots = plan.variants[variant];
  let cases = clone(expectations.sliderClient[variant].cases);
  if (stage === 'full-node') cases = cases.filter(c => c.path.endsWith('demo.test.ts'));
  if (stage !== 'slider-client') cases.push({ path: stage === 'full-node' ? 'components/Other/__test__/demo.test.ts' : 'components/Other/__test__/index.test.tsx', title: 'unrelated existing case' });
  const suites = new Map();
  for (const item of cases) {
    if (!suites.has(item.path)) suites.set(item.path, { name: roots.sourceRoot + '/' + item.path, assertionResults: [], status: 'passed', message: '' });
    suites.get(item.path).assertionResults.push({ title: item.title, fullName: item.title, ancestorTitles: [], status: 'passed', failureMessages: [] });
  }
  const totalSnapshots = stage === 'full-node' ? 15 : 19;
  const jest = { wasInterrupted: false, success: true, testResults: [...suites.values()], snapshot: {
    added: 0, updated: 0, unmatched: 0, filesAdded: 0, filesRemoved: 0, filesUnmatched: 0, filesUpdated: 0,
    matched: totalSnapshots, total: totalSnapshots, unchecked: 0, failure: false, didUpdate: false,
    filesRemovedList: [], uncheckedKeysByFile: []
  } };
  recount(jest);
  let argv = ['slider-client', 'full-client', 'full-node'].includes(stage)
    ? ['env', 'NODE_ENV=test', 'node', path.join(bundle, 'toolchain/node_modules/yarn/bin/yarn.js'),
      'test:' + (stage === 'full-node' ? 'node' : 'client'),
      ...(stage === 'slider-client' ? ['--runTestsByPath', 'components/Slider/__test__/index.test.tsx', 'components/Slider/__test__/demo.test.ts'] : []),
      '--runInBand', '--ci', '--json', '--cacheDirectory=' + roots.cacheRoot + '/jest-' + stage,
      '--outputFile=' + roots.evidenceRoot + '/' + stage + '.jest.json']
    : ['node', roots.sourceRoot + '/node_modules/tool.js', stage];
  if (['client-show-config', 'node-show-config', 'client-list', 'node-list'].includes(stage)) argv =
    ['env', 'NODE_ENV=test', 'node', path.join(bundle, 'toolchain/node_modules/yarn/bin/yarn.js'), 'test:' + stage.split('-')[0],
      stage.endsWith('-list') ? '--listTests' : '--showConfig', '--json', '--runInBand', '--ci', '--cacheDirectory=' + roots.cacheRoot + '/jest-' + stage];
  if (stage === 'types-show-config') argv = ['node', 'node_modules/typescript/bin/tsc', '--showConfig', '-p', 'tsconfig.json'];
  return { roots, loadErrors: [], jest, selectedPaths: jest.testResults.map(s => s.name),
    eslint: ['components/Slider/hooks/useLegalValue.ts', 'components/Slider/__test__/index.test.tsx'].map(p => ({ filePath: roots.sourceRoot + '/' + p, messages: [], errorCount: 0, warningCount: 0, fatalErrorCount: 0 })),
    snapshotKeys: clone(expectations.sliderClient[variant].snapshotKeys),
    runtime: { node: 'v16.20.2', modules: [{ name: 'jest', version: '26.6.3', path: roots.sourceRoot + '/node_modules/jest' }] },
    status: { stage, variant, status: 'passed', completed: true, processExit: 0, loggerExit: 0,
      preIntegrityExit: 0, postIntegrityExit: 0, validationExit: 0 },
    log: 'Command completed.\nDone in 1.25s.\n',
    command: { argv,
      cwd: roots.sourceRoot, environment: { CI: 'true', TZ: 'Asia/Singapore', NODE_ENV: 'test' }, timeoutSeconds: 1800, effectiveTimeoutSeconds: 1800 } };
}
function inspect(evidence, stage = evidence.status.stage) {
  return inspectJest({ stage, variant: evidence.status.variant, result: evidence.jest,
    selectedPaths: evidence.selectedPaths, sourceRoot: evidence.roots.sourceRoot, expectations, snapshotKeys: evidence.snapshotKeys });
}
function fail(evidence, message = 'Expected: 1\nReceived: 2') {
  const suite = evidence.jest.testResults[0], item = suite.assertionResults[0];
  const error = message + '\n    at ' + suite.name + ':10:20';
  item.status = 'failed'; item.failureMessages = [error]; suite.message = error;
  recount(evidence.jest);
  Object.assign(evidence.status, { processExit: 1, validationExit: 1, status: 'failed' });
  return evidence;
}
function classify(a, b, stage = a.status.stage, ctx = context) { return classifyStage(stage, a, b, expectations, ctx); }
function reject(name, change, stage = 'slider-client') {
  check(name, () => { const value = fixture('candidate', stage); change(value); assert.strictEqual(inspect(value, stage).validEvidence, false); });
}
function persist(variant, stage, evidence) {
  write(variant + '/' + stage + '.status.json', evidence.status);
  write(variant + '/' + stage + '.command.json', evidence.command);
  write(variant + '/' + stage + '.log', evidence.log);
  write(variant + '/' + stage + '.exit-code', String(evidence.status.processExit) + '\n');
  write(variant + '/' + stage + '.logger-exit-code', String(evidence.status.loggerExit) + '\n');
  write(variant + '/' + stage + '.effective-timeout-seconds', String(evidence.command.effectiveTimeoutSeconds) + '\n');
  write(variant + '/' + stage + '.pre.integrity.json', guard(variant, stage, 'pre'));
  write(variant + '/' + stage + '.post.integrity.json', guard(variant, stage, 'post'));
  write(variant + '/runtime.json', evidence.runtime);
  if (['client-show-config', 'node-show-config', 'types-show-config', 'client-list', 'node-list'].includes(stage)) {
    const parsed = stage === 'types-show-config' ? typesConfig(variant) : stage.endsWith('-list')
      ? fixture(variant, stage === 'node-list' ? 'full-node' : 'full-client').selectedPaths : jestConfig(variant, stage.startsWith('client'));
    write(variant + '/' + stage + '.parsed.json', parsed);
    write(variant + '/' + stage + '.log', 'yarn run v1.22.22\n$ original capture command\n[Arco React]: site/config/pwa not exists\n' + JSON.stringify(parsed, null, 2) + '\nDone in 1.25s.\n');
  }
  if (stage === 'changed-eslint') write(variant + '/changed-eslint.json', evidence.eslint);
  if (['slider-client', 'full-client', 'full-node'].includes(stage)) {
    write(variant + '/' + stage + '.jest.json', evidence.jest);
    write(variant + '/' + (stage === 'full-node' ? 'node' : 'client') + '-list.parsed.json', evidence.selectedPaths);
    if (stage === 'slider-client') write(variant + '/slider-client.snapshot-keys.json', evidence.snapshotKeys);
    if (stage !== 'full-node') {
      const files = coverageFiles(variant), records = coverageRecords(variant), sha256 = inventoryDigest(records);
      for (const [filename, text] of Object.entries(files)) write(variant + '/' + stage + '.coverage/' + filename, text);
      write(variant + '/' + stage + '.coverage-validation.json', { complete: true, errors: [], sha256 });
      write(variant + '/' + stage + '.coverage-inventory.json', { files: records, count: Object.keys(records).length, sha256 });
    }
  }
}
function jestConfig(variant, client) {
  const root = plan.variants[variant].sourceRoot;
  return { version: '26.6.3', configs: [{ rootDir: root, cwd: root, roots: [root],
    name: crypto.createHash('md5').update(root + '0').digest('hex'),
    testEnvironment: root + '/node_modules/jest-environment-' + (client ? 'jsdom' : 'node') + '/build/index.js',
    testRegex: [client ? '.*\\.test\\.(j|t)sx?$' : 'demo\\.test\\.(j|t)sx?$'], testMatch: [],
    testPathIgnorePatterns: ['/node_modules/'], modulePathIgnorePatterns: [], modulePaths: [root + '/site/node_modules'],
    setupFiles: [root + '/tests/setup.js'], setupFilesAfterEnv: client ? [root + '/tests/jest-dom-setup.js'] : [], globals: {},
    transformIgnorePatterns: ['node_modules/(?!@?react-dnd|dnd-core)'],
    transform: [['^.+\\.jsx?$', '/node_modules/arco-scripts/lib/config/jest/babelTransform.js'],
      ['^.+\\.tsx?$', '/node_modules/arco-scripts/node_modules/ts-jest/dist/index.js'],
      ['.*\\.md$', '/node_modules/arco-scripts/lib/config/jest/mdTransform.js'],
      ['.*\\.(css|less|scss)$', '/node_modules/arco-scripts/lib/config/jest/styleTransform.js']].map(([p, f]) => [p, root + f, {}]),
    coveragePathIgnorePatterns: ['/node_modules/', '/lib/', '/es/', '/dist/', '/icon/', '/components/index.tsx', '/components/locale/'] }],
    globalConfig: { rootDir: root, collectCoverage: client, updateSnapshot: 'none', testFailureExitCode: 1, maxWorkers: 1, json: true,
      forceExit: false, onlyChanged: false, onlyFailures: false, findRelatedTests: false, runTestsByPath: false, passWithNoTests: false,
      watch: false, watchAll: false, bail: 0, testPathPattern: '', nonFlagArgs: [], silent: client,
      coverageDirectory: root + '/.coverage', collectCoverageFrom: ['components/**/*.{ts,tsx}', '!components/**/style/*', '!components/**/api/*'],
      coverageReporters: ['json', 'json-summary', 'lcov', 'clover', 'text-summary'] } };
}
function typesConfig(variant) {
  return { compilerOptions: { jsx: 'react', module: 'es6', target: 'es5', lib: ['es5', 'dom'], moduleResolution: 'node',
    declaration: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true, esModuleInterop: true,
    downlevelIteration: true, experimentalDecorators: true, allowSyntheticDefaultImports: true, outDir: './es', baseUrl: './',
    paths: { '@arco-design/web-react': ['components/index.tsx'], '@arco-design/web-react/icon': ['icon/index.js'], 'test-utils': ['tests/util.ts'] } },
    include: ['components/**/*.ts', 'components/**/*.tsx'], exclude: ['node_modules', 'components/**/*.test.tsx', 'components/**/*.test.ts'],
    files: ['./components/index.tsx', './components/Slider/hooks/useLegalValue.ts'] };
}
function coverageFiles(variant) {
  return { 'coverage-final.json': JSON.stringify({ [plan.variants[variant].sourceRoot + '/components/Slider/index.tsx']: { s: { '0': 1 } } }),
    'coverage-summary.json': JSON.stringify({ total: { statements: { total: 1 } } }),
    'lcov.info': 'SF:components/Slider/index.tsx\nend_of_record\n', 'clover.xml': '<coverage></coverage>',
    'lcov-report/index.html': '<html>Coverage</html>' };
}
function coverageRecords(variant) {
  return Object.fromEntries(Object.entries(coverageFiles(variant)).map(([filename, text]) => [filename, {
    type: 'file', sha256: crypto.createHash('sha256').update(text).digest('hex'), size: Buffer.byteLength(text), executable: false
  }]));
}
function guard(variant, stage, boundary) {
  const inventories = Object.fromEntries(INVENTORY_ROOTS.map(root => [root, { sha256: 'c'.repeat(64), count: 0 }]));
  if (stage === 'final' || STAGES.indexOf(stage) > STAGES.indexOf('slider-client') || (stage === 'slider-client' && boundary === 'post')) {
    const records = coverageRecords(variant);
    inventories['.coverage/'] = { sha256: inventoryDigest(Object.fromEntries(Object.entries(records).map(([filename, item]) => ['.coverage/' + filename, item]))), count: Object.keys(records).length };
  }
  return { variant, stage, boundary, commit: SOURCE[variant].commit, trackedTree: SOURCE[variant].tree,
    source: { sha256: (variant === 'candidate' ? 'a' : 'b').repeat(64), count: 123 },
    errors: [], unexpected: [], inventories };
}
function persistAll(variant) {
  write(variant + '/source.json', { variant, ...SOURCE[variant], pristine: variant === 'baseline', patchApplied: false });
  write(variant + '/prepared.pre.integrity.json', guard(variant, 'prepared', 'pre'));
  write(variant + '/final.pre.integrity.json', guard(variant, 'final', 'pre'));
  for (const stage of STAGES) persist(variant, stage, fixture(variant, stage));

}

for (const variant of ['candidate', 'baseline']) check(variant + ' exact Slider inventory accepted', () => {
  const value = fixture(variant), result = inspect(value);
  assert.strictEqual(result.accepted, true, JSON.stringify(result.errors));
  assert.strictEqual(result.counts.total, variant === 'candidate' ? 59 : 37);
  assert.strictEqual(result.snapshotKeys.length, 19);
});
check('full client keeps skips and todos separate', () => {
  const value = fixture('candidate', 'full-client'), tests = value.jest.testResults[2].assertionResults;
  tests[0].status = 'pending';
  tests.push({ title: 'future', fullName: 'future', ancestorTitles: [], status: 'todo', failureMessages: [] });
  recount(value.jest);
  const result = inspect(value);
  assert.strictEqual(result.accepted, true); assert.strictEqual(result.counts.skipped, 1); assert.strictEqual(result.counts.todo, 1);
});
reject('reject missing selected suite', value => { value.jest.testResults.pop(); recount(value.jest); });
reject('reject extra executed suite', value => { value.selectedPaths.pop(); });
reject('reject duplicated selection', value => { value.selectedPaths.push(value.selectedPaths[0]); });
reject('reject duplicate executed suite', value => { value.jest.testResults.push(clone(value.jest.testResults[0])); recount(value.jest); });
reject('reject outside-checkout suite', value => { value.jest.testResults[0].name = '/other/index.test.tsx'; });
reject('reject traversal in list', value => { value.selectedPaths[0] = '../index.test.tsx'; });
reject('reject missing case despite matching total', value => { value.jest.testResults[0].assertionResults[0].fullName = 'replacement'; value.jest.testResults[0].assertionResults[0].title = 'replacement'; });
reject('reject whitespace-normalized case title', value => {
  const item = value.jest.testResults[0].assertionResults.find(i => i.title.includes('Slider  '));
  item.title = item.title.replace('Slider  ', 'Slider '); item.fullName = item.title;
});
reject('reject inconsistent fullName', value => { value.jest.testResults[0].assertionResults[0].ancestorTitles = ['different']; });
reject('reject contradictory counts', value => { value.jest.numPassedTests++; });
reject('reject missing snapshot key inventory', value => { delete value.snapshotKeys; });
reject('reject changed snapshot key with matching count', value => { value.snapshotKeys[0] = 'replacement 1'; });
reject('reject snapshot mutation', value => { value.jest.snapshot.updated = 1; });
reject('reject deleted snapshot file', value => { value.jest.snapshot.filesRemoved = 1; });
reject('reject snapshot update mode', value => { value.jest.snapshot.didUpdate = true; });
reject('reject interrupted suite', value => { value.jest.wasInterrupted = true; });
reject('reject assertion timeout', value => { fail(value, 'Exceeded timeout of 5000 ms for a test.'); });
reject('reject missing assertion diagnostics', value => { delete value.jest.testResults[0].assertionResults[0].failureMessages; });
reject('reject unknown assertion status', value => { value.jest.testResults[0].assertionResults[0].status = 'success'; });
reject('reject success masking failed assertion', value => { fail(value); value.jest.success = true; });
reject('reject suite marked passed with hidden error', value => { value.jest.testResults[0].message = 'TypeError: extra failure'; });
reject('reject zero-sample complete suite', value => { for (const suite of value.jest.testResults) suite.assertionResults = []; recount(value.jest); }, 'full-client');
reject('reject aggregate missing frozen Slider case', value => { value.jest.testResults[0].assertionResults.pop(); recount(value.jest); }, 'full-client');
reject('reject aggregate missing frozen Slider demo', value => { value.jest.testResults[0].assertionResults.pop(); recount(value.jest); }, 'full-node');
reject('reject full-client snapshot-free fake green', value => { value.jest.snapshot.total = 0; value.jest.snapshot.matched = 0; }, 'full-client');
reject('reject full-node snapshot-free fake green', value => { value.jest.snapshot.total = 0; value.jest.snapshot.matched = 0; }, 'full-node');
check('focused skipped case does not pass', () => {
  const value = fixture('candidate'); value.jest.testResults[0].assertionResults[0].status = 'pending'; recount(value.jest);
  assert.strictEqual(inspect(value).accepted, false);
});
check('failed snapshot remains failed evidence', () => {
  const value = fail(fixture('candidate')); value.jest.snapshot.matched = 18; value.jest.snapshot.unmatched = 1; value.jest.snapshot.failure = true;
  const result = inspect(value); assert.strictEqual(result.validEvidence, true); assert.strictEqual(result.accepted, false);
});
check('matching pristine failure stays red', () => {
  const result = classify(fail(fixture('candidate')), fail(fixture('baseline')));
  assert.strictEqual(result.classification, 'reproduced-on-pristine-base', JSON.stringify(result.comparisonErrors));
  assert.strictEqual(result.status, 'failed');
});
check('only exact verified native command and output echoes normalize', () => {
  const a = fail(fixture('candidate', 'full-node')), b = fail(fixture('baseline', 'full-node'));
  for (const value of [a, b]) {
    value.log = '$ arco-scripts test:node --silent=false ' + value.command.argv.slice(5).join(' ') + '\n' + value.log +
      'Test results written to: ' + path.relative(value.command.cwd, path.join(value.roots.evidenceRoot, 'full-node.jest.json')) + '\n';
  }
  assert.strictEqual(classify(a, b).classification, 'reproduced-on-pristine-base');
  a.log += 'Error: could not write ' + a.roots.evidenceRoot + '/other.json\n';
  b.log += 'Error: could not write ' + b.roots.evidenceRoot + '/other.json\n';
  assert.strictEqual(classify(a, b).classification, 'unresolved');
});
check('altered Yarn command echo is not discarded', () => {
  const a = fail(fixture('candidate', 'full-node')), b = fail(fixture('baseline', 'full-node'));
  for (const value of [a, b]) value.log = '$ arco-scripts test:node --silent=false ' + value.command.argv.slice(5).join(' ') + '\n';
  a.log = a.log.replace('--ci ', '--onlyChanged --ci ');
  assert.strictEqual(classify(a, b).classification, 'unresolved');
});
check('fully successful pristine comparator identifies candidate-only', () => {
  assert.strictEqual(classify(fail(fixture('candidate')), fixture('baseline')).classification, 'candidate-only');
});
for (const [name, mutation] of [
  ['different expected value', b => { b.jest.testResults[0].message = b.jest.testResults[0].message.replace('Expected: 1', 'Expected: 9'); }],
  ['different source line', b => { b.jest.testResults[0].message = b.jest.testResults[0].message.replace(':10:20', ':11:20'); }],
  ['different source column', b => { b.jest.testResults[0].message = b.jest.testResults[0].message.replace(':10:20', ':10:21'); }],
  ['different runtime', b => { b.runtime.node = 'v18.0.0'; }],
  ['different timeout', b => { b.command.timeoutSeconds--; }],
  ['different effective timeout', b => { b.command.effectiveTimeoutSeconds--; }],
  ['different environment', b => { b.command.environment.TZ = 'UTC'; }],
  ['different command', b => { b.command.argv.push('--onlyChanged'); }],
  ['incomplete baseline', b => { b.status.completed = false; }],
  ['timed-out baseline', b => { b.status.status = 'timed-out'; b.status.processExit = 124; }],
  ['baseline logger failure', b => { b.status.loggerExit = 1; }],
  ['baseline integrity failure', b => { b.status.postIntegrityExit = 1; }],
  ['baseline missing JSON', b => { delete b.jest; }]
]) check(name + ' is unresolved', () => {
  const a = fail(fixture('candidate')), b = fail(fixture('baseline')); mutation(b);
  assert.strictEqual(classify(a, b).classification, 'unresolved');
});
for (const diagnostic of ['Jest: global coverage threshold for statements (90%) not met: 70%',
  'UnhandledPromiseRejectionWarning: TypeError: unexpected', 'additional unexplained output']) {
  check('mixed assertion plus candidate-only log diagnostic stays unresolved: ' + diagnostic, () => {
    const a = fail(fixture('candidate')), b = fail(fixture('baseline')); a.log += diagnostic + '\n';
    assert.strictEqual(classify(a, b).classification, 'unresolved');
    b.log += diagnostic + '\n';
    assert.strictEqual(classify(a, b).classification, 'reproduced-on-pristine-base');
  });
}
check('unverified pristine identity is unresolved', () => {
  assert.strictEqual(classify(fail(fixture('candidate')), fail(fixture('baseline')), 'slider-client', { ...context, identitiesVerified: false }).classification, 'unresolved');
});
check('failed baseline setup cannot reproduce', () => {
  assert.strictEqual(classify(fail(fixture('candidate')), fail(fixture('baseline')), 'slider-client', { ...context, prerequisitesVerified: false }).classification, 'unresolved');
});
check('missing result never passes even with zero exit', () => {
  const value = fixture('candidate'); delete value.jest;
  assert.strictEqual(assessStage('slider-client', 'candidate', value, expectations).validEvidence, false);
});
for (const field of ['loggerExit', 'preIntegrityExit', 'postIntegrityExit', 'validationExit']) check(field + ' cannot be hidden by zero process exit', () => {
  const value = fixture('candidate'); value.status[field] = 1;
  const result = assessStage('slider-client', 'candidate', value, expectations);
  assert.strictEqual(result.validEvidence, false); assert.notStrictEqual(result.status, 'passed');
});
check('nonzero process exit cannot be hidden by Jest success', () => {
  const value = fixture('candidate'); value.status.processExit = 1; value.status.status = 'failed';
  assert.strictEqual(assessStage('slider-client', 'candidate', value, expectations).validEvidence, false);
});
check('failed non-Jest output sentinel is unresolved', () => {
  const a = fixture('candidate', 'build-cjs'), b = fixture('baseline', 'build-cjs');
  for (const v of [a, b]) { v.status.validationExit = 1; v.status.status = 'failed'; }
  assert.strictEqual(classify(a, b).classification, 'unresolved');
});
check('matching ordinary non-Jest failure remains red', () => {
  const a = fixture('candidate', 'changed-prettier'), b = fixture('baseline', 'changed-prettier');
  for (const v of [a, b]) { v.status.processExit = 1; v.status.status = 'failed'; v.log = v.roots.sourceRoot + '/file.ts:1:1 Error: example\nDone in 1.25s.\n'; }
  b.log = b.log.replace('1.25s', '9.00s');
  const result = classify(a, b); assert.strictEqual(result.classification, 'reproduced-on-pristine-base'); assert.strictEqual(result.status, 'failed');
});
check('matching ESLint JSON errors reproduce while validation remains failed', () => {
  const a = fixture('candidate', 'changed-eslint'), b = fixture('baseline', 'changed-eslint');
  for (const v of [a, b]) {
    Object.assign(v.status, { processExit: 1, validationExit: 1, status: 'failed' });
    v.eslint[0].messages = [{ ruleId: 'example', severity: 2, line: 1, column: 2, message: 'Example error.' }];
    v.eslint[0].errorCount = 1;
  }
  assert.strictEqual(classify(a, b).classification, 'reproduced-on-pristine-base');
  b.eslint[0].messages[0].column = 3;
  assert.strictEqual(classify(a, b).classification, 'unresolved');
});
check('failure normalization retains source numbers and ordinary numeric values', () => {
  const roots = plan.variants.candidate, raw = roots.sourceRoot + '/file.ts:41:17\nExpected: 59\nReceived: 37\nDone in 8.05s.\n';
  assert.strictEqual(normalizeFailure(raw, roots), '<sourceRoot>/file.ts:41:17\nExpected: 59\nReceived: 37\nDone in <elapsed>s.\n');
});
check('path normalization does not erase an unrelated path prefix', () => {
  const roots = plan.variants.candidate;
  assert.strictEqual(normalizeFailure(roots.sourceRoot + '-other/file.ts', roots), roots.sourceRoot + '-other/file.ts');
});
check('generated Jest project identity is strictly validated', () => {
  const roots = plan.variants.candidate;
  const config = { configs: [{ rootDir: roots.sourceRoot, name: crypto.createHash('md5').update(roots.sourceRoot + '0').digest('hex') }] };
  assert.strictEqual(normalizedJestConfig(config, roots).configs[0].name, '<verified-generated-project-name>');
  config.configs[0].name = 'unverified'; assert.throws(() => normalizedJestConfig(config, roots));
});
check('complete client inventories permit only the 22 frozen additions', () => {
  const result = classify(fail(fixture('candidate', 'full-client')), fail(fixture('baseline', 'full-client')));
  assert.strictEqual(result.classification, 'reproduced-on-pristine-base', JSON.stringify(result.comparisonErrors));
  assert.strictEqual(result.inventoryComparison.added.length, 22);
});
check('unrelated extra full-suite case is unresolved', () => {
  const a = fail(fixture('candidate', 'full-client')), b = fail(fixture('baseline', 'full-client'));
  b.jest.testResults[2].assertionResults[0].title = 'different'; b.jest.testResults[2].assertionResults[0].fullName = 'different';
  assert.strictEqual(classify(a, b).classification, 'unresolved');
});
check('complete node inventory does not require Slider keyboard index', () => {
  const a = fail(fixture('candidate', 'full-node')), b = fail(fixture('baseline', 'full-node'));
  const result = classify(a, b); assert.strictEqual(result.classification, 'reproduced-on-pristine-base');
  assert.strictEqual(result.inventoryComparison.added.length, 0);
});
check('exact pristine plan accepted; injected baseline rejected', () => {
  validatePlan(plan, dir); const bad = clone(plan); bad.variants.baseline.tree = 'b5e76a788981e52ca5e08b3cfc0d1baf8b7627fe';
  assert.throws(() => validatePlan(bad, dir));
});
check('reducing stage plan cannot manufacture green', () => {
  const bad = clone(plan); bad.stages.pop(); assert.throws(() => validatePlan(bad, dir));
});
write('quality-plan.json', plan);
write('driver.exit-code', '0\n');
persistAll('candidate');
check('all successful candidate gates need no pristine rerun', () => {
  const result = classifyEvidence({ evidenceDir: dir, expectations });
  assert.strictEqual(result.accepted, true, JSON.stringify(result.stages.filter(s => s.classification !== 'passed')));
  assert.strictEqual(result.stages.length, STAGES.length);
});
for (const stage of ['client-show-config', 'node-show-config', 'types-show-config', 'client-list', 'node-list']) {
  for (const mode of ['missing', 'malformed', 'changed-without-raw']) check(stage + ' ' + mode + ' parsed capture prevents green', () => {
    const filename = 'candidate/' + stage + '.parsed.json', absolute = path.join(dir, filename), before = fs.readFileSync(absolute, 'utf8');
    try {
      if (mode === 'missing') fs.unlinkSync(absolute);
      else if (mode === 'malformed') write(filename, '{not valid JSON');
      else {
        const value = JSON.parse(before);
        if (Array.isArray(value)) value.pop();
        else if (value.compilerOptions) value.compilerOptions.jsx = 'preserve';
        else value.globalConfig.testPathPattern = 'Slider';
        write(filename, value);
      }
      const result = classifyEvidence({ evidenceDir: dir, expectations });
      assert.strictEqual(result.accepted, false);
      assert.notStrictEqual(result.stages.find(item => item.stage === stage).classification, 'passed');
    } finally { write(filename, before); }
  });
  check(stage + ' ambiguous original JSON prevents green', () => {
    const filename = 'candidate/' + stage + '.log', before = fs.readFileSync(path.join(dir, filename), 'utf8');
    try {
      write(filename, before + fs.readFileSync(path.join(dir, 'candidate/' + stage + '.parsed.json'), 'utf8') + '\n');
      assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, false);
    } finally { write(filename, before); }
  });
}
for (const [name, stage, change] of [
  ['disabled coverage', 'client-show-config', c => { c.globalConfig.collectCoverage = false; }],
  ['filtered selection', 'client-show-config', c => { c.globalConfig.testPathPattern = 'Slider'; }],
  ['wrong node environment', 'node-show-config', c => { c.configs[0].testEnvironment = c.configs[0].testEnvironment.replace('jest-environment-node', 'jest-environment-jsdom'); }],
  ['wrong generated identity', 'node-show-config', c => { c.configs[0].name = 'wrong'; }],
  ['changed transformer options', 'client-show-config', c => { c.configs[0].transform[1][2].diagnostics = false; }],
  ['type-test-file inclusion', 'types-show-config', c => { c.files.push('./components/Slider/__test__/index.test.tsx'); }],
  ['changed type exclusion', 'types-show-config', c => { c.exclude.pop(); }],
  ['wrong type compiler target', 'types-show-config', c => { c.compilerOptions.target = 'esnext'; }],
  ['node non-demo selection', 'node-list', c => { c.push(plan.variants.candidate.sourceRoot + '/components/Slider/__test__/index.test.tsx'); }]
]) check('raw-bound ' + name + ' still fails semantic validation', () => {
  const parsedFile = 'candidate/' + stage + '.parsed.json', logFile = 'candidate/' + stage + '.log';
  const parsedBefore = fs.readFileSync(path.join(dir, parsedFile), 'utf8'), logBefore = fs.readFileSync(path.join(dir, logFile), 'utf8');
  try {
    const value = JSON.parse(parsedBefore); change(value);
    write(parsedFile, value); write(logFile, 'yarn run v1.22.22\n' + JSON.stringify(value, null, 2) + '\nDone in 2.00s.\n');
    assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, false);
  } finally { write(parsedFile, parsedBefore); write(logFile, logBefore); }
});
check('TypeScript es2015 serialization alias remains valid', () => {
  const parsedFile = 'candidate/types-show-config.parsed.json', logFile = 'candidate/types-show-config.log';
  const parsedBefore = fs.readFileSync(path.join(dir, parsedFile), 'utf8'), logBefore = fs.readFileSync(path.join(dir, logFile), 'utf8');
  try {
    const value = JSON.parse(parsedBefore); value.compilerOptions.module = 'es2015';
    write(parsedFile, value); write(logFile, JSON.stringify(value, null, 2) + '\n');
    assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, true);
  } finally { write(parsedFile, parsedBefore); write(logFile, logBefore); }
});
check('TypeScript config command cannot silently become an emitting compile', () => {
  const filename = 'candidate/types-show-config.command.json', before = fs.readFileSync(path.join(dir, filename), 'utf8');
  try {
    const value = JSON.parse(before); value.argv = value.argv.filter(arg => arg !== '--showConfig'); write(filename, value);
    assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, false);
  } finally { write(filename, before); }
});
check('wrapper parser handles escaped strings and Arco/Yarn noise', () => {
  const value = { configs: [{ note: 'quotes " and braces } ] and slash \\ survive' }], globalConfig: {} };
  const raw = 'yarn run v1.22.22\n$ arco-scripts test:client --showConfig --json\n[Arco React]: site/config/pwa not exists\n' + JSON.stringify(value, null, 2) + '\nDone in 3.29s.\n';
  assert.deepStrictEqual(parseEmbeddedJSON(raw, 'config'), value);
  assert.deepStrictEqual(parseEmbeddedJSON('[Arco React]: notice\n["/source/a.test.ts", "/source/b.test.ts"]\nDone in 1s.', 'list'), ['/source/a.test.ts', '/source/b.test.ts']);
  assert.deepStrictEqual(parseEmbeddedJSON('compiler wrapper\n{"compilerOptions":{"jsx":"react"}}\n', 'types'), { compilerOptions: { jsx: 'react' } });
  assert.throws(() => parseEmbeddedJSON(raw + JSON.stringify(value), 'config'));
});
for (const [name, filename, change] of [
  ['missing final guard', 'candidate/final.pre.integrity.json', null],
  ['changed final source digest', 'candidate/final.pre.integrity.json', v => { v.source.sha256 = 'd'.repeat(64); }],
  ['failed final guard', 'candidate/final.pre.integrity.json', v => { v.errors.push('source changed'); }],
  ['wrong source commitment', 'candidate/source.json', v => { v.commit = SOURCE.baseline.commit; }],
  ['patch applied on candidate', 'candidate/source.json', v => { v.patchApplied = true; }],
  ['missing stage guard', 'candidate/full-client.post.integrity.json', null],
  ['missing coverage validation', 'candidate/full-client.coverage-validation.json', null],
  ['incomplete coverage', 'candidate/full-client.coverage-validation.json', v => { v.complete = false; }],
  ['coverage digest mismatch', 'candidate/full-client.coverage-validation.json', v => { v.sha256 = 'f'.repeat(64); }],
  ['coverage inventory mutation', 'candidate/full-client.coverage-inventory.json', v => { v.files['lcov.info'].size++; }],
  ['changed nonwriter inventory', 'candidate/full-node.post.integrity.json', v => { v.inventories['node_modules/'].sha256 = 'd'.repeat(64); }],
  ['broken phase chain', 'candidate/full-client.pre.integrity.json', v => { v.inventories['.coverage/'].sha256 = 'd'.repeat(64); }]
]) check(name + ' prevents aggregate green', () => {
  const filenameAbsolute = path.join(dir, filename), before = fs.readFileSync(filenameAbsolute, 'utf8');
  if (change) { const value = JSON.parse(before); change(value); write(filename, value); } else fs.unlinkSync(filenameAbsolute);
  assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, false);
  write(filename, before);
});
check('final global guard failure prevents aggregate green', () => {
  write('driver.exit-code', '1\n'); assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, false); write('driver.exit-code', '0\n');
});
check('missing original process sidecar prevents aggregate green', () => {
  fs.unlinkSync(path.join(dir, 'candidate/full-node.exit-code'));
  assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, false); write('candidate/full-node.exit-code', '0\n');
});
check('missing copied coverage report prevents aggregate green', () => {
  const filename = 'candidate/full-client.coverage/lcov.info', before = fs.readFileSync(path.join(dir, filename), 'utf8');
  fs.unlinkSync(path.join(dir, filename)); assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, false); write(filename, before);
});
check('changed copied coverage bytes prevent aggregate green', () => {
  const filename = 'candidate/full-client.coverage/lcov.info', before = fs.readFileSync(path.join(dir, filename), 'utf8');
  write(filename, 'tampered'); assert.strictEqual(classifyEvidence({ evidenceDir: dir, expectations }).accepted, false); write(filename, before);
});
check('not-run final stage cannot manufacture green', () => {
  const value = fixture('candidate', 'full-node'); value.status = { stage: 'full-node', variant: 'candidate', status: 'not-run', completed: false, processExit: null };
  persist('candidate', 'full-node', value);
  const result = classifyEvidence({ evidenceDir: dir, expectations });
  assert.strictEqual(result.accepted, false); assert.strictEqual(result.stages.at(-1).status, 'not-run');
  persist('candidate', 'full-node', fixture('candidate', 'full-node'));
});
persistAll('baseline');
check('aggregate remains failed when pristine reproduces', () => {
  persist('candidate', 'full-client', fail(fixture('candidate', 'full-client')));
  persist('baseline', 'full-client', fail(fixture('baseline', 'full-client')));
  const result = classifyEvidence({ evidenceDir: dir, expectations });
  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.stages.find(s => s.stage === 'full-client').classification, 'reproduced-on-pristine-base');
  assert.strictEqual(result.stages.find(s => s.stage === 'full-node').classification, 'passed');
});
check('different baseline default config is unresolved', () => {
  write('baseline/client-show-config.parsed.json', { override: true });
  const result = classifyEvidence({ evidenceDir: dir, expectations });
  assert.strictEqual(result.stages.find(s => s.stage === 'full-client').classification, 'unresolved');
});
check('missing prerequisite blocks purported later pass', () => {
  const value = fixture('candidate', 'build-es'); value.status.status = 'blocked'; value.status.completed = false; value.status.processExit = null;
  persist('candidate', 'build-es', value);
  const result = classifyEvidence({ evidenceDir: dir, expectations });
  assert.strictEqual(result.stages.find(s => s.stage === 'full-node').status, 'blocked');
});
check('partial CLI validates before stage status finalization', () => {
  fs.unlinkSync(path.join(dir, 'candidate/slider-client.status.json'));
  const run = spawnSync(process.execPath, [path.join(bundle, 'scripts/classify-quality.cjs'), '--evidence', dir,
    '--expectations', path.join(bundle, 'quality-expectations.json'), '--stage', 'slider-client', '--variant', 'candidate'], { encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr + run.stdout);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'candidate/slider-client.validation.json'))).accepted, true);
});
check('missing partial JSON writes explicit failed evidence report', () => {
  fs.unlinkSync(path.join(dir, 'candidate/slider-client.jest.json'));
  const run = spawnSync(process.execPath, [path.join(bundle, 'scripts/classify-quality.cjs'), '--evidence', dir,
    '--expectations', path.join(bundle, 'quality-expectations.json'), '--stage', 'slider-client', '--variant', 'candidate'], { encoding: 'utf8' });
  assert.strictEqual(run.status, 1);
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'candidate/slider-client.validation.json')));
  assert.strictEqual(result.accepted, false); assert.strictEqual(result.validEvidence, false);
});
fs.rmSync(dir, { recursive: true, force: true });
report.accepted = report.checks.every(c => c.passed);
report.passed = report.checks.filter(c => c.passed).length;
report.failed = report.checks.length - report.passed;
if (process.argv.length > 2) {
  assert.strictEqual(process.argv[2], '--output'); assert.strictEqual(process.argv.length, 4);
  fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.accepted ? 0 : 1;
