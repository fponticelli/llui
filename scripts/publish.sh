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
