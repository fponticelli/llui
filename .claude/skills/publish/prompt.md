# /publish — Bump version, build, test, and publish all packages to npm

Publish all @llui packages to npm in dependency order.

## Usage

```
/publish patch    # 0.0.1 → 0.0.2
/publish minor    # 0.0.1 → 0.1.0
/publish major    # 0.0.1 → 1.0.0
/publish 0.2.0    # explicit version
```

## Steps

### 1. Determine the new version

Parse the argument: `patch`, `minor`, `major`, or an explicit semver string. Read the current version from `packages/dom/package.json` as the baseline.

### 2. Update all package versions

Run this Node script to bump every package + fix peer deps:

```bash
node -e "
const fs = require('fs')
const path = require('path')
const version = 'NEW_VERSION_HERE'
const pkgs = ['dom','vite-plugin','effects','test','components','router','transitions','vike','mcp','lint-idiomatic']
for (const dir of pkgs) {
  const pkgPath = path.join('packages', dir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.version = version
  // Fix peer deps pointing to @llui/*
  for (const [k, v] of Object.entries(pkg.peerDependencies || {})) {
    if (k.startsWith('@llui/')) pkg.peerDependencies[k] = '^' + version
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(pkg.name + ' → v' + version)
}
"
```

### 3. Build and test

```bash
pnpm turbo build check lint test --force
```

All tasks must pass. If any fail, stop and fix before continuing.

### 4. Git commit and tag

```bash
git add -A
git commit -m "release: v${VERSION}

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git tag "v${VERSION}"
git push && git push --tags
```

### 5. Publish to npm

Publish in dependency order. `@llui/dom` and `@llui/effects` have no internal deps and must go first.

```bash
# Tier 1 — no internal deps
cd packages/dom && npm publish --access public && cd ../..
cd packages/effects && npm publish --access public && cd ../..

# Tier 2 — depends on dom/effects
cd packages/vite-plugin && npm publish --access public && cd ../..
cd packages/test && npm publish --access public && cd ../..
cd packages/router && npm publish --access public && cd ../..
cd packages/transitions && npm publish --access public && cd ../..
cd packages/components && npm publish --access public && cd ../..
cd packages/vike && npm publish --access public && cd ../..
cd packages/mcp && npm publish --access public && cd ../..
cd packages/lint-idiomatic && npm publish --access public && cd ../..
```

If any publish fails with an auth error, ask the user to check their npm token in `~/.npmrc`.

### 6. Verify

Wait 30 seconds for registry propagation, then:

```bash
for pkg in dom vite-plugin effects test components router transitions vike mcp lint-idiomatic; do
  ver=$(npm view @llui/$pkg version 2>/dev/null)
  printf "%-22s %s\n" "@llui/$pkg" "${ver:-propagating...}"
done
```

All 10 should show the new version. If some are still propagating, wait another minute and retry.

### 7. Update ROADMAP if needed

If this is a significant release, add a release note to ROADMAP.md.
