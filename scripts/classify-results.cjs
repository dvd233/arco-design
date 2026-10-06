#!/usr/bin/env node
'use strict';
// Fail-closed classifier for original Jest JSON, not a replacement test runner.
// The baseline payloads below are static predictions and have not been observed.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const bundle = path.resolve(__dirname, '..');
const evidence = path.join(bundle, 'evidence');
const expected = JSON.parse(fs.readFileSync(path.join(bundle, 'expected-tests.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(bundle, 'source-manifest.json'), 'utf8'));
const mode = process.argv[2];
const report = { mode, accepted: false, evidenceType: 'native Jest JSON classification', variants: [] };

function must(condition, message) {
  if (!condition) throw new Error(message);
}
function json(relative) {
  return JSON.parse(fs.readFileSync(path.join(evidence, relative), 'utf8'));
}
function exitCode(relative) {
  const raw = fs.readFileSync(path.join(evidence, relative), 'utf8').trim();
  must(/^(0|[1-9][0-9]*)$/.test(raw), 'Invalid exit code: ' + relative);
  return Number(raw);
}
function equal(actual, wanted, label) {
  assert.deepStrictEqual(actual, wanted, label);
}
function clean(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');
}
function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  return Array.isArray(value) && value.every(numeric);
}
function parseNumeric(text) {
  // Only numeric scalars/nested arrays are accepted. Do not eval Jest messages.
  const normalized = text.trim().replace(/\bArray\s*\[/g, '[').replace(/,\s*]/g, ']');
  must(/^[\s\d+\-.,\[\]eE]+$/.test(normalized), 'Failure value is not a numeric literal/array.');
  const value = JSON.parse(normalized);
  must(numeric(value), 'Failure value has an unexpected type.');
  return value;
}
function diffValues(message) {
  const lines = message.split('\n');
  const header = lines.findIndex(line => /^- Expected(?:\s|$)/.test(line.trim()));
  if (header < 0) return null;
  const receivedHeader = lines.findIndex((line, i) => i > header && /^\+ Received(?:\s|$)/.test(line.trim()));
  if (receivedHeader < 0) return null;
  let wanted = '', received = '', began = false;
  for (let i = receivedHeader + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() && !began) continue;
    if (line.startsWith('- ')) { wanted += line.slice(2) + '\n'; began = true; }
    else if (line.startsWith('+ ')) { received += line.slice(2) + '\n'; began = true; }
    else if (line.startsWith('  ')) {
      wanted += line.slice(2) + '\n';
      received += line.slice(2) + '\n';
      began = true;
    } else break;
    try {
      return { expected: parseNumeric(wanted), received: parseNumeric(received), from: 'exact numeric diff' };
    } catch (_) {
      // Continue only until a complete numeric value exists on both sides.
    }
  }
  throw new Error('Could not decode the complete numeric Expected/Received diff.');
}
function labeledValues(message, prediction) {
  const lines = message.split('\n');
  const first = lines.findIndex(line => /^Expected:/.test(line.trim()));
  const received = lines.findIndex((line, i) => i > first && /^Received(?::|\s*$)/.test(line.trim()));
  must(first >= 0 && received > first, 'No supported exact Expected/Received numeric payload.');
  const wanted = [lines[first].trim().replace(/^Expected:\s*/, ''), ...lines.slice(first + 1, received)].join('\n');
  const tail = lines.slice(received);
  const stop = tail.findIndex(line => /^\s*(?:Number of calls:|\d+\s*\||>\s*\d+\s*\||at )/.test(line));
  const payload = (stop < 0 ? tail : tail.slice(0, stop));
  let actual;
  if (/^Received:/.test(payload[0].trim())) {
    actual = [payload[0].trim().replace(/^Received:\s*/, ''), ...payload.slice(1)].join('\n');
  } else {
    // Spy matchers can print the last two calls; require the predicted final call index.
    const entries = [];
    for (let i = 1; i < payload.length; i++) {
      const match = payload[i].match(/^\s*(?:->\s*)?(\d+):\s*(.*)$/);
      if (match) entries.push({ index: Number(match[1]), text: match[2] });
      else if (entries.length) entries[entries.length - 1].text += '\n' + payload[i];
      else must(!payload[i].trim(), 'Unexpected spy-call payload.');
    }
    must(entries.length > 0, 'No spy call values.');
    const final = entries[entries.length - 1];
    must(final.index === prediction.callCount, 'Last spy call index differs from prediction.');
    actual = final.text;
  }
  return { expected: parseNumeric(wanted), received: parseNumeric(actual), from: 'exact numeric labels' };
}
function failureValues(result, prediction, message) {
  const details = result.failureDetails;
  if (details !== undefined) {
    must(Array.isArray(details) && details.length === 1, 'Expected exactly one failure detail.');
    const matcher = details[0] && details[0].matcherResult;
    if (matcher) {
      if (matcher.name !== undefined) equal(matcher.name, prediction.matcher, 'Wrong matcher name.');
      if (matcher.pass !== undefined) equal(matcher.pass, false, 'Matcher did not fail.');
      // Some Jest 26 assertion results expose literal expected/actual values.
      if (numeric(matcher.expected) && numeric(matcher.actual)) {
        equal(matcher.expected, prediction.expected, 'Structured expected value differs.');
        equal(matcher.actual, prediction.received, 'Structured received value differs.');
        return { expected: matcher.expected, received: matcher.actual, from: 'structured matcherResult' };
      }
    }
  }
  return diffValues(message) || labeledValues(message, prediction);
}
function classifyFailure(result, specification) {
  const prediction = specification.firstFailure;
  must(Array.isArray(result.failureMessages) && result.failureMessages.length === 1,
    'Expected exactly one assertion failure for ' + specification.title);
  const message = clean(result.failureMessages[0]);
  must(!/(?:SyntaxError:|ReferenceError:|TypeError:|Cannot find module|Test suite failed to run|Exceeded timeout|Async callback was not invoked|Your test suite must contain|Jest worker encountered)/.test(message),
    'Infrastructure/runtime/import/timeout failure is not behavioral red.');
  const firstLine = message.trim().split('\n')[0].replace(/^Error:\s*/, '');
  const shape = prediction.matcher === 'toEqual'
    ? /^expect\(received\)\.toEqual\(expected\)(?: \/\/ deep equality)?$/
    : /^expect\(jest\.fn\(\)\)\.toHaveBeenLastCalledWith\(\.\.\.expected\)$/;
  must(shape.test(firstLine), 'First error is not the predicted assertion matcher: ' + firstLine);
  const escapedPath = expected.sourceFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  must(new RegExp(escapedPath + ':' + prediction.sourceLine + ':\\d+').test(message),
    'Assertion failure is not at the exact predicted source line.');
  if (prediction.matcher === 'toHaveBeenLastCalledWith') {
    const count = message.match(/Number of calls:\s*(\d+)/);
    must(count && Number(count[1]) === prediction.callCount, 'Spy call count differs from prediction.');
  }
  const values = failureValues(result, prediction, message);
  equal(values.expected, prediction.expected, 'Expected payload differs from static prediction.');
  equal(values.received, prediction.received, 'Received payload differs from static prediction.');
  must(JSON.stringify(values.expected) !== JSON.stringify(values.received), 'Failure values are equal.');
  return { title: specification.title, matcher: prediction.matcher, sourceLine: prediction.sourceLine, ...values };
}
function checkSnapshots(snapshot, full) {
  must(snapshot && typeof snapshot === 'object', 'Missing snapshot result.');
  for (const field of ['added', 'updated', 'unmatched', 'filesRemoved', 'filesUnmatched']) {
    equal(snapshot[field], 0, 'Snapshot write/mismatch: ' + field);
  }
  equal(snapshot.failure, false, 'Snapshot failure.');
  if (full) {
    equal(snapshot.total, expected.expectedExistingSnapshots, 'Wrong full-file snapshot count.');
    equal(snapshot.matched, expected.expectedExistingSnapshots, 'Not all original snapshots matched.');
    equal(snapshot.unchecked, 0, 'Unchecked snapshots remain.');
  } else {
    equal(snapshot.total, 0, 'Focused run unexpectedly exercised snapshots.');
  }
}
function classify(variant, full = false) {
  const stem = full ? 'full' : 'focused';
  if (!full) equal(exitCode(variant + '/stage.exit-code'), 0, variant + ' setup/integrity failed.');
  const actualExit = exitCode(variant + '/' + stem + '.exit-code');
  equal(exitCode(variant + '/' + stem + '-completed.exit-code'), actualExit, 'Invocation completion is not established.');
  const predictedFailure = variant === 'baseline';
  equal(actualExit, predictedFailure ? 1 : 0, 'Unexpected original runner exit code.');
  const result = json(variant + '/' + stem + '.jest.json');
  equal(result.wasInterrupted, false, 'Jest was interrupted.');
  equal(result.numRuntimeErrorTestSuites, 0, 'Jest runtime-error suite.');
  equal(result.numTotalTestSuites, 1, 'Exactly the requested source file must execute.');
  equal(result.numPendingTestSuites, 0, 'Pending test suite.');
  equal(result.numFailedTestSuites, predictedFailure ? 1 : 0, 'Wrong failed suite count.');
  equal(result.numPassedTestSuites, predictedFailure ? 0 : 1, 'Wrong passed suite count.');
  equal(result.success, !predictedFailure, 'Unexpected Jest success flag.');
  equal(result.numTotalTests, expected.expectedFullFileCount, 'Wrong total registered test count.');
  equal(result.numTodoTests, 0, 'Todo test present.');
  equal(result.numFailedTests, predictedFailure ? expected.predictedBaselineFailed : 0, 'Wrong failed test count.');
  equal(result.numPassedTests, full ? expected.expectedFullFileCount : (predictedFailure ? expected.predictedBaselinePassed : expected.expectedFocusedCount), 'Wrong passed test count.');
  equal(result.numPendingTests, full ? 0 : expected.existingTests.length, 'Wrong pending test count.');
  must(Array.isArray(result.testResults) && result.testResults.length === 1, 'Wrong testResults file count.');
  const suite = result.testResults[0];
  must(typeof suite.name === 'string' && suite.name.endsWith('/' + expected.sourceFile), 'Unexpected suite source path.');
  must(!suite.testExecError, 'Suite setup/import/execution error.');
  equal(suite.status, predictedFailure ? 'failed' : 'passed', 'Wrong suite status.');
  must(Array.isArray(suite.assertionResults), 'No assertionResults.');
  equal(suite.assertionResults.length, expected.expectedFullFileCount, 'Missing/extra registered assertion identities.');
  const identities = new Map();
  for (const item of suite.assertionResults) {
    must(typeof item.fullName === 'string' && !identities.has(item.fullName), 'Missing or duplicate test identity.');
    must(Array.isArray(item.ancestorTitles) && typeof item.title === 'string', 'Incomplete test identity.');
    equal(item.fullName, [...item.ancestorTitles, item.title].join(' '), 'Inconsistent full test name.');
    identities.set(item.fullName, item);
  }
  const failures = [];
  function consume(ancestors, title, status, specification) {
    const key = [...ancestors, title].join(' ');
    const item = identities.get(key);
    must(item, 'Missing expected identity: ' + key);
    equal(item.ancestorTitles, ancestors, 'Wrong ancestor group: ' + key);
    equal(item.title, title, 'Wrong title: ' + key);
    equal(item.status, status, 'Unexpected status: ' + key);
    if (status === 'failed') failures.push(classifyFailure(item, specification));
    else {
      equal(item.failureMessages || [], [], 'Unexpected failure attached to non-failed test.');
      if (item.failureDetails !== undefined) equal(item.failureDetails, [], 'Unexpected failureDetails.');
    }
    identities.delete(key);
  }
  for (const item of expected.tests) {
    consume([expected.describe], item.title, predictedFailure ? item.baseline : 'passed', item);
  }
  for (const item of expected.existingTests) {
    consume(item.ancestors, item.title, full ? 'passed' : 'pending');
  }
  equal(identities.size, 0, 'Unexpected identities remain.');
  checkSnapshots(result.snapshot, full);
  const audit = json(variant + '/post-' + stem + '.integrity.json');
  equal(audit.errors, [], 'Source audit did not pass.');
  equal(audit.trackedTree, source.variants[variant].tree, 'Wrong source tree.');
  equal(audit.sourceSha256[expected.sourceFile], expected.sourceSha256, 'Tests differ from the frozen inventory.');
  report.variants.push({ variant, originalExitCode: actualExit, passed: result.numPassedTests,
    failed: result.numFailedTests, pending: result.numPendingTests, sourceTree: audit.trackedTree,
    dependencySha256: audit.dependencies.sha256, failures });
}

try {
  must(mode === 'focused' || mode === 'full', 'Use focused or full classification mode.');
  if (mode === 'focused') {
    classify('baseline');
    classify('candidate');
    equal(report.variants[0].dependencySha256, report.variants[1].dependencySha256,
      'The baseline/candidate installed dependency inventories differ.');
    report.scope = 'Identical 22 native DOM cases; baseline exact behavioral failures and candidate passes.';
  } else {
    const prior = json('focused.classification.json');
    equal(prior.accepted, true, 'Focused pair gate was not accepted.');
    classify('candidate', true);
    report.scope = 'Complete original Slider index file, including 22 existing tests and 4 existing snapshots.';
  }
  report.accepted = true;
  report.remaining = 'Aggregate client/node suites, builds, lint/type checks and real browser QA are not established by this result.';
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
}
fs.writeFileSync(path.join(evidence, mode + '.classification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
