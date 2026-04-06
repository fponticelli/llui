---
description: Bump, build, test, and publish changed @llui packages to npm
user_invocable: true
---

# /publish — Bump, build, test, and publish changed packages to npm

Publish only the @llui packages that have changed since the last release. Each package is versioned independently.

## Usage

```
/publish patch              # bump changed packages by patch
/publish minor              # bump changed packages by minor
/publish major              # bump changed packages by major
/publish 0.2.0              # explicit version for changed packages
/publish --all patch        # force-bump ALL packages regardless of changes
```

## Steps

### 1. Detect changed packages

Find the latest git tag matching `v*` (e.g., `v0.0.1`). If no tag exists, treat all packages as changed.

```bash
LAST_TAG=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo "")
```

For each package, check if any files under `packages/<name>/` changed since the tag:

```bash
for pkg in dom vite-plugin effects test components router transitions vike mcp lint-idiomatic; do
  if [ -z "$LAST_TAG" ] || [ -n "$(git diff --name-only "$LAST_TAG"..HEAD -- "packages/$pkg/")" ]; then
    echo "CHANGED: @llui/$pkg"
  fi
done
```

If `--all` flag is passed, skip detection and include every package.

### 2. Determine dependency cascade

If a **dependency** changed, its **dependents** must also be bumped even if their own source didn't change. The dependency graph is:

```
Tier 1 (no internal deps):  dom, effects
Tier 2 (depends on tier 1): vite-plugin, test, router, transitions, components, vike, mcp, lint-idiomatic
```

Specifically:
- `dom` changed → also bump: vite-plugin, test, router, transitions, components, vike
- `effects` changed → also bump: (no dependents currently)

Add cascaded packages to the changed set. Present the final list to the user for confirmation before proceeding.

### 3. Bump versions

For each changed package, compute the new version from its CURRENT version (not a shared baseline — packages may be at different versions). Apply the bump type (patch/minor/major) or set the explicit version.

Update `peerDependencies` pointing to changed @llui packages to `^newVersion`.

### 4. Build and test

```bash
pnpm turbo build check lint test --force
```

All tasks must pass. If any fail, stop and fix before continuing.

### 5. Git commit and tag

Create one commit with all version bumps. Tag each published package individually:

```bash
git add -A packages/*/package.json
git commit -m "release: @llui/dom@X.Y.Z, @llui/components@X.Y.Z, ...

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"

# One tag per published package
git tag "@llui/dom@X.Y.Z"
git tag "@llui/components@X.Y.Z"
# ... etc

git push && git push --tags
```

### 6. Publish to npm

Publish only the changed packages, in dependency order:

```bash
# Tier 1 first (if changed)
cd packages/dom && npm publish --access public && cd ../..
cd packages/effects && npm publish --access public && cd ../..

# Then tier 2 (if changed)
cd packages/vite-plugin && npm publish --access public && cd ../..
# ... only packages in the changed set
```

If any publish fails with an auth error, ask the user to check their npm token in `~/.npmrc`.

### 7. Verify

Wait 30 seconds for registry propagation, then verify only the published packages:

```bash
npm view @llui/dom version       # should show new version
npm view @llui/components version # should show new version
# ... only for packages that were published
```

If some are still propagating, wait another minute and retry.

### 8. Update ROADMAP if needed

If this is a significant release, add a release note to ROADMAP.md.
