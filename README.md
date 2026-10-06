# Arco Slider negative marks: native DOM validation proposal

This is a validation-only publication bundle for the user's own fork. It is not the product source tree and is not an upstream pull request.

## Status and boundaries

During preparation, only source inspection, artifact writing, and static inventory comparison were performed. No dependency installation, proposed script execution, native test, build, browser, listener, GitHub connector action, push, or publication was performed by this bundle's author. The workflow and its classifier have not been executed by the author. An independent audit may report its own separately scoped checks.

The expected native result is a **static prediction**: 18 specific baseline assertion failures plus four passing controls, then 22 candidate passes. The raw native failure format and payloads have not yet been observed. A strict classifier rejection is an unresolved gate, not permission to relabel arbitrary failures as the expected defect. Prior standalone hook research is separate evidence and does not establish a native DOM pass.

This first stage uses the repository's original `yarn test:client` command, Arco/Jest configuration, React, `tests/util` renderer/events, and actual Slider implementation. It does not replace the hook/component, insert a hand-coded navigation implementation, update snapshots, or use the research fixture's dependencies.

The candidate full original Slider index runs only after the focused pair is accepted. Aggregate client/node suites, demo snapshots, CJS/ES/package builds, lint/type checks, and genuine browser/focus/visual QA remain separate pending stages. This workflow starts no browser or HTTP listener.

## Frozen source identity

