#!/usr/bin/env node
'use strict';
// Evidence-only classifier. Never imports product code or executes a test/build.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STAGES = Object.freeze(['root-install', 'site-install', 'runtime',
  'client-show-config', 'node-show-config', 'client-list', 'node-list',
  'types-show-config', 'changed-eslint', 'changed-prettier', 'icon', 'source-types',
  'build-cjs', 'build-es', 'build-css', 'slider-client', 'full-client', 'full-node']);
const JEST_STAGES = new Set(['slider-client', 'full-client', 'full-node']);
const INVENTORY_ROOTS = ['node_modules/', 'site/node_modules/', 'icon/react-icon/', 'icon/react-icon-cjs/',
  'lib/', 'hooks/lib/', 'es/', 'hooks/es/', 'dist/css/', 'dist/asset/', '.coverage/'];
const WRITERS = { 'root-install': ['node_modules/'], 'site-install': ['site/node_modules/'],
  icon: ['icon/react-icon/', 'icon/react-icon-cjs/'], 'build-cjs': ['lib/', 'hooks/lib/'],
  'build-es': ['es/', 'hooks/es/'], 'build-css': ['es/', 'lib/', 'dist/css/', 'dist/asset/'],
  'slider-client': ['.coverage/'], 'full-client': ['.coverage/'] };
const SOURCE = Object.freeze({
  candidate: { commit: 'a1ea1670c162248348515ddfa14e445860bb3c22', tree: 'ce1acd1765289aa70d6e02e89c5f9138f447db58' },
  baseline: { commit: 'c2b050d9c7ce94bebba94f616a0721344231caac', tree: '51f988b198e24b8ea898e5803cfa0698280a1ef7' }
});
const INSTALLS = ['root-install', 'site-install', 'runtime'];
const TEST_PREREQUISITES = [...INSTALLS, 'icon', 'build-cjs', 'build-es'];
const PREREQUISITES = {
  'root-install': [], 'site-install': ['root-install'], runtime: ['root-install', 'site-install'],
  'client-show-config': INSTALLS, 'node-show-config': INSTALLS,
  'client-list': [...INSTALLS, 'client-show-config'], 'node-list': [...INSTALLS, 'node-show-config'],
  'types-show-config': INSTALLS, 'changed-eslint': INSTALLS, 'changed-prettier': INSTALLS,
  icon: INSTALLS, 'source-types': [...INSTALLS, 'icon', 'types-show-config'],
  'build-cjs': [...INSTALLS, 'icon'], 'build-es': [...INSTALLS, 'icon', 'build-cjs'],
  'build-css': [...INSTALLS, 'icon', 'build-cjs', 'build-es'],
  'slider-client': [...TEST_PREREQUISITES, 'client-show-config', 'client-list'],
  'full-client': [...TEST_PREREQUISITES, 'client-show-config', 'client-list'],
  'full-node': [...TEST_PREREQUISITES, 'node-show-config', 'node-list']
};
const integer = n => Number.isInteger(n) && n >= 0;
const stable = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(stable(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))]))
  : value);
const equal = (a, b) => stable(a) === stable(b);
const sorted = values => [...values].sort((a, b) => stable(a).localeCompare(stable(b)));
function must(condition, message) { if (!condition) throw new Error(message); }
function relativeFile(filename, root) {
  must(typeof filename === 'string' && filename.length > 0 && !filename.includes('\0'), 'Invalid test path.');
  let result = filename;
  if (path.isAbsolute(result)) {
    must(typeof root === 'string' && result.startsWith(root.replace(/\/$/, '') + '/'), 'Test path escapes verified source root: ' + filename);
    result = path.relative(root, result);
  }
  must(result && !result.split('/').some(p => p === '..' || p === '.' || p === '') && !result.includes('\\'), 'Noncanonical test path: ' + filename);
  return result;
}
function normalizePrefixes(text, roots, includeArtifacts = false) {
  must(typeof text === 'string', 'Expected text for normalization.');
  const fields = includeArtifacts ? ['sourceRoot', 'evidenceRoot', 'cacheRoot'] : ['sourceRoot'];
  const entries = fields.filter(k => roots && typeof roots[k] === 'string' && roots[k].length > 1)
    .map(k => [roots[k].replace(/\/$/, ''), '<' + k + '>']).sort((a, b) => b[0].length - a[0].length);
  let result = text;
  for (const [prefix, marker] of entries) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped + '(?=$|[\\/\\s:\\"\\\'\\)])', 'g'), marker);
  }
  return result;
}
function normalizeFailure(text, roots) {
  // Do not strip ANSI, source lines, columns, values, whitespace, or arbitrary numbers.
  // Only whole, recognizable runner timing lines are volatile.
  return normalizePrefixes(text, roots).replace(/^Done in \d+(?:\.\d+)?s\.$/gm, 'Done in <elapsed>s.')
    .replace(/^Time:\s+\d+(?:\.\d+)? s(?:, estimated \d+(?:\.\d+)? s)?$/gm, 'Time: <elapsed> s');
}
function normalizeMetadata(value, roots) {
  if (typeof value === 'string') return normalizePrefixes(value, roots, true);
  if (Array.isArray(value)) return value.map(v => normalizeMetadata(v, roots));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeMetadata(v, roots)]));
  return value;
}
function multisetDifference(left, right) {
  const remaining = new Map();
  for (const item of right) remaining.set(stable(item), (remaining.get(stable(item)) || 0) + 1);
  return sorted(left.filter(item => {
    const key = stable(item), n = remaining.get(key) || 0;
    if (n) { remaining.set(key, n - 1); return false; }
    return true;
  }));
}
const isTimeout = text => /Exceeded timeout|Async callback was not invoked within|Timeout - Async callback|Jest:.*timed out|worker.*timed out/i.test(text);

