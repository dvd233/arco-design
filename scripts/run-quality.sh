#!/usr/bin/env bash
# Hosted-only proposal. Native installs/builds/tests have NOT been executed locally.
set -Eeuo pipefail
BUNDLE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE="$BUNDLE/evidence/quality"
mkdir -p "$EVIDENCE"
if [[ "${GITHUB_REPOSITORY:-}" != 'dvd233/arco-design' ||
      "${GITHUB_REPOSITORY_ID:-}" != '1407419356' ||
      "${GITHUB_REPOSITORY_OWNER_ID:-}" != '111864431' ||
      "${GITHUB_REF:-}" != 'refs/heads/validation/slider-negative-marks-native' ||
      ! "${GITHUB_EVENT_NAME:-}" =~ ^(push|workflow_dispatch)$ ]]; then
  echo 'Restricted to the exact authorized own-fork repository and validation ref.' >&2
  exit 1
fi
# Reject inherited build-selection overrides instead of quietly choosing another compiler.
if env | grep -q '^BUILD_ENV_' || [[ -n "${NODE_ENV:-}" || -n "${NODE_OPTIONS:-}" ]]; then
  echo 'Unexpected native compiler/runtime environment override.' >&2
  exit 1
fi
export CI=true TZ=Asia/Singapore FORCE_COLOR=0 GIT_TERMINAL_PROMPT=0 HUSKY=0
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=true
export NODE_OPTIONS='--max-old-space-size=4096'
export QUALITY_TMP="$RUNNER_TEMP/arco-quality-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
mkdir -p "$QUALITY_TMP"
export npm_config_cache="$QUALITY_TMP/npm-cache"
YARN="$BUNDLE/toolchain/node_modules/yarn/bin/yarn.js"
HELPER="$BUNDLE/scripts/quality-integrity.py"
STAGES=(root-install site-install runtime client-show-config node-show-config client-list node-list
  types-show-config changed-eslint changed-prettier icon source-types build-cjs build-es build-css
  slider-client full-client full-node)
F1='components/Slider/hooks/useLegalValue.ts'
F2='components/Slider/__test__/index.test.tsx'
# 165-minute command budget reserves 15 minutes under the 180-minute job cap for audits/upload.
DEADLINE=$((SECONDS + 9900))
finalize() {
  local original=$?
  trap - EXIT
  set +e
  python3 "$BUNDLE/scripts/integrity.py" publication > "$EVIDENCE/publication-final.log" 2>&1 || original=1
  python3 "$HELPER" toolchain "$EVIDENCE" check > "$EVIDENCE/toolchain-final.log" 2>&1 || original=1
  printf '%s\n' "$original" > "$EVIDENCE/driver.exit-code"
  node "$BUNDLE/scripts/classify-quality.cjs" --evidence "$EVIDENCE" \
    --expectations "$BUNDLE/quality-expectations.json" --output "$EVIDENCE/classification.json" \
    > "$EVIDENCE/classification.log" 2>&1
  local classified=$?
  cat "$EVIDENCE/classification.log"
  [[ "$original" == 0 && "$classified" == 0 ]] || exit 1
}
trap finalize EXIT
python3 "$HELPER" plan "$EVIDENCE"
python3 "$BUNDLE/scripts/integrity.py" publication > "$EVIDENCE/publication-initial.log" 2>&1
[[ "$(node --version)" == v16.20.2 ]]
node --version > "$EVIDENCE/node-version.log"
npm --version > "$EVIDENCE/npm-version.log"
set +e
timeout --kill-after=30s 300s npm ci --prefix "$BUNDLE/toolchain" --ignore-scripts --no-audit --no-fund \
  2>&1 | tee "$EVIDENCE/toolchain-install.log"
