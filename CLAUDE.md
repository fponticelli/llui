# CLAUDE.md

Guidance for coding agents in this repo. **`AGENTS.md` is a symlink to this file** — never replace it with a copy (`scripts/test/agent-instructions-mirror.test.ts` fails the build). Write for both Claude and Codex: never name one agent's private directory without the other's. Checkouts must support symlinks (on `core.symlinks=false`, `AGENTS.md` becomes a 10-byte file and silently gives an empty instruction set).

This file holds the RULES. The measurements, incident history and reasoning behind them live in `docs/agents/`. **Read the matching file before changing that area** — most rules below exist because a green suite shipped a real bug:

| File                                                             | Covers                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`docs/agents/workflow.md`](docs/agents/workflow.md)             | worktrees, pre-commit lock, stash ban, symlinks + prettier, `llui-mcp` watchdog   |
| [`docs/agents/ci.md`](docs/agents/ci.md)                         | CI vs local, `check:scripts` / `lint:scripts` / `check:docs` gates, step order    |
| [`docs/agents/test-durations.md`](docs/agents/test-durations.md) | duration baseline, timeouts, load vs load-transient, perf-ratio tests             |
| [`docs/agents/verification.md`](docs/agents/verification.md)     | faithful mutation testing, focus/overlay probes, NUL bytes in source              |
| [`docs/agents/runtime.md`](docs/agents/runtime.md)               | `@llui/dom` concepts and invariants in full                                       |
| [`docs/agents/compiler.md`](docs/agents/compiler.md)             | `@llui/compiler` invariants in full (signal recognition, rows, lint rules)        |
| [`docs/agents/styling.md`](docs/agents/styling.md)               | registry recipes, Tailwind, tokens, attribute/contrast guards, CSS probe traps    |
| [`docs/agents/packages.md`](docs/agents/packages.md)             | per-package notes (components, charts, forms, meter, markdown, lexical, editor …) |
| [`docs/agents/packaging.md`](docs/agents/packaging.md)           | peer deps, `stripInternal`, `.d.ts` gates, metadata ABI, dormant v2 compiler      |

## What is LLui

A compile-time-optimized web framework on The Elm Architecture (TEA), built for LLM-first authoring. Runtime: `@llui/dom` (one import surface; no legacy runtime, no `/signals` subpath). No virtual DOM — `view()` runs ONCE and builds real DOM with reactive bindings. Updates use a **chunked-mask reconciler**: each binding has a sparse mask of the state-path chunks it reads; an update computes dirty chunks (reference-equality per path), skips bindings that don't intersect, and commits only changed values (output-equality).

Structural primitives (`branch`, `each`, `show`, `unsafeHtml`, `lazy`, `virtualEach`, `foreign`, `portal`, `provide`) are **lazy `Mountable`s**: they build nodes and register their scope where they are _placed_, not where they are created. A reused `Mountable` rebuilds fresh on each remount; placing one twice gives two live instances.

The Vite plugin runs ONE signal transform (`@llui/compiler`, TypeScript Compiler API): it lowers signal expressions in a component's direct view to runtime helpers, emits introspection metadata, and runs the lint rules as build ERRORS. What it can't lower (view helpers, block-body views) runs through the real runtime helpers, so both forms coexist.

## Commands