function inspectJest({ stage, variant, result, selectedPaths, sourceRoot, expectations, snapshotKeys }) {
  const out = { validEvidence: false, accepted: false, errors: [], failureReasons: [], failures: [],
    inventory: [], suites: [], skippedCases: [], todoCases: [] };
  try {
    must(JEST_STAGES.has(stage), 'Not a supported Jest stage.');
    must(variant === 'candidate' || variant === 'baseline', 'Invalid variant.');
    must(result && typeof result === 'object' && !Array.isArray(result), 'Missing/malformed Jest JSON.');
    must(result.wasInterrupted === false, 'Jest was interrupted or completion is unknown.');
    for (const field of ['numFailedTestSuites', 'numFailedTests', 'numPassedTestSuites', 'numPassedTests',
      'numPendingTestSuites', 'numPendingTests', 'numRuntimeErrorTestSuites', 'numTodoTests', 'numTotalTestSuites', 'numTotalTests']) {
      must(integer(result[field]), 'Invalid or missing Jest count: ' + field);
    }
    must(typeof result.success === 'boolean', 'Missing Jest success flag.');
    must(Array.isArray(result.testResults) && result.testResults.length > 0, 'Missing/empty executed test suites.');
    must(Array.isArray(selectedPaths) && selectedPaths.length > 0, 'Missing/empty captured test selection.');
    const selected = selectedPaths.map(p => relativeFile(p, sourceRoot));
    must(new Set(selected).size === selected.length, 'Duplicate captured test selection.');
    const spec = expectations && expectations.sliderClient && expectations.sliderClient[variant];
    must(spec && Array.isArray(spec.cases) && Array.isArray(spec.snapshotKeys), 'Missing frozen Slider inventory.');
    const wantedSuites = stage === 'slider-client' ? [...new Set(spec.cases.map(c => c.path))] : selected;
    must(wantedSuites.every(p => selected.includes(p)), 'Focused Slider file absent from captured client selection.');
    const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, suitesPassed: 0, suitesFailed: 0, suitesSkipped: 0 };
    for (const suite of result.testResults) {
      must(suite && typeof suite === 'object', 'Invalid suite result.');
      const filename = relativeFile(suite.name, sourceRoot);
      must(!out.suites.includes(filename), 'Duplicate executed suite: ' + filename);
      out.suites.push(filename);
      must(['passed', 'failed', 'pending', 'skipped', 'disabled'].includes(suite.status), 'Unknown suite status: ' + filename);
      must(Array.isArray(suite.assertionResults), 'Missing assertion results: ' + filename);
      must(suite.status !== 'passed' || suite.assertionResults.length > 0, 'Passed suite has no registered assertions: ' + filename);
      must(typeof suite.message === 'string', 'Missing suite diagnostic message: ' + filename);
      if (suite.status === 'passed') counts.suitesPassed++;
      else if (suite.status === 'failed') counts.suitesFailed++;
      else counts.suitesSkipped++;
      const suiteFailures = [];
      for (const item of suite.assertionResults) {
        must(item && typeof item.title === 'string' && typeof item.fullName === 'string' &&
          Array.isArray(item.ancestorTitles) && item.ancestorTitles.every(t => typeof t === 'string'), 'Incomplete assertion identity: ' + filename);
        must(item.fullName === [...item.ancestorTitles, item.title].join(' '), 'Inconsistent assertion fullName: ' + filename);
        must(['passed', 'failed', 'pending', 'skipped', 'disabled', 'todo'].includes(item.status), 'Unknown assertion status: ' + item.fullName);
        must(Array.isArray(item.failureMessages) && item.failureMessages.every(m => typeof m === 'string'), 'Missing assertion diagnostics: ' + item.fullName);
        const entry = { path: filename, title: item.fullName, status: item.status };
        out.inventory.push(entry);
        if (item.status === 'failed') {
          counts.failed++;
          must(item.failureMessages.length > 0 && item.failureMessages.some(m => m.length > 0), 'Failed assertion without an error: ' + item.fullName);
          suiteFailures.push({ path: filename, title: item.fullName, messages: item.failureMessages });
        } else {
          must(item.failureMessages.length === 0 && (!item.failureDetails || (Array.isArray(item.failureDetails) && item.failureDetails.length === 0)), 'Error attached to a nonfailed assertion.');
          if (item.status === 'passed') counts.passed++;
          else if (item.status === 'todo') { counts.todo++; out.todoCases.push(entry); }
          else { counts.skipped++; out.skippedCases.push(entry); }
        }
      }
      if (suite.status === 'passed') must(suiteFailures.length === 0 && !suite.testExecError && suite.message === '', 'Passed suite contains failure evidence.');
      if (suiteFailures.length) must(suite.status === 'failed', 'Failed assertion in a nonfailed suite.');
      if (suite.status === 'failed') {
        must(suite.message.length > 0 || suiteFailures.length > 0 || suite.testExecError, 'Failed suite has no diagnostics.');
        out.failures.push({ path: filename, message: suite.message, assertions: suiteFailures,
          ...(suite.testExecError ? { testExecError: suite.testExecError } : {}) });
      }
    }
    out.suites.sort(); out.inventory = sorted(out.inventory);
    out.selection = { captured: sorted(wantedSuites), executed: out.suites,
      missing: multisetDifference(wantedSuites, out.suites), added: multisetDifference(out.suites, wantedSuites) };
    must(out.selection.missing.length === 0 && out.selection.added.length === 0, 'Executed suites differ from captured selection.');
    const total = counts.passed + counts.failed + counts.skipped + counts.todo;
    must(total > 0, 'No registered test cases executed.');
    for (const [field, actual] of Object.entries({ numPassedTests: counts.passed, numFailedTests: counts.failed,
      numPendingTests: counts.skipped, numTodoTests: counts.todo, numTotalTests: total,
      numPassedTestSuites: counts.suitesPassed, numFailedTestSuites: counts.suitesFailed,
      numPendingTestSuites: counts.suitesSkipped, numTotalTestSuites: out.suites.length })) {
      must(result[field] === actual, 'Jest count contradicts inventory: ' + field);
    }
    must(result.numRuntimeErrorTestSuites <= counts.suitesFailed, 'Runtime-error suite count exceeds failed suites.');
    must(!out.failures.some(f => isTimeout(stable(f))), 'Jest timeout is unresolved.');
    const snap = result.snapshot;
    must(snap && typeof snap === 'object', 'Missing snapshot result.');
    for (const field of ['added', 'updated', 'unmatched', 'filesAdded', 'filesRemoved', 'filesUnmatched', 'filesUpdated', 'matched', 'total', 'unchecked']) {
      must(integer(snap[field]), 'Invalid snapshot count: ' + field);
    }
    must(typeof snap.failure === 'boolean' && typeof snap.didUpdate === 'boolean', 'Missing snapshot state.');
    for (const field of ['added', 'updated', 'filesAdded', 'filesRemoved', 'filesUpdated']) must(snap[field] === 0, 'Snapshot mutation: ' + field);
    must(snap.didUpdate === false, 'Snapshot update mode was used.');
    must(Array.isArray(snap.filesRemovedList) && snap.filesRemovedList.length === 0, 'Removed snapshot file evidence.');
    must(Array.isArray(snap.uncheckedKeysByFile), 'Missing unchecked snapshot inventory.');
    must(snap.total === snap.matched + snap.unmatched, 'Snapshot totals are inconsistent.');
    out.snapshot = snap;
    out.counts = { ...counts, total, suites: out.suites.length, runtimeErrorSuites: result.numRuntimeErrorTestSuites };
    {
      const frozenCases = stage === 'full-node' ? spec.cases.filter(c => c.path === 'components/Slider/__test__/demo.test.ts') : spec.cases;
      const frozenPaths = new Set(frozenCases.map(c => c.path));
      const actualCases = out.inventory.filter(c => frozenPaths.has(c.path)).map(({ path: filename, title }) => ({ path: filename, title }));
      out.caseInventory = { added: multisetDifference(actualCases, frozenCases), missing: multisetDifference(frozenCases, actualCases) };
      must(out.caseInventory.added.length === 0 && out.caseInventory.missing.length === 0, 'Slider assertion identities differ from frozen inventory.');
      must(spec.cases.length === (variant === 'candidate' ? 59 : 37) && spec.snapshotKeys.length === 19, 'Unexpected frozen Slider totals.');
      must(stage !== 'full-node' || frozenCases.length === 15, 'Unexpected frozen Slider node-demo count.');
      if (out.inventory.some(c => frozenPaths.has(c.path) && !['passed', 'failed'].includes(c.status))) out.failureReasons.push('Frozen Slider cases unexpectedly skipped or todo.');
      const minimumSnapshots = stage === 'full-node' ? 15 : 19;
      const frozenPassed = out.inventory.filter(c => frozenPaths.has(c.path)).every(c => c.status === 'passed');
      must(!frozenPassed || snap.matched >= minimumSnapshots, 'Passed frozen Slider cases lack their required existing snapshot matches.');
    }
    if (stage === 'slider-client') {
      must(Array.isArray(snapshotKeys) && equal(sorted(snapshotKeys), sorted(spec.snapshotKeys)), 'Slider snapshot key inventory differs or is missing.');
      out.snapshotKeys = sorted(snapshotKeys);
      // A failed test can stop before its snapshot. This is evidence of failure,
      // not permission to claim that all 19 snapshots were exercised.
      if (snap.total !== 19 || snap.matched !== 19 || snap.unchecked !== 0 || snap.uncheckedKeysByFile.length) out.failureReasons.push('Not all 19 existing Slider snapshots matched.');
      if (counts.skipped || counts.todo) out.failureReasons.push('Focused Slider contains skipped/todo cases.');
    }
    if (counts.failed || counts.suitesFailed || result.numRuntimeErrorTestSuites) out.failureReasons.push('Jest contains failed assertions/suites.');
    if (snap.failure || snap.unmatched || snap.filesUnmatched) out.failureReasons.push('Snapshot mismatch.');
    if (result.success) must(out.failureReasons.length === 0, 'Jest success contradicts failed evidence.');
    else out.failureReasons.push('Jest success is false.');
    out.validEvidence = true;
    out.accepted = result.success && out.failureReasons.length === 0;
  } catch (error) { out.errors.push(error.message); }
  return out;
}

