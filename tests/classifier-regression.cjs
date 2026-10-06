#!/usr/bin/env node
'use strict';
// Dependency-free classifier tests. This file never installs or runs product tests.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const bundle = path.resolve(__dirname, '..');
const { classifyFailure } = require('../scripts/classify-results.cjs');
const inventory = JSON.parse(fs.readFileSync(path.join(bundle, 'expected-tests.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/native-run-37483595078-failures.json'), 'utf8'));
const historicalInventory = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/native-run-37483595078-expected-tests.json'), 'utf8'));
const specifications = new Map(historicalInventory.tests.map(test => [test.title, test]));
const currentSpecifications = new Map(inventory.tests.map(test => [test.title, test]));
const cases = new Map(fixture.cases.map(test => [test.title, test]));
const report = { scope: 'Classifier-only regression tests, not native/product/build/browser execution.',
  fixtureRun: fixture.provenance.runId, checks: [] };
const clone = value => JSON.parse(JSON.stringify(value));
function check(name, fn) {
  try {
    fn();
    report.checks.push({ name, passed: true });
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
  }
}
function reject(name, title, change) {
  check(name, () => {
    const test = clone(cases.get(title));
    const before = JSON.stringify(test);
    change(test);
    assert.notStrictEqual(JSON.stringify(test), before, 'Negative control did not modify its input.');
    assert.throws(() => classifyFailure(test, specifications.get(title)));
  });
}
function rewrite(test, before, after) {
  assert(test.failureMessages[0].includes(before), 'Fixture mutation target is absent.');
  test.failureMessages[0] = test.failureMessages[0].replace(before, after);
}

assert.strictEqual(fixture.cases.length, 18);
assert.strictEqual(cases.size, 18);
for (const test of fixture.cases) {
  check('actual failure: ' + test.title, () => {
    const transformation = fixture.provenance.transformations[0];
    test.failureMessages.forEach((message, index) => {
      const restored = message.split(transformation.to).join(transformation.from);
      assert.strictEqual(crypto.createHash('sha256').update(restored).digest('hex'),
        test.originalFailureMessagesSha256[index], 'Fixture differs beyond its documented path substitution.');
    });
    const specification = specifications.get(test.title);
    assert(specification && specification.baseline === 'failed');
    const result = classifyFailure(clone(test), specification);
    assert.deepStrictEqual(result.expected, specification.firstFailure.expected);
    assert.deepStrictEqual(result.received, specification.firstFailure.received);
    assert.strictEqual(result.sourceLine, specification.firstFailure.sourceLine);
  });
}

// Keep real historical fixture bytes/locations unchanged. The following cases are
// explicitly synthetic location rebinding for the whitespace-only new source.
for (const test of fixture.cases) {
  check('synthetic formatting-only source-line rebind: ' + test.title, () => {
    const previous = specifications.get(test.title), current = currentSpecifications.get(test.title);
    const previousShape = clone(previous), currentShape = clone(current);
    delete previousShape.firstFailure.sourceLine; delete currentShape.firstFailure.sourceLine;
    assert.deepStrictEqual(previousShape, currentShape, 'Assertion semantics changed.');
    const input = clone(test);
    const from = 'index.test.tsx:' + previous.firstFailure.sourceLine + ':';
    const to = 'index.test.tsx:' + current.firstFailure.sourceLine + ':';
    input.failureMessages = input.failureMessages.map(message => {
      assert(message.includes(from));
      return message.split(from).join(to);
    });
    assert.strictEqual(classifyFailure(input, current).sourceLine, current.firstFailure.sourceLine);
  });
}
check('new freeze rejects unchanged historical shifted source location', () => {
  const title = 'should navigate range values for -10,10';
  assert.throws(() => classifyFailure(clone(cases.get(title)), currentSpecifications.get(title)));
});

