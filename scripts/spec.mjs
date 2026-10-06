// These are source-reviewed EXPECTATIONS, not measured browser outcomes.
// Both variants use this exact scenario/input table. No Slider logic is replaced.
const R = 'ArrowRight', L = 'ArrowLeft', U = 'ArrowUp', D = 'ArrowDown';
const mixed = [[-20, '-20'], [-10, '-10'], [0, '0'], [10, '10'], [20, '20']];
const mixedProps = { min: -20, max: 20, step: 1000, onlyMarkValue: true };
const key = (press, fixed, baseline, thumb = 0) => ({ action: 'key', press, thumb, fixed, baseline });
const scalar = (id, initial, presses, fixed, baseline, overrides = {}) => ({
  id, description: id.replaceAll('-', ' '), initial, control: 'uncontrolled',
  marks: mixed, props: mixedProps, ...overrides,
  steps: presses.map((press, index) => key(press, fixed[index], baseline[index])),
});
const traverse = [R,R,R,R,R,L,L,L,L,L,R,R,R,R,R,L,L,L,L,L];
export const SCENARIOS = [
  scalar('mixed-repeated-traversal', -20, traverse,
    [-10,0,10,20,20,10,0,-10,-20,-20,-10,0,10,20,20,10,0,-10,-20,-20],
    [-10,-10,-10,-10,-10,-20,20,10,0,0,10,20,-20,-10,-10,-20,20,10,0,0]),
  scalar('mixed-shuffled-insertion', -20, [R,L,L,R,R,R],
    [-10,-20,-20,-10,0,10], [-20,-10,20,-10,-20,-20],
    { marks: [[-10,'-10'],[20,'20'],[-20,'-20'],[0,'0'],[10,'10']] }),
  scalar('all-negative-shuffled-insertion', -30, [R,R,R,L,L,L],
    [-20,-10,-10,-20,-30,-30], [-20,-20,-20,-30,-10,-10],
    { marks: [[-10,'-10'],[-30,'-30'],[-20,'-20']], props: { min: -30, max: -10, onlyMarkValue: true } }),
  scalar('all-negative-reverse-insertion', -30, [R,L,L,L,R,R,R],
    [-20,-30,-30,-30,-20,-10,-10], [-30,-20,-10,-10,-20,-30,-30],
    { marks: [[-10,'-10'],[-20,'-20'],[-30,'-30']], props: { min: -30, max: -10, onlyMarkValue: true } }),
  {
    id: 'range-crossing', description: 'Two thumbs cross and keep existing sorted payloads',
    initial: [-10,0], control: 'uncontrolled', marks: mixed, props: { ...mixedProps, range: true },
    steps: [
      key(R,[0,0],[-10,0],0), key(R,[0,10],[-10,0],0), key(R,[0,20],[-10,10],1),
      key(L,[-10,20],[-20,10],0), key(L,[-20,20],[10,20],0),
      key(L,[-20,10],[10,10],1), key(L,[-20,0],[0,10],1), key(L,[-20,-10],[0,0],1),
    ],
  },
  {
    id: 'multiple-thumb-crossing', description: 'Three thumbs cross and preserve sorted callback values',
    initial: [-20,-10,0], control: 'uncontrolled', marks: mixed, props: { ...mixedProps, range: true },
    steps: [
      key(R,[-20,0,0],[-20,-10,0],1), key(R,[-20,0,10],[-20,-10,0],1),
      key(L,[-20,-10,10],[-20,-20,0],1), key(L,[-20,-10,10],[-20,0,20],0),
      key(R,[-20,-10,20],[-20,-20,0],2),
    ],
  },
  scalar('controlled-rejection', -10, [R,R,L,U,D], [0,0,-20,0,-20], [-10,-10,-20,-10,-20], { control: 'reject' }),
  {
    id: 'controlled-deferred-acceptance', description: 'Reject repeated proposals until the real parent accepts its latest callback',
    initial: -10, control: 'defer', marks: mixed, props: mixedProps,
    steps: [key(R,0,-10),key(R,0,-10),{ action:'accept' },key(R,10,-10),{ action:'accept' },key(L,0,-20),{ action:'accept' },key(R,10,-10),{ action:'accept' }],
  },
  scalar('controlled-immediate-acceptance', -10, [R,U,L,D], [0,10,0,-10], [-10,-10,-20,20], { control: 'accept' }),
  scalar('disabled-keyboard-guard', -10, [R,L,U,D], [-10,-10,-10,-10], [-10,-10,-10,-10], { props: { ...mixedProps, disabled: true } }),
  ...[
    ['vertical', { vertical:true }], ['reverse', { reverse:true }],
    ['vertical-reverse', { vertical:true, reverse:true }],
    ['rtl-default', {}, true], ['rtl-explicit-reverse', { reverse:true }, true],
    ['rtl-vertical', { vertical:true }, true],
  ].map(([id, props, rtl]) => scalar(id, -10, [R,U,L,D], [0,10,0,-10], [-10,-10,-20,20], { props: { ...mixedProps, ...props }, rtl: !!rtl })),
  scalar('positive-integer-control', 0, [R,R,R,L,L,L], [10,20,20,10,0,0], [10,20,20,10,0,0],
    { marks: [[20,'20'],[0,'0'],[10,'10']], props: { min:0, max:20, onlyMarkValue:true, step:1000 } }),
  scalar('ordinary-step-with-marks', -10, [R,R,L,U,D,L], [-5,0,-5,0,-5,-10], [-5,0,-5,0,-5,-10],
    { props: { min:-20, max:20, step:5, onlyMarkValue:false } }),
  scalar('ordinary-step-no-marks-endpoints', -20, [L,R,R,R,R,R,L], [-20,-10,0,10,20,20,10], [-20,-10,0,10,20,20,10],
    { marks: null, props: { min:-20, max:20, step:10 } }),
];
const asThumbs = value => Array.isArray(value) ? value : [value];
export function expectedCheckpoints(scenario, variant) {
  if (!['baseline','fixed'].includes(variant)) throw new Error('Unknown variant');
  let display = scenario.initial, pending;
  const events = [], accepted = [];
  return scenario.steps.map(step => {
    if (step.action === 'accept') {
      if (pending === undefined) throw new Error('Acceptance without a real callback');
      display = pending; accepted.push(pending); pending = undefined;
    } else if (!scenario.props.disabled) {
      pending = step[variant]; events.push(pending);
      if (['uncontrolled','accept'].includes(scenario.control)) display = pending;
    }
    return { values: asThumbs(display), events: structuredClone(events), accepted: structuredClone(accepted) };
  });
}
export function countExpectedSemanticDifferences() {
  return SCENARIOS.reduce((count, scenario) => {
    const baseline = expectedCheckpoints(scenario,'baseline');
    return count + expectedCheckpoints(scenario,'fixed').filter((expected,index) => JSON.stringify(expected) !== JSON.stringify(baseline[index])).length;
  }, 0);
}