function inspectEslint(results, root) {
  must(Array.isArray(results) && results.length === 2, 'ESLint must report exactly both changed files.');
  const inventory = results.map(item => {
    const filename = relativeFile(item.filePath, root);
    must(Array.isArray(item.messages), 'Missing ESLint diagnostics.');
    for (const message of item.messages) must(message && [1, 2].includes(message.severity) && typeof message.message === 'string', 'Invalid ESLint diagnostic.');
    const errors = item.messages.filter(m => m.severity === 2).length;
    const warnings = item.messages.filter(m => m.severity === 1).length;
    must(item.errorCount === errors && item.warningCount === warnings, 'ESLint diagnostic counts disagree.');
    must(item.fatalErrorCount === undefined || item.fatalErrorCount === item.messages.filter(m => m.fatal === true).length, 'ESLint fatal count disagrees.');
    must(!Object.prototype.hasOwnProperty.call(item, 'output'), 'ESLint unexpectedly reports fixed output.');
    return { path: filename, messages: item.messages, errors, warnings };
  });
  must(equal(sorted(inventory.map(i => i.path)), sorted(['components/Slider/hooks/useLegalValue.ts', 'components/Slider/__test__/index.test.tsx'])), 'ESLint inspected the wrong paths.');
  return { accepted: inventory.every(i => i.errors === 0), inventory: sorted(inventory) };
}
function validateJestCommand(stage, command, roots) {
  const argv = command.argv;
  must(command.cwd === roots.sourceRoot && equal(argv.slice(0, 3), ['env', 'NODE_ENV=test', 'node']) &&
    typeof argv[3] === 'string' && argv[3].endsWith('/toolchain/node_modules/yarn/bin/yarn.js'), 'Jest command is not the original local native runner.');
  const wanted = ['test:' + (stage === 'full-node' ? 'node' : 'client')];
  if (stage === 'slider-client') wanted.push('--runTestsByPath', 'components/Slider/__test__/index.test.tsx', 'components/Slider/__test__/demo.test.ts');
  wanted.push('--runInBand', '--ci', '--json', '--cacheDirectory=' + roots.cacheRoot + '/jest-' + stage,
    '--outputFile=' + roots.evidenceRoot + '/' + stage + '.jest.json');
  must(equal(argv.slice(4), wanted), 'Jest flags/selection/output paths differ from the exact native quality scope.');
}

function assessStage(stage, variant, evidence, expectations) {
  const out = { status: 'not-run', validEvidence: false, processExit: null, errors: [], failures: [] };
  if (!evidence || !evidence.status) { out.errors.push('No completed stage status.'); return out; }
  const s = evidence.status;
  out.processExit = s.processExit;
  try {
    must(s.stage === stage && s.variant === variant, 'Stage status identity mismatch.');
    must(['passed', 'failed', 'blocked', 'timed-out', 'not-run'].includes(s.status), 'Unknown stage status.');
    out.status = s.status;
    if (s.status === 'not-run') { must(s.completed === false, 'Not-run stage claims completion.'); return out; }
    must(s.completed === true, 'Stage completion is not established.');
    if (s.status === 'timed-out' || [124, 137, 143].includes(s.processExit)) {
      out.status = 'timed-out'; throw new Error('Timed-out/terminated stage is unresolved.');
    }
    must(s.status !== 'blocked', 'Stage was blocked.');
    must(integer(s.processExit) && s.processExit <= 255, 'Invalid process exit code.');
    must(Array.isArray(evidence.loadErrors) && evidence.loadErrors.length === 0, (evidence.loadErrors || []).join('; ') || 'Missing evidence-load status.');
    for (const field of ['loggerExit', 'preIntegrityExit', 'postIntegrityExit']) must(s[field] === 0, 'Evidence/integrity gate failed: ' + field);
    must(integer(s.validationExit), 'Missing validation exit code.');
    must(typeof evidence.log === 'string', 'Missing raw command log.');
    must(evidence.command && Array.isArray(evidence.command.argv) && evidence.command.argv.length > 0 &&
      evidence.command.argv.every(a => typeof a === 'string') && typeof evidence.command.cwd === 'string' &&
      evidence.command.environment && typeof evidence.command.environment === 'object' &&
      Number.isFinite(evidence.command.timeoutSeconds) && evidence.command.timeoutSeconds > 0, 'Missing/incomplete exact command metadata.');
    if (JEST_STAGES.has(stage)) {
      validateJestCommand(stage, evidence.command, evidence.roots);
      out.jest = inspectJest({ stage, variant, result: evidence.jest, selectedPaths: evidence.selectedPaths,
        sourceRoot: evidence.roots.sourceRoot, expectations, snapshotKeys: evidence.snapshotKeys });
      must(out.jest.validEvidence, out.jest.errors.join('; '));
      must(s.processExit === (out.jest.accepted ? 0 : 1), 'Process exit contradicts Jest result.');
      must(s.validationExit === (out.jest.accepted ? 0 : 1), 'Validation exit contradicts Jest evidence.');
      out.failures = out.jest.failures;
    } else if (stage === 'changed-eslint') {
      out.eslint = inspectEslint(evidence.eslint, evidence.roots.sourceRoot);
      must(s.processExit === (out.eslint.accepted ? 0 : 1) && s.validationExit === (out.eslint.accepted ? 0 : 1), 'ESLint exit codes contradict diagnostics.');
    } else must(s.validationExit === 0, 'Required output/config/build validation failed.');
    const passed = s.processExit === 0 && s.validationExit === 0;
    must(s.status === (passed ? 'passed' : 'failed'), 'Declared status contradicts original exit codes.');
    out.validEvidence = true;
  } catch (error) {
    out.errors.push(error.message);
    if (out.status === 'passed') out.status = 'failed';
  }
  return out;
}

