#!/bin/bash
set -e

# Publish @llui packages to npm in dependency order.
#
# Uses `pnpm publish`, which automatically rewrites `workspace:*` /
# `workspace:^` / `workspace:~` dependency specs to the resolved version
# in the published tarball. Source files keep `workspace:*` so local
# `pnpm install` continues to work against the workspace.
#
# Authentication is delegated to whatever pnpm/npm already has configured
# (either a long-lived token in ~/.npmrc or a prior `pnpm login`). If not
# logged in, pnpm will prompt.
#
# Usage:
#   ./scripts/publish.sh              # publish all packages
#   ./scripts/publish.sh dom effects  # publish specific packages

# The publish list is DERIVED, not hand-maintained. `scripts/publish-order.mjs`
# reads every packages/*/package.json, drops the `"private": true` ones, and
# topologically sorts the rest so a package's in-repo runtime dependencies
# publish before it does. This replaces the old hand-kept TIER1/TIER2/TIER3
# arrays, which silently omitted packages (a2ui, lexical-collab, notes-format)
# every time a new package was added — a class of bug a derived list cannot have.
#
# `eslint-plugin-llui` was deleted in the lint→compiler migration (v0.3.0); all
# framework lint rules now emit as compile-time errors from `@llui/compiler`.
ORDER_TSV="$(node scripts/publish-order.mjs)" || {
  echo "✗ failed to compute publish order (scripts/publish-order.mjs)"
  exit 1
}

# NOTE: macOS ships bash 3.2, which has no associative arrays (`declare -A`).
# Look name/deps up from the TSV on demand instead of caching them in a map, so
# the script runs on the stock system bash without requiring a Homebrew bash 4+.
ALL_DIRS=()
while IFS=$'\t' read -r dir _name _deps; do
  [ -z "$dir" ] && continue
  ALL_DIRS+=("$dir")
done <<< "$ORDER_TSV"

pkg_name() { printf '%s\n' "$ORDER_TSV" | awk -F'\t' -v d="$1" '$1==d {print $2; exit}'; }
pkg_deps() { printf '%s\n' "$ORDER_TSV" | awk -F'\t' -v d="$1" '$1==d {print $3; exit}'; }

