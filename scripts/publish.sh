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

TIER1=(dom effects)
TIER2=(vite-plugin test router transitions components vike mcp lint-idiomatic)
ALL_PKGS=("${TIER1[@]}" "${TIER2[@]}")

# If args provided, use them; otherwise publish all
if [ $# -gt 0 ]; then
  PKGS=("$@")
else
  PKGS=("${ALL_PKGS[@]}")
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

for pkg in "${PKGS[@]}"; do
  dir="packages/$pkg"
  if [ ! -d "$dir" ]; then
    echo "⚠ packages/$pkg not found, skipping"
    continue
  fi

  version=$(node -e "console.log(require('./$dir/package.json').version)")
  echo "Publishing @llui/$pkg@$version..."

  # pnpm publish substitutes workspace:* with the concrete dependency
  # version at pack time, so the published tarball has real semver ranges
  # while the source stays on workspace:* for local resolution.
  # --no-git-checks skips pnpm's "you have uncommitted changes" guard —
  # we've already committed the bump in the calling flow.
  if (cd "$dir" && pnpm publish --access public --no-git-checks 2>&1); then
    SUCCEEDED+=("@llui/$pkg@$version")
    echo "✓ @llui/$pkg@$version published"
  else
    FAILED+=("@llui/$pkg")
    echo "✗ @llui/$pkg failed"
  fi
  echo ""
done

echo "=== Results ==="
if [ ${#SUCCEEDED[@]} -gt 0 ]; then
  echo "Published:"
  for s in "${SUCCEEDED[@]}"; do echo "  ✓ $s"; done
fi
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Failed:"
  for f in "${FAILED[@]}"; do echo "  ✗ $f"; done
  exit 1
fi
echo "Done."
