// Synthetic classifier-unit fixtures only. These are not browser/product evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { classify } from '../scripts/classify.mjs';
import { SCENARIOS, expectedCheckpoints, countExpectedSemanticDifferences } from '../scripts/spec.mjs';
const keyCodes = { ArrowRight:39,ArrowLeft:37,ArrowUp:38,ArrowDown:40 };
const artifact = name => ({ path:name,sha256:'a'.repeat(64) });
function fixture(variant) {
  return { variant,completed:true,errors:[],scenarios:SCENARIOS.map(scenario => {
    const keyEvents = [];
    const expected = expectedCheckpoints(scenario,variant);
    return {
      id:scenario.id,completed:true,
      initial:{ values:Array.isArray(scenario.initial) ? scenario.initial : [scenario.initial],events:[],accepted:[],keyEvents:[] },
      readyScreenshot:artifact(`${scenario.id}-ready.png`),trace:artifact(`${scenario.id}-trace.zip`),
      checkpoints:scenario.steps.map((step,index) => {
        if (step.action === 'key') keyEvents.push({ key:step.press,keyCode:keyCodes[step.press],trusted:true });
        return { step,actual:{ ...expected[index],keyEvents:structuredClone(keyEvents) },screenshot:artifact(`${scenario.id}-${index+1}.png`) };
      }),
    };
  }) };
}
test('precise baseline trace is expected red and fixed trace is green',() => {
  assert.equal(classify(fixture('baseline')).status,'expected-baseline-red');
  assert.equal(classify(fixture('fixed')).status,'fixed-green');
  assert.ok(countExpectedSemanticDifferences() > 0);
});
test('infrastructure failures and incomplete runs cannot be expected baseline red',() => {
  for (const variant of ['baseline','fixed']) {
    for (const error of ['setup failed','navigation timeout','selector missing','pageerror','HTTP 500','trace failure','cleanup failure']) {
      const report = fixture(variant); report.errors.push(error);
      assert.throws(() => classify(report));
    }
    const report = fixture(variant); report.completed=false;
    assert.throws(() => classify(report));
  }
});
test('each altered payload, displayed value and untrusted key is rejected',() => {
  for (const variant of ['baseline','fixed']) {
    for (const [scenarioIndex,scenario] of SCENARIOS.entries()) {
      for (let index=0; index<scenario.steps.length; index++) {
        for (const field of ['values','events','accepted']) {
          const report = fixture(variant);
          report.scenarios[scenarioIndex].checkpoints[index].actual[field]=['corrupt'];
          assert.throws(() => classify(report));
        }
        const report = fixture(variant);
        report.scenarios[scenarioIndex].checkpoints[index].actual.keyEvents[0].trusted=false;
        assert.throws(() => classify(report));
      }
    }
  }
});
test('missing scenarios/checkpoints/artifacts are rejected',() => {
  const mutations = [
    report => report.scenarios.pop(),
    report => report.scenarios[0].checkpoints.pop(),
    report => { report.scenarios[0].completed=false; },
    report => { report.scenarios[0].trace.sha256=''; },
    report => { report.scenarios[0].readyScreenshot.path='../private.png'; },
    report => { report.scenarios[0].checkpoints[0].screenshot.sha256=''; },
  ];
  for (const mutation of mutations) {
    const report=fixture('baseline'); mutation(report);
    assert.throws(() => classify(report));
  }
});