setup_codes=("${PIPESTATUS[@]}")
set -e
printf '%s\n' "${setup_codes[0]}" > "$EVIDENCE/toolchain-install.exit-code"
printf '%s\n' "${setup_codes[1]}" > "$EVIDENCE/toolchain-install.logger-exit-code"
[[ "${setup_codes[0]}" == 0 && "${setup_codes[1]}" == 0 ]]
[[ "$(node "$YARN" --version)" == 1.22.22 ]]
node "$YARN" --version > "$EVIDENCE/yarn-version.log"
python3 "$HELPER" toolchain "$EVIDENCE" anchor > "$EVIDENCE/toolchain-anchor.log"
export PATH="$BUNDLE/toolchain/node_modules/.bin:$PATH"
declare -A RESULT=() REQUESTED=()
write_status() {
  python3 "$HELPER" status "$E" "$1" "$variant" "$2" "$3" "$4" "$5" "$6" "$7"
}
# Return 2 on integrity/evidence failure; 1 on native gate failure; 0 on a complete pass.
run_stage() {
  local stage="$1" cap="$2" cwd="$3"; shift 3
  local process=0 logger=0 pre=0 post=0 validation=0 remaining effective
  remaining=$((DEADLINE - SECONDS))
  if ((remaining < 60)); then
    write_status "$stage" null null 1 null null false
    RESULT["$variant:$stage"]=blocked
    return 1
  fi
  effective="$cap"; ((remaining >= cap)) || effective="$remaining"
  python3 "$BUNDLE/scripts/integrity.py" publication > "$E/$stage.publication-pre.log" 2>&1 || pre=1
  python3 "$HELPER" toolchain "$EVIDENCE" check > "$E/$stage.toolchain-pre.log" 2>&1 || pre=1
  python3 "$HELPER" audit "$variant" "$source" "$E" "$stage" pre > "$E/$stage.pre.log" 2>&1 || pre=1
  if [[ "$pre" != 0 ]]; then
    write_status "$stage" null null "$pre" null null false
    RESULT["$variant:$stage"]=blocked
    return 2
  fi
  remaining=$((DEADLINE - SECONDS))
  if ((remaining < 60)); then
    write_status "$stage" null null 1 null null false
    RESULT["$variant:$stage"]=blocked
    return 1
  fi
  effective="$cap"; ((remaining >= cap)) || effective="$remaining"
  python3 "$HELPER" command "$E" "$stage" "$cwd" "$cap" "$@" || return 2
  printf '%s\n' "$effective" > "$E/$stage.effective-timeout-seconds"
  set +e
  (cd "$cwd" && timeout --kill-after=30s "${effective}s" "$@") 2>&1 | tee "$E/$stage.log"
  local codes=("${PIPESTATUS[@]}")
  set -e
  process="${codes[0]}"; logger="${codes[1]}"
  printf '%s\n' "$process" > "$E/$stage.exit-code"
  printf '%s\n' "$logger" > "$E/$stage.logger-exit-code"
  python3 "$HELPER" audit "$variant" "$source" "$E" "$stage" post > "$E/$stage.post.log" 2>&1 || post=1
  python3 "$BUNDLE/scripts/integrity.py" publication > "$E/$stage.publication-post.log" 2>&1 || post=1
  python3 "$HELPER" toolchain "$EVIDENCE" check > "$E/$stage.toolchain-post.log" 2>&1 || post=1
  python3 "$HELPER" validate "$source" "$E" "$stage" > "$E/$stage.metadata-validation.log" 2>&1 || validation=1
  if [[ "$stage" == slider-client ]]; then
    python3 "$HELPER" snapshot-keys "$source" "$E" || validation=1
  fi
  if [[ "$stage" == slider-client || "$stage" == full-client ]]; then
    python3 "$HELPER" coverage "$source" "$E" "$stage" || validation=1
  fi
  if [[ "$stage" == slider-client || "$stage" == full-client || "$stage" == full-node ]]; then
    node "$BUNDLE/scripts/classify-quality.cjs" --evidence "$EVIDENCE" \
      --expectations "$BUNDLE/quality-expectations.json" --stage "$stage" --variant "$variant" \
      --output "$E/$stage.validation.json" > "$E/$stage.validation.log" 2>&1 || validation=1
  fi
  if [[ "$stage" == build-css && "$process" == 0 && "$post" == 0 && "$validation" == 0 ]]; then
    python3 "$HELPER" css-deliverable "$source" "$E" || validation=1
  fi
  write_status "$stage" "$process" "$logger" "$pre" "$post" "$validation" true
  if [[ "$pre" != 0 || "$post" != 0 || "$logger" != 0 ]]; then
    RESULT["$variant:$stage"]=failed
    return 2
  fi
  if [[ "$process" != 0 || "$validation" != 0 ]]; then
    RESULT["$variant:$stage"]=failed
    return 1
  fi
  RESULT["$variant:$stage"]=passed
  return 0
}
run_variant() {
  local variant="$1" stage rc=0 fatal=0 deps=1 icons=1 builds=1 configs=1
  local source="$GITHUB_WORKSPACE/quality-$variant" E="$EVIDENCE/$variant" T="$QUALITY_TMP/$variant"
  mkdir -p "$E" "$T" "$T/tmp"
  export XDG_CACHE_HOME="$T/cache" TMPDIR="$T/tmp"
  python3 "$HELPER" prepare "$variant" "$source" "$E" > "$E/prepare.log" 2>&1 || return 2
  for stage in "${STAGES[@]}"; do
    # Baseline comparison only runs requested failed test gates; setup/builds are fresh prerequisites.
    if [[ "$variant" == baseline && "$stage" =~ ^(slider-client|full-client|full-node)$ && "${REQUESTED[$stage]:-}" != yes ]]; then
      continue
    fi
    if [[ "$fatal" == 1 || ( "$stage" != root-install && "$deps" == 0 ) ||
          ( "$stage" =~ ^(source-types|build-cjs|build-es|build-css|slider-client|full-client|full-node)$ && "$icons" == 0 ) ||
          ( "$stage" =~ ^(build-es|build-css|slider-client|full-client|full-node)$ && "$builds" == 0 ) ||
          ( "$stage" =~ ^(slider-client|full-client|full-node)$ && "$configs" == 0 ) ]]; then
      write_status "$stage" null null 1 null null false
      RESULT["$variant:$stage"]=blocked
      continue
    fi
    rc=0
    case "$stage" in
      root-install) run_stage "$stage" 1200 "$source" node "$YARN" install --frozen-lockfile --non-interactive --ignore-scripts --production=false --cache-folder "$T/yarn-root" || rc=$? ;;
      site-install) run_stage "$stage" 1200 "$source/site" node "$YARN" install --frozen-lockfile --non-interactive --ignore-scripts --production=false --cache-folder "$T/yarn-site" || rc=$? ;;
      runtime) run_stage "$stage" 120 "$source" node "$BUNDLE/scripts/inspect-quality-runtime.cjs" "$source" "$E" || rc=$? ;;
      client-show-config|node-show-config)
        run_stage "$stage" 120 "$source" env NODE_ENV=test node "$YARN" "test:${stage%%-*}" --showConfig --json --runInBand --ci --cacheDirectory="$T/jest-$stage" || rc=$? ;;
      client-list|node-list)
        run_stage "$stage" 300 "$source" env NODE_ENV=test node "$YARN" "test:${stage%%-*}" --listTests --json --runInBand --ci --cacheDirectory="$T/jest-$stage" || rc=$? ;;
      types-show-config) run_stage "$stage" 120 "$source" node node_modules/typescript/bin/tsc --showConfig -p tsconfig.json || rc=$? ;;
      changed-eslint) run_stage "$stage" 300 "$source" node node_modules/eslint/bin/eslint.js --no-fix --no-cache --format json --output-file "$E/changed-eslint.json" "$F1" "$F2" || rc=$? ;;
      changed-prettier) run_stage "$stage" 120 "$source" node node_modules/prettier/bin-prettier.js --config .prettierrc --check "$F1" "$F2" || rc=$? ;;
      icon) run_stage "$stage" 300 "$source" node "$YARN" icon || rc=$? ;;
      source-types) run_stage "$stage" 600 "$source" node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --pretty false || rc=$? ;;
      build-cjs) run_stage "$stage" 900 "$source" env npm_config_offline=true node "$YARN" build:cjs || rc=$? ;;
      build-es) run_stage "$stage" 900 "$source" env npm_config_offline=true node "$YARN" build:es || rc=$? ;;
      build-css) run_stage "$stage" 900 "$source" env npm_config_offline=true node "$YARN" build:css || rc=$? ;;
      slider-client) run_stage "$stage" 1200 "$source" env NODE_ENV=test node "$YARN" test:client --runTestsByPath "$F2" components/Slider/__test__/demo.test.ts --runInBand --ci --json --cacheDirectory="$T/jest-$stage" --outputFile="$E/$stage.jest.json" || rc=$? ;;
      full-client) run_stage "$stage" 2400 "$source" env NODE_ENV=test node "$YARN" test:client --runInBand --ci --json --cacheDirectory="$T/jest-$stage" --outputFile="$E/$stage.jest.json" || rc=$? ;;
      full-node) run_stage "$stage" 1800 "$source" env NODE_ENV=test node "$YARN" test:node --runInBand --ci --json --cacheDirectory="$T/jest-$stage" --outputFile="$E/$stage.jest.json" || rc=$? ;;
    esac
    [[ "$rc" != 2 ]] || fatal=1
    if [[ "$rc" != 0 ]]; then
      [[ "$variant" != candidate ]] || REQUESTED["$stage"]=yes
      case "$stage" in root-install|site-install|runtime) deps=0;; icon) icons=0;; build-cjs|build-es) builds=0;; *show-config|*-list) configs=0;; esac
    fi
  done
  python3 "$HELPER" audit "$variant" "$source" "$E" final pre > "$E/final.log" 2>&1 || return 2
}
VARIANT_FAILURE=0
run_variant candidate || { REQUESTED[prepare]=yes; VARIANT_FAILURE=1; }
if ((${#REQUESTED[@]})); then run_variant baseline || VARIANT_FAILURE=1; fi
# Final classifier is authoritative; any abnormal candidate gate keeps the aggregate job red.
exit "$VARIANT_FAILURE"