const range = 'should navigate range values for -10,10';
const scalar = 'should traverse mixed marks inserted out of order in numeric order';
const boundary = 'should stay at mark boundary -20 on ArrowLeft';
for (const test of fixture.cases.filter(test => specifications.get(test.title).firstFailure.matcher === 'toHaveBeenLastCalledWith' &&
    Array.isArray(specifications.get(test.title).firstFailure.expected))) {
  check('legacy no-outer-comma array diff: ' + test.title, () => {
    const input = clone(test);
    rewrite(input, '  ],\n\nNumber of calls:', '  ]\n\nNumber of calls:');
    classifyFailure(input, specifications.get(test.title));
  });
}
reject('reject changed received value', range, test => rewrite(test, '+   -10,', '+   -9,'));
reject('reject changed expected value', range, test => rewrite(test, '-   0,', '-   1,'));
reject('reject wrong source line', range, test => rewrite(test, 'index.test.tsx:441:24', 'index.test.tsx:442:24'));
reject('reject wrong call count', range, test => rewrite(test, 'Number of calls: 1', 'Number of calls: 2'));
reject('reject runtime error', range, test => { test.failureMessages[0] = 'TypeError: unexpected runtime error\n' + test.failureMessages[0]; });
reject('reject timeout', range, test => { test.failureMessages[0] += '\nExceeded timeout of 5000 ms'; });
reject('reject second scalar argument', range, test => rewrite(test, '  ],\n\nNumber', '  ],\n  42,\n\nNumber'));
reject('reject second array argument', range, test => rewrite(test, '  ],\n\nNumber', '  ],\n  Array [\n    42,\n  ],\n\nNumber'));
reject('reject argument after blank line', range, test => rewrite(test, '  ],\n\nNumber', '  ],\n\n  42,\n\nNumber'));
reject('reject inline trailing garbage', range, test => rewrite(test, '  ],\n\nNumber', '  ], trailing garbage\n\nNumber'));
reject('reject unprefixed trailing garbage', range, test => rewrite(test, '  ],\n\nNumber', '  ],\ntrailing garbage\n\nNumber'));
reject('reject diff-prefixed trailing garbage', range, test => rewrite(test, '  ],\n\nNumber', '  ],\n  trailing garbage\n\nNumber'));
reject('reject garbage after footer', range, test => { test.failureMessages[0] += '\ntrailing garbage'; });
reject('reject double outer comma', range, test => rewrite(test, '  ],\n\nNumber', '  ],,\n\nNumber'));
reject('reject truncated outer array', range, test => rewrite(test, '  ],\n\nNumber', '\n\nNumber'));
reject('reject truncated footer', range, test => { test.failureMessages[0] = test.failureMessages[0].split('\nNumber of calls:')[0]; });
reject('reject outer comma on toEqual array', boundary, test => rewrite(test, '  ]\n    at ', '  ],\n    at '));
reject('reject comma on scalar spy', scalar, test => rewrite(test, 'Received: -20', 'Received: -20,'));
reject('reject malformed diff header', range, test => rewrite(test, '- Expected\n', '- Expected extra\n'));
reject('reject missing Received header', range, test => rewrite(test, '+ Received\n', ''));
reject('reject truncated nested array', boundary, test => rewrite(test, '    ],\n', ''));
reject('reject wrong assertion type', range, test => rewrite(test, '.toHaveBeenLastCalledWith(', '.toHaveBeenCalledWith('));

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  assert(index + 1 < args.length, 'Missing value for ' + name);
  return path.resolve(args[index + 1]);
}
const actualEvidence = option('--real-evidence');
const legacyClassifier = option('--v1-classifier');
const reportPath = option('--report');
function replay(classifier) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arco-classifier-replay-'));
  try {
    fs.mkdirSync(path.join(temp, 'scripts'));
    fs.copyFileSync(classifier, path.join(temp, 'scripts/classify-results.cjs'));
    // This optional replay remains bound to the historical run, not the new freeze.
    fs.writeFileSync(path.join(temp, 'source-manifest.json'), JSON.stringify({ variants: {
      baseline: { tree: fixture.provenance.baselineTree },
      candidate: { tree: fixture.provenance.sourceCandidateTree }
    } }));
    fs.copyFileSync(path.join(__dirname, 'fixtures/native-run-37483595078-expected-tests.json'),
      path.join(temp, 'expected-tests.json'));
    for (const variant of ['baseline', 'candidate']) {
      fs.mkdirSync(path.join(temp, 'evidence', variant), { recursive: true });
      for (const name of ['focused.jest.json', 'focused.exit-code', 'focused-completed.exit-code',
        'stage.exit-code', 'post-focused.integrity.json']) {
        // Byte-for-byte input copies; the original artifact is never edited.
        fs.copyFileSync(path.join(actualEvidence, variant, name), path.join(temp, 'evidence', variant, name));
      }
    }
    const child = spawnSync(process.execPath, [path.join(temp, 'scripts/classify-results.cjs'), 'focused'],
      { encoding: 'utf8', timeout: 10000 });
    assert.ifError(child.error);
    const output = JSON.parse(fs.readFileSync(path.join(temp, 'evidence/focused.classification.json'), 'utf8'));
    return { exitCode: child.status, output };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (actualEvidence) {
  check('full real focused pair, untouched artifact input copies', () => {
    const result = replay(path.join(bundle, 'scripts/classify-results.cjs'));
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.output.accepted, true);
    assert.deepStrictEqual(result.output.variants.map(item => [item.variant, item.passed, item.failed]),
      [['baseline', 4, 18], ['candidate', 22, 0]]);
    assert.strictEqual(result.output.variants[0].failures.length, 18);
    report.realFocusedReplay = result.output;
  });
  if (legacyClassifier) {
    check('v1 reproduces the original real-artifact rejection', () => {
      const result = replay(legacyClassifier);
      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(result.output.accepted, false);
      assert.strictEqual(result.output.error, 'Could not decode the complete numeric Expected/Received diff.');
    });
  }
}
report.passed = report.checks.filter(check => check.passed).length;
report.failed = report.checks.length - report.passed;
report.accepted = report.failed === 0;
if (reportPath) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (!report.accepted) process.exitCode = 1;