```bash
pnpm turbo build          # Build all packages (tsc)
pnpm turbo check          # Type-check all packages (tsc --noEmit)
pnpm turbo lint           # ESLint all packages
pnpm check:benchmarks     # Type-check benchmark/setup/orchestration tooling
pnpm check:scripts        # Type-check ALL of scripts/ (.ts + .mjs, checkJs on)
pnpm lint:scripts         # ESLint ALL of scripts/, type-aware
pnpm turbo test           # Run tests (vitest) across all packages
pnpm test:scripts         # Root scripts/test suite
pnpm format               # Prettier format everything
pnpm format:check         # Check formatting without writing
pnpm gallery              # Component Gallery dev server (shell + both path documents)
pnpm test:durations       # Record the per-file test-duration baseline
pnpm check:test-durations # Diff against that baseline (report-only, load-normalized)

# Single package — run each script SEPARATELY (see Committing)
pnpm --filter @llui/dom build
pnpm --filter @llui/dom test
pnpm --filter @llui/dom check

# Single test file (from package dir)
cd packages/dom && pnpm vitest run test/signals/runtime.test.ts

# Benchmarks (js-framework-benchmark)
pnpm bench:setup              # One-time setup (idempotent). Never hand-run the npm ci chain (#81).
pnpm bench                    # Build + run jfb + compare against saved baseline
pnpm bench --runs 3           # N runs, median-of-medians
pnpm bench --all              # Also re-run all competitor frameworks (~15 min)
pnpm bench:all --runs 5 --save # Only supported baseline save (standard + ticker, atomic)
pnpm bench:container:smoke     # Build the pinned image and verify Node/pnpm/Chrome
pnpm bench:container -- --framework llui --runs 1 # One-shot Docker diagnostic
pnpm bench:build              # Build jfb app only
```

## Committing and parallel worktrees

Full reasoning: `docs/agents/workflow.md`.