- Repository: [dvd233/arco-design](https://github.com/dvd233/arco-design)
- Frozen base commit: `c2b050d9c7ce94bebba94f616a0721344231caac`
- Base tree: `51f988b198e24b8ea898e5803cfa0698280a1ef7`
- Baseline plus identical tests tree: `b5e76a788981e52ca5e08b3cfc0d1baf8b7627fe`
- Published source-only candidate commit: [2bbbbed7f1add2b25e35bb290f4eaf7e54f5dc65](https://github.com/dvd233/arco-design/commit/2bbbbed7f1add2b25e35bb290f4eaf7e54f5dc65)
- Candidate tree: `0a9a01536e61e5119f753f972e71967ac251f9c9`
- Candidate sole parent: the frozen base commit above
- Source freeze: `SOURCE_FREEZE.json`, version 2

The baseline checks out the exact base and applies only `patches/native-tests.patch`. The candidate checks out the exact published candidate commit at depth two, verifies its sole parent and tree, and reconstructs `base + candidate.patch` in a temporary Git index. It does not apply the candidate patch to an already patched checkout. Both variants' full tracked trees are reconstructed and verified again around installation, icon generation, configuration inspection, and tests. SHA-256 checks additionally bind the test, hook, manifests/locks, configuration, utilities, snapshots, and relevant component/icon sources.

The product change is one numeric sort of freshly obtained mark keys. The index=-1 fallback control flow is unchanged, but sorting can change which first key it selects for negative marks. The unmarked-boundary control covers only nonnegative marks `{10,20}`; this bundle does not claim identical fallback outputs for every mark object.

## Publication and permission boundary

Publish only the exact files in `publication-manifest.json` into a new independent empty Git tree. Never copy or inherit the upstream repository's other workflows into this tree. The separate source checkouts may contain their original `.github` directories as inert source inputs; they are not the publication root.

The single workflow is restricted twice, by job condition and execution guard, to:

- Repository `dvd233/arco-design`, repository ID `1407419356`
- Owner ID `111864431`
- Exact ref `refs/heads/validation/slider-negative-marks-native`
- Push to that branch or `workflow_dispatch` selecting that same branch

It grants only `contents: read`, uses `persist-credentials: false` for all checkouts, and uses no secret references, PR events, writes, comments, deployments, package publication, or shared cache action. It does not dispatch or publish itself. Review and publication are separate controlled steps.

Only official checkout, setup-node, and upload-artifact actions are used. Their immutable commit pins and prior official-repository verification provenance are in `actions-lock.json`. No fresh remote verification was performed while preparing this bundle.

`publication-manifest.json` includes the exact allowlist and SHA-256 for every other public file. The manifest cannot hash itself recursively; its bytes are bound by the independently reviewed publication tree/commit. No private logs, raw connector responses, credentials, or local research directories are publication inputs.

## Toolchain and installation

Upstream's contribution guide prescribes Yarn, offers own-fork Actions as an alternative for expensive native test runs, and its PR workflow selects Node 16. This proposal pins Node `16.20.2` and Yarn `1.22.22`; Node 16 is an upstream-compatibility runtime, not a recommendation for new applications. The hosted runner is ephemeral.

A minimal isolated `toolchain/package.json` and npm v2 lock contain only the exact Yarn CLI. Its registry URL/integrity were copied from previously installed official Yarn metadata. The workflow uses `npm ci --ignore-scripts` only inside that toolchain folder, with an isolated temporary npm cache. It does not install or alter a global package manager. Nested `yarn` commands resolve to that same local CLI.

Each source checkout receives its own original frozen root dependency install:

    node /absolute/bundle/toolchain/node_modules/yarn/bin/yarn.js install --frozen-lockfile --non-interactive --ignore-scripts --production=false --cache-folder /runner-temporary/variant-cache

Skipping all installation lifecycle scripts is intentional and visible: the root `prepare` script invokes Husky 7, and unrelated dependency scripts can write hooks or download browsers. The test command itself is not skipped or replaced. The original `yarn icon` command runs explicitly afterward. A native package that genuinely needs an omitted lifecycle step causes a setup failure requiring review; it must not count as the expected baseline red or be repaired by silently substituting dependencies.

This focused scope installs only the root dependencies, not the site's separate package tree or a prebuilt replacement. If this real source test unexpectedly requires another upstream preparation stage, the workflow fails with evidence. Site/aggregate work is not smuggled into a focused pass.

## Input integrity and generated icons

The source auditor includes ignored files when looking for unexpected inputs. Before installation, no untracked input is allowed. After installation, only `node_modules/` is allowed. After explicit icon generation, only that directory plus `icon/react-icon/` and `icon/react-icon-cjs/` are allowed. Symlinks must stay inside their corresponding allowed root.

Dependencies are fully rehashed at every audited phase. One complete post-install dependency inventory and two post-icon generated-file inventories are retained per variant. Later phases retain aggregate hash/count reports; any mismatch also saves a detailed before/after delta. Baseline and candidate dependency digests must agree.

The original icon command also rewrites four tracked files: `icon/index.js`, `icon/index.es.js`, `icon/index.d.ts`, and `icon/demo.js`. They must still match the frozen source tree. Any generation drift fails before tests and preserves the tracked diff. The workflow never resets those files, broadens the dirty-input allowlist, or claims a pass against altered inputs.

The original runner's `--showConfig` output and resolved package versions/paths are preserved before testing. Jest caches live outside both source trees.

## Native commands and strict classification

For each variant, in sequence, the workflow runs the original native command with identical options:

    yarn test:client --runTestsByPath components/Slider/__test__/index.test.tsx --testNamePattern='^Slider onlyMarkValue keyboard navigation ' --runInBand --collectCoverage=false --silent=false --ci --json --cacheDirectory=/runner-temporary/variant-jest-cache --outputFile=/absolute/evidence/variant/focused.jest.json

The raw command exit code is retained even for the expected failing baseline. `tee` does not replace it. A completion marker confirms only that the invocation and integrity checks finished; it does not assert success.

`expected-tests.json` binds the exact 22 new titles and the 22 pre-existing test identities. The focused classifier requires exactly the new 22 to run and all 22 existing tests to be pending. It rejects missing/duplicate/unexpected identities, skipped new cases, counters inconsistent with those identities, imports/setup/runtime errors, interruptions, unanticipated assertion types/locations/payloads, missing JSON, abnormal exit codes, or changed inputs.

Each predicted baseline failure must occur at its exact first assertion line, with the predicted matcher and numeric expected/received values. Spy assertions also require the predicted call count. Literal structured Jest failure details are used when available; otherwise the classifier parses a narrowly supported numeric Expected/Received message or diff without evaluating text. Unrecognized formatting fails closed. Counts alone never establish baseline behavior.

Only after that paired gate passes, the candidate runs the same original Slider index without a name filter. The second classifier requires all 44 tests and all four existing index snapshots to pass, with no pending/todo cases and no snapshot additions, updates, deletions, or unmatched entries. `--ci` and unchanged snapshot hashes prohibit silently refreshing snapshots. The separate Slider demo file is not included in this first-stage claim.

## Evidence and interpretation

An always-run upload step retains `bundle/evidence/` for seven days. Evidence includes raw logs/exit codes, untouched Jest JSON, resolved native configuration/versions, patch reconstruction, phase-by-phase source audits, dependency/icon anchors, drift deltas if any, and separate focused/full classification reports. It excludes node_modules contents, package caches, source checkouts, secrets, and environment dumps.

An accepted focused report establishes only this source-bound 22-case native DOM comparison. An accepted full report additionally establishes the original Slider index and its existing snapshots. Neither is a broad package, browser, accessibility, merge-readiness, or deployment claim. Setup/format/source failures remain visible blockers to diagnose before any wider validation stage.
