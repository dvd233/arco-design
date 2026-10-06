#!/usr/bin/env bash
# Proposed hosted execution only. This script has not been run during preparation.
set -Eeuo pipefail

BUNDLE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE="$BUNDLE/evidence"
mkdir -p "$EVIDENCE"

# Repeat the workflow guard before any dependency installation or source execution.
if [[ "${GITHUB_REPOSITORY:-}" != 'dvd233/arco-design' ||
      "${GITHUB_REPOSITORY_ID:-}" != '1407419356' ||
      "${GITHUB_REPOSITORY_OWNER_ID:-}" != '111864431' ||
      "${GITHUB_REF:-}" != 'refs/heads/validation/slider-negative-marks-native' ||
      ! "${GITHUB_EVENT_NAME:-}" =~ ^(push|workflow_dispatch)$ ]]; then
  echo 'This workflow is restricted to the exact authorized own-fork repository and branch.' >&2
  exit 1
fi

TMP="$RUNNER_TEMP/arco-slider-native-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
mkdir -p "$TMP"
YARN="$BUNDLE/toolchain/node_modules/yarn/bin/yarn.js"
export CI=true NODE_ENV=test TZ=Asia/Singapore FORCE_COLOR=0 GIT_TERMINAL_PROMPT=0
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=true HUSKY=0
export npm_config_cache="$TMP/npm-cache"

record() {
  local label="$1"
  shift
  local status=0
  # Capture the command's exit status, not tee's. Do not coerce expected red to green.
  set +e
  "$@" 2>&1 | tee "$EVIDENCE/$label.log"
  local pipe_status=("${PIPESTATUS[@]}")
  set -e
  status="${pipe_status[0]}"
  printf '%s\n' "$status" > "$EVIDENCE/$label.exit-code"
  if [[ "${pipe_status[1]}" != 0 ]]; then
    echo "Evidence logging failed for $label." >&2
    return 125
  fi
  return "$status"
}

check_publication() {
  record "$1" python3 "$BUNDLE/scripts/integrity.py" publication
}

check_source() {
  local variant="$1" phase="$2"
  record "$variant/$phase" python3 "$BUNDLE/scripts/integrity.py" audit \
    "$variant" "$GITHUB_WORKSPACE/$variant" "$EVIDENCE/$variant" "$phase"
}

check_publication publication-before || exit "$?"
record node-version node --version || exit "$?"
[[ "$(node --version)" == 'v16.20.2' ]] || { echo 'Unexpected Node version.'; exit 1; }
record npm-version npm --version || exit "$?"
record toolchain-install npm ci --prefix "$BUNDLE/toolchain" --ignore-scripts --no-audit --no-fund || exit "$?"
record yarn-version node "$YARN" --version || exit "$?"
[[ "$(node "$YARN" --version)" == '1.22.22' ]] || { echo 'Unexpected Yarn version.'; exit 1; }
check_publication publication-after-toolchain || exit "$?"

# Yarn's subprocess calls to `yarn` resolve only to the isolated, pinned CLI.
export PATH="$BUNDLE/toolchain/node_modules/.bin:$PATH"

run_variant() {
  local variant="$1" status=0 audit_status=0
  local source="$GITHUB_WORKSPACE/$variant"
  mkdir -p "$EVIDENCE/$variant"
  record "$variant/prepare" python3 "$BUNDLE/scripts/integrity.py" prepare \
    "$variant" "$source" "$EVIDENCE/$variant" || return "$?"
  check_source "$variant" pre-install || return "$?"
  cd "$source" || return "$?"
  record "$variant/install" node "$YARN" install --frozen-lockfile --non-interactive \
    --ignore-scripts --production=false --cache-folder "$TMP/yarn-$variant" || status=$?
  check_source "$variant" post-install || audit_status=$?
  [[ "$status" == 0 ]] || return "$status"
  [[ "$audit_status" == 0 ]] || return "$audit_status"
  check_publication "$variant/publication-after-install" || return "$?"

  check_source "$variant" pre-icon || return "$?"
  status=0
  audit_status=0
  record "$variant/icon" node "$YARN" icon || status=$?
  check_source "$variant" post-icon || audit_status=$?
  [[ "$status" == 0 ]] || return "$status"
  [[ "$audit_status" == 0 ]] || return "$audit_status"
  check_publication "$variant/publication-after-icon" || return "$?"

  # Preserve resolved versions/paths and the original runner's effective configuration.
  record "$variant/runtime" node "$BUNDLE/scripts/inspect-runtime.cjs" "$source" || return "$?"
  record "$variant/config" node "$YARN" test:client --showConfig --json \
    --runTestsByPath components/Slider/__test__/index.test.tsx || return "$?"
  check_source "$variant" post-config || return "$?"
  check_publication "$variant/publication-after-config" || return "$?"

  check_source "$variant" pre-focused || return "$?"
  # --runTestsByPath prevents other test files from being silently included.
  # The original Arco CLI, config, runtime source, test utilities and assertions remain intact.
  status=0
  audit_status=0
  record "$variant/focused" node "$YARN" test:client \
    --runTestsByPath components/Slider/__test__/index.test.tsx \
    --testNamePattern='^Slider onlyMarkValue keyboard navigation ' \
    --runInBand --collectCoverage=false --silent=false --ci --json \
    --cacheDirectory="$TMP/jest-$variant-focused" \
    --outputFile="$EVIDENCE/$variant/focused.jest.json" || status=$?
  check_source "$variant" post-focused || audit_status=$?
  [[ "$audit_status" == 0 ]] || return "$audit_status"
  check_publication "$variant/publication-after-focused" || return "$?"
  # A marker means invocation and integrity checks completed; it is not a pass claim.
  printf '%s\n' "$status" > "$EVIDENCE/$variant/focused-completed.exit-code"
  return 0
}

# Keep each variant independent, including installation and generated icons.
# Even a baseline setup failure does not prevent preserving candidate diagnostic evidence.
for variant in baseline candidate; do
  variant_status=0
  run_variant "$variant" || variant_status=$?
  printf '%s\n' "$variant_status" > "$EVIDENCE/$variant/stage.exit-code"
done

cd "$BUNDLE"
record classify-focused node "$BUNDLE/scripts/classify-results.cjs" focused || exit "$?"

# This is a separate, broader Slider-file stage, not an aggregate package green claim.
check_source candidate pre-full || exit "$?"
cd "$GITHUB_WORKSPACE/candidate"
full_status=0
record candidate/full node "$YARN" test:client \
  --runTestsByPath components/Slider/__test__/index.test.tsx \
  --runInBand --collectCoverage=false --silent=false --ci --json \
  --cacheDirectory="$TMP/jest-candidate-full" \
  --outputFile="$EVIDENCE/candidate/full.jest.json" || full_status=$?
check_source candidate post-full || exit "$?"
check_publication publication-after-full || exit "$?"
printf '%s\n' "$full_status" > "$EVIDENCE/candidate/full-completed.exit-code"
cd "$BUNDLE"
record classify-full node "$BUNDLE/scripts/classify-results.cjs" full
