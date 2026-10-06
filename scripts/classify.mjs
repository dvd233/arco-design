import assert from 'node:assert/strict';
import { SCENARIOS, expectedCheckpoints, countExpectedSemanticDifferences } from './spec.mjs';
const keys = { ArrowRight:39, ArrowLeft:37, ArrowUp:38, ArrowDown:40 };
const artifact = file => {
  assert.match(file.path,/^[a-z0-9-]+\.(png|zip)$/);
  assert.match(file.sha256,/^[a-f0-9]{64}$/);
};
export function classify(report) {
  assert.ok(['baseline','fixed'].includes(report.variant));
  assert.equal(report.completed,true);
  assert.deepEqual(report.errors,[]);
  assert.equal(report.scenarios.length,SCENARIOS.length);
  let semanticDifferences = 0;
  for (const [index,scenario] of SCENARIOS.entries()) {
    const entry = report.scenarios[index];
    assert.equal(entry.id,scenario.id);
    assert.equal(entry.completed,true);
    artifact(entry.readyScreenshot); artifact(entry.trace);
    assert.deepEqual(entry.initial.values,Array.isArray(scenario.initial) ? scenario.initial : [scenario.initial]);
    assert.deepEqual(entry.initial.events,[]);
    assert.deepEqual(entry.initial.accepted,[]);
    assert.deepEqual(entry.initial.keyEvents,[]);
    assert.equal(entry.checkpoints.length,scenario.steps.length);
    const expected = expectedCheckpoints(scenario,report.variant);
    const correct = expectedCheckpoints(scenario,'fixed');
    const expectedKeyEvents = [];
    for (const [stepIndex,step] of scenario.steps.entries()) {
      const checkpoint = entry.checkpoints[stepIndex];
      assert.deepEqual(checkpoint.step,step);
      const actual = { values:checkpoint.actual.values, events:checkpoint.actual.events, accepted:checkpoint.actual.accepted };
      assert.deepEqual(actual,expected[stepIndex],`${scenario.id} step ${stepIndex} is not the precise expected ${report.variant} semantics`);
      if (step.action === 'key') expectedKeyEvents.push({ key:step.press, keyCode:keys[step.press], trusted:true });
      assert.deepEqual(checkpoint.actual.keyEvents,expectedKeyEvents);
      if (JSON.stringify(actual) !== JSON.stringify(correct[stepIndex])) semanticDifferences++;
      artifact(checkpoint.screenshot);
    }
  }
  assert.equal(semanticDifferences,report.variant === 'baseline' ? countExpectedSemanticDifferences() : 0);
  return { status:report.variant === 'baseline' ? 'expected-baseline-red' : 'fixed-green', exitCode:report.variant === 'baseline' ? 1 : 0, semanticDifferences };
}
