# Native CSS source review and remaining gate

Status: static source contract reviewed and approved for the local executable candidate; fresh browser-job build still pending. No package was installed and no native compiler was executed for this review.

## Verified source provenance

The implementation worker retrieved the official arco-scripts@1.27.14 tarball read-only. Its SHA-512 matches the frozen source Yarn lock and registry metadata. All 33 extracted compiler/CLI JavaScript files match the real hosted native-v1 dependency inventory byte for byte. css-source-audit.json records the official archive URL/integrity, archive SHA-256, those 33 file hashes plus package metadata, frozen source inputs, native command, and exact statically derived output list.

## Original command and configuration

- Repository yarn build:css → arco-scripts build:component:css → CLI component.buildCSS() → compileStyle.build().
- Native constants set output roots to es, lib, and dist. Default CSS dist path is dist/css; raw filename is index.less. The tracked project override changes the final CSS filename to arco.min.css. The full browser stylesheet is therefore dist/css/arco.min.css.
- The override sets source watch patterns to components/**/*.{less,woff,woff2,png,jpg} and components/style/theme/color/*.js, both with base components.
- The compatibility proxy maps config.less to config.css only. The repository's legacy config.less.cssJsEntry assignment is not consumed by the native style-entry generator; jsEntry.entry remains src/style/index.ts plus components/*/style/index.ts. autoInjectArcoDep=false; rename, extra-data and hook options remain unused.
- Native Less uses gulp-less, paths: ['node_modules'], npm-import and autoprefix plugins, relativeUrls: true, and javascriptEnabled: true. The three source color plugins are copied unchanged into es/lib and require @arco-design/color. Complete dependency inventories and before-command resolution metadata bind these package inputs. The harness no longer supplies a separate Less compiler.
- Native BUILD_ENV_* variables remain unset. The inspected compiler treats absence of BUILD_ENV_MODE as production for CSS minification. Inherited BUILD_ENV_* / NODE_PATH / NODE_OPTIONS overrides are removed, and the CSS environment override object is explicitly empty. Source install/icon steps use the hosted-established Node 16.20.2 and Yarn 1.22.22.

## Exact static output contract

Derived only from original compiler rules and the fixed Git-tree file inventory:

- 192 Less source files copied to each of es and lib
- 3 color plugin JavaScript files copied to each output root
- 73 index.less entries compiled to corresponding index.css in both roots
- 70 one-level component style TypeScript entries transformed to style/css.js in both roots
- dist/css/index.less and dist/css/arco.min.css

Total: 678 expected files. Of these, 390 must be byte-identical raw Less/plugin copies of committed source. The frozen tree has no src/ files and no matching source image/font/SVG assets, so no dist/asset files are expected. The manifest enumerates every output path individually; no output-directory wildcard is approved. The JSON audit records each raw copy's source path and SHA-256.

The independently reviewed quality contract permits exactly six empty outputs, each bound to the empty SHA-256: Icon/style/css.js, Watermark/style/index.css and style/mixins/index.css under both es/ and lib/. Their sources are respectively an empty style entry, theme definitions without selectors, and an uncalled mixin. The browser audit mirrors that exact exception list; every other CSS output must be nonempty. Output paths and raw-copy mappings remain unchanged.

The browser consumes the full native stylesheet. es/Slider/style/index.css alone would omit global, Input, InputNumber and Tooltip dependencies included by the original Slider style entry.

## Runtime risks that still require real evidence

Native compiler handlers can log failures instead of yielding a simple nonzero process result. The draft retains the original exit code/log and additionally rejects known native failure diagnostics or a missing success marker. It requires every exact output, all raw-copy hashes, nonempty full CSS with expected component selectors, and unchanged source/dependency/icon anchors. No success is inferred merely from exit 0.

distLess and distCss appear in the same parallel build stage. Their actual completion is not assumed from scheduling; the fresh complete output gate and subsequent bundle/browser checks must pass. No CSS command has run for this proposal, so the static output contract still requires actual build validation and parent review.

## Parent and hosted-build gates

1. Review css-source-audit.json, its exact 678-file contract, source/package bindings, native resolution metadata code, and new phase-anchor checks. The publisher approved audited-native-css for the static contract. That state does not claim a fresh build; publication and actual execution remain under the publisher's control.
2. Run original native preparation on fresh exact source, sequentially baseline then candidate, retaining commands, selected environment, tool/lock hashes, raw logs and actual exits. Never copy an old generated stylesheet, substitute released package CSS, reset generated tracked source, or relax output matching.
3. Post-CSS checks must freeze each actual output hash and verify all 390 raw copies, native package resolution, full dependency/icon inventories, and source blob/mode equality. Preserve failures and unexpected files.
4. Bundle a byte-identical copy of that run's full native CSS with the source-imported Slider. Record its producing command, path/hash, output inventory, CSS audit digest, and bundle hashes. Complete actual Chromium regression and pair evidence before reporting browser success.