# Completeness assertion: every non-private package under packages/ MUST appear
# in the derived list. Guards against a package being invisibly dropped (e.g. a
# dependency cycle that makes the topo sort bail on a node).
EXPECTED=0
for d in packages/*/; do
  [ -f "${d}package.json" ] || continue
  isPrivate=$(node -e "process.stdout.write(String(!!require('./${d}package.json').private))")
  [ "$isPrivate" = "true" ] && continue
  EXPECTED=$((EXPECTED + 1))
done
if [ "${#ALL_DIRS[@]}" -ne "$EXPECTED" ]; then
  echo "✗ publish coverage mismatch: derived ${#ALL_DIRS[@]} packages but $EXPECTED non-private packages exist."
  echo "  Every non-private package must be covered — check scripts/publish-order.mjs for a cycle or omission."
  exit 1
fi

# If args provided, publish only those directory names — but keep topological
# order and the failure-cascade semantics below.
if [ $# -gt 0 ]; then
  REQUESTED=" $* "
  PKGS=()
  for dir in "${ALL_DIRS[@]}"; do
    case "$REQUESTED" in
      *" $dir "*) PKGS+=("$dir") ;;
    esac
  done
else
  PKGS=("${ALL_DIRS[@]}")
fi

# Preflight: confirm we have write credentials to the registry before
# packing and uploading nine tarballs just to collect nine 404s.
#
# npm returns 404 on PUT for unauthenticated writers (rather than 403)
# to avoid leaking scope existence, so a stale token surfaces as a
# confusing "package not found" error instead of "unauthorized". Catch
# it here with a direct whoami probe. On auth failure, run `pnpm login`
# interactively in-place — the operator's terminal handles the browser
# + 2FA prompts and the fresh token lands in ~/.npmrc. Re-check whoami
# afterwards to confirm the token actually works before we start
# packing tarballs.
check_auth() {
  pnpm whoami --registry https://registry.npmjs.org/ 2>&1 || true
}

echo "Checking npm auth..."
WHOAMI_OUTPUT=$(check_auth)

if echo "$WHOAMI_OUTPUT" | grep -qE 'E401|Unauthorized|ENEEDAUTH'; then
  echo "✗ Not authenticated to npm — token is missing, expired, or revoked."
  echo ""
  echo "Starting interactive login..."
  echo ""
  # Run login in the operator's terminal. This opens a browser, prompts
  # for 2FA if configured, and writes the fresh token to ~/.npmrc.
  # Ctrl+C or a failed login exits non-zero; we propagate the failure.
  if ! pnpm login --registry https://registry.npmjs.org/; then
    echo ""
    echo "✗ pnpm login failed or was cancelled. Aborting publish."
    exit 1
  fi
  echo ""
  echo "Re-checking auth..."
  WHOAMI_OUTPUT=$(check_auth)
  if echo "$WHOAMI_OUTPUT" | grep -qE 'E401|Unauthorized|ENEEDAUTH'; then
    echo "✗ Still unauthenticated after login. Check ~/.npmrc and try again:"
    echo "  cat ~/.npmrc"
    echo "  pnpm whoami --registry https://registry.npmjs.org/"
    exit 1
  fi
fi

if [ -z "$WHOAMI_OUTPUT" ] || echo "$WHOAMI_OUTPUT" | grep -qiE 'error|fail'; then
  echo "✗ pnpm whoami failed with unexpected output:"
  echo "$WHOAMI_OUTPUT" | sed 's/^/  /'
  echo ""
  echo "Resolve the underlying issue before retrying — we don't want to"
  echo "start a partial publish with a broken registry connection."
  exit 1
fi

echo "✓ Authenticated as $WHOAMI_OUTPUT"
echo ""

echo "Publishing ${#PKGS[@]} packages: ${PKGS[*]}"
echo ""

FAILED=()
SUCCEEDED=()
SKIPPED=()
# Names (not dirs) of packages that failed OR were skipped, so their dependents
# cascade. Space-padded for whole-word matching.
FAILED_NAMES=" "

for pkg in "${PKGS[@]}"; do
  dir="packages/$pkg"
  if [ ! -d "$dir" ]; then
    echo "⚠ packages/$pkg not found, skipping"
    continue
  fi

  name="$(pkg_name "$pkg")"
  version=$(node -e "process.stdout.write(require('./$dir/package.json').version)")

  # Failure cascade: if any in-repo dependency (transitive) already failed or was
  # skipped, do NOT publish this package — it would ship pointing at a dependency
  # version that never reached the registry. Skip it and mark it failed too, so
  # ITS dependents cascade in turn (topological order guarantees deps come first).
  blocked=""
  IFS=',' read -ra deps <<< "$(pkg_deps "$pkg")"
  for dep in "${deps[@]}"; do
    [ -z "$dep" ] && continue
    case "$FAILED_NAMES" in
      *" $dep "*) blocked="$dep"; break ;;
    esac
  done
  if [ -n "$blocked" ]; then
    echo "⏭ Skipping $name — dependency $blocked did not publish."
    SKIPPED+=("$name (needs $blocked)")
    FAILED_NAMES+="$name "
    echo ""
    continue
  fi

  echo "Publishing $name@$version..."

  # Build BEFORE emitting the __llui_deps manifest. `pnpm publish` runs the
  # package's prepack (which builds), but that happens AFTER emit-deps below —
  # so on a fresh checkout dist/ would not yet exist when emit-deps looks for it,
  # and the manifest would be silently skipped. Building here guarantees dist/ is
  # present for emit-deps (the prepack rebuild during publish is then a cheap
  # no-op re-emit).
  if [ -f "$dir/package.json" ] && node -e "process.exit(require('./$dir/package.json').scripts?.build ? 0 : 1)"; then
    if ! (cd "$dir" && pnpm run build); then
      echo "✗ $name failed to build — aborting its publish."
      FAILED+=("$name (build)")
      FAILED_NAMES+="$name "
      echo ""
      continue
    fi
  fi

  # Emit the package's __llui_deps.json library-boundary manifest so consumers
  # can narrow reactive bindings through its helpers (see scripts/emit-deps.mjs).
  # Requires @llui/compiler to be built. Only packages with a src/ that ships
  # dist/ benefit; emit-deps no-ops cleanly elsewhere. Non-fatal — a manifest
  # failure must never block a release.
  if [ -d "$dir/src" ] && [ -d "$dir/dist" ]; then
    node scripts/emit-deps.mjs "$dir" || echo "  ⚠ emit-deps skipped for $name"
  fi

  # pnpm publish substitutes workspace:* with the concrete dependency
  # version at pack time, so the published tarball has real semver ranges
  # while the source stays on workspace:* for local resolution.
  # --no-git-checks skips pnpm's "you have uncommitted changes" guard —
  # we've already committed the bump in the calling flow.
  if (cd "$dir" && pnpm publish --access public --no-git-checks 2>&1); then
    SUCCEEDED+=("$name@$version")
    echo "✓ $name@$version published"
  else
    FAILED+=("$name")
    FAILED_NAMES+="$name "
    echo "✗ $name failed"
  fi
  echo ""
done

echo "=== Results ==="
if [ ${#SUCCEEDED[@]} -gt 0 ]; then
  echo "Published:"
  for s in "${SUCCEEDED[@]}"; do echo "  ✓ $s"; done
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo "Skipped (dependency did not publish):"
  for s in "${SKIPPED[@]}"; do echo "  ⏭ $s"; done
fi
if [ ${#FAILED[@]} -gt 0 ] || [ ${#SKIPPED[@]} -gt 0 ]; then
  if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Failed:"
    for f in "${FAILED[@]}"; do echo "  ✗ $f"; done
  fi
  exit 1
fi
echo "Done."
