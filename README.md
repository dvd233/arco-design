# Arco Slider source-bound browser validation proposal

## Current status

Draft only. No upload, push, workflow dispatch, browser launch, listener, dependency installation, native build, or browser run was performed for this package. Product source was not edited. Browser results do not exist. Expected traces are source-reviewed assertions, not observations.

Local dependency installation owned by the implementation task was stopped after repeated approval-review cancellation. This package does not retry it or substitute an alternate local installation. Its build-only validation is **NOT RUN**. The separate official-fork native-baseline-first route has now produced genuine focused-test and preparation evidence described below; the Slider index has passed, while applicable aggregate/native build gates remain separately scoped.

The publisher has created and API-verified the format-only source child identified below. Prior source commit `2bbbbed7f1add2b25e35bb290f4eaf7e54f5dc65` has genuine native evidence, including focused baseline 18 expected failures/4 passing controls, fixed 22 passes, and later Slider/client/node/CSS gates. Its real full native CSS was identical on baseline/candidate, but those results are not relabeled as this new source child's browser result. This package's fresh build-only and browser execution remain **NOT RUN**.

An unexecuted local workflow now exists at `.github/workflows/validate-slider-negative-marks-browser.yml`. It has not been published or run. Its first data-only gate rejects an unapproved draft before runtime/package installation. Exact runtime candidates are recorded separately in `runtime-freeze-draft.json`, and the original approved patch is materialized. The verified format-only source child, runtime identities and static CSS contract are now bound in a local executable publication candidate under explicit publisher authorization. No workflow has been published or run; real source/CSS/build/browser results still require the hosted job.

## What the harness does

- Imports the actual checkout's `components/Slider` and `ConfigProvider` and real transitive runtime source. CSS comes from the original native `build:css` full output, subject to publisher approval and actual build gates in `CSS_SOURCE_GATE.md`. It does not use the published Arco npm component, copy Slider logic, monkey-patch behavior, or inject known return values.
- Uses the same React page and 19 scenarios on exact baseline and candidate source.
- Gets focus with real Tab presses from a preceding control, sends Chromium keyboard events, and records actual trusted key events, callback payloads, displayed `aria-valuenow`, accepted publisher values, screenshots, and traces.
- Exercises repeated forward/backward traversal across zero and endpoint holds; mixed and all-negative insertion permutations; two- and three-thumb crossing and sorted callbacks; controlled rejection, deferred acceptance, immediate acceptance; disabled tab skipping and programmatically focused guard; vertical/reverse/RTL combinations; positive marks and ordinary steps with/without marks.
- Preserves existing numeric arrow mapping: Right/Up increase; Left/Down decrease. Orientation/reverse/RTL assertions concern existing numeric mapping and real root classes, not a redesign of accessibility semantics.
- Keeps expected baseline defects separate from correct expectations. A baseline is accepted only if every actual checkpoint matches the specific old-source trace and all controls pass. Setup, rendering, navigation, selector, timeout, runtime, cleanup, missing screenshot/trace, or unexpected-semantics failures are exit 2; they cannot qualify as expected baseline red. A verified expected baseline trace is exit 1, and a fully green candidate is exit 0.

The step=1000 marked scenarios additionally verify that `onlyMarkValue` keeps ignoring step. Deferred acceptance uses a real publisher button to accept the latest actual callback; no timer or runtime replacement supplies expected state.

## Exact source and dependency binding

Baseline repository: https://github.com/arco-design/arco-design

Baseline commit: `c2b050d9c7ce94bebba94f616a0721344231caac`

Baseline tree: `51f988b198e24b8ea898e5803cfa0698280a1ef7`

Candidate repository: approved own fork `dvd233/arco-design`, source branch `fix/slider-negative-marks`.