function comparableCommand(evidence) {
  const { argv, cwd, environment, timeoutSeconds, effectiveTimeoutSeconds } = evidence.command;
  return normalizeMetadata({ argv, cwd, environment, timeoutSeconds,
    ...(effectiveTimeoutSeconds === undefined ? {} : { effectiveTimeoutSeconds }) }, evidence.roots);
}
function normalizeJestLog(stage, evidence) {
  const script = stage === 'full-node' ? 'arco-scripts test:node --silent=false' : 'arco-scripts test:client';
  const echo = '$ ' + script + ' ' + evidence.command.argv.slice(5).join(' ');
  const output = path.join(evidence.roots.evidenceRoot, stage + '.jest.json');
  const outputLines = [output, path.relative(evidence.command.cwd, output)]
    .map(filename => 'Test results written to: ' + filename);
  // Canonicalize only exact, independently validated command/output echoes.
  // Never replace artifact/cache prefixes elsewhere in diagnostics.
  const log = evidence.log.split('\n').map(line => line === echo
    ? '$ <verified original native Jest command>'
    : outputLines.includes(line) ? 'Test results written to: <verified output file>' : line).join('\n');
  return normalizeFailure(log, evidence.roots);
}
function failureSignature(stage, evidence, assessment) {
  if (stage === 'changed-eslint') return { diagnostics: normalizeFailure(stable(assessment.eslint.inventory), evidence.roots),
    log: normalizeFailure(evidence.log, evidence.roots) };
  if (!JEST_STAGES.has(stage)) {
    must(/error TS\d+|\b(?:Error|TypeError|SyntaxError|ReferenceError):|\b(?:ENOENT|EACCES)\b|\[warn\].*(?:\.(?:tsx?|jsx?|json)|Code style)/.test(evidence.log), 'Non-Jest log lacks a specific diagnostic to reproduce.');
    return normalizeFailure(evidence.log, evidence.roots);
  }
  const failure = assessment.jest;
  const normalize = value => {
    if (typeof value === 'string') return normalizeFailure(value, evidence.roots);
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
    return value;
  };
  // Include the complete raw log even when assertions failed. Otherwise an extra
  // coverage-threshold/runtime error can hide behind a matching old assertion.
  // This is deliberately conservative: benign log differences may make a pair
  // unresolved. Never discard unknown output in order to label it pre-existing.
  return { failures: sorted(normalize(failure.failures)), snapshot: {
    failure: failure.snapshot.failure, unmatched: failure.snapshot.unmatched,
    filesUnmatched: failure.snapshot.filesUnmatched,
    uncheckedKeysByFile: normalize(failure.snapshot.uncheckedKeysByFile)
  }, log: normalizeJestLog(stage, evidence) };
}
function compareInventories(stage, candidate, baseline, expectations) {
  if (!JEST_STAGES.has(stage)) return { valid: true };
  const identities = result => result.jest.inventory.map(({ path: filename, title }) => ({ path: filename, title }));
  const a = identities(candidate), b = identities(baseline);
  const added = multisetDifference(a, b), missing = multisetDifference(b, a);
  const spec = expectations.sliderClient;
  const expectedAdded = stage === 'full-node' ? [] : multisetDifference(spec.candidate.cases, spec.baseline.cases);
  const expectedMissing = stage === 'full-node' ? [] : multisetDifference(spec.baseline.cases, spec.candidate.cases);
  const skippedChanged = !equal(sorted(candidate.jest.skippedCases), sorted(baseline.jest.skippedCases));
  const todosChanged = !equal(sorted(candidate.jest.todoCases), sorted(baseline.jest.todoCases));
  return { valid: equal(added, expectedAdded) && equal(missing, expectedMissing) && !skippedChanged && !todosChanged,
    added, missing, expectedAdded, expectedMissing, skippedChanged, todosChanged };
}
function classifyStage(stage, candidate, baseline, expectations, context = {}) {
  const a = assessStage(stage, 'candidate', candidate, expectations);
  const b = assessStage(stage, 'baseline', baseline, expectations);
  const out = { stage, status: a.status, classification: 'unresolved', candidate: a, baseline: b, comparisonErrors: [] };
  if (a.status === 'passed' && a.validEvidence) { out.classification = 'passed'; return out; }
  if (!a.validEvidence || a.status !== 'failed') return out;
  try {
    must(!INSTALLS.includes(stage), 'Setup/toolchain failures do not establish a product baseline.');
    must(context.identitiesVerified === true, 'Exact candidate/pristine-baseline identities are unverified.');
    must(context.prerequisitesVerified === true, 'Matching successful baseline/candidate prerequisites are not established.');
    must(b.validEvidence && ['passed', 'failed'].includes(b.status), 'Baseline failed differently, is incomplete, or lacks valid evidence.');
    must(equal(comparableCommand(candidate), comparableCommand(baseline)), 'Commands, environment, or timeout resources differ.');
    must(candidate.runtime && baseline.runtime && equal(normalizeMetadata(candidate.runtime, candidate.roots),
      normalizeMetadata(baseline.runtime, baseline.roots)), 'Resolved runtime/toolchain metadata differ or are missing.');
    out.inventoryComparison = compareInventories(stage, a, b, expectations);
    must(out.inventoryComparison.valid, 'Case/skip/todo inventories differ beyond the frozen candidate additions.');
    if (b.status === 'passed') out.classification = 'candidate-only';
    else {
      must(candidate.status.processExit === baseline.status.processExit && candidate.status.validationExit === baseline.status.validationExit, 'Failure exit codes differ.');
      const left = failureSignature(stage, candidate, a), right = failureSignature(stage, baseline, b);
      must(stable(left).length > 2 && equal(left, right), 'Pristine baseline errors do not exactly reproduce candidate errors.');
      out.classification = 'reproduced-on-pristine-base';
    }
  } catch (error) { out.comparisonErrors.push(error.message); }
  return out;
}

