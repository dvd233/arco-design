# Independent native-quality extension (draft, not executed)

This v3 validation-only bundle adds a separate `native-quality` job after `native-dom` in the same exact own-fork workflow/ref. The original native driver, parser, tests, patches, source freeze and toolchain files are unchanged. Its successful v2 hosted run was [37486928843](https://github.com/dvd233/arco-design/actions/runs/37486928843): the candidate's original Slider index had 44 passing tests and four unchanged snapshots. That earlier evidence does not establish any of the new quality gates below.

All new native installs, configuration captures, lint/format/type checks, builds, expanded/aggregate suites and CSS generation are **NOT RUN** during preparation. Only syntax checks and dependency-free synthetic guards/classifiers have been exercised locally. New independent review is required before publication. No browser validation, release, merge or deployment is claimed.

## Frozen inputs and stage separation

- Candidate: `2bbbbed7f1add2b25e35bb290f4eaf7e54f5dc65`, tree `0a9a01536e61e5119f753f972e71967ac251f9c9`, sole parent below.
- Pristine comparator: `c2b050d9c7ce94bebba94f616a0721344231caac`, tree `51f988b198e24b8ea898e5803cfa0698280a1ef7`.
- Fresh independent `quality-candidate` and `quality-baseline` checkouts. The quality baseline never applies the native behavioral regression-test patch. No earlier source, dependency or build artifacts are downloaded or reused.
- Ubuntu 24.04, Node 16.20.2, locked Yarn 1.22.22; frozen root and site installs with install scripts disabled. Original `yarn icon` is explicit. Browser-download suppression is active.
- Build `NODE_ENV` and all `BUILD_ENV_*` overrides are absent. Tests/config use explicit `NODE_ENV=test`. Native CSS defaults to production minification when `BUILD_ENV_MODE` is absent. Hooks' original `npx tsc` resolves the installed root compiler, with npm offline mode during builds.
- Source-local root/site dependency inventories remain separate and immutable. The metadata observer records root/nested TypeScript, node-typescript-compiler, root ESLint/Prettier/Jest/React and site dependency paths/versions. It verifies the exact inspected Arco tooling hashes without loading product/package JavaScript.

## Serial hosted gates

1. Frozen root and site dependencies; exact runtime/tooling metadata.
2. Original client and node `--showConfig` and unfiltered `--listTests`, plus root `tsc --showConfig`. Raw wrapper output and parsed JSON are both retained. Jest caches live outside source.
3. Direct pinned ESLint on the two changed files, without fixing/caching/quiet or warning overrides; pinned Prettier `--check` on those same files.
4. Original icon generation, then root `tsc -p tsconfig.json --noEmit --pretty false`. The checked-in tsconfig excludes test files; this is source typechecking, not a test-file typecheck.
5. Original `yarn build:cjs`, then `yarn build:es`, including their native hooks builds. Require nonempty component/hook entry and Slider outputs, plus ES declarations. Preserve raw compiler diagnostics even when an upstream driver exits zero.
6. Original `yarn build:css` as a distinct CSS-output gate for the separate browser plan. It produces the full native `dist/css/arco.min.css`; it does not run a browser. The exact static contract admits 678 CSS output paths and checks 390 byte-identical raw Less/color-plugin copies. Only six source-derived outputs may be empty: `Icon/style/css.js`, `Watermark/style/index.css` and `style/mixins/index.css` under each of `es/` and `lib/`. Each must match the empty-file SHA-256; the first starts from a zero-byte TS entry, and the Less entries only define variables or uncalled mixins. CJS/ES outputs outside this exact CSS list cannot change. No source assets exist in the frozen tree, so no `dist/asset` files are admitted. A successful hosted gate copies the original CSS bytes and source/dependency/pre/post hash provenance to the evidence artifact.
7. Original client runner on both Slider index and demo files, with native coverage enabled: expected candidate 59 cases, pristine base 37 cases, and 19 existing snapshots in either. Exact assertion names, selected files and snapshot keys must agree with the frozen inventory.
8. Original full configured client and full configured node suites, unfiltered and serial, with `--runInBand --ci --json`. Client coverage stays enabled; node keeps its native demo/SSR selection and `--silent=false`. No snapshot updates, replacement config, force-exit, pass-with-no-tests, coverage suppression or test-timeout changes.

ES/CJS are not full release/package builds. Node demo/SSR coverage is not a Slider keyboard index run. CSS generation does not prove focus, visual, accessibility or browser behavior.

## Integrity and evidence

`quality-integrity.py` reuses only the original helper's hashing/Git primitives, never its injected-baseline preparation. Every command has an exact argv/cwd/whitelisted-environment record, raw combined log, original process exit and logger exit. Complete tracked-source SHA-256 inventory and exact Git tree are checked before/after stages. All ignored/untracked files, symlink targets and generated outputs are inventoried. Escaping symlinks, unexpected roots, source/lock/snapshot drift, dependency changes and mutation of previously anchored outputs fail closed; files are never reset to conceal drift.

Writer boundaries are root install, site install, icon, CJS, ES, CSS, Slider client coverage and full client coverage. All other stages are read-only with respect to source-local inputs/outputs. CSS can only touch the exact compiler-derived output list, not all of `es/`, `lib/` or `dist/`. Tests freeze dependencies, icons and builds. The node stage must preserve previous client coverage. Each client coverage directory is copied separately into stage evidence before another client stage can overwrite it, with a complete-copy inventory. A passing client stage requires valid nonempty JSON/summary/LCOV/Clover/HTML coverage reports and nonzero instrumented statements.

The isolated Yarn toolchain and publication allowlist/hashes are checked around each stage. Outputs under `bundle/evidence/quality/` retain full writer inventories, deltas, source diffs, config/test lists, raw Jest JSON, exact selected/executed case inventories, skipped/todo cases, coverage copies, compiler source bytes and a complete stage classification.

The job has a 180-minute cap and a 165-minute command budget, leaving room for final guards and always-on artifact upload. Per-command timeouts are 2–40 minutes according to phase. Timeout, termination, missing JSON, incomplete comparator, logging failure or source drift is unresolved, never a pass. Budget clipping is recorded. Operations are serial with a 4 GiB Node heap ceiling and independent source/stage caches.

## Pristine failure comparisons and truthful status

Any abnormal candidate gate requests a fresh pristine-base comparison with the same policy/prerequisites. Only candidate-failing test gates trigger corresponding full baseline suite runs; a failed full suite is never replaced by a filtered rerun. Independent node evidence is still collected after a client failure if its source/setup/build prerequisites remain sound.

A stage may be passed, failed, blocked, timed out or not run. Process status is separate from evidence validation and classification. Reproduction requires matching source-default config, runtime, command/resources, baseline prerequisites and exact path/title/error or snapshot failure. Only checkout prefixes and recognizable elapsed-time lines are normalized. The root-derived Jest project name is canonicalized only after verifying its exact locked-algorithm value, `md5(rootDir + "0")`, against source-bound Jest code; raw evidence remains intact. Different, missing or incomplete baseline failures stay unresolved. Jest reproduction also conservatively requires normalized raw-log equality to avoid hiding extra coverage/runtime failures; benign progress/count differences can therefore leave a genuine existing failure unresolved. Existing failures remain failed gates and keep the aggregate job red. Candidate-only failures block readiness.

Publication changes are confined to the appended workflow job, quality scripts/manifests/tests and documentation/manifest metadata. The source candidate commit and original native proof machinery are unchanged. No private preparation notes, connector responses or local runner outputs belong in this publication tree.
