#!/bin/bash
#
# This script is used to run end-to-end tests for the Colab VS Code extension.
#
# Usage:
#   ./scripts/test_e2e.sh [--headless] [--vsix=<path_to_vsix_file>] [--auth-driver:<args>...]
#
# Arguments:
#   - storage=<path>: Path to use for extest storage.
#   - headless: Run tests in headless mode using xvfb.
#   - vsix=<path_to_vsix_file>: Install the specified VSIX file before running tests.
#   - auth-driver:<args>: Pass additional arguments to the authentication driver.
#
# A couple ugly workarounds are made to have this script be portable to Mac which by default
# runs a very old version of bash:
#
# - `${var[@]+"${var[@]}"}` instead of simply `${var[@]}` over arrays that could be empty.
# - `IFS= read -r line` instead of `mapfile -t` to read lines into an array.

set -euo pipefail

STORAGE=""
HEADLESS=0
VSIX_FILE=""
AUTH_DRIVER_ARGS=()
# Defined after flags are parsed.
storage_flag=()

usage() {
  cat <<EOF
Usage:
  ./scripts/test_e2e.sh [options]

Arguments:
  --storage=<path>         Path to use for extest storage.
  --headless               Run tests in headless mode using xvfb.
  --vsix=<path_to_vsix>    Install the specified VSIX file and run the tests against it instead of building from source.
  --auth-driver:<arg>      Pass arguments to the authentication driver. Can be used multiple times.
  -h, --help               Show this help message.
EOF
}

parse_args() {
  for arg in "$@"; do
    case "$arg" in
    --storage=*)
      STORAGE="${arg#--storage=}"
      ;;
    --headless)
      HEADLESS=1
      ;;
    --vsix=*)
      VSIX_FILE="${arg#--vsix=}"
      ;;
    --auth-driver:*)
      AUTH_DRIVER_ARGS+=("${arg}")
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "🤷‍♂️ Unknown argument: $arg" >&2
      usage
      exit 1
      ;;
    esac
  done
}

check_deps() {
  local missing=()
  command -v extest >/dev/null 2>&1 || missing+=("extest (did you mean to invoke script behind \`npm run\`?)")
  if [[ "$HEADLESS" -eq 1 ]]; then
    command -v xvfb-run >/dev/null 2>&1 || missing+=("xvfb-run")
  fi
  if [[ ${#missing[@]} -eq 0 ]]; then
    return
  fi

  echo "❌ Missing required dependencies:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
}

setup_extest() {
  if [[ -z "$VSIX_FILE" ]]; then
    return
  fi

  extest get-vscode "${storage_flag[@]+"${storage_flag[@]}"}"
  extest get-chromedriver "${storage_flag[@]+"${storage_flag[@]}"}"
  echo "🔧 Installing VSIX from $VSIX_FILE" >&2
  extest install-vsix "${storage_flag[@]+"${storage_flag[@]}"}" --vsix_file "$VSIX_FILE"
}

build_test_cmd() {
  local base_cmd=()
  if [[ -n "$VSIX_FILE" ]]; then
    base_cmd=(extest run-tests "${storage_flag[@]+"${storage_flag[@]}"}")
  else
    base_cmd=(extest setup-and-run "${storage_flag[@]+"${storage_flag[@]}"}")
  fi

  # Print each part of the command on a new line.
  printf "%s\n" "${base_cmd[@]}"
  printf "%s\n" ./out/test/*.e2e.test.js -m ./out/test/e2e.mocharc.js

  if [[ ${#AUTH_DRIVER_ARGS[@]} -gt 0 ]]; then
    printf "%s\n" "--"
    printf "%s\n" "${AUTH_DRIVER_ARGS[@]}"
  fi
}

run_tests() {
  if [[ "$HEADLESS" -eq 1 ]]; then
    echo "🏃 Running tests in headless mode..." >&2
    xvfb-run -a -s '-screen 0 1024x768x24' "$@"
  else
    echo "🏃 Running tests..." >&2
    "$@"
  fi
}

main() {
  parse_args "$@"
  [[ -n "$STORAGE" ]] && storage_flag=(--storage="${STORAGE}")
  check_deps
  setup_extest
  local test_cmd=()
  while IFS= read -r line; do
    test_cmd+=("$line")
  done < <(build_test_cmd)
  run_tests "${test_cmd[@]+"${test_cmd[@]}"}"
  echo "✅ All tests passed!" >&2
}

main "$@"