function readJSON(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function parseEmbeddedJSON(text, kind) {
  must(typeof text === 'string', 'Missing raw metadata log.');
  const found = [];
  for (const match of text.matchAll(/^[\[{]/gm)) {
    const stack = []; let string = false, escaped = false, end = -1;
    for (let i = match.index; i < text.length; i++) {
      const char = text[i];
      if (string) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') string = false;
      } else if (char === '"') string = true;
      else if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        if (stack.pop() !== (char === '}' ? '{' : '[')) break;
        if (stack.length === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) continue;
    try {
      const value = JSON.parse(text.slice(match.index, end));
      if ((kind === 'config' && value && !Array.isArray(value) && 'configs' in value && 'globalConfig' in value) ||
        (kind === 'types' && value && !Array.isArray(value) && 'compilerOptions' in value) ||
        (kind === 'list' && Array.isArray(value) && value.every(v => typeof v === 'string'))) found.push(value);
    } catch (_) { /* Wrapper noise is not JSON. */ }
  }
  must(found.length === 1, 'Expected one unambiguous ' + kind + ' JSON payload, found ' + found.length + '.');
  return found[0];
}
function validateCapturedJestConfig(stage, value, roots) {
  normalizedJestConfig(value, roots);
  const client = stage.startsWith('client'), project = value.configs[0], global = value.globalConfig;
  must(value.version === '26.6.3' && global && typeof global === 'object', 'Unexpected Jest version/global config.');
  must(global.rootDir === roots.sourceRoot && project.cwd === roots.sourceRoot && equal(project.roots, [roots.sourceRoot]), 'Jest configured checkout roots differ.');
  must(project.testEnvironment === roots.sourceRoot + '/node_modules/jest-environment-' + (client ? 'jsdom' : 'node') + '/build/index.js', 'Unexpected native test environment.');
  must(equal(project.testRegex, [client ? '.*\\.test\\.(j|t)sx?$' : 'demo\\.test\\.(j|t)sx?$']) && equal(project.testMatch, []), 'Native test selection differs.');
  must(equal(project.testPathIgnorePatterns, ['/node_modules/']) && equal(project.modulePathIgnorePatterns, []) &&
    equal(project.modulePaths, [roots.sourceRoot + '/site/node_modules']), 'Native module/test search scope differs.');
  must(global.collectCoverage === client && global.updateSnapshot === 'none' && global.testFailureExitCode === 1 && global.maxWorkers === 1 && global.json === true, 'Native coverage/snapshot/runner settings differ.');
  for (const flag of ['forceExit', 'onlyChanged', 'onlyFailures', 'findRelatedTests', 'runTestsByPath', 'passWithNoTests', 'watch', 'watchAll']) must(global[flag] === false, 'Unexpected native selection/exit override: ' + flag);
  must(global.bail === 0 && global.testPathPattern === '' && equal(global.nonFlagArgs, []) &&
    (!('testNamePattern' in global) || global.testNamePattern === ''), 'Filtered/short-circuit native config.');
  must(global.silent === client && equal(project.setupFiles, [roots.sourceRoot + '/tests/setup.js']), 'Native silence/setup differs.');
  must(equal(project.setupFilesAfterEnv, client ? [roots.sourceRoot + '/tests/jest-dom-setup.js'] : []), 'Native post-environment setup differs.');
  must(equal(project.transformIgnorePatterns, ['node_modules/(?!@?react-dnd|dnd-core)']) && equal(project.globals, {}), 'Native transforms/ts-jest diagnostics override.');
  const transform = [
    ['^.+\\.jsx?$', '/node_modules/arco-scripts/lib/config/jest/babelTransform.js'],
    ['^.+\\.tsx?$', '/node_modules/arco-scripts/node_modules/ts-jest/dist/index.js'],
    ['.*\\.md$', '/node_modules/arco-scripts/lib/config/jest/mdTransform.js'],
    ['.*\\.(css|less|scss)$', '/node_modules/arco-scripts/lib/config/jest/styleTransform.js']
  ].map(([pattern, filename]) => [pattern, roots.sourceRoot + filename, {}]);
  must(equal(project.transform, transform), 'Native transformer selection/options differ.');
  if (client) {
    must(global.coverageDirectory === roots.sourceRoot + '/.coverage' && equal(global.collectCoverageFrom,
      ['components/**/*.{ts,tsx}', '!components/**/style/*', '!components/**/api/*']), 'Native client coverage path/scope differs.');
    must(equal(global.coverageReporters, ['json', 'json-summary', 'lcov', 'clover', 'text-summary']), 'Native coverage reporters differ.');
    must(equal(project.coveragePathIgnorePatterns, ['/node_modules/', '/lib/', '/es/', '/dist/', '/icon/', '/components/index.tsx', '/components/locale/']), 'Native coverage exclusions differ.');
  }
}
function validateCapturedTypes(value) {
  const options = value && value.compilerOptions;
  must(options && typeof options === 'object', 'Missing TypeScript compiler options.');
  const expected = { jsx: 'react', module: 'es6', target: 'es5', lib: ['es5', 'dom'], moduleResolution: 'node',
    declaration: true, noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true, esModuleInterop: true,
    downlevelIteration: true, experimentalDecorators: true, allowSyntheticDefaultImports: true,
    paths: { '@arco-design/web-react': ['components/index.tsx'], '@arco-design/web-react/icon': ['icon/index.js'], 'test-utils': ['tests/util.ts'] } };
  for (const [key, wanted] of Object.entries(expected)) {
    const same = key === 'module' ? ['es6', 'es2015'].includes(options[key]) : key === 'moduleResolution' ? ['node', 'nodejs'].includes(options[key]) : equal(options[key], wanted);
    must(same, 'TypeScript source option differs: ' + key);
  }
  must(['es', './es'].includes(options.outDir) && ['./', '.'].includes(options.baseUrl), 'TypeScript source/output base differs.');
  must(equal(sorted(Object.keys(options)), sorted([...Object.keys(expected), 'outDir', 'baseUrl'])), 'Unexpected TypeScript compiler override.');
  must(equal(value.include, ['components/**/*.ts', 'components/**/*.tsx']) &&
    equal(value.exclude, ['node_modules', 'components/**/*.test.tsx', 'components/**/*.test.ts']), 'TypeScript source-only scope differs.');
  must(Array.isArray(value.files) && value.files.length > 0, 'Missing TypeScript resolved source list.');
  const actual = value.files.map(p => relativeFile(p.replace(/^\.\//, '')));
  must(new Set(actual).size === actual.length && actual.every(p => /^components\/.*\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)), 'TypeScript resolved files leave the original source-only scope.');
}
function validateMetadataCommand(stage, command, roots) {
  if (stage === 'types-show-config') must(command.cwd === roots.sourceRoot && equal(command.argv,
    ['node', 'node_modules/typescript/bin/tsc', '--showConfig', '-p', 'tsconfig.json']), 'TypeScript config capture command is not read-only/exact.');
  else {
    const isList = stage.endsWith('-list'), family = stage.split('-')[0];
    must(command.cwd === roots.sourceRoot && equal(command.argv.slice(0, 3), ['env', 'NODE_ENV=test', 'node']) &&
      command.argv[3].endsWith('/toolchain/node_modules/yarn/bin/yarn.js') && equal(command.argv.slice(4),
        ['test:' + family, isList ? '--listTests' : '--showConfig', '--json', '--runInBand', '--ci', '--cacheDirectory=' + roots.cacheRoot + '/jest-' + stage]), 'Native config/list capture command differs.');
  }
}
function inventoryDigest(files) {
  // Match Python's sort_keys/separators/ensure_ascii metadata-only observer.
  const encoded = stable(files).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return crypto.createHash('sha256').update(encoded).digest('hex');
}
function validateCoverage(dir, stage, postGuard) {
  const validation = readJSON(path.join(dir, stage + '.coverage-validation.json'));
  const inventory = readJSON(path.join(dir, stage + '.coverage-inventory.json'));
  must(validation.complete === true && Array.isArray(validation.errors) && validation.errors.length === 0, 'Client coverage output is missing/incomplete.');
  must(inventory && inventory.files && !Array.isArray(inventory.files) && Object.keys(inventory.files).length > 0 &&
    integer(inventory.count) && inventory.count === Object.keys(inventory.files).length &&
    inventory.sha256 === inventoryDigest(inventory.files) && validation.sha256 === inventory.sha256, 'Coverage validation/inventory digest differs.');
  const root = path.join(dir, stage + '.coverage'), files = {};
  must(fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(), 'Missing/unsafe copied coverage directory.');
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name), relative = path.relative(root, filename), stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) {
        must(fs.realpathSync(filename).startsWith(fs.realpathSync(root) + '/'), 'Copied coverage symlink escapes its root.');
        files[relative] = { type: 'symlink', target: fs.readlinkSync(filename) };
      } else if (stat.isDirectory()) walk(filename);
      else {
        must(stat.isFile(), 'Special file in copied coverage.');
        files[relative] = { type: 'file', sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
          size: stat.size, executable: Boolean(stat.mode & 0o111) };
      }
    }
  }
  walk(root);
  must(equal(files, inventory.files), 'Copied coverage files differ from the full preserved inventory.');
  for (const required of ['coverage-final.json', 'coverage-summary.json', 'lcov.info', 'clover.xml', 'lcov-report/index.html']) {
    must(files[required] && files[required].type === 'file' && files[required].size > 0, 'Missing native coverage reporter output: ' + required);
  }
  const prefixed = Object.fromEntries(Object.entries(files).map(([filename, value]) => ['.coverage/' + filename, value]));
  must(postGuard && postGuard.inventories['.coverage/'].sha256 === inventoryDigest(prefixed) &&
    postGuard.inventories['.coverage/'].count === inventory.count, 'Copied coverage does not bind to the stage source audit.');
  return { complete: true, sha256: inventory.sha256, files: inventory.count };
}
function validateGuard(guard, variant, stage, boundary, originalSource) {
  must(guard && guard.variant === variant && guard.stage === stage && guard.boundary === boundary, 'Wrong source guard identity: ' + stage + '.' + boundary);
  must(guard.commit === SOURCE[variant].commit && guard.trackedTree === SOURCE[variant].tree, 'Source guard commit/tree drift: ' + stage);
  must(Array.isArray(guard.errors) && guard.errors.length === 0 && Array.isArray(guard.unexpected) && guard.unexpected.length === 0, 'Source guard reported drift/errors: ' + stage);
  must(guard.source && /^[a-f0-9]{64}$/.test(guard.source.sha256) && integer(guard.source.count) && guard.source.count > 0, 'Missing source-byte digest: ' + stage);
  if (originalSource) must(equal(guard.source, originalSource), 'Source-byte digest changed: ' + stage);
  must(guard.inventories && equal(sorted(Object.keys(guard.inventories)), sorted(INVENTORY_ROOTS)), 'Incomplete phase inventories: ' + stage);
  for (const item of Object.values(guard.inventories)) must(item && /^[a-f0-9]{64}$/.test(item.sha256) && integer(item.count), 'Malformed phase inventory: ' + stage);
  return guard;
}
function loadVariantGuards(evidenceDir, variant) {
  const out = { accepted: false, errors: [] }, dir = path.join(evidenceDir, variant);
  try {
    const source = readJSON(path.join(dir, 'source.json'));
    must(source.variant === variant && source.commit === SOURCE[variant].commit && source.tree === SOURCE[variant].tree &&
      source.pristine === (variant === 'baseline') && source.patchApplied === false, 'Source preparation identity/pristine proof differs.');
    out.prepared = validateGuard(readJSON(path.join(dir, 'prepared.pre.integrity.json')), variant, 'prepared', 'pre');
    must(Object.values(out.prepared.inventories).every(i => i.count === 0), 'Fresh checkout contains generated inputs.');
    out.final = validateGuard(readJSON(path.join(dir, 'final.pre.integrity.json')), variant, 'final', 'pre', out.prepared.source);
    out.accepted = true;
  } catch (error) { out.errors.push(error.message); }
  return out;
}
function loadStage(evidenceDir, variant, stage, plan) {
  const dir = path.join(evidenceDir, variant), errors = [];
  function read(suffix, json = true, required = true) {
    const filename = path.join(dir, suffix);
    try { return json ? readJSON(filename) : fs.readFileSync(filename, 'utf8'); }
    catch (error) { if (required) errors.push(suffix + ': ' + error.message); return undefined; }
  }
  const status = read(stage + '.status.json', true, false);
  const roots = plan && plan.variants && plan.variants[variant] || {};
  const result = { status, roots, loadErrors: errors };
  if (!status) return result;
  result.command = read(stage + '.command.json'); result.log = read(stage + '.log', false);
  result.runtime = read('runtime.json', true, STAGES.indexOf(stage) >= STAGES.indexOf('runtime'));
  if (stage === 'runtime' && (!result.runtime || result.runtime.node !== 'v16.20.2' ||
    !Array.isArray(result.runtime.modules) || result.runtime.modules.length === 0)) errors.push('Missing or invalid pinned runtime inventory.');
  for (const [suffix, field] of [['exit-code', 'processExit'], ['logger-exit-code', 'loggerExit']]) {
    const raw = read(stage + '.' + suffix, false);
    if (typeof raw !== 'string' || !/^(0|[1-9]\d*)\n?$/.test(raw) || Number(raw.trim()) !== status[field]) errors.push('Original ' + suffix + ' sidecar disagrees with stage status.');
  }
  const effective = read(stage + '.effective-timeout-seconds', false);
  if (typeof effective !== 'string' || !/^[1-9]\d*\n?$/.test(effective) || !result.command || Number(effective.trim()) > result.command.timeoutSeconds) errors.push('Missing/invalid effective timeout evidence.');
  else if (result.command.effectiveTimeoutSeconds !== undefined && result.command.effectiveTimeoutSeconds !== Number(effective.trim())) errors.push('Effective timeout evidence disagrees.');
  else result.command.effectiveTimeoutSeconds = Number(effective.trim());
  result.preGuard = read(stage + '.pre.integrity.json'); result.postGuard = read(stage + '.post.integrity.json');
  try {
    const prepared = readJSON(path.join(dir, 'prepared.pre.integrity.json'));
    validateGuard(result.preGuard, variant, stage, 'pre', prepared.source);
    validateGuard(result.postGuard, variant, stage, 'post', prepared.source);
    for (const prefix of INVENTORY_ROOTS.filter(p => !(WRITERS[stage] || []).includes(p))) must(equal(result.preGuard.inventories[prefix], result.postGuard.inventories[prefix]), 'Nonwriter phase mutated ' + prefix);
  } catch (error) { errors.push(error.message); }
  if (['client-show-config', 'node-show-config', 'types-show-config', 'client-list', 'node-list'].includes(stage)) {
    const kind = stage === 'types-show-config' ? 'types' : stage.endsWith('-list') ? 'list' : 'config';
    result.parsed = read(stage + '.parsed.json');
    try {
      must(equal(result.parsed, parseEmbeddedJSON(result.log, kind)), 'Parsed ' + stage + ' artifact differs from unique original raw-log payload.');
      validateMetadataCommand(stage, result.command, roots);
      if (kind === 'config') validateCapturedJestConfig(stage, result.parsed, roots);
      if (kind === 'types') validateCapturedTypes(result.parsed);
      if (kind === 'list') {
        must(result.parsed.length > 0 && new Set(result.parsed).size === result.parsed.length, 'Empty/duplicate captured selection.');
        for (const filename of result.parsed) {
          const relative = relativeFile(filename, roots.sourceRoot);
          must((stage === 'node-list' ? /demo\.test\.(j|t)sx?$/ : /\.test\.(j|t)sx?$/).test(relative), 'Captured test file violates native selection regex.');
        }
      }
    } catch (error) { errors.push(error.message); }
  }
  if (stage === 'changed-eslint') result.eslint = read('changed-eslint.json');
  if (JEST_STAGES.has(stage)) {
    result.jest = read(stage + '.jest.json');
    result.selectedPaths = read((stage === 'full-node' ? 'node' : 'client') + '-list.parsed.json');
    if (stage === 'slider-client') result.snapshotKeys = read('slider-client.snapshot-keys.json');
    if (stage !== 'full-node') {
      try { result.coverage = validateCoverage(dir, stage, result.postGuard); }
      catch (error) { errors.push(error.message); }
    }
  }
  return result;
}
function validatePlan(plan, evidenceDir) {
  must(plan && equal(plan.stages, STAGES), 'Quality plan stage scope/order differs from the complete frozen gate list.');
  for (const variant of ['candidate', 'baseline']) {
    const item = plan.variants && plan.variants[variant];
    must(item && item.commit === SOURCE[variant].commit && item.tree === SOURCE[variant].tree, 'Wrong exact source identity: ' + variant);
    for (const field of ['sourceRoot', 'evidenceRoot', 'cacheRoot']) must(typeof item[field] === 'string' && path.isAbsolute(item[field]) && item[field] !== '/', 'Missing/unsafe evidence prefix: ' + variant + '.' + field);
    must(path.resolve(item.evidenceRoot) === path.resolve(evidenceDir, variant), 'Variant evidence root does not match evidence location.');
  }
  must(plan.variants.baseline.pristine === true, 'Baseline is not attested pristine.');
  for (const field of ['sourceRoot', 'evidenceRoot', 'cacheRoot']) must(plan.variants.candidate[field] !== plan.variants.baseline[field], 'Variants share mutable roots: ' + field);
}
function normalizedJestConfig(config, roots) {
  must(config && Array.isArray(config.configs) && config.configs.length === 1, 'Expected one native Jest project.');
  const project = config.configs[0];
  must(project.rootDir === roots.sourceRoot, 'Jest config root differs from verified checkout.');
  // Jest 26.6.3 normalize.ts computes md5(rootDir + configPath + projectIndex).
  // Arco's JSON --config has no configPath and its sole project has index 0.
  const generated = crypto.createHash('md5').update(project.rootDir + '0').digest('hex');
  must(project.name === generated, 'Jest project name is not the verified generated checkout identity.');
  return normalizeMetadata({ ...config, configs: [{ ...project, name: '<verified-generated-project-name>' }] }, roots);
}
function classifyEvidence({ evidenceDir, expectations }) {
  const report = { schemaVersion: 1, accepted: false, status: 'failed', errors: [], stages: [],
    scope: 'Hosted native quality evidence only. No browser, release, merge, or deployment claim.',
    rule: 'A reproduced pristine-base failure remains a failed candidate gate.' };
  let plan, identitiesVerified = false;
  try { plan = readJSON(path.join(evidenceDir, 'quality-plan.json')); validatePlan(plan, evidenceDir); identitiesVerified = true; }
  catch (error) { report.errors.push(error.message); }
  try {
    const raw = fs.readFileSync(path.join(evidenceDir, 'driver.exit-code'), 'utf8');
    must(/^0\n?$/.test(raw), 'Final driver/publication/toolchain guard did not succeed.');
  } catch (error) { report.errors.push(error.message); }
  report.sourceGuards = { candidate: loadVariantGuards(evidenceDir, 'candidate'), baseline: loadVariantGuards(evidenceDir, 'baseline') };
  if (!report.sourceGuards.candidate.accepted) report.errors.push('Candidate prepared/final source guards: ' + report.sourceGuards.candidate.errors.join('; '));
  const variants = {};
  for (const variant of ['candidate', 'baseline']) variants[variant] = Object.fromEntries(STAGES.map(stage => [stage, loadStage(evidenceDir, variant, stage, plan)]));
  const assessments = {};
  for (const variant of ['candidate', 'baseline']) assessments[variant] = Object.fromEntries(STAGES.map(stage => [stage, assessStage(stage, variant, variants[variant][stage], expectations)]));
  for (const stage of STAGES) {
    const prerequisites = PREREQUISITES[stage];
    const candidateReady = prerequisites.every(p => assessments.candidate[p].status === 'passed' && assessments.candidate[p].validEvidence);
    const baselineReady = prerequisites.every(p => assessments.baseline[p].status === 'passed' && assessments.baseline[p].validEvidence);
    const result = classifyStage(stage, variants.candidate[stage], variants.baseline[stage], expectations,
      { identitiesVerified: identitiesVerified && report.sourceGuards.candidate.accepted && report.sourceGuards.baseline.accepted,
        prerequisitesVerified: candidateReady && baselineReady });
    if (!candidateReady && result.classification === 'passed') {
      result.status = 'blocked'; result.classification = 'unresolved';
      result.comparisonErrors.push('A required candidate prerequisite did not pass.');
    }
    // Compare prerequisite command policy and configurations as well as outcomes.
    if (['candidate-only', 'reproduced-on-pristine-base'].includes(result.classification)) {
      try {
        for (const prereq of prerequisites) must(equal(comparableCommand(variants.candidate[prereq]), comparableCommand(variants.baseline[prereq])), 'Prerequisite command differs: ' + prereq);
        for (const prefix of ['node_modules/', 'site/node_modules/']) must(equal(variants.candidate[stage].preGuard.inventories[prefix], variants.baseline[stage].preGuard.inventories[prefix]), 'Installed dependency bytes differ: ' + prefix);
        if (JEST_STAGES.has(stage)) {
          const family = stage === 'full-node' ? 'node' : 'client';
          const ca = readJSON(path.join(evidenceDir, 'candidate', family + '-show-config.parsed.json'));
          const cb = readJSON(path.join(evidenceDir, 'baseline', family + '-show-config.parsed.json'));
          must(equal(normalizedJestConfig(ca, variants.candidate[stage].roots), normalizedJestConfig(cb, variants.baseline[stage].roots)), 'Effective source-default Jest configs differ.');
        }
      } catch (error) { result.classification = 'unresolved'; result.comparisonErrors.push(error.message); }
    }
    report.stages.push(result);
  }
  for (const variant of ['candidate', 'baseline']) {
    const guards = report.sourceGuards[variant];
    if (!guards.accepted) continue;
    let previous = guards.prepared.inventories;
    for (const stage of STAGES) {
      const item = variants[variant][stage];
      if (!item.status || item.status.status === 'not-run' || item.status.status === 'blocked') continue;
      if (!item.preGuard || !item.postGuard || !equal(previous, item.preGuard.inventories)) {
        guards.errors.push('Broken phase inventory chain before ' + stage); guards.accepted = false; break;
      }
      previous = item.postGuard.inventories;
    }
    if (!equal(previous, guards.final.inventories)) { guards.errors.push('Final inventory differs from last audited phase.'); guards.accepted = false; }
    if (!guards.accepted) {
      if (variant === 'candidate') report.errors.push('Candidate phase/final inventory chain is invalid.');
      for (const item of report.stages.filter(s => ['candidate-only', 'reproduced-on-pristine-base'].includes(s.classification))) {
        item.classification = 'unresolved'; item.comparisonErrors.push('Source phase/final inventory chain is invalid: ' + variant);
      }
    }
  }
  report.accepted = report.errors.length === 0 && report.stages.every(s => s.status === 'passed' && s.classification === 'passed');
  report.status = report.accepted ? 'passed' : 'failed';
  report.summary = Object.fromEntries(['passed', 'reproduced-on-pristine-base', 'candidate-only', 'unresolved'].map(c => [c, report.stages.filter(s => s.classification === c).length]));
  return report;
}
function cli(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    must(['--evidence', '--expectations', '--output', '--stage', '--variant'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--') && !args[argv[i]], 'Invalid/missing/duplicate CLI option: ' + argv[i]);
    args[argv[i]] = argv[i + 1];
  }
  must(args['--evidence'] && args['--expectations'], 'Required: --evidence DIR --expectations FILE [--output FILE] [--stage NAME --variant NAME].');
  const evidenceDir = path.resolve(args['--evidence']), expectations = readJSON(args['--expectations']);
  let report, output = args['--output'];
  if (args['--stage'] || args['--variant']) {
    const stage = args['--stage'], variant = args['--variant'];
    must(JEST_STAGES.has(stage) && ['candidate', 'baseline'].includes(variant), 'Partial mode requires a Jest stage and exact variant.');
    output = output || path.join(evidenceDir, variant, stage + '.validation.json');
    try {
      const plan = readJSON(path.join(evidenceDir, 'quality-plan.json')); validatePlan(plan, evidenceDir);
      const dir = path.join(evidenceDir, variant);
      report = inspectJest({ stage, variant, expectations, sourceRoot: plan.variants[variant].sourceRoot,
        result: readJSON(path.join(dir, stage + '.jest.json')),
        selectedPaths: readJSON(path.join(dir, (stage === 'full-node' ? 'node' : 'client') + '-list.parsed.json')),
        snapshotKeys: stage === 'slider-client' ? readJSON(path.join(dir, 'slider-client.snapshot-keys.json')) : undefined });
    } catch (error) { report = { validEvidence: false, accepted: false, errors: [error.message] }; }
    report = { stage, variant, ...report };
  } else { report = classifyEvidence({ evidenceDir, expectations }); output = output || path.join(evidenceDir, 'classification.json'); }
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ accepted: report.accepted, output, ...(report.summary ? { summary: report.summary } : { errors: report.errors }) }));
  return report.accepted ? 0 : 1;
}
module.exports = { STAGES, SOURCE, PREREQUISITES, INVENTORY_ROOTS, inspectJest, inspectEslint, assessStage, classifyStage, classifyEvidence, inventoryDigest,
  normalizeFailure, normalizeMetadata, normalizedJestConfig, parseEmbeddedJSON, validateCapturedJestConfig, validateCapturedTypes, compareInventories, validatePlan, cli };
if (require.main === module) {
  try { process.exitCode = cli(process.argv.slice(2)); }
  catch (error) { console.error('Quality classification failed: ' + error.message); process.exitCode = 1; }
}