Candidate commit: [`a1ea1670c162248348515ddfa14e445860bb3c22`](https://github.com/dvd233/arco-design/commit/a1ea1670c162248348515ddfa14e445860bb3c22)

Candidate tree: `ce1acd1765289aa70d6e02e89c5f9138f447db58`

Sole publisher: `c2b050d9c7ce94bebba94f616a0721344231caac`

The publisher verified the published commit/tree/sole publisher against the GitHub commit response. Source freeze version 3 supplies the two candidate file SHA-256 hashes now recorded in this manifest:

- `components/Slider/hooks/useLegalValue.ts`: `f12f5a80fa6f2f154b81168037724bee8d3db685080256e573a5203abfbbd7d0`
- `components/Slider/__test__/index.test.tsx`: `a5acb850032de6f4b3e25391672e25843a0e519ca5dc32f6d21465d72e8b3e86`

Frozen candidate patch SHA-256: `2a4f3ceadfd13d42d4a105989f9c7e64636c54fc7027e419eba34deb1e2a251d`. The original full baseline-to-candidate patch is materialized and its approved digest is verified. It includes only the numeric hook fix and regression tests, with two subsequent whitespace-only test formatting fixes. The source verifier reads the exact baseline tree into a new private temporary index, applies the frozen patch with `git apply --cached`, and requires `git write-tree` to equal the published candidate tree. A private temporary object store with read-only access to the checkout's objects keeps new blobs/trees out of the source checkout. The private files are removed afterward.

This accepts the approved patch's abbreviated text index hashes without rewriting its bytes to imitate `git diff --full-index`. Its formatting need not match a freshly generated diff; its SHA-256 and reconstructed tree must match exactly. Never replace either commit or infer identity from a branch head.

The product delta is only the real hook plus native regression test. The source gate checks exact HEAD/tree, candidate sole publisher, both changed paths, patch-to-tree equivalence, and every committed file's actual Git blob ID and SHA-256. Its committed tree inventory is authoritative, so an index flag hiding a modified tracked file cannot make its bytes pass. Unexpected source symlinks/gitlinks, file-mode changes, index-only paths, dirty tracked files, and extra untracked/ignored source/config inputs are rejected. Only exact dependency roots and officially generated icon output roots are excluded from the extra-input scan. Recording these source identities removes candidate uncertainty; it is not a completed source preparation, dependency install, build, or test.

Real Slider transitively requires generated `icon/react-icon` modules. The future source preparation must use each exact clean checkout's official `yarn icon` generator under the same frozen dependency lock, rather than vendoring icons from a release or stubbing imports. Record generation commands, output inventories, and before/after source gates. If generation changes a tracked file or writes an unexpected input, stop and investigate; do not add a broad dirty-source allowance.

Harness `package-lock.json` is now statically reused from the earlier audited esbuild 0.25.12 / playwright-core 1.56.1 graph: all 28 non-root package entries are unchanged; only project name/version changed. The independent Yarn toolchain manifest/lock are copied byte-identically from the proven native validation toolchain. `LOCK_PROVENANCE.json` records their origins/hashes and explicitly says no installation occurred here. Source `yarn.lock` remains bound to hosted-verified SHA-256 `776292e19ebf3f1a43c3f7c35029946871aed14d2120c9e08fe89282b8e7cebc`. Source preparation uses Node 16.20.2/Yarn 1.22.22; the modern harness's exact Node version remains separate. Reused locks still require publisher review and a real isolated hosted installation.

The source bundle records actual input hashes, source/package/lock/tool versions, dependency/icon/native-CSS inventory anchors, and the original hook's sourcemap text. Direct custom Less compilation was removed. Native compiler source review now establishes `dist/css/arco.min.css` as the full output and an exact 678-file generation contract, including 390 byte-identical raw Less/plugin copies. Build still requires publisher approval and genuine output anchors. CSS requiring external imports or URL resources is rejected. esbuild defines only the exact literal `process.env.NODE_ENV="production"`.

## Fresh phase anchors and observed native precedent

The new inactive `prepare.mjs`, `phase.mjs`, and `input-inventory.py` reuse the native auditor's full-file inventory design. Before install, no generated/dependency input is allowed; post-install allows only `node_modules/`; post-icon adds only the two exact icon roots; post-CSS adds only an audited exact file list. Anchors are created exclusively at the successful producing stage, never overwritten. Every later phase fully rehashes those inputs and binds the anchor to exact source/tree/lock, manifest, run/attempt, producing command record and log. Symlinks must stay inside their corresponding allowed root; CSS outputs cannot be symlinks. Drift retains deltas/logs and blocks progress. Source blob and mode checks remain separate and strict.

Preparation records the actual command, selected environment, tool versions/hashes, real exit, raw log hash, exact source identity, current run/attempt/validation commit, and the hash of its successful predecessor phase. Every successful source/inventory phase gets an immutable receipt linking those files and the preceding phase. Failed commands retain their real logs/exits and a rejected post-stage attempt; they receive no successful post-stage receipt, and source/inventory diagnostics after that failed producer are not claimed. No generated dependency/icon/CSS file is copied from historical evidence into a fresh source checkout.

## Final evidence contract (independent audit repairs)

The independent audit found two real false-acceptance paths in the earlier draft: final verification could omit the build/input/exit chain, and a standalone post-install anchor could relabel an old producer as current. Original probes remain unchanged. The same reviewer independently passed the repaired pure-validator contract: eight test groups, one complete pair positive plus 40 rejected pair mutations, one phase positive plus 11 rejected phase mutations, and an independent positive plus five rejected re-signed counterexamples. That PASS does not claim a real build/browser result.

- `executionScope` now requires the exact current Git validation commit, frozen publication file hashes/sizes, actual current file bytes, approved repository/branch/event, exact runtime policy and lock hashes. A changed current runner cannot validate an old report. `publication-manifest.json` is an explicit remaining freeze gate; its own bytes are bound by the validation Git commit.
- Each producer binds current run/attempt/validation commit and the exact successful pre-stage receipt. Each immutable post-stage receipt binds producer command/log/exit and source/inventory results. All eleven phases must be present, ordered, successful and fresh within the eventual approved job-duration window. Old, skipped, copied or failed predecessors are rejected.
- `run-stage.mjs` owns build/browser invocation and captures the actual child-process exit independently of its report. Baseline browser exit 1, fixed exit 0, and unexpected exit 2 remain distinct. The wrapper creates post-stage evidence only after capturing the exit; its own outcome is also required.
- The final verifier walks the complete chain, recomputes anchor entry counts/digests, checks current anchored input bytes, validates package/tool metadata, rehashes retained and served build artifacts, checks original hook sourcemap text, and compares the report with the actual build record. It then reclassifies exact browser semantics and hashes every screenshot/trace. Two matching self-reports are insufficient.
- A successful verdict includes hashes for the evidence files it verified. Installation/build/browser exceptions or missing chain files cannot be converted into expected baseline red.

The local runtime freeze includes separate native/harness runtime binary hashes, expected Chromium version and an approved maximum evidence age tied to the workflow timeout. This is a CI evidence-freshness gate, not a product test or a background monitoring schedule. Actual execution remains exclusively controlled by the publisher; nothing has been published or run here.

Hosted native v1 precedent, independently readable in the supplied artifacts: both sides had clean post-install, post-icon and post-focused tracked trees; matching 63,618-entry dependency SHA-256 `efc5394b04052747ad61f8acf73a7c612348fe535c07f8590783584210dc09a0`; 284 ES icon entries at `7d88ed2d45a47af4416522ae2ada5584e28dfa37215a9d6e6f79bf6dd0f64fbb`; and 284 CJS icon entries at `467266d159e383a03061a7d849c0782de57833cb6008cb47b819826e5d66af6f`. These are historical observations, not fabricated fresh anchors. The native baseline includes the regression tests; the browser baseline remains the exact pristine base tree identified above.

## Small official GitHub Actions plan, after native baseline and audit

1. A dedicated validation branch in `dvd233/arco-design`, with exact repository ID, owner ID, and `refs/heads/validation/slider-negative-marks` checked for both push and workflow_dispatch. No pull_request or pull_request_target trigger.
2. `permissions: contents: read`; checkout credentials not persisted; no user secrets, personal/private files, external service tokens, write-scope jobs, comments, PR creation, deploy, or publication step. Pin only official `actions/checkout`, `actions/setup-node`, and `actions/upload-artifact` by full audited commit. Reverify official refs before freezing; earlier TDesign action pins are background, not new verification here.
3. Fetch exact public source baseline/candidate commits. Check target tree, exact patch and files before source execution. Record validation commit/run ID/attempt and package/lock metadata.
4. Install the locked harness, then prepare baseline **followed by** candidate. Use the repository-pinned Yarn and frozen source lock. Build/source generation runs sequentially to avoid the earlier parallel-memory failure mode. Run source gates before install, after install, after generation/build, after harness build, and after browser runs. Preserve every failure log and process exit.
5. If build-only checks have not already been possible, perform them here first. Direct-source esbuild compilation validates this harness; it does not substitute for the project's native build or native test gate. Keep the separate native baseline and fixed results explicit.
6. Install the harness-pinned official Playwright Chromium. Use normal Chromium sandboxing, `chromiumSandbox: true`; no no-sandbox flags, tunnels, external listeners, or security-setting changes. A local loopback static server is created only inside the approved hosted Actions job; requests are allowlisted to generated fixture files and the browser rejects requests to other origins.
   The page includes one fixed, empty inline SVG favicon so Chromium does not need a `/favicon.ico` request. The document hash binds it. No HTTP/console failure is ignored and the server asset allowlist is unchanged.
7. Run both identical browser scenarios, record actual exit codes, and verify they match reports. Preserve screenshots at ready and every checkpoint, per-scenario traces and SHA-256 hashes, actual callback/key/value payload JSON, build/input metadata and sourcemaps, package/lock hashes, source state, runtime/browser versions, and install/build/native/browser logs.
8. `verify-pair.mjs` reclassifies both complete reports, rehashes every image/trace, checks exact source and same harness/dependency versions, and binds the final verdict to this run/attempt/validation commit. Upload an explicit evidence allowlist even on failure. A green job without this fresh verdict is insufficient.

## Runnable commands once prerequisites are approved and frozen

Install the reviewed existing locks only under the later authorized hosted route (`npm ci` for the harness and `npm ci --prefix toolchain --ignore-scripts` for Yarn). Then, from this package:

```sh
npm run check
node scripts/prepare.mjs --source work/baseline --variant baseline --native-node /approved/pinned/node16/bin/node --through css
node scripts/prepare.mjs --source work/fixed --variant fixed --native-node /approved/pinned/node16/bin/node --through css
node scripts/run-stage.mjs --stage build --source work/baseline --variant baseline
node scripts/run-stage.mjs --stage build --source work/fixed --variant fixed
# All producer commands are hosted-CI only and reject the current draft manifest.
node scripts/run-stage.mjs --stage browser --source work/baseline --variant baseline
node scripts/run-stage.mjs --stage browser --source work/fixed --variant fixed
node scripts/verify-pair.mjs --baseline evidence/baseline --fixed evidence/fixed --out evidence/VERDICT.json
```

The validator tests are explicitly synthetic unit/counterexample tests, not screenshots, Chromium traces or evidence that Slider works. Only these dependency-free validators and syntax parsers were run under the later explicit authorization. Logs and positive/negative contract results are in `evidence/synthetic-tests/`. No producer, dependency install, esbuild, native build, listener or browser code was invoked by those tests.

## Remaining work and stopping conditions

- Retain corrected native focused/full-index results and obtain applicable native build/full-repository checks separately; they do not replace browser validation.
- Publisher approves the browser approach and exact public files. Candidate commit/tree/files are now bound to the verified publication above; copy and verify the approved patch, materialize both exact source commits, and confirm clean source gates.
- Package-lock gate: review the statically reused harness and byte-identical Yarn toolchain locks, then perform genuine hosted installs. No new install has been claimed; historical graph identity is not proof of a fresh installation.
- Runtime gate: preserve native Node 16.20.2/Yarn 1.22.22 and freeze the separate modern harness Node, installed esbuild/Playwright, and official Chromium binary. Freeze execution repository ID/owner ID, approved validation branch, and official action commits. These exact fields are now populated in the local candidate; the hosted job must independently confirm them.
- CSS gate: publisher reviews the now source-bound `css-source-audit.json`, exact output list and plugin/package-resolution checks. State is still `source-reviewed-pending-publisher-audit`; no native CSS output has been generated here and no wildcard has replaced the exact file list.
- Build-only gate: source dependencies and official icon generation are not prepared here; baseline and candidate direct-source builds have not run. Perform them sequentially only after publisher authorization, with complete before/after source gates, real input/sourcemap provenance, original source CSS, and failure logs. These builds do not replace native test/build results.
- Add a small exact-scope workflow and source-preparation steps, audit them, run syntax/classifier/source-guard counterexample tests, and perform actual sequential build-only checks when permitted.
- Verify the source-derived baseline trace expectations against actual hosted Chromium, preserving discrepancies as failures. Do not relabel an unexpected failure as expected red or quietly alter the specification.
- Browser verification is complete only with actual-source baseline exact red, candidate green, all 19 scenarios complete, expected disabled/ordinary controls intact, unchanged source gates, fresh pair verdict, and complete hashed evidence. Otherwise stop at the precise actionable blocker and retain NOT RUN/failed distinctions.

## Additional static preparation findings, not executed

- The initial byte-for-byte full-index diff comparison was incompatible with the frozen abbreviated-index patch. It has been replaced with the private-index/private-object-store reconstruction above, preserving the approved patch digest. The formerly unexecuted validator cases have now passed authorized pure-validator runs and the same independent reviewer's final recheck. Those synthetic results cover abbreviated-index success, wrong/unapplicable patches and source-index/worktree non-mutation; they are not product/browser execution.
- Source materialization must include the candidate's publisher/baseline objects (for example, fetch the exact candidate plus its verified sole publisher), not an insufficient one-commit shallow checkout. Patch reconstruction fails closed if those objects are missing.
- Producer wrappers remain unexecuted. The strengthened pure validators have complete synthetic positive-chain and negative cross-binding tests; the same independent reviewer must recheck the repaired false-acceptance probes before freeze. This does not authorize running wrappers or publishing the package.
- Official `yarn icon` rewrites four tracked files (`icon/index.js`, `icon/index.es.js`, `icon/index.d.ts`, `icon/demo.js`) as well as the generated roots. They must retain their committed bytes; generation drift is a setup failure. The separate native CI already preserves this strict gate; reuse its verified outcome/procedure instead of resetting files or expanding allowed source changes.
- The direct Less path has been removed. Verified original compiler bytes are now available and were inspected; `CSS_SOURCE_GATE.md` records the native dispatch/config/output behavior and the remaining publisher/build gates. Native compiler error swallowing and parallel dist scheduling are treated as risks requiring fresh outputs and logs, not as proof of an observed failure.
- No install, native/harness build, browser or listener was run for this refinement. Authorized dependency-free validator tests and syntax checks are separately recorded; they do not clear the pending real execution gates.

## Proposed public-file scope

Only `.gitignore`, `README.md`, `CSS_SOURCE_GATE.md`, `css-source-audit.json`, `LOCK_PROVENANCE.json`, `package.json`, `package-lock.json`, `toolchain/package.json`, `toolchain/package-lock.json`, `source-manifest.json`, the later exact `candidate.patch`, `harness/`, `scripts/`, `tests/`, the later audited workflow/publication manifest, and action/version lock metadata are eligible for the publisher to consider. No surrounding research directory, dependency tree, local source checkout, installation cache, raw connector result, synthetic fixture directory, or private note should be uploaded. Freeze the exact file/hash/size allowlist after all revisions; this document is not upload authorization.


## Minimal publication handoff

The same-day official action pins, source-compatible Node 16.20.2, harness Node 22.23.3, and locked Playwright Chromium revision 1194 / version 141.0.7390.37 have concrete read-only provenance in actions-lock.json and the review-only runtime-freeze-draft.json. Runtime binary candidates must match the independent setup-node installations in the real job. The workflow uses the already proven Ubuntu 22.04 sandboxed-browser route, preserves the original native/CSS commands, builds baseline then candidate serially, and only then installs/launches Chromium.

The publisher must first bind the latest verified source-only commit/tree/direct parent/test hash and complete baseline-to-candidate patch. The bound format-only successor has an intermediate parent, so candidate checkout depth is three; the behavioral baseline remains the original main commit. Then approve the already reviewed runtime/identity/CSS static contract in source-manifest.json and run the data-only scripts/freeze-publication.py with --expected-candidate set explicitly to that verified new commit. It emits the exact allowlist, publication-manifest.json, GitData tree payload and expected Git tree under evidence/publication-freeze/. It never installs, builds, executes a browser, publishes or chooses a remote commit parent.

PUBLICATION_ALLOWLIST.json and runtime-freeze-draft.json are local review aids, excluded from the published tree. The publisher alone verifies the current remote ref, uses a non-forced appropriate parent, verifies the resulting tree/commit, and starts the reviewed workflow. Successful static CSS approval authorizes testing the contract; it does not claim that real CSS or browser gates already passed.
