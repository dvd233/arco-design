import React from 'react';
import { create, act } from 'react-test-renderer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import useLegalValue from './upstream/components/Slider/hooks/useLegalValue';
import useInterval from './upstream/components/Slider/hooks/useInterval';

function readHooks(overrides: object) {
  let api: any;
  const props = {
    min: 0, max: 100, step: 1, onlyMarkValue: true, isRange: false,
    marks: { 0: 'zero', 10: 'ten', 20: 'twenty' }, ...overrides,
  };
  function Probe() {
    const intervals = useInterval(props as any);
    api = { ...intervals, ...useLegalValue({ ...props, intervalConfigs: intervals.intervalConfigs } as any) };
    return null;
  }
  let root: any;
  act(() => { root = create(React.createElement(Probe)); });
  const result = api;
  act(() => { root.unmount(); });
  return result;
}

const negativeMarks = { '-20': '-20', '-10': '-10', 0: '0', 10: '10', 20: '20' };
const decimalMarks = { 0: '0', 0.5: '0.5', 1: '1' };

for (const [name, options, from, direction, expected] of [
  ['CONTROL positive-integer next mark', {}, 0, 'addition', 10],
  ['CONTROL positive-integer previous mark', {}, 20, 'subtraction', 10],
  ['CONTROL positive-integer upper bound', {}, 20, 'addition', 20],
  ['CONTROL positive-integer lower bound', {}, 0, 'subtraction', 0],
  ['CONTROL ordinary step mode', { onlyMarkValue: false, step: 0.5 }, 10, 'addition', 10.5],
  ['CONTROL negative adjacent marks before crossing zero', { min: -20, max: 20, marks: negativeMarks }, -20, 'addition', -10],
  ['BUG negative-to-zero cannot advance', { min: -20, max: 20, marks: negativeMarks }, -10, 'addition', 0],
  ['BUG zero-to-negative cannot retreat', { min: -20, max: 20, marks: negativeMarks }, 0, 'subtraction', -10],
  ['BUG upper bound wraps to negative minimum', { min: -20, max: 20, marks: negativeMarks }, 20, 'addition', 20],
  ['BUG decimal mark is skipped', { max: 1, marks: decimalMarks }, 0, 'addition', 0.5],
  ['BUG decimal-to-integer cannot advance', { max: 1, marks: decimalMarks }, 0.5, 'addition', 1],
  ['BUG decimal upper bound moves backwards', { max: 1, marks: decimalMarks }, 1, 'addition', 1],
] as any[]) {
  test(name, () => {
    const api = readHooks(options);
    // Match Slider.handleArrowEvent -> onChange -> updateValue.
    const actual = api.getLegalValue(api.getNextMarkValue(from, direction));
    assert.equal(actual, expected, `${name}: ${direction} from ${from}`);
  });
}

test('CONTROL rendering interval marks already uses ascending numeric order', () => {
  assert.deepEqual(readHooks({ max: 1, marks: decimalMarks }).markList.map((m: any) => +m.key), [0, 0.5, 1]);
  assert.deepEqual(readHooks({ min: -20, max: 20, marks: negativeMarks }).markList.map((m: any) => +m.key), [-20, -10, 0, 10, 20]);
});

test('CONTROL non-mark value is normalized to nearest mark before a keyboard event', () => {
  const api = readHooks({ min: -20, max: 20, marks: negativeMarks });
  assert.deepEqual(api.getLegalRangeValue(-8), [-20, -10]);
  assert.deepEqual(api.getLegalRangeValue(-100), [-20, -20]);
  assert.deepEqual(api.getLegalRangeValue(100), [-20, 20]);
});

test('BUG normalized non-mark input cannot advance across zero', () => {
  const api = readHooks({ min: -20, max: 20, marks: negativeMarks });
  const displayed = api.getLegalRangeValue(-8)[1];
  assert.equal(api.getLegalValue(api.getNextMarkValue(displayed, 'addition')), 0);
});

test('BUG range endpoint cannot advance across zero', () => {
  const api = readHooks({ isRange: true, min: -20, max: 20, marks: negativeMarks });
  const values = api.getLegalRangeValue([-10, 10]);
  values[0] = api.getNextMarkValue(values[0], 'addition');
  assert.deepEqual(values.map(api.getLegalValue).sort((a: number,b: number) => a-b), [0, 10]);
});

test('BUG all-negative integer labels obey insertion order instead of numeric order', () => {
  const api = readHooks({ min: -30, max: -10, marks: { '-10': '-10', '-30': '-30', '-20': '-20' } });
  assert.equal(api.getLegalValue(api.getNextMarkValue(-10, 'addition')), -10);
});

test('CONTROL onlyMarkValue ignores the numeric step', () => {
  const api = readHooks({ step: 1000 });
  assert.equal(api.getNextMarkValue(0, 'addition'), 10);
});

test('CONTROL decimal nearest-mark normalization handles a computed floating value', () => {
  const api = readHooks({ max: 1, marks: {0: '0', 0.3: '0.3', 1: '1'} });
  assert.equal(api.getLegalRangeValue(0.1 + 0.2)[1], 0.3);
});

test('BUG negative lower bound wraps to positive maximum', () => {
  const api = readHooks({ min: -20, max: 20, marks: negativeMarks });
  assert.equal(api.getLegalValue(api.getNextMarkValue(-20, 'subtraction')), -20);
});

test('BUG repeated increments must visit every negative and positive integer mark', () => {
  const api = readHooks({ min: -20, max: 20, marks: negativeMarks });
  let value = -20;
  const actual = [value];
  for (let count = 0; count < 5; count++) {
    value = api.getLegalValue(api.getNextMarkValue(value, 'addition'));
    actual.push(value);
  }
  assert.deepEqual(actual, [-20, -10, 0, 10, 20, 20]);
});
