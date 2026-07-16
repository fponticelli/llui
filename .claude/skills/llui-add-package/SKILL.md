---
name: llui-add-package
description: >-
  Follow this exact procedure when adding a NEW publishable package to the LLui monorepo
  (a new packages/<name>/ shipping as @llui/<name>). Use it whenever you're creating a
  new workspace package in this repo: the package.json shape (exports map, files, scripts,
  sideEffects), the tsconfig chain, the CRITICAL @llui/dom-must-be-a-peer rule (a hard
  dependency causes the two-context provide() production bug), how build/publish order is
  derived, and the CLAUDE.md + site registry drift-gates you MUST update or CI fails. This
  is framework-internals / monorepo-plumbing work. Load it before scaffolding the package.
---

# Adding a publishable `@llui/*` package

Copy the closest skeleton: `packages/security/` (a pure leaf, no `@llui/dom`) or
`packages/markdown/` (needs the runtime).

## Checklist

1. **`packages/<name>/`** with `src/index.ts` and `test/`.
2. **`package.json`** (copy security's):
   - `"name": "@llui/<name>"`, `"version": "0.1.0"`, `"type": "module"`,
     `"sideEffects": false` (or an array of CSS files), `"main": "dist/index.js"`,
     `"types": "dist/index.d.ts"`.
   - **`exports` map** — `.` plus any subpaths, each
     `{ "types": "./dist/<x>.d.ts", "import": "./dist/<x>.js" }`.
   - **`"files": ["dist", "src"]`** — ship source for go-to-definition sourcemaps.
   - **`scripts`:** `"build": "tsc -p tsconfig.build.json"`, `"prepack": "pnpm run build"`,
     `"check": "tsc --noEmit -p tsconfig.check.json"`, `"lint": "eslint src"`,
     `"test": "vitest run"`.
   - Metadata: `repository.directory`, `publishConfig.access: "public"`, license, author.
3. **`tsconfig.json`** → `{ "extends": "../../tsconfig.json", "include": ["src","test"], "compilerOptions": { "outDir": "dist", "rootDir": "." } }`.
   **`tsconfig.build.json`** → `{ "extends": "./tsconfig.json", "include": ["src"], "compilerOptions": { "rootDir": "src", "declaration": true, "declarationMap": true, "sourceMap": true } }`.
   Add a `tsconfig.check.json` too (security has one).
4. **`vitest.config.ts`**, `README.md`, `LICENSE`.

## The `@llui/dom` peer-dep rule — CRITICAL

If the package consumes the runtime, `@llui/dom` **MUST** be a `peerDependency` (`workspace:^`)
**plus** a `devDependency` (`workspace:*`) — **NEVER a `dependency`**:

```jsonc
"peerDependencies": { "@llui/dom": "workspace:^" },
"devDependencies":  { "@llui/dom": "workspace:*" }
```

**Why (the double-context `provide()` bug — this caused a production outage):** `@llui/dom`
holds module-singleton state — the build-context `ctx` slot read by `requireCtx()`, and the
`provide`/`useContext` registry. If a library declares `@llui/dom` as a regular `dependency`,
`pnpm publish` pins the resolved version and a consumer app can end up with **two installed
copies** of `@llui/dom`. The library's helpers then build against a _different_ `ctx`
singleton and a different context map than the app's — so `requireCtx()` sees the wrong build
and a value the app `provide`s is invisible to the library's `useContext` (and every
primitive from the consumer's view throws `provide() can only be called inside a component's
view()`). A `peerDependency` forces a single deduped copy shared by app + library; the
`devDependency` supplies it for this package's own build/test. **Do not** paper over a
symptom with `pnpm.overrides`. (Same rule for any future package that owns render context.)

## Build + publish order — auto-derived, no manual edit

- **Turbo** derives build order from `"dependsOn": ["^build"]`; declaring `@llui/dom` (dep or
  peer) makes Turbo build it first.
- **Publish order** is computed by `scripts/publish-order.mjs` — a Kahn topological sort over
  every non-`private` package (edges from `dependencies` + `peerDependencies` +
  `optionalDependencies`, NOT devDeps). A new package auto-slots in; `scripts/publish.sh`
  consumes the TSV and cascades skips on failure. No order file to edit.
- `scripts/emit-deps.mjs` (`__llui_deps.json` producer) is **dormant** and NOT wired into any
  package build or into the published tarball — leave it unless you are deliberately reviving
  the ABI (see `CLAUDE.md` Active proposals).
- `pnpm-workspace.yaml` already globs `packages/*` — no edit needed.

## Drift-gates you MUST update (CI fails otherwise)

1. **Root `CLAUDE.md`** — add a row to the "Monorepo Structure" package table (and bump the
   package count in the sentence above it). The table is the de-facto spec; a missing row is a
   review finding.
2. **`site/pages/api/@pkg/packages.ts`** — add a `PackageMeta` entry `{ slug, category, blurb }`
   to the `PACKAGES` array. This registry is the SINGLE source driving routes, nav
   (`site/src/components/site-layout.ts`), `llms.txt` (`site/src/generate-llms.ts`), AND the
   API-doc generator.
3. **`site/src/generate-api.ts`** — auto-generates `site/content/api/<slug>.md` from
   `package.json#exports` via a real `ts.Program`. It **hard-fails** if a publishable package
   is missing from the registry or has zero extractable exports. After step 2, run
   `cd site && tsx src/generate-api.ts` and commit the generated `content/api/<slug>.md` — the
   CI **drift job** diffs generated pages and fails on any uncommitted change.

## Finish

```bash
pnpm install            # link the new workspace package
pnpm turbo build check test lint --filter @llui/<name>
pnpm turbo build --filter=!@llui/site   # confirm the whole graph still builds
```

Then the `publish` skill/flow handles version bump + CHANGELOG + the derived publish order.
