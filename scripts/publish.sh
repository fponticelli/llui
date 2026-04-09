#!/bin/bash
set -e

# Publish @llui packages to npm in dependency order.
# Uses --auth-type=web for browser-based authentication.
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

# Authenticate once via browser
echo "Authenticating with npm (browser)..."
npm login --auth-type=web
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

  if (cd "$dir" && npm publish --access public 2>&1); then
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
