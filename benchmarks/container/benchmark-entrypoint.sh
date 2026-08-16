#!/usr/bin/env bash
set -euo pipefail

readonly expected_node='v24.14.1'
readonly expected_pnpm='10.33.0'
readonly expected_chrome='150.0.7871.46'

assert_version() {
  local label=$1
  local actual=$2
  local expected=$3
  if [[ "$actual" != *"$expected"* ]]; then
    printf 'ERROR: %s version mismatch: expected %s, found %s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
  printf '%s: %s\n' "$label" "$actual"
}

mkdir -p "$HOME" /cache/npm /cache/pnpm
assert_version Node "$(node --version)" "$expected_node"
assert_version pnpm "$(pnpm --version)" "$expected_pnpm"
assert_version Chrome "$(google-chrome --version)" "$expected_chrome"

if [[ "${LLUI_BENCH_SMOKE:-0}" == '1' ]]; then
  printf 'Benchmark image smoke check passed.\n'
  exit 0
fi

if [[ ! -f /workspace/package.json || ! -d /workspace/.git ]]; then
  printf 'ERROR: /workspace must be a complete LLui git checkout.\n' >&2
  exit 1
fi

cd /workspace
git config --global --add safe.directory /workspace

pnpm install --frozen-lockfile --store-dir /cache/pnpm
pnpm bench:setup --force
pnpm bench:ticker:setup

exec pnpm bench:all "$@"
