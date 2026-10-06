# Reproduce Slider's negative-mark keyboard ordering

This small project reproduces a numerical selection bug in Arco React's existing `onlyMarkValue` keyboard path. It uses unmodified upstream source with React 16.14 and `react-test-renderer` 16.14. It does not contain a product fix.

## Run

Use Node.js 18 or later (verified with Node.js 24.19.0):

```sh
npm ci --ignore-scripts
npm test
npm run test:controls
```

Expected baseline results:

- `npm test` exits **1**: 21 tests, **11 failing bug assertions and 10 passing controls**.
- `npm run test:controls` exits **0**: **10/10 controls pass**.
- Source verification checks the hashes of all four copied source files and the original MIT license before testing.

Eight failures concern **documented negative integer marks**. Three additional failures concern decimal marks; decimals already appear in upstream rendering tests, but the API text says integer, so they are supplemental evidence rather than the core bug claim.

## Primary reproduction

The component props are:

```tsx
<Slider
  min={-20}
  max={20}
  onlyMarkValue
  marks={{ '-20': '-20', '-10': '-10', 0: '0', 10: '10', 20: '20' }}
  defaultValue={-10}
/>
```

Its existing keyboard handler maps Right/Up to addition and Left/Down to subtraction. The unchanged hook returns these results:

| Current mark | Direction | Expected | Baseline |
| --- | --- | --- | --- |
| -10 | addition | 0 | -10 |
| 0 | subtraction | -10 | 0 |
| 20 | addition | 20 | -20 |
| -20 | subtraction | -20 | 20 |

`Object.keys(marks)` enumerates the example as `['0', '10', '20', '-20', '-10']`. The keyboard path uses this array without numeric sorting, whereas rendered marks are already sorted numerically. Negative-only keys supplied in a different insertion order fail too.

## What these tests prove

The tests render the **real upstream hooks** through React, then call their actual normalization and next-mark functions. No hook implementation is copied into the test or mocked. The cases cover numeric ordering, boundaries, repeated traversal, a range endpoint, nearest-mark normalization, normal step mode, and positive-only controls.

This is an **offline hook-level reproduction**, not browser or full-component DOM verification. The handler-composition tests mirror the component's normalization/selection path; they do not dispatch a native keyboard event. No browser verification or complete upstream test-suite pass is claimed.

## Source and provenance

Repository: https://github.com/arco-design/arco-design

Fixed research commit: `c2b050d9c7ce94bebba94f616a0721344231caac`.

The source package.json identifies version `2.66.16`. The official npm metadata for that release points to `fbf2ec0a8cc28a5d20f1f82de6c2c4196ef66950`, which is a different repository commit. All four runtime source files used here were fetched from that fixed release commit and are byte-for-byte identical to the research commit. Thus the fixture also reproduces the released 2.66.16 source logic. `SOURCE.json` records the exact original URL and SHA-256 of each copied file. All files under `upstream/` are unmodified. The upstream MIT license is retained at `upstream/LICENSE`.

The fixture compiles only the runtime imports needed by these hooks with esbuild. It is not an upstream TypeScript-check or full library build. The lockfile pins the small reproduction dependency set. Generated JavaScript and installed dependencies are ignored by Git.