- **Never run `git stash`.** `refs/stash` is shared by all worktrees; parallel lanes destroy each other's entries.
- The pre-commit hook runs `lint-staged` through `scripts/pre-commit.mjs`, which serializes all worktrees behind a lock (#179). **Never set `SKIP_SIMPLE_GIT_HOOKS=1`** — it bypasses the lock AND the format gate. `--no-stash` and `SIMPLE_GIT_HOOKS_RC` were measured and rejected (see the header of `scripts/pre-commit.mjs`).
- Do not weaken `scripts/test/worktree-lock.test.ts` (48 processes, ~0 ms critical section, crash-recovery case). Four lock bugs were only found by contending harder.
- Hook changes reach a worktree only after that worktree's next `pnpm install`.
- `lint-staged` calls `scripts/prettier-staged.mjs`, which drops symlinks — prettier exits 2 on an explicitly named symlink and `.prettierignore` does not stop it.
- **`pnpm --filter <pkg> build check lint test` is INVALID** — pnpm runs only `build` and passes the rest as argv. Run each script separately.
- **Anything that walks the repo must skip `.claude/worktrees/`** (gitignored full checkouts of sibling lanes). Enumerate with `git ls-files --cached --others --exclude-standard` and assert an EXACT set size, never `length > N`. CI never reproduces this; local `pnpm verify` does.
- Lanes share ONE scratchpad. A mutation harness must live in a per-lane subdir, assert `git rev-parse --show-toplevel` and branch before writing, restore in `finally`, and be verified with `git diff` per file, never a file count.
- Generated files every lane regenerates (e.g. `site/public/llms-full.txt`) are not text-mergeable. Regenerate AFTER the merge and commit that.
- After merging locally, run `pnpm install` in the main worktree before trusting any failure (stale `node_modules` resolve a different graph).
- `llui-mcp` shuts down when its parent process changes (#192), including under `nohup … & disown`. Export `LLUI_MCP_NO_PARENT_WATCH=1` to daemonize it on purpose.

## CI — where it differs from local

Mirror `.github/workflows/ci.yml` **step for step, filters included**. Full detail: `docs/agents/ci.md`.

- **`--filter=!@llui/site` applies to the BUILD step only.** `turbo check` and `turbo lint` run unfiltered, so the site is type-checked and linted.
- `@llui/site` and `@llui/registry` are the only packages whose tsconfigs type-check a file importing `vitest.shared.ts`; `pnpm check:scripts` is the other gate. Type root config against vitest's own config type, not `as const`.
- Vitest's esbuild transpile never type-checks. `registry/test/` is compiled by `registry/tsconfig.test.json` (#272): the registry `check` script runs both registry configs and `pnpm check:registry` delegates to it.
- `scripts/` is covered by `pnpm check:scripts` (`tsconfig.scripts.json`, `checkJs` on — not redundant) and `pnpm lint:scripts` (type-aware, `recommendedTypeChecked`). Keep the lint globs QUOTED (`sh` has no globstar). A new file under `scripts/` must be `.ts` or `.mjs` or the coverage tests fail.
- In `.mjs`, the JSDoc cast `/** @type {X} */ (JSON.parse(raw))` still trips `no-unsafe-*`. Write `/** @type {unknown} */ const parsed = JSON.parse(raw)` first, then cast.
- `pnpm check:docs` type-checks README examples. `@doc-skip`, `@doc-setup` and `DOC_ONLY_MODULES` can all hide real staleness — review them like an allowlist.
- A test must not depend on a directory an earlier CI step created. Fix the assumption (`mkdirSync(dir, { recursive: true })`), never the step order.
- `verify` fails fast: red at `Type check` tells you nothing about the tests. Run later steps locally too.
- `LLUI_TEST_DURATIONS` stays RELATIVE in `ci.yml` (container path ≠ host path); both writer and reader resolve it against the repo root.

## Test durations and timeouts

Full detail: `docs/agents/test-durations.md`.

- Workspace `testTimeout` is 30 s. Every vitest config must reach `vitest.shared.ts` (gated by `scripts/test/vitest-config-baseline.test.ts`). `mergeConfig` CONCATENATES `test.include` — override by spreading instead.
- The per-file duration metric is test BUSY time, `min(sum, span)`: a `describe.concurrent` test's duration includes its queue time, so a raw sum is not a cost.
- `check:test-durations` is REPORT-ONLY via `continue-on-error` in `ci.yml`. Thresholds (`4x / +400 ms`, quartile spread) are calibrated against measured noise; re-run the sweep in `scripts/lib/test-durations.mjs` before changing them.
- Expensive fixtures belong in `beforeAll` (60 s `hookTimeout`), but hook time is invisible to the duration report.
- Browser suites BUILD their fixture once and serve it static (`scripts/lib/prebuilt-fixture.mjs`), never a per-file Vite dev server: on-demand compiles, per-page module fan-out and a shared dependency-optimizer cache all land on the tests under load. Record fast in-page state in-page, never sleep-then-read across a round trip.
- `pnpm smoke:examples` AND every test browser are hermetic, through ONE policy and Iconify fixture (`scripts/lib/network-policy.mjs`): tests launch only via `useHermeticBrowser()` (`scripts/lib/hermetic-browser.mjs`, called at collection time; `scripts/test/hermetic-browser-coverage.test.ts` gates it), and an undeclared off-origin request FAILS the smoke or the test, naming the URL.
- Perf-RATIO tests break on load transients in BOTH directions. Never add `retry` to one; fix the sizes, and measure a faithful slow mutant, not just the healthy arm. Measure through the shipped test, never a replica.
- **No test retries, anywhere** (`scripts/test/no-test-retry.test.ts`, allowlist empty and closed at both ends). Wait on the observable event or condition (`scripts/lib/wait-until.mjs`), never a sleep or a private deadline; a test's teardown must `destroy()`/close what it started.

## Development approach

- **TDD:** define the type/shape, write failing tests, then implement.
- Tests live in each package's `test/` folder, not beside sources.
- **No `any`** unless unavoidable. `as unknown as X` is a smell.
- **Nothing is sacred.** No legacy/back-compat concerns. When assumptions change, update `site/content/` (published to [llui.dev](https://llui.dev)).
- **No shortcuts.** Correctness and developer experience decide, not expedience.

### Verification discipline

Full detail: `docs/agents/verification.md`. Lint-rule, reconciler and quota changes arrive with a **mutation table**.

- Prove the mutation reached live code (print/assert the diff). If nothing goes red, suspect the patch first.
- A mutation must be FAITHFUL: change only the property under test, keep paired bookkeeping and teardown intact. Broken mutations usually redden MORE tests and look like strong coverage.
- A mutation cannot kill a test whose assertion it satisfies. Say per row why a survivor survives.
- Restore multiple patches to one file in REVERSE order. Re-run mutations against the final committed code.
- Focus probes: don't use Playwright's `page.focus()` for the action; spread the real (possibly nested) part bag and assert its attributes first; make trap assertions cross the disputed boundary.

## Code style

- Single quotes, no semicolons, trailing commas. Prefix unused params with `_`. Config: `.prettierrc`, `eslint.config.ts` (flat).
- **Control characters in string literals are ESCAPES (`\0`), never raw bytes.** A raw NUL makes git hide diffs and makes `grep` silently report no matches. `scripts/test/source-encoding.test.ts` enforces it.

## Monorepo structure

Twenty-six packages under `packages/`, managed by pnpm workspaces + Turborepo (25 published `@llui/*`/`llui-agent`; `@llui/agent-e2e` is private test fixtures). A twenty-seventh workspace member, `registry/` (`@llui/registry`), is private and never published — it is component SOURCE served as JSON from llui.dev and copied into consumer apps by `@llui/cli`. Build order comes from Turbo's `"dependsOn": ["^build"]`; roots are `@llui/dom` and `@llui/effects`. Per-package detail: `docs/agents/packages.md`.

| Package                                | Purpose                                                                                                      | Dependencies                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `@llui/dom`                            | Runtime: component, mount, `createTeaDriver`, scope tree, bindings, element helpers, structural primitives   | —                                                                                                               |
| `@llui/compiler`                       | Signal TypeScript transform (view lowering + inline metadata) + compile-time lint rules (all errors)         | typescript (peer)                                                                                               |
| `@llui/compiler-ssr`                   | Opt-in: 'use client' directive transforms                                                                    | @llui/compiler                                                                                                  |
| `@llui/vite-plugin`                    | Vite adapter for the compiler, plus dev-server surface (notes, attention router, agent endpoints, HUD)       | peer: vite, @llui/dom                                                                                           |
| `@llui/components`                     | Headless components (accordion, dialog, tabs, select, chart, meter, form-field, …) via `connect`/`overlay`   | @llui/dom + @llui/interactions (peers)                                                                          |
| `@llui/test`                           | Test harness: testComponent, assertEffects, testView, propertyTest, replayTrace                              | @llui/dom                                                                                                       |
| `@llui/effects`                        | Effect builders: http, cancel, debounce, sequence, race + handleEffects chain                                | —                                                                                                               |
| `@llui/security`                       | Shared URL + loopback-origin sanitization for DOM sinks and dev-server surfaces                              | —                                                                                                               |
| `@llui/router`                         | Client router with route-matching helpers and link components                                                | @llui/dom                                                                                                       |
| `@llui/transitions`                    | Animation/transition wrapper helpers                                                                         | @llui/dom                                                                                                       |
| `@llui/mcp`                            | MCP server exposing LLui debug API to LLMs                                                                   | @llui/compiler, @llui/vite-plugin, @modelcontextprotocol/sdk, ws, zod (+ peer: @llui/dom, optional playwright)  |
| `@llui/cli` (`packages/cli`)           | `llui add <item>`: copies registry components into an app (shadcn model); never overwrites w/o `--overwrite` | zod                                                                                                             |
| `@llui/vike`                           | Vike SSR adapter: onRenderHtml, onRenderClient                                                               | @llui/dom                                                                                                       |
| `@llui/agent` (`packages/agent`)       | LAP (LLui Agent Protocol) server + browser client runtime for driving a running app from LLM clients         | ws, zod, @modelcontextprotocol/sdk                                                                              |
| `llui-agent` (`packages/agent-bridge`) | MCP CLI bridging LLM clients to a running `@llui/agent` server (thin LAP-over-HTTP forwarder)                | @llui/agent                                                                                                     |
| `@llui/agent-e2e`                      | End-to-end fixtures and tests for the agent surface                                                          | @llui/agent                                                                                                     |
| `@llui/devmode-annotate`               | Core annotation HUD: capture, selector, notebook transport, plain Markdown textarea; editor contract         | `@llui/dom` (peer), `@llui/components`, `@llui/notes-format`                                                    |
| `@llui/notes-format`                   | Devmode notebook on-disk format, shared by devmode-annotate, vite-plugin and mcp                             | —                                                                                                               |
| `@llui/devmode-annotate-editor`        | Optional rich (Lexical) Markdown surface for `@llui/devmode-annotate`                                        | `@llui/devmode-annotate` + `@llui/dom` + `@llui/interactions` (peers), `@llui/markdown-editor` + required peers |
| `@llui/markdown`                       | Reactive Markdown rendering to live DOM; incremental streaming; light/dark themes                            | @llui/dom (peer)                                                                                                |
| `@llui/lexical`                        | Lexical ↔ signal-runtime binding: `lexicalForeign`, plugin contract, decorator bridge, commit hub            | @llui/dom + lexical (peer)                                                                                      |
| `@llui/lexical-collab`                 | Opt-in Yjs collaborative editing (`yjsCollab`): CRDT sync, scoped undo, presence                             | @llui/lexical + @lexical/yjs + yjs (peer)                                                                       |
| `@llui/lexical-loro`                   | Opt-in Loro collaborative editing (`loroCollab`), with its own CRDT undo                                     | @llui/lexical + lexical + loro-crdt (peer)                                                                      |
| `@llui/markdown-editor`                | WYSIWYG Markdown editor: component, transformers, GFM/callout/wikilink/table plugins, toolbar, collab seam   | @llui/lexical, @llui/dom                                                                                        |
| `@llui/a2ui`                           | Renderer for Google's A2UI protocol (v0.9): `mountA2ui()`, catalogs, Basic catalog on `@llui/components`     | @llui/dom + @llui/interactions (peers) + @llui/components                                                       |
| `@llui/interactions`                   | DOM interaction primitives: focus trap, dismiss layers, floating, modal isolation, scroll lock, roving       | @llui/dom (peer) + @floating-ui/dom                                                                             |

**Framework lint rules are compile-time ERRORS in `@llui/compiler`, never ESLint rules.** LLMs ignore warnings. Do NOT reintroduce `@llui/eslint-plugin`. The rule set lives in `packages/compiler/src/signals/rules.ts` (`peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`, `empty-props`, `agent-annotation-syntax`, `tag-send-drift`, `imperative-dom-mutation`, plus cross-file checks).

## Architecture concepts

Full version: `docs/agents/runtime.md`.

- **Component:** `component<State, Msg, Effect>({ name, init, update, view, onEffect? })`. State is JSON-serializable. Msg/Effect are discriminated unions on `type`. `init()` takes NO arguments. `view` gets `{ state, send }` where `state` is a `Signal<State>`: `state.map(fn)` derives, `state.at('field')` narrows, `state.peek()` is a one-shot read for handlers/effects. Element and structural helpers are module imports from `@llui/dom`, not bag members.
- **View functions:** plain functions taking signal handles (`header(state.at('header'), send)`). Return type `Renderable` (list) or `Mountable` (one element), not `Node`. A helper's `Mountable` (e.g. `onMount`) does nothing unless PLACED in the view.
- **State tiers for `connect()`:** T1 static → `connect(constant(v), noSend, opts)`; T2 private/transient → `island({ def })` (main barrel; `subApp` is a deprecated alias); T3 hoisted (URL, undo, persistence, shared) → `connect(state.at('x'), send)`. Island props go in via `props` + `onProps`, messages out via `onHandle`.
- **Effects are data:** `update()` returns `[newState, effects]`. The runtime passes every effect to `onEffect` (dropped with a dev warning if none). Builders and `handleEffects<E>().else(...)` are in `@llui/effects`.
- **`send()` is synchronous** (reducer + commit immediately). `batch(fn)` coalesces a burst into one reconcile. The compiler auto-wraps straight-line multi-`send` handlers. Opt-in `mountApp(el, def, { scheduler: 'raf' })` coalesces commits per frame; `handle.flush()` forces one.

## Invariants & landmines

Hard constraints. Several are not enforced by types or CI. **Before touching a subsystem, read its full section** — the one-liners below are reminders, not the spec.

### Runtime (`@llui/dom`) — `docs/agents/runtime.md`

- **Build-once.** `view()` runs once. A value read outside a binding (e.g. `peek()` in a slot) is frozen forever.
- **State is JSON-serializable** (no Map/Set/Date/class/function). Unenforced; breaks devtools, replay, agent snapshots, SSR.
- **`update()` is pure and returns a NEW object.** In-place mutation is invisible to the reconciler.
- **ARIA state attributes are enumerated strings.** `applyAttr` renders a boolean on an `aria-*` name as `"true"`/`"false"`; `null`/`undefined` removes it.
- **Commits happen only inside a commit scope** (`packages/dom/src/signals/commit-scope.ts`, via `withCommitScope`). Reentrant sends enqueue. The commit SCHEDULE and effect-frame handling are contract. Read that file's header first.
- **Keyed `each`/`virtualEach` rows are STABLE elements.** No fragment or `show`/`branch`/`each`/`island`/`lazy` as a row root (`src/signals/row-root.ts`).
- **The items seam is total:** a nullish list renders empty and warns in dev on the transition.
- **The mount error boundary covers mounts OUTSIDE a commit round only**; in-round behaviour is deliberately unchanged (#165, #216).
- **Authoring errors throw `LluiFrameworkError`** (branded). `test/signals/framework-error-taxonomy.test.ts` rejects unbranded throws in `src/signals/`.
- **`onMount(cb)` receives the BUILD's root container**, not the enclosing element. Scope any query by id or attribute.
- **`island()`/`lazy()` inherit ancestor CONTEXT (snapshotted at placement) and nothing else.** Head-style namespaces are allocated at placement (`~1`, `~1/~2`); `@llui/vike` layers use `L1`, `L2`, ….
- Disposing a container mount removes the nodes it inserted. `provide()` context is snapshotted at each primitive's placement.
- **Output-equality belongs only to `ValueBinding`.** Every structural reconcile is side-effect-free when nothing changed.
- `state.at('x')` rows are gatable; `state.map(...)`/whole-state rows re-run on every change (O(n) cliff).
- Stateless widgets use `constant(v)` + `noSend`; never fake them with `pathHandle`, never type a no-op sender as `Send<never>`.

### Compiler (`@llui/compiler`) — `docs/agents/compiler.md`

- **The dep analyzer may over-approximate but must NEVER miss a path** (missed dep = permanently stale UI).
- **Exactly ONE dep analyzer** (`signals/analyze-deps.ts` + `signals/extract-deps.ts`). New questions get a new driver, never a new walker. Walkers root identifiers only where READ and prune shadowing with `scopeIntroduces` (`signals/helper-bindings.ts`).
- **Signals are recognized by IMPORT PROVENANCE, not identifier text** (`extract-deps.ts:signalFactoryOf`). `bindings` is a required parameter. Fail closed.
- **A static row slot may not read a free identifier the row didn't introduce** (`firstOpaqueFreeIdentifier`, #244). The trust-withdrawal set is structural, never hand-listed.
- **`peek-in-slot` is scoped to slots and an exemption is sticky** (#245). A change may only REMOVE reports versus main.
- **An `each` row rebases onto component state only for a name that provably denotes it** (#247). Pruned rows must widen the each's dep mask, or the row goes stale.
- **`tagSend` variants must match what the handler dispatches** (`tag-send-drift`). Under-declaration is reported when attributable; over-declaration only when the dispatch set is provably complete. When the two directions disagree, BAIL.
- **`prefer-at-over-map` recommends `.at()` only on a provable PATH receiver** (`RootShape`). A `show`/`branch` narrowed param IS its condition handle: over a `.map`/`derived` condition it is mapped, and `.at()` on it is `at-after-map` (#267).
- **`imperative-dom-mutation`:** DOM writes from a view's own element-helper event handler are build errors; `foreign()`/`island()`/`subApp()` are exempt.
- **Named function expressions are never lowered** — lowering relocates the body and drops the self-binding (#181).
- **Parse via the ONE `ts.createSourceFile` in `src/parse.ts`** with the real filename's ScriptKind; share one `ParsedModule`; never mutate the tree.
- **The injected `@llui/dom` import aliases around ANY occurrence of a helper name in the file** (#90). Don't narrow the collision test.
- **All agent annotation args go through `annotation-args.ts`**, never a per-tag regex (#89).
- Schema metadata is computed per `component()` call.
- **Compiler A/B tests need a `dist` rebuild between swaps**, or "no difference" is fake. Always state whether a corpus diff applied the plugin gate.

### Styling & registry — `docs/agents/styling.md`

- **Every registry class must compile under real Tailwind** (`scripts/test/tailwind-classes.test.ts`). No untested class-string layers.
- **Recipes are shadcn/ui ported VERBATIM.** Only four translations: `focus:` → `data-[highlighted]:` on menu-like surfaces, `data-slot=` → `data-part=`, physical → exact logical utilities, and `--radix-…-available-height` → `--llui-floating-available-height`. The one sanctioned ADDITION is a `forced-colors:` variant (inert outside forced-colors mode, so normal rendering stays upstream's); spell `outline-solid` beside any `outline-none` it overrides (`scripts/test/forced-colors-outline.test.ts` gates it, through `buttonVariants` composition).
- **`scripts/test/registry-attrs.test.ts` checks recipe attributes and VALUES against what machines publish.** Allowlists are keyed `file.ts: attr`, never a bare name. Boolean `data-*` are published BARE.
- **`scripts/test/token-contrast.test.ts`** asserts AA contrast for all token pairs in all six theme cells. Its allowlist is closed at both ends.
- `theme.css` (plain CSS baseline) and `tokens.css` (Tailwind v4 registry) are independent; never style the same parts from both. Tailwind namespaces (`--transition-duration-*`, `--z-index-*`) matter only in `tailwind.css`.
- Keep `@layer base` rules (`* { border-color: var(--border) }`, `button:not(:disabled) { cursor: pointer }`). `tw-animate-css` is a real dependency.
- Route `class` through `mergeClass` (a raw `cn()` stringifies signals). Style state through `data-*`, never a computed class.
- Icons come from Iconify as rebuilt `<svg>` elements (allowlisted, never `innerHTML`). Failures are not cached.
- CSS probes: verify by RENDERING. Hidden tabs freeze transitions; CSS Color 4 values need paint-and-read; assert the instrument on a mid-tone known pair first.
- Example apps (`baseline-css`, `registry-demo`) serve `dist/styles/` — rebuild `@llui/components` after a style source edit. The Component Gallery aliases to source.
- **The Component Gallery is the component inventory.** The hand-written Baseline showcase (`examples/components-demo`) is retired; `examples/registry-demo` is the copied-source SYNC FIXTURE, not a showcase. Baseline-path live compositions the browser suites drive live in `examples/baseline-css/src/test-fixtures/` (no Tailwind, no Vite plugin — linted by `packages/components/test/styles/baseline-css-lint.test.ts`).
- **The Component Gallery (`examples/component-gallery`) renders Baseline theme and Registry skins as SEPARATE builds/documents.** Never load both systems in one document; renderers stay per path; its inventory is derived from the contract and family catalogs, never listed.
- **Every gallery case is gated (#268):** renders `ready`, no serious/critical axe finding, intact markup/idrefs, no runtime fault, per-path visual baseline (`test/cases.browser.test.ts`), plus keyboard/pointer flows per family. Fix findings at the source; a11y exemptions are per case, closed at both ends. Baselines are recorded ONLY in CI's Playwright image (`pnpm gallery:visual:update`, or commit CI's `visual-baselines` artifact).

### Packaging — `docs/agents/packaging.md`

- **`@llui/dom` (and any render-context owner) is a `peerDependency` (`workspace:^`) + devDependency, never a dependency** (two copies break `provide()`).
- **`typescript` is a required peer (`>=5.0.0 <7.0.0`) of `@llui/compiler`, `@llui/compiler-ssr`, `@llui/vite-plugin`**, same range in all three.
- `tsc` doesn't clean `dist/`; `scripts/publish.sh` does.
- **Never spell the internal JSDoc tag in prose comments** — `stripInternal` deletes the next declaration. `pnpm check:dist` gates it, plus a full `.d.ts` semantic check (#253, #257).
- **Compiler↔runtime metadata keys (`$ms`/`$es`/`$ss`/`$ma`/`$sh`/`$cm`) are final at emit and declared twice** (`packages/compiler/src/emit-names.ts`, `packages/dom/src/signals/compiler-keys.ts`). Change both; treat any change as breaking.
- **Do NOT resurrect deleted code:** the v2c module registry, introspection/devtools factories and packages, the cross-file walker, the second dep analyzer (`collect-deps.ts` etc.), `@llui/eslint-plugin`, the two-word bitmask model.

### Protocol

LAP is **v2** (breaking): zod-validated frames, `expiresAt` in milliseconds, version skew ends the pairing. Ship the app's `@llui/agent` client and server together.

## Maintainer skills

Skills in `.claude/skills/` cover adding a structural primitive, a lint rule, a headless component, or a package — use the matching one first (`llui-app-dev` is for consumer app code). They are mirrored in `.agents/skills/` (only `CLAUDE.md`→`AGENTS.md` and `.claude/skills`→`.agents/skills` differ). **Edit both.** `scripts/test/agent-instructions-mirror.test.ts` checks the whole tree.

## Docs

Authoritative docs: `site/content/`, published to **[llui.dev](https://llui.dev)** (Vike; some pages symlink to `docs/*.md`; `api/<pkg>.md` is generated by `site/src/generate-api.ts`). Key pages: [Architecture](https://llui.dev/architecture), [Getting Started](https://llui.dev/getting-started), [Cookbook](https://llui.dev/cookbook), [Composition Patterns](https://llui.dev/composition-patterns), [API Reference](https://llui.dev/api/dom), [Agents](https://llui.dev/agents), [Debugging](https://llui.dev/debugging), [Benchmarks](https://llui.dev/benchmarks), [Publishing a precompiled library](https://llui.dev/publishing-a-precompiled-library).

**Component facts in docs are generated, never typed (#269).** Counts, inventories, add/import names, aliases, stylesheet entry points and gallery links live in `<!-- product-contract:<id>:start/end -->` regions rendered from `registry/registry.json` by `site/src/generate-component-docs.ts` (targets: `COMPONENT_DOC_TARGETS`, including READMEs and the `llui-app-dev` skill outside `site/`). Edit the renderer, then `pnpm --filter @llui/site run generate`. `site/test/docs-integrity.test.ts` fails on a broken internal link/anchor or a hand-written component count outside a region; never document `llui add <name>` and `@llui/components/<name>` as one artifact.

`docs/designs/` no longer exists — don't reference it. In-flight design work lives in `docs/proposals/`.

## Active proposals

- **v2 Compiler Architecture** (`docs/proposals/v2-compiler/`) — partly realized. The live path is `transformSignalComponentSource` with inline metadata. The `__llui_deps.json` ABI is dormant (producer kept, not published). Detail: `docs/agents/packaging.md`.

## Agent skills

- **Issue tracker:** GitHub Issues on `fponticelli/llui` via `gh`. See `docs/agents/issue-tracker.md`.
- **Triage labels:** five canonical roles, label = name. See `docs/agents/triage-labels.md`.
- **Domain docs:** one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
