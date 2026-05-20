---
title: Changelog
description: Release history for LLui packages
---

# Changelog

All notable changes to LLui packages are documented here. LLui is a pre-1.0 project — every release may include breaking changes, though we try to call them out explicitly.

**How to read this file:** entries are anchored by **release date**. Inside each release, fixes are grouped by **`@llui/<package>@<version>`** sub-sections so you always know exactly which package and version a bullet applies to. Cross-cutting changes that affect every package (like build-output fixes) live under a shared "All packages" section. Breaking changes and migration notes sit at the top of each release block because they usually cut across multiple packages.

Packages version in lockstep at release time: `@llui/dom`, `@llui/vite-plugin`, `@llui/test`, `@llui/router`, `@llui/transitions`, `@llui/components`, `@llui/vike` share a version line. `@llui/effects`, `@llui/mcp`, `@llui/eslint-plugin`, `@llui/agent`, and `llui-agent` have their own cadence.

## 2026-05-20 — 0.2.1 / 0.3.1

**Released:** `@llui/{dom,test,router,transitions,components,vike,agent}@0.2.1`; `llui-agent@0.2.1`; `@llui/{compiler,compiler-introspection,compiler-devtools,compiler-ssr,mcp,vite-plugin}@0.3.1`

Bundle-size release. The js-framework-benchmark LLui bundle dropped from 8.9 kB gz to 7.0 kB gz (-21 %) through a series of dev-only DCE gates, build-flag gates, a property-rename pass in the vite-plugin, and one bench-config fix. No public API changes; no perf regressions in median-of-3 measurements (Select / Update 10th / Swap all faster or unchanged).

### `@llui/dom@0.2.1`

- **Improved** dev-only error enrichment (`enhanceBindingError`, `dispatchEffectDev`), dev-only field writes (`disposalCause`, `Lifetime._kind`), and long-form dev error messages (`getRenderContext`, `applyBinding`, `sample()`, `useContext`, `AppHandle.getState()`-after-dispose) now gated behind `import.meta.env?.DEV` so production builds DCE them out. Combined contributions ~1.5 kB gz on the bench.
- **Added** `__LLUI_TRANSITIONS__` build flag gates `each()`'s `enter` / `leave` / `onTransition` callback handling. Apps that don't animate drop ~0.22 kB gz; apps using `@llui/transitions` or custom transition callbacks must opt in via the vite plugin.
- **Improved** per-env `WeakMap<DomEnv, Map<...>>` template cache replaced with a singleton `Map<string, HTMLTemplateElement>`. SSR adapters needing a fresh cache between renders call the exported `_resetTemplateCache()`.
- **Improved** mount-time HMR and devtools-install checks (`hmrModule`, `devToolsInstall` consultations across `mount.ts`'s 13 entry points) gated behind `import.meta.env?.DEV`.

### `@llui/vite-plugin@0.3.1`

- **Added** `transitions?: boolean` plugin option (default false). Sets the `__LLUI_TRANSITIONS__` build flag the runtime checks.
- **Improved** `generateBundle` hook strips `_lluiCompilerEmitted: 1` integrity-check markers from production chunks after verification, and renames LLui-internal `__view` / `__prefixes` / `__handlers` / `__compilerVersion` / etc. compiler-emit properties to short `$a` / `$b` / `$c` forms. Allow-list approach — only LLui-emitted names are renamed; Vite's `__vite__mapDeps`, Vike's `__VIKE__NOT_SERIALIZABLE__`, user-defined `__LLUI_STATE__` containers and other framework-internal `__`-prefixed identifiers pass through unmolested.

### `@llui/compiler@0.3.1`

- **Improved** static-template HTML emission drops unneeded attribute quotes for safe values (`class=col-md-6` instead of `class="col-md-6"`). Reduces emitted HTML size on `elTemplate` / `__cloneStaticTemplate` call sites by 2 bytes per simple-value attribute.

### `@llui/test@0.2.1`

- **Added** `defineTestComponent` and `stampTestVersion` re-exported from `@llui/dom/internal` and `@llui/test`'s public surface. Test fixtures opt into the optimized runtime path via a single canonical helper.
- **Improved** `testView` now stamps `__compilerVersion: '__test__'` on raw `ComponentDef` literals it receives, silencing `warnUncompiledOnce` without forcing callers to use `defineTestComponent`.

### `@llui/{compiler-devtools,compiler-introspection,compiler-ssr}@0.3.1`

- Cascade bump — picks up the new `@llui/compiler@0.3.1` baseline.

### `@llui/mcp@0.3.1` and `@llui/{agent,components,router,transitions,vike}@0.2.1`, `llui-agent@0.2.1`

- Cascade bumps — `peerDependencies["@llui/dom"]` rolled to `^0.2.1` for the dom-peer packages; `llui-agent` rolls to track `@llui/agent`.

### Bench

- **Improved** the `js-framework-benchmark` LLui app dropped Vite's `build.lib` mode for a standard app build. Lib mode preserves whitespace + `//#region` source-map markers for downstream re-bundling, but the bench bundle is served directly to Chrome — ~1.3 kB gz of formatting overhead was dead weight.

### Cumulative

|                               | Pre-release | Post-release |
| ----------------------------- | ----------- | ------------ |
| jfb bundle (gzipped)          | ~8.9 kB     | **7.0 kB**   |
| jfb Select (median-of-3)      | 4.3 ms      | **3.9 ms**   |
| jfb Update 10th               | 15.9 ms     | **14.4 ms**  |
| jfb Swap 1↔998                | 11.5 ms     | **10.9 ms**  |
| vs Solid (bundle gz multiple) | ~2.0×       | **~1.55×**   |

## 2026-05-17 — 0.2.0

**Released:** `@llui/{dom,vite-plugin,components,vike,transitions,router,test,mcp,agent,eslint-plugin}@0.2.0`; `llui-agent@0.2.0`

Cleanup pass over what 0.1.0's unified composition model rendered redundant: the public composition surface drops the `child*` naming (the primitive it referenced no longer exists), the compiler drops two layers of dead code, and three ESLint rules stop false-positiving on generic slice/view helpers.

### Breaking

- **`@llui/dom@0.2.0`** — `childHandlers` renamed to `composeModules`; `ChildState<T>` renamed to `ModulesState<T>`; `ChildMsg<T>` renamed to `ModulesMsg<T>`. The runtime behavior is identical — these names alluded to the removed-in-0.1.0 `child()` primitive and were misleading. The `ChildOptions<S, ChildM>` interface (also a 0.1.0 leftover that was exported but never referenced) is removed.

### Migration

- Replace `import { childHandlers }` with `import { composeModules }`. Same signature, same runtime behavior — pure rename.
- Replace `import type { ChildState, ChildMsg }` with `import type { ModulesState, ModulesMsg }`.
- Delete any import of `ChildOptions` — the type was unused as of 0.1.0.
- If you applied `/* eslint-disable llui/static-items, llui/static-on, llui/each-closure-violation */` to suppress false positives on generic slice/view helpers, the underlying rules are fixed in 0.2.0 — those disables can come off.

### `@llui/dom@0.2.0`

- **Breaking** `child*` → `module*` rename on the composition surface. See top of release block.
- **Fixed** five stale `child()` references in error messages and docstrings (`render-context.ts`, `sample.ts`, `types.ts` ×2, `update-loop.ts`).

### `@llui/vite-plugin@0.2.0`

- **Improved** dropped ~85 lines of voided `__dirty` emission machinery from `tryInjectDirty`. 0.1.0 stopped attaching `__dirty` to the emitted `ComponentDef` but left the function-building code in place behind two `void`-statements. The `topLevelBits` aggregation that `tryBuildHandlers` and `__maskLegend` need stays.
- **Improved** removed the `computePhase2Mask` stub that always returned `FULL_MASK`. The per-binding gate in Phase 2 already does this work bit-by-bit; the function was a placeholder for a not-shipped aggregate analysis. `buildUpdateBody` signature trimmed.

### `@llui/eslint-plugin@0.2.0`

- **Fixed** `static-items` and `static-on` no longer fire false positives when the accessor reads state through a call argument. `(s) => opts.getProps(s).items` and `(s) => derive(s, ctx)` are now recognized as reactive reads; previously the rule only matched direct member access (`s.field`).
- **Fixed** `each-closure-violation` no longer flags captures inside event handler properties. Properties matching `/^on[A-Z]/` (except the three structural names `onMsg`/`onSuccess`/`onError`) are treated as event handler contexts where captures of `send`, dispatch helpers, and parent-helper plumbing (`opts`, `wrapMsg`, …) are standard. Reactive-binding captures (`text(() => ...)`, `class: () => ...`) still fire the rule.

### `@llui/{components,router,transitions,vike,test,mcp,agent}@0.2.0`

- **Cascade** peer dependency on `@llui/dom` bumped from `^0.1.0` to `^0.2.0`. No source changes.

### `llui-agent@0.2.0`

- **Cascade** dependency on `@llui/agent` bumped to track. No source changes.

### Tests / dev infra

- Added regression test (`packages/dom/test/nested-mountapp.test.ts`) covering child-app reactivity when `mountApp(ChildDef)` is invoked from inside another app's view tick (the classic `foreign({ mount })` + deferred `onMount` pattern). Locks in the compiled fast paths' contract: `__update`, `__handlers`, and `__prefixes` work correctly under nested mounts; the fields take instance state as parameters and do not capture binding lists at definition time.
- Added pre-commit hook (`simple-git-hooks` + `lint-staged`) that runs `prettier --write` on staged files. Auto-installs via the `prepare` script after `pnpm install`. No release impact; collaborator-facing only.

## 2026-05-16 — 0.1.0 (unified composition model)

**Released:** `@llui/{dom,vite-plugin,components,vike,transitions,router,test,mcp,agent,eslint-plugin}@0.1.0`; `llui-agent@0.1.0`

First minor bump of the 0.0.x line. Removes the two-tier `component()`/`child()` composition model in favor of a single primitive: view functions, with `combine()` for reducer composition and `subApp` as a lint-enforced escape hatch. Path-keyed reactivity (`__prefixes`) replaces the per-top-level-field `__dirty` bitmask and now supports up to 62 reactive paths per component (was 31). Every package re-lockstepped to `0.1.0` so the boundary between the old and new model is unambiguous.

See [Migration from v0.0.x](/api/dom#migration) (`docs/designs/13 Migration from v0.0.x.md`) for the full migration recipe.

### Breaking

- **`@llui/dom@0.1.0`** — removed: `child()`, `addressOf`, `setAddressedDispatcher`, `propsMsg` / `receives` on `ComponentDef`, and the `AddressedEffect` runtime registry. Migrate every `child({ def, props, onMsg })` call to a view function that the parent invokes directly with the parent owning the child's state slice. Migrate addressed-effect cross-component coordination to shared parent state with `combine()`-routed slices; for adapter-layer push (vike persistent layouts), use the new `onLayerDataChange` callback.
- **`@llui/dom@0.1.0`** — user-authored `__dirty` on `ComponentDef` is now rejected at `createComponentInstance` with a hard throw. The compiler emits `__prefixes` (path-keyed reactivity) automatically; hand-written `__dirty` is no longer accepted at the type level or at runtime.
- **`@llui/vike@0.1.0`** — `def.propsMsg` is no longer honored as a persistent-layout-chain prop pusher. Use the new `onLayerDataChange` option on `RenderClientOptions` to dispatch state-update messages through the framework-supplied `AppHandle` when a layer's `lluiLayoutData[i]` slice changes across navigations.
- **`@llui/eslint-plugin@0.1.0`** — `unnecessary-child` and `child-static-props` rules removed (their target primitive no longer exists). New `subapp-requires-reason` rule enforces a non-empty `reason` field on every `subApp({ reason, ... })` call. `bitmask-overflow` threshold raised 31 → 62 paths.

### Migration

- Replace every `child({ def, props, onMsg })` call with a view function: the child module exports `update(slice, msg)` and `view(props, send)` instead of a `ComponentDef`; the parent owns the slice and namespaces messages as `{ type: 'child-name', msg: ChildMsg }`. See `docs/designs/13 Migration from v0.0.x.md` for the worked example.
- Replace mechanical "route by message-type prefix to a sub-reducer" parent reducers with `combine({ slice: reducer, ... })`. Messages must use `{ type: '${slice}/${action}', ... }` shape.
- Replace addressed effects (`toToastManager.show(...)`) with shared parent state slices (`{ type: 'toasts/add', ... }`).
- In `@llui/vike` apps, replace each `Layout` def's `propsMsg` with an `onLayerDataChange` callback on `createOnRenderClient({ onLayerDataChange: ... })`.
- Delete any hand-written `__dirty` from `ComponentDef` literals. The compiler emits `__prefixes` automatically — for components built without `@llui/vite-plugin`, the runtime falls back to `FULL_MASK` (re-evaluate every binding every cycle).
- Embed genuinely isolated TEA loops via `subApp({ reason, def, ... })` with a non-empty `reason` string explaining why state-lifetime isolation is required. Don't use `subApp` to "isolate a complex component" — extract a view function instead.

### `@llui/dom@0.1.0`

- **Added** `combine<S, M, E>({ slice: reducer, ... }, top?)` — reducer composition by `${slice}/${action}` message-prefix routing. Preserves top-level state reference equality when slices return unchanged.
- **Added** `subApp({ reason, def, data?, onHandle? })` at `@llui/dom/escape-hatch` — embed an independent TEA loop with its own state lifetime. The `reason` field is required and surfaces in the rendered DOM as `data-llui-sub-app-reason`.
- **Added** path-keyed reactivity runtime: `__prefixes` is the supported compiler-emitted dirty-detection mechanism. Each entry is a hoisted closure `(s: S) => unknown`; the runtime reference-compares `prefix(prev) !== prefix(next)` per entry.
- **Added** two-word mask architecture: `Binding.maskHi`, `StructuralBlock.maskHi`, two-word `computeDirtyFromPrefixes` return type `[lo, hi]`. Supports up to 62 reactive paths per component before falling back to FULL_MASK. Gates emit as `(mask & d) | (maskHi & dHi)`; for ≤31-prefix components the high-word branch collapses on V8's inline cache.
- **Breaking** — `child()`, `addressOf`, `setAddressedDispatcher`, addressed-effect registry removed. See top of release block.
- **Breaking** — `propsMsg` / `receives` removed from `ComponentDef`, `AnyComponentDef`, `LazyDef`. `AppHandle.send` is the imperative external-dispatch surface.
- **Breaking** — user-authored `__dirty` rejected at `createComponentInstance`. See top of release block.
- **Improved** `_runPhase2` and `_handleMsg` widened with optional `dirtyHi` parameter (defaults to 0 — backward compat for stale compiled bundles). `__update` arrow gains trailing `dHi = 0` parameter; runtime passes `combinedDirtyHi` as the 6th positional arg.

### `@llui/vite-plugin@0.1.0`

- **Added** `__prefixes` emission for every component with reactive accessors. Replaces `__dirty` (which is no longer emitted at all). Path positions 0..30 land in the low-word mask, 31..61 in the high word.
- **Added** per-binding `maskHi` literal emission via a 5th tuple slot on `elSplit` binding tuples and an optional 6th positional arg on `elTemplate`'s `__bind` callback. Emitted only when the binding reads a high-word prefix — the common ≤31-prefix case stays byte-identical to the pre-multi-word baseline.
- **Added** two-word Phase 1 block gate emission in compiler-emitted `__update`: `!((bk.mask & d) | (bk.maskHi & dHi))`. `block.reconcile` and `__runPhase2` calls thread `dHi` through.
- **Added** two-word `__handlers` case-handler emission: `_handleMsg(inst, msg, caseDirty, method, caseDirtyHi)` when (and only when) the case touches a high-word top-level field.
- **Improved** `collectDeps` returns `{ lo, hi }` maps; `computeAccessorMask` returns `{ mask, maskHi, readsState }`.
- **Breaking** — `__dirty` PropertyAssignment emission removed. Any tooling that grep'd compiled output for `__dirty:` should look for `__prefixes:` instead.

### `@llui/components@0.1.0`

- **Fixed** dialog-child-form-submit test cleanup after the `child()` primitive was removed.
- **Improved** peer @llui/dom pinned to `^0.1.0`.

### `@llui/vike@0.1.0`

- **Added** `onLayerDataChange?: (ctx: { def, handle, newData, prevData }) => void` option on `RenderClientOptions`. Fires for each surviving layout layer whose `lluiLayoutData[i]` slice changed across a navigation; the user dispatches a state-update message through the supplied `AppHandle`.
- **Breaking** — `def.propsMsg` is no longer consulted for persistent-layout chain prop pushes. See top of release block.

### `@llui/test@0.1.0`

- **Improved** peer @llui/dom pinned to `^0.1.0`. No user-visible API surface changes — internal helpers re-checked against the new ComponentDef shape.

### `@llui/router@0.1.0`

- **Improved** peer @llui/dom pinned to `^0.1.0`. No user-visible API surface changes.

### `@llui/transitions@0.1.0`

- **Improved** peer @llui/dom pinned to `^0.1.0`. No user-visible API surface changes.

### `@llui/eslint-plugin@0.1.0`

- **Added** `subapp-requires-reason` rule — enforces a non-empty `reason` string on every `subApp({ reason, ... })` call. The reason surfaces in the rendered DOM as `data-llui-sub-app-reason` for code-review visibility.
- **Improved** `bitmask-overflow` threshold raised 31 → 62 paths to match the new two-word mask capacity. Message text rewritten to recommend state restructuring or view-function extraction rather than `child()` extraction.
- **Breaking** — `unnecessary-child` rule removed. Its target call shape (`child(...)`) no longer exists.
- **Breaking** — `child-static-props` rule removed. Its target call shape no longer exists.

### `@llui/mcp@0.1.0`

- **Improved** peer @llui/dom pinned to `^0.1.0`. No user-visible API surface changes; internal recompile against the new ComponentDef shape.

### `@llui/agent@0.1.0`

- **Improved** peer @llui/dom pinned to `^0.1.0`. No user-visible API surface changes.

### `llui-agent@0.1.0`

- **Improved** transitive bump on `@llui/agent` peer change.

### Docs

- Added `docs/designs/13 Migration from v0.0.x.md` — step-by-step migration guide covering all seven concrete migrations downstream apps need (child → view function, propsMsg → onLayerDataChange / slice ownership, addressed effects → shared state, mergeHandlers/sliceHandler → combine, user `__dirty` removal, subApp for genuine isolation, plus a mechanical sweep checklist).
- Rewrote `docs/designs/01 Architecture.md` and `docs/designs/07 LLM Friendliness.md` around the unified composition model.
- Site content (`getting-started.md`, `cookbook.md`, `architecture.md`, `api/dom.md`) swept for stale references to removed primitives.
- See also `docs/proposals/unified-composition-model.md` (original design), `unified-composition-model-spike-result.md` (benchmark validation), `unified-composition-model-status.md` (branch status).

## 2026-05-16 — 0.0.40

**Released:** `@llui/{dom,components,transitions}@0.0.40`; `@llui/{test,router}@0.0.41`; `@llui/vike@0.0.42`; `@llui/mcp@0.0.37`; `@llui/agent@0.0.58`; `llui-agent@0.0.22`

Fix `child({ onMsg })` silently no-opping when mounted inside an `each()` (or `virtualEach()`) row.

### `@llui/dom@0.0.40`

- **Fixed** `each()` and `virtualEach()` reuse a module-scoped `buildCtx` per row to avoid allocation, and `buildEntry` mutated only a fixed set of fields per row — dropping `send` and `container`. `child({ def, onMsg })` reads `parentCtx.send` to forward `onMsg` output to the parent reducer; with `send === undefined`, the bubble silently no-opped. Controlled inputs paired with each() lost every user interaction: the child fired its message, the parent never saw it, and the parent's reactive `value:` accessor re-evaluated against unchanged state on the next render — racing the user's drag and resetting the DOM. Surface symptom looked like an input race; root cause was three layers deep (each row → child mount → onMsg microtask → undefined parentSend). Both primitives now copy every non-`rootLifetime`/non-`state` field from the surrounding context, matching the comment's stated intent. The missing `container` field separately affected `onMount` calls from inside each rows (fell back to `document.body` instead of the parent component's container).

### `@llui/{components,transitions}@0.0.40`, `@llui/{test,router}@0.0.41`, `@llui/vike@0.0.42`, `@llui/mcp@0.0.37`, `@llui/agent@0.0.58`

- **Fixed** Cascade bump for `@llui/dom@0.0.40`. Peer range updated from `^0.0.39` to `^0.0.40`. No behaviour change in these packages themselves.

### `llui-agent@0.0.22`

- **Fixed** Cascade bump for `@llui/agent@0.0.58`. No behaviour change in the bridge itself.

## 2026-05-14 — 0.0.39

**Released:** `@llui/{dom,components,transitions}@0.0.39`; `@llui/{test,router}@0.0.40`; `@llui/vike@0.0.41`; `@llui/mcp@0.0.36`; `@llui/agent@0.0.57`; `llui-agent@0.0.21`

Fix nested `mountApp` failing past the first instance, plus the same class of bug latent across `mountAtAnchor` / `hydrateApp` / `hydrateAtAnchor`.

### `@llui/dom@0.0.39`

- **Fixed** The HMR fast path in `mountApp` matched on `def.name` alone, so a second call into a _different_ container fired `replaceComponent` on the existing entry instead of mounting a new instance. The docs-page idiom of iterating placeholder spans and calling `mountApp(span, InlineRollChip, …)` for each only rendered the first chip — every subsequent call silently re-rendered chip #1 with new state and left the new span empty. Fix scopes the fast path by container identity (new `replaceComponentForContainer`); independent mounts of the same-named component into distinct containers now each produce their own instance.
- **Fixed** The same class of bug was latent (as a leak, not as wrong output) in the other three mount paths. `mountAtAnchor`, `hydrateApp`, and `hydrateAtAnchor` had no fast path at all, so a repeated call into the same root created a new instance while leaving the prior one orphaned — its `rootLifetime` was never disposed, its HMR entry stayed in the registry, its `activeInstances` entry stuck, and its bindings kept running on detached DOM. All three now check an identity-keyed fast path (`replaceComponentForContainer` / new `replaceComponentForAnchor`) before doing any work, matching `mountApp`'s shape. Re-execution of the user's mount/hydrate call (typical of HMR module re-run, page navigation in vike persistent layouts) hot-swaps cleanly instead of leaking.
- **Improved** Broadcast `replaceComponent(name, def)` — the variant the vite plugin's `import.meta.hot.accept` callback fires — is factored through a shared `swapEntry` helper with the new identity-scoped variants. Behaviour for the HMR-accept path is unchanged.

### `@llui/{components,transitions}@0.0.39`, `@llui/{test,router}@0.0.40`, `@llui/vike@0.0.41`, `@llui/mcp@0.0.36`, `@llui/agent@0.0.57`

- **Fixed** Cascade bump for `@llui/dom@0.0.39`. Peer range updated from `^0.0.38` to `^0.0.39`. No behaviour change in these packages themselves.

### `llui-agent@0.0.21`

- **Fixed** Cascade bump for `@llui/agent@0.0.57`. No behaviour change in the bridge itself.

## 2026-05-12 — 0.0.38

**Released:** `@llui/{dom,components,transitions}@0.0.38`; `@llui/{test,router}@0.0.39`; `@llui/vike@0.0.40`; `@llui/mcp@0.0.35`; `@llui/agent@0.0.56`; `llui-agent@0.0.20`

Fix silent freezing of memo'd structural accessors on the single-message fast path.

### `@llui/dom@0.0.38`

- **Fixed** The per-msg fast path (`__handlers` → `_handleMsg`) reconciled structural blocks without updating `currentDirtyMask`, so the compiler-emitted `memo(fn, mask)` wrappers that the Vite plugin auto-applies to multi-field structural accessors (`each.items`, `branch.on`, `show.when`) short-circuited on the stale mask left over from the previous cycle and returned cached output. The structural block was correctly invoked but reconciled against frozen input — lists didn't filter, branches didn't switch, conditional content didn't update. Bug surfaced only when an accessor read 2+ state fields (single-field accessors don't get auto-memo'd) and was masked by the fact that per-attribute bindings (`text(...)`, `el({class: ...})`) gate on a `dirty` parameter, so attribute-level reactivity continued working on the same update — making the asymmetry hard to spot. Reported with a fully-worked repro against a multi-field `each.items` in a downstream consumer.

### `@llui/{components,transitions}@0.0.38`, `@llui/{test,router}@0.0.39`, `@llui/vike@0.0.40`, `@llui/mcp@0.0.35`, `@llui/agent@0.0.56`

- **Fixed** Cascade bump for `@llui/dom@0.0.38`. Peer range updated from `^0.0.37` to `^0.0.38`. No behaviour change in these packages themselves.

### `llui-agent@0.0.20`

- **Fixed** Cascade bump for `@llui/agent@0.0.56`. No behaviour change in the bridge itself.

### Docs

- `routeToAgentDO`'s API reference now documents the `mcpPath?: string` option (shipped in `@llui/agent@0.0.55`).

## 2026-05-04 — @llui/agent@0.0.55, llui-agent@0.0.19

**Released:** `@llui/agent@0.0.55`; `llui-agent@0.0.19`

Fix `routeToAgentDO` so Claude Code can reach the MCP endpoint without a bearer token.

### `@llui/agent@0.0.55`

- **Fixed** `routeToAgentDO` now routes `/agent/mcp` (and any custom `mcpPath`) to the root DO without requiring a `Bearer` token. Previously the function only exempted the hardcoded management endpoints (`/agent/mint`, `/agent/revoke`, `/agent/resume/*`, `/agent/sessions`) from the token gate, so every MCP initialization request from Claude Code received `401 Unauthorized` and `mcp__<server>__connect_session` never appeared in the tool list. MCP auth happens inside the protocol via `connect_session({token})`, not at the HTTP layer. Added `mcpPath?: string` option to `routeToAgentDO` (default `'/agent/mcp'`) for deployments that customize the path.

### `llui-agent@0.0.19`

- **Fixed** Cascade bump for `@llui/agent@0.0.55`. No behaviour change in the bridge itself.

## 2026-05-04 — @llui/agent@0.0.54, llui-agent@0.0.18

**Released:** `@llui/agent@0.0.54`; `llui-agent@0.0.18`

Token prefix changed from `llui-agent_` to `agt_` — LLM clients no longer pattern-match the bearer token to the bridge MCP tool.

### Breaking

- **`@llui/agent@0.0.54`** — The `agt_` prefix replaces `llui-agent_`. All previously-minted tokens are invalid; users must generate a new token after upgrading. The token is user-visible (pasted into the LLM chat) so existing sessions end naturally on the next reconnect.

### Migration

- If you store or validate the token format (e.g. regex, length checks), update to expect `agt_` prefix and length 47 (was 54).
- Re-generate any in-flight tokens after deploying the update — old `llui-agent_…` tokens will fail authentication with `unknown`.

### `@llui/agent@0.0.54`

- **Fixed** Token prefix changed from `llui-agent_` to `agt_`. Claude Code and Claude Desktop were pattern-matching the old prefix to `mcp__llui__connect_session` (the bridge tool, schema `{url, token}`) and asking for a URL even when connected to the server-side MCP endpoint whose `connect_session` only needs `{token}`. The neutral `agt_` prefix carries no MCP namespace hint — the auth model is opaque: only the server-side hash lookup determines validity.

### `llui-agent@0.0.18`

- **Fixed** Cascade bump for the `agt_` token prefix change in `@llui/agent@0.0.54`. No behaviour change in the bridge itself — the bridge's own `connect_session({url, token})` is unchanged.

## 2026-05-04 — @llui/agent@0.0.53, llui-agent@0.0.17, @llui/eslint-plugin@0.0.24

**Released:** `@llui/agent@0.0.53`; `llui-agent@0.0.17`; `@llui/eslint-plugin@0.0.24`; `@llui/mcp@0.0.34`

Server-side MCP endpoint for `@llui/agent` (no bridge required), plus tree-shake-friendly import linting across the wider `@llui/*` namespace.

### `@llui/agent@0.0.53`

- **Added** Server-side MCP endpoint at `/agent/mcp` (opt-in via `mcp?: boolean | McpRouterOptions` in `ServerOptions` / `DurableObjectOptions`). Enables Claude Desktop and Claude Code to connect directly to an app backend without installing the `llui-agent` bridge — the user pastes a per-session token in-chat, `connect_session({token})` binds the session, and all 14 forwarded tools work exactly as they do through the bridge.
- **Added** `@llui/agent/mcp/tools` sub-path export — single source of truth for the shared tool catalogue (14 forwarded tools + `disconnect_session`). `connect_session` is intentionally absent: the bridge needs `{url, token}`, the server surface needs only `{token}`.
- **Added** `createMcpRouter` — WHATWG-compatible MCP router using `WebStandardStreamableHTTPServerTransport`. Integrates into `createLluiAgentServer` via the new `mcp` option; also available standalone.
- **Added** `mcp?: boolean | McpRouterOptions` to `AgentPairingDurableObject` (`@llui/agent/server/cloudflare`) — enabling MCP inside a Cloudflare Workers Durable Object is now `new AgentPairingDurableObject({ mcp: true })`.

### `llui-agent@0.0.17`

- **Improved** `tools.ts` now imports shared descriptors from `@llui/agent/mcp/tools` (new single source of truth) rather than duplicating them. The bridge's own `connect_session({url, token})` is retained — its surface differs from the server-side `connect_session({token})`. Type aliases `ForwardedToolDescriptor`, `MetaToolDescriptor`, `ToolDescriptor` are re-exported for back-compat.

### `@llui/eslint-plugin@0.0.24`

- **Improved** `llui/namespace-import` now covers `@llui/dom`, `@llui/components`, `@llui/router`, `@llui/transitions`, `@llui/effects`, and `@llui/agent` (was just `dom` + `components`). Autofix uses scope analysis to enumerate every namespace member access, builds a sorted-deduped named-import list, and rewrites both the import statement and every call site. Bails without a fix when any reference is non-static.
- **Added** `llui/no-barrel-import-when-subpath-exists` — reads the target package's `exports` field at lint init (cached) and for each named specifier matching an existing `./<name>` sub-path export, splits the barrel import. Targets `@llui/components` today. Ships in `recommended` at `error`.

### `@llui/mcp@0.0.34`

- Cascade only — picks up `@llui/eslint-plugin@0.0.24`. No behavior change.

## 2026-05-03 — @llui/vite-plugin@0.0.42

**Released:** `@llui/vite-plugin@0.0.42`

Follow-up to 0.0.41 — the deeper `collect-deps` walk that follows named identifier references at reactive positions stopped at the first call to another local helper, so accessors of the shape `(s) => helper(s)` extracted only the outer body's reads and missed everything `helper` read transitively. The result was a precise mask that _under-counted_: a sibling reactive accessor reading only the helper-internal fields could drive a non-zero `dirty` that AND'd with the narrow `each.__mask` was zero, silently skipping the reconcile. This release recurses through helper delegations.

### `@llui/vite-plugin@0.0.42`

- **Fixed** `collect-deps.ts` `extractAccessorPaths` and `transform.ts` `computeAccessorMask` now recurse through `helper(s)` delegation calls — when an accessor body calls another local function and passes the state param verbatim (`helper(s)` where `s` matches our state param name), the helper is resolved via `accessor-resolver.ts` and its body is walked too. A visited-set breaks cycles on mutually-recursive helpers. Both walkers gate the recursion behind: top-level only (don't descend into nested function bodies whose params shadow ours), skip framework helpers (`memo` / `text` / `unsafeHtml` / `sample` / `item`), and only follow when arg0 is the state param verbatim — never `helper(s.foo)` or `helper(otherVar)`.
- **Fixed** `computeAccessorMask`'s chain-prefix matcher now handles "we read deeper than fieldBits tracks" symmetrically. A chain like `'items.filter'` from `s.items.filter(...)` now masks in the `'items'` bit when fieldBits has `'items'` (depth 1), so calling builtin array methods on a tracked path correctly contributes to the per-element mask.

## 2026-05-03 — @llui/vite-plugin@0.0.41, @llui/eslint-plugin@0.0.23, @llui/mcp@0.0.33

**Released:** `@llui/vite-plugin@0.0.41`; `@llui/eslint-plugin@0.0.23`; `@llui/mcp@0.0.33`

Compiler fix for reactive prop values that aren't an inline arrow — named-function references, `memo()` results, hoisted function declarations, imported helpers — which were silently miscompiled at element-helper call sites. Plus a new lint rule covering the remaining `let`-as-accessor footgun.

### `@llui/vite-plugin@0.0.41`

- **Fixed** Reactive prop values that resolved to anything other than an inline arrow or a const-bound arrow no longer silently degrade. The buggy paths — `__cloneStaticTemplate("<button></button>")` (prop dropped entirely when the element had no other reactive binding) and `__e.disabled = isGated` (function reference written to a boolean DOM property when it had a sibling) — are gone. Function declarations, `memo()` results, and other recognised callable shapes now emit binding tuples; unresolvable identifiers (imports, parameters) bail the element to the runtime helper, which classifies `typeof v === 'function'` correctly. A new `classifyReactiveValue` helper is the single source of truth, and Pass 2 mask injection for `text()` / `show()` / `branch()` / `each()` now uses the same shape contract.
- **Improved** `collect-deps.ts` follows identifier references at reactive positions to their local declarations and extracts state-path reads from the resolved bodies. Refactoring an inline arrow to a named helper (`function isGated(s) { return s.gated }` or `const isGated = (s) => s.gated`) now keeps the precise-mask optimization — previously, files whose every accessor was a named reference produced empty `fieldBits` and the bitmask gating was a no-op.
- **Improved** Resolver helpers (`resolveLocalConstInitializer`, `resolveAccessorBody`, `isMemoCallWithArrowArg`) are extracted into a shared `accessor-resolver.ts` module so `transform.ts` and `collect-deps.ts` use one definition of "what counts as a callable accessor in this file."

### `@llui/eslint-plugin@0.0.23`

- **Added** `llui/no-let-reactive-accessor` — flags `let` / `var` bindings used at reactive-accessor positions. The compiler's resolver only follows `const` (reassignment would invalidate the analysis), so `let isGated = (s) => s.gated; button({ disabled: isGated })` silently falls back to FULL_MASK — runtime correct but every binding fires on every state change. Autofixes `let` → `const` when the binding is never reassigned; reports without a fix when there's at least one write. Ships in `recommended` at `error`.

### `@llui/mcp@0.0.33`

- Cascade only — picks up the new `@llui/eslint-plugin@0.0.23`. No behavior change.

## 2026-05-02 — @llui/agent@0.0.52, llui-agent@0.0.16

**Released:** `@llui/agent@0.0.52`; `llui-agent@0.0.16`

Removes the in-app chat composer surface introduced in 0.0.50 (`agentChat` slice + `wait_for_user_input` LAP method + bridge tool + `UserInputStorage` adapter). The visibility primitives — `agentLog` / `agentAttention` / `narrate` — stay intact and unchanged.

### Breaking

- **`@llui/agent@0.0.52`** — `agentChat` namespace, `agentChat.AgentChatState` / `AgentChatMsg` / `connect()`, `LapWaitForUserInputRequest` / `LapWaitForUserInputResponse`, `UserInputSubmittedFrame`, `LogKind: 'user-input'`, `WsClient.submitUserInput`, `AgentChatSendInput` effect, `EffectHandlerHost.wrapAgentChat` / `getWsClient`, `CreateAgentClientOpts.slices.wrapChatMsg`, `UserInputStorage` interface, `CoreOptions.userInputStorage` are all removed. The `/lap/v1/wait-for-user-input` endpoint is gone; its handler file is deleted. The pairing registry's per-tid user-input buffer + parked-waiter queue are gone.
- **`llui-agent@0.0.16`** — the `wait_for_user_input` MCP tool is removed. The `llui-connect` MCP prompt no longer mentions it.
- **`@llui/agent/server/cloudflare`** — `makeDurableObjectUserInputStorage` and `DurableObjectStorageLike` exports are removed (they were only useful for the deleted `UserInputStorage` adapter).

### Migration

- Hosts that wired the chat composer must drop the slice from state, the reducer case, the `wrapChatMsg` factory option, and any panel UI that rendered an input. One mechanical commit per host — see [`decisive.space-2@d084466`](https://github.com/fponticelli/decisive.space-2/commit/d084466) for a worked diff.
- The connect snippet auto-regenerates on the next mint and no longer mentions `wait_for_user_input`. Existing pending snippets (sessions in `pending-claude` at upgrade time) keep their old text but the missing MCP tool is harmless — Claude just won't find it on tool lookup.
- CF DO hosts that wired `makeDurableObjectUserInputStorage` should drop the import + the `userInputStorage` opt; the registry no longer accepts the constructor option.

### Why

The chat composer crossed from a "visibility surface" into a "half-conversation" without delivering true conversational continuity (which would require an embedded LLM, deliberately rejected for cost / cross-app-context reasons). The result was two competing input surfaces (LLM client window vs. in-app composer) and an "always listening" long-poll model that felt uncanny. Visibility (`agentLog` + `agentAttention` + `narrate`) is the part that earns its keep — the agent's actions become perceptible inside the app — without trying to make the app itself the conversation surface. See `docs/designs/10 Agent Protocol.md` §5b for the rewritten architectural rationale.

### `@llui/agent@0.0.52`

- **Removed** see Breaking. Net: ~600 lines of source + ~700 lines of tests deleted, 14 source files touched. The connect snippet shrinks to `connect_session` + `narrate` + namespacing edge case.
- **Improved** `narrate` becomes the canonical "LLM surfaces intent in the app" primitive. The connect snippet now nudges the LLM to call it during multi-step tasks; the bridge prompt mirrors the same nudge.

### `llui-agent@0.0.16`

- **Removed** `wait_for_user_input` MCP tool descriptor (mirrors the LAP method removal in `@llui/agent`).
- **Improved** `narrate` tool description loses the "pair with `wait_for_user_input`" sentence — `narrate` now stands alone as a one-way LLM → user signal.

### Docs

- `docs/designs/10 Agent Protocol.md` §5b retitled "In-app Visibility Surface" (was "Conversational Surface"). Strips the `agentChat` / `wait_for_user_input` subsections; rewrites the framing to "operate-and-narrate, conversation lives in the LLM client". Composition contract collapses from five slices to four. A historical note at the end explains why the chat surface was removed for any future reader.
- `site/content/cookbook.md` "Agent Conversational Surface" recipe retitled "Agent Visibility Surface". Wiring example drops the chat slice; rendering example drops the composer; tool table drops `wait_for_user_input`.
- `examples/github-explorer/src/views/agent-panel.ts` worked example loses its chat composer block.

## 2026-05-01 — @llui/dom@0.0.37

**Released:** `@llui/{dom,components,transitions}@0.0.37`; `@llui/{router,test}@0.0.38`; `@llui/vike@0.0.39`; `@llui/agent@0.0.51`; `@llui/mcp@0.0.32`; `llui-agent@0.0.15`

Two same-day fixes: nested-each DOM mutations no longer break parent reconcile, and the new chat composer's event handlers actually fire (the camelCase requirement bit me in the agentChat bag types).

### `@llui/dom@0.0.37`

- **Fixed** Nested-each reconcile no longer throws `InvalidNodeTypeError` from `Range#setEndAfter` when an inner structural primitive replaces its territory between an outer render snapshot and the next outer reconcile. The bulk-remove paths (`reconcileClear`, fast-path-1 clear, fast-path-5 full-replace) used to anchor `range.setEndAfter(lastEntry.lastNode)` against the most recent entry's tail node — but a nested `each` / `branch` / `show` could detach that node out from under the outer block, leaving `setEndAfter` to throw on a parent-less node. The fix adds a stable `each-end` comment-anchor owned by each `each()` block and threads it through `reconcileEntries` so bulk Range ops always span the two outer comments regardless of inner-each / show / branch mutations in between.

### `@llui/agent@0.0.51`

- **Fixed** `agentChat.connect()`'s prop bag declared `oninput` and `onkeydown` (lowercase). LLui's element runtime only attaches keys matching `/^on[A-Z]/` as DOM event listeners (`packages/dom/src/elements.ts:72`); lowercase silently degrades to a string attribute. The visible symptom: typing into the in-app chat composer never fired `SetInput`, `pendingInput` stayed empty, and the submit button stayed disabled forever. Renamed the bag's keys + types + handlers to `onInput` / `onKeyDown`, updated the doc comments with a sharp warning, and adjusted the 19 `agentChat` tests. No behaviour change for any other slice; `agentConnect` / `agentConfirm` / `agentLog` were already camelCase.

### `@llui/components@0.0.37`, `@llui/transitions@0.0.37`, `@llui/router@0.0.38`, `@llui/test@0.0.38`, `@llui/vike@0.0.39`, `@llui/mcp@0.0.32`, `llui-agent@0.0.15`

- Cascade release picking up the new `@llui/dom@0.0.37` peer range. No package-level source changes.

## 2026-05-01 — @llui/agent@0.0.50, llui-agent@0.0.14

**Released:** `@llui/agent@0.0.50`; `llui-agent@0.0.14`

In-app conversational surface for the agent: chat composer (the user's voice), visual attention layer (the framework directs the user's eye to changed regions), `narrate()` LAP method (the agent's prose), and the plumbing that turns the activity log into a real chronological timeline. The user's LLM stays external (BYOL, cross-app context, no per-app cost); the conversation now lives inside the host app's window.

### `@llui/agent@0.0.50`

- **Added** `agentChat` namespace — Level 1 slice owning the in-app chat composer's editor state. `init` / `update` / `Msg` / `connect()` shape matching the existing `agentConnect` / `agentConfirm` / `agentLog` siblings. The reducer guards double-submit and whitespace-only sends; `connect()` returns a static prop bag with reactive accessors (input value, disabled state, Enter/Shift+Enter handling, submit button props, `canSubmit` predicate). Submit fires `AgentChatSendInput { text, at }` which the framework's effect handler chains through `WsClient.submitUserInput` (one upstream `user-input-submitted` WS frame + one synthesized `LogEntry { kind: 'user-input', detail: text }` mirrored locally so the activity feed renders the user's reply inline with agent actions) followed by `SubmitComplete` to re-enable the input.
- **Added** `agentAttention` namespace — visual attention layer. Listens for the same `Append { entry }` payload `agentLog` accepts (factory fans a single `log-append` to both slices), extracts top-level paths from `LogEntry.stateDiff` (with `'/'` collapsing to wildcard `'*'`), records `latestDispatch: { entryId, paths, variant, intent, at }`, fires `AgentAttentionFlashTimeout` for race-tolerant auto-clear (the `Clear { entryId }` Msg returned by the timer no-ops if a fresher dispatch already replaced the spotlight). `connect()` exposes `flashing(path)`, `flashClass(path, className?)`, `regionAction(path)`, and `latestDispatch` accessors.
- **Added** `entryDiff(id)` accessor on `agentLog.connect()`'s `ConnectBag<S>` — memoized reactive accessor returning the entry's JSON-Patch `stateDiff` (or `null` for entries without one or unknown ids). Memoized per-id, looks up against the raw entries (not the visibility filter) so a diff sidecar over a hidden entry still resolves.
- **Added** `LogEntry.detail` auto-narration in `ws-client` — schema-free `k=v` summary of `send_message` payloads (first 3 non-`type` fields, objects rendered as keysets, arrays as length, strings JSON-quoted, all values truncated at 30 chars). Populates the existing-but-previously-unused `detail` field; surfaces a glanceable second line under `intent` even for variants without `@intent`.
- **Added** `narrate()` LAP method — the agent pushes prose into the activity feed without inventing fake `@agentOnly` Msgs. Server handler synthesizes `LogEntry { kind: 'narrate', detail: text, intent }` and pushes a new `log-push` server-frame to the paired runtime; ws-client mirrors it via `onLogEntry` locally and echoes a `log-append` upstream so the recent-log buffer + audit sink see it through the existing browser → server channel — single audit pathway, no double-record.
- **Added** `LogKind: 'user-input' | 'narrate'` — distinct chips/styles in the activity feed for the user's typed replies and the agent's commentary.
- **Added** `summarizeDiff` / `groupDiff` / `describeOp` exports from `@llui/agent/client` — pure renderers that turn JSON-Patch into one-line headlines (`"3 changes in cart"` / `"2 items added across 3 regions"`), per-region structured breakdowns, or short verb + dotted path strings (`"changed cart.total"`). Schema-free; the host renders however it likes.
- **Added** `@llui/agent/styles/agent-panel.css` — opt-in default stylesheet shipping a `.agent-flash` keyframe with `prefers-reduced-motion` fallback, per-`LogKind` colour hints (via `[data-scope='agent-log'] [data-part='entry'][data-kind='…']` selectors), tunable CSS custom properties (`--llui-agent-flash-color`, `--llui-agent-flash-duration`, etc.), and a chat-composer disabled-state style. Hosts that want a panel that works on first paint import this; production apps override the custom properties or write their own keyframes.
- **Added** `UserInputStorage` adapter interface + `core` option — optional persistence for the chat composer's user-input buffer across runtime restarts. Cloudflare Durable Object hosts get a ready-made adapter from `@llui/agent/server/cloudflare`'s new `makeDurableObjectUserInputStorage(state.storage)`; pass the result to `new AgentPairingDurableObject({ userInputStorage: … })` and buffered messages survive DO eviction. Parked `waitForUserInput` waiters can't be persisted (they're JS Promise resolvers); the LAP client retries naturally and the restored buffer drains on the retry. Calls are best-effort: storage outages cause lost messages on eviction but never wedge a live conversation.
- **Improved** Factory wiring: a single inbound `log-append` now fans out to BOTH `wrapLogMsg` and `wrapAttentionMsg` when both are wired (the host's reducer sees the same entry through different sub channels and routes to the right slice). New optional slices: `wrapAttentionMsg`, `wrapChatMsg`. New `getWsClient` host hook so the chat-send effect handler can find the active client lazily across the connection lifecycle (graceful no-op pre-open / post-close — the input field re-enables either way).
- **Improved** `LogPushFrame` (server → browser) added to `ServerFrame`; ws-client handles `t: 'log-push'` by mirroring through `onLogEntry` and echoing `log-append` upstream so the existing audit pathway captures server-originated entries.

### `llui-agent@0.0.14`

- **Added** `wait_for_user_input` MCP tool — long-poll the in-app chat composer's submission queue. Returns `{ status: 'submitted', text, at }` on receipt of a `user-input-submitted` WS frame, or `{ status: 'timeout' }` after `timeoutMs` (default 30s). Submissions buffer briefly when no waiter is parked (8-message FIFO with drop-oldest on overflow) so a user typing before the agent reaches the tool call still gets through.
- **Added** `narrate` MCP tool — push a one-line prose update into the activity feed without dispatching a Msg. Use before long-running actions, to surface inferred reasoning, or to acknowledge user input before acting. Returns `{ ok: true }` once the host runtime has the entry.

### Docs

- `docs/designs/10 Agent Protocol.md` gains "5b. In-app Conversational Surface" — explains the architectural reframe (protocol-mediated external LLM stays right; the missing piece was an in-app surface for the LLM's presence and the user's voice) and the composition contract for the five slices.
- Cookbook adds an "Agent Conversational Surface" recipe walking through host wiring, panel rendering, the visual attention layer, the helper utilities, and a tool-selection table for `send_message` / `narrate` / `wait_for_user_input` / `wait_for_change`.
- `examples/github-explorer/src/views/agent-panel.ts` extended end-to-end with all five slices composed (connect + confirm + log + attention + chat). Activity rows now show payload `detail` + diff summary; chat composer wires up via `agentChat.connect()`'s prop bag with no extra event-handling code in the host.

## 2026-05-01 — @llui/dom@0.0.36

**Released:** `@llui/{dom,components,transitions}@0.0.36`; `@llui/{router,test}@0.0.37`; `@llui/vite-plugin@0.0.40`; `@llui/vike@0.0.38`; `@llui/agent@0.0.49`; `@llui/mcp@0.0.31`; `llui-agent@0.0.13`

Hotfix: a component whose update case modifies multiple state fields and incidentally resets one to `[]` (e.g. `{ ...state, open: true, name: '', tags: [] }`) used to go structurally inert after mount — `propsMsg` and `update` fired, the new state landed, but every `show` / `branch` / `scope` block in the view stopped reacting because their `when` / `on` accessors never re-evaluated. The compiler's per-message handler routed the case through an each-only reconcile method that no-ops on non-each blocks. Fixed at both the compiler and the runtime.

### `@llui/dom@0.0.36`

- **Fixed** Phase 1 reconcile in `_handleMsg` falls back to `block.reconcile(s, dirty)` when the specialized method (`reconcileItems` / `reconcileClear` / `reconcileRemove` / `reconcileChanged`) is undefined on a selected block. Previously, a compiler-emitted handler with `method=2` (clear) would invoke `block.reconcileClear?.()` on every block whose mask intersected the case's dirty bits — but those specialized methods only exist on `each` blocks. `show` / `branch` / `scope` blocks silently no-opped, leaving their `when` / `on` accessors stuck at the mount-time evaluation. The defense-in-depth fallback ensures non-each blocks still reconcile correctly even if a compile-time miss slips through.

### `@llui/vite-plugin@0.0.40`

- **Fixed** `detectArrayOp` only emits `'clear'` / `'mutate'` / `'remove'` / `'strided'` when the case modifies exactly one field AND that field is the one with the array op. A multi-field case like `{ ...state, open: true, name: '', tags: [] }` previously matched on the first `tags: []` it walked and routed the entire case to `method=2`, bypassing `block.reconcile` for show/branch blocks gated on `open` or `name`. Multi-field cases now fall through to `'general'` (method=0). Sister of the `method=-1` fix in `show-helper-reconcile.test.ts` — same architectural rule: optimizations that route around `block.reconcile` must hold for every primitive, because the compiler can't see helpers and library overlays (e.g. `dialog.overlay` from `@llui/components`, which uses show internally).

### `@llui/components@0.0.36`, `@llui/transitions@0.0.36`, `@llui/router@0.0.37`, `@llui/test@0.0.37`, `@llui/vike@0.0.38`, `@llui/agent@0.0.49`, `@llui/mcp@0.0.31`, `llui-agent@0.0.13`

- Cascade release picking up the new `@llui/dom@0.0.36` peer range. No package-level source changes.

## 2026-04-30 — @llui/dom@0.0.35

**Released:** `@llui/{dom,components,transitions}@0.0.35`; `@llui/{router,test}@0.0.36`; `@llui/vike@0.0.37`; `@llui/agent@0.0.48`; `@llui/mcp@0.0.30`; `@llui/eslint-plugin@0.0.22`; `llui-agent@0.0.12`

Enforce the accessor-purity contract end-to-end. `sample()` (and `h.sample()`) called from inside any structural-primitive accessor (`each.{items,key}`, `branch.on`, `show.when`, `scope.on`, `child.props`, `foreign.props`) or a binding accessor (`text(s => …)`, `unsafeHtml(s => …)`) now throws a targeted runtime error at the first invocation — typically initial mount, before the bug can ship. A new ESLint rule catches the same antipattern at edit time. Phase 1 reconcile gains the same try/catch defense Phase 2 already had: a thrown accessor surfaces via `_onBindingError` instead of dying silently in a microtask.

### Breaking

- **`@llui/dom@0.0.35`** — `sample()` / `h.sample()` calls from inside an accessor now throw at the first invocation with a targeted error. The previous behaviour was undefined: the accessor's mask analysis silently dropped the hidden dep (so the block was mask-gated out when the sampled state changed), and on the reconcile paths where the accessor did run, `sample()` threw a generic "outside render context" error mid-flush that escaped to an unhandled microtask. Apps that depended on the prior accidental behaviour need to lift the dep into the accessor's parameter — bake outer state into `items`, return a wider object from `props`, etc. The lint rule `llui/no-sample-in-accessor` flags every site at edit time.

### Migration

- For `each().key` reading sibling state via `sample()`, replace with the items-map pattern. Before:
  ```ts
  each({ items: (s) => s.rows, key: (it) => `${it.id}|${sample((s) => s.rev)}` })
  ```
  After:
  ```ts
  each({
    items: (s) => s.rows.map((it) => ({ it, rev: s.rev })),
    key: (r) => `${r.it.id}|${r.rev}`,
  })
  ```
  The same shape applies to the other accessors: lift the dep into the parameter so the compiler's mask analysis can see it. The lint rule's error message points at the corresponding workaround.

### `@llui/dom@0.0.35`

- **Fixed** `sample()` inside an accessor used to fail silently. The compiler's mask analysis only walks `param.X` reads on the accessor's parameter, so a read via `sample(s2 => s2.X)` was invisible — the dep silently dropped from the structural block's mask. When the hidden dep changed, the block was gated out and reconcile never fired; when reconcile did fire (e.g. on a sibling change), the accessor threw at `sample()` because there's no render context during the update phase, and the throw escaped the update loop into a swallowed microtask. The new runtime accessor stack (in `render-context.ts`) lets `sample()` detect every accessor call site by name (`each().key`, `each().items`, `branch().on`, `show().when`, `child().props`, `foreign().props`, `a binding accessor`) and throw a targeted error pointing at the lift-into-parameter workaround. The fail-fast happens at initial mount, so the bug can't ship.
- **Improved** Phase 1 structural reconcile errors now flow through `_onBindingError` (parallel to Phase 2 binding errors) instead of escaping the update loop. A throwing accessor no longer kills the rest of the update or vanishes into an unhandled microtask rejection — the dev/agent integration surfaces the error in the same channel as binding accessor throws, with `kind: 'reconcile'` to distinguish it.

### `@llui/eslint-plugin@0.0.22`

- **Added** `llui/no-sample-in-accessor` rule (recommended at `error`). Flags `sample()` / `h.sample()` calls inside `each.{items,key}`, `branch.on`, `show.when`, `scope.on`, `child.props`, `foreign.props`, and the binding helpers `text` / `unsafeHtml`. Catches the runtime-throw antipattern at edit time with zero runtime cost. The walker intentionally does not descend into nested function bodies, so a `sample()` inside an event handler attached during render (a non-accessor closure) is not flagged. Sister rule of `no-sample-in-reactive-position`, which catches the adjacent "sample's _result_ in a reactive position" antipattern.

### `@llui/components@0.0.35`, `@llui/transitions@0.0.35`, `@llui/router@0.0.36`, `@llui/test@0.0.36`, `@llui/vike@0.0.37`, `@llui/agent@0.0.48`, `@llui/mcp@0.0.30`, `llui-agent@0.0.12`

- Cascade release picking up the new `@llui/dom@0.0.35` peer range. No package-level source changes.

### Docs

- `docs/designs/03 Runtime DOM.md` — added an "accessor purity contract" paragraph in the `each()` section spelling out the construction-vs-update phase split, the mask-gating implication, and the runtime + lint enforcement.
- `docs/designs/09 API Reference.md` — `sample()` description updated with the accessor restriction and pointer to the lint rule.

## 2026-04-29 — @llui/agent@0.0.47, llui-agent@0.0.11

**Released:** `@llui/agent@0.0.47`; `llui-agent@0.0.11`

Fix: panel correctly transitions to "Connected" after WS re-pair (page refresh / brief drop).

### `@llui/agent@0.0.47`

- **Fixed** `acceptConnection` now sends the `'active'` frame to the new WS on the re-pair branch. The grace-window re-pair path calls `markActive` directly to skip the awaiting-claude → active transition, but the matching browser notification was missing — leaving the page stuck on `pending-claude` ("Waiting for AI to claim") indefinitely after a refresh, even though the session was fully alive. `ensureActive` couldn't help on subsequent LAP calls because the record was already `active` by then.

### `llui-agent@0.0.11`

- Cascade release for `@llui/agent@0.0.47`. No bridge-level changes.

## 2026-04-29 — @llui/agent@0.0.46, llui-agent@0.0.10

**Released:** `@llui/agent@0.0.46`; `llui-agent@0.0.10`

Fix: the panel's connect status now correctly flips from "Waiting for AI to claim" → "Connected" when the AI binds via `/observe`, not just `/describe`.

### `@llui/agent@0.0.46`

- **Fixed** `markActive` + `'active'` browser frame fire from any LAP call, not just `/describe`. The `llui-agent` MCP bridge connects via `/observe` (the unified bootstrap endpoint), so the previous describe-only path left the panel stuck on `pending-claude` indefinitely — even though LAP calls worked. Centralised the transition in `lap/active.ts:ensureActive`; every LAP handler runs it after auth+paired (observe, message, confirm-result, wait, describe, recent-actions, every forward handler). The transition is no-op when the record isn't `awaiting-claude`, so it's cheap and idempotent on every call.

### `llui-agent@0.0.10`

- Cascade release for `@llui/agent@0.0.46`. No bridge-level changes.

## 2026-04-29 — @llui/agent@0.0.45, llui-agent@0.0.9

**Released:** `@llui/agent@0.0.45`; `llui-agent@0.0.9`

Robust session lifecycle. Brief network drops, server restarts, page reloads, and explicit user disconnects now all behave correctly without putting the LLM in a confusing state. Session = (token, tid) is the durable identity; the WS is just the realtime delivery channel and can churn freely.

### Breaking

- **`@llui/agent@0.0.45`** — `AgentConnectStatus` adds `'reconnecting'` and `'failed'` variants; `AgentConnectState` adds `reconnectAttempt` and `reconnectElapsedMs` fields; `AgentConnectPendingToken` adds `wsUrl`. UI code that switches over the status union or destructures the state shape needs updating to match. New Msgs `Disconnect`, `ReconnectAttempt`, and `ReconnectGaveUp` are also part of the union; exhaustive Msg matchers must add cases (or fall through). The default behaviour for `WsClosed` while a `pendingToken` is set is now "schedule auto-reconnect" instead of "zero state to idle" — apps that explicitly want the old behaviour should dispatch `Disconnect` from the same site.

### Migration

- Hosts that wired the legacy `AgentSessionPersist` / `AgentSessionClear` effects to `sessionStorage` themselves can keep doing so — the framework's auto-handler co-exists. To migrate cleanly, pass `sessionStorage: null` to `createAgentClient` if you want only your handler to run, or remove your handler and let the framework own it (default key: `'llui-agent:session'`).
- Any app that surfaced the connect status in its UI should add a render path for `'reconnecting'` (compact "reconnecting…" pill is the canonical UX) and `'failed'` (the loop gave up; offer a manual retry).
- An explicit "Disconnect" button in the agent panel should dispatch the new `Disconnect` Msg instead of `Revoke` — same revoke behaviour PLUS clears persisted credentials and short-circuits the reconnect loop.

### `@llui/agent@0.0.45`

- **Added** WS-close grace window. `createLluiAgentCore({ pendingResumeGraceMs })` (default 60s) controls how long a token's record stays in `pending-resume` after the WS closes. During the window, a reconnect with the same bearer re-pairs without rotating — `acceptConnection` detects the pending-resume record and calls `markActive` directly, so the agent's existing token stays valid the whole time. Wires up dead code that was sitting in the protocol/storage layer (`markPendingResume`, `pending-resume` status, `resume/list` filtering) — all become live for the first time. Set `0` to opt out (legacy behaviour: WS close immediately drops the record, reconnect must rotate via `/resume/claim`).
- **Added** `Retry-After` and `X-LLui-Reconnect: pending|revoked|expired|unknown` headers on every 503 `paused` response (centralized in `buildPausedResponse`). The MCP bridge can distinguish "WS bouncing, will be back" from "session is dead, paste a new snippet" instead of guessing from a bare 503.
- **Added** Browser auto-reconnect with exponential backoff (1s → 2s → 4s → 8s → 16s → 30s cap, 5-minute cumulative ceiling, then `'failed'`). Uses the cached `wsUrl`/`token` directly — no mint round-trip, no `/resume/claim` rotation. The reducer schedules `AgentReconnectSchedule` effects; the handler is a thin `setTimeout` wrapper. User `Disconnect` short-circuits the loop via the reducer's status guard (no cancel handles needed).
- **Added** Framework-owned session persistence. `AgentSessionStorage` adapter passed to `createAgentClient` (default = `defaultSessionStorage()` reading `window.sessionStorage` under `'llui-agent:session'`). On `start()` the framework reads the blob and auto-dispatches `RestoreSession` if a non-expired session is present; `MintSucceeded` writes; `Revoke` / `Disconnect` clear. Hosts can pass `sessionStorage: null` to opt out (legacy host-handled `AgentSessionPersist` / `AgentSessionClear` effects still flow through).
- **Added** `Disconnect` Msg — explicit user-initiated revoke. Clears credentials, blocks any in-flight reconnect timer, dispatches `AgentRevoke` + `AgentSessionClear` + `AgentCloseWS`. Distinct from `Revoke` (per-tid revoke from the sessions list — keeps reconnect-loop semantics for non-active tids).
- **Fixed** `markPendingResume` no longer lifts `revoked` / `expired` records into a fresh grace window. The transition is guarded to `active` / `awaiting-claude` only, so a stale WS-close after a deliberate `Revoke` can't accidentally resurrect the session.

### `llui-agent@0.0.9`

- Cascade release for `@llui/agent@0.0.45`. No bridge-level changes.

## 2026-04-29 — @llui/vite-plugin@0.0.39

**Released:** `@llui/vite-plugin@0.0.39`

`@should` / `@validates` JSDoc annotations are now read from every nested-field site, not just top-level Msg variant fields. Apps that put guidance on domain types (e.g. `interface Alternative.image`) finally see it surface in the agent's `payloadHint` and `fieldHints`.

### `@llui/vite-plugin@0.0.39`

- **Fixed** Schema extractor reads `@should` and `@validates` JSDoc on **every** nested-field call site: interface members, inline-object members, and discriminated-union variant fields. Previously only top-level Msg variant fields (the ones that flow through `buildFieldDescriptor`) honored these annotations; nested fields silently dropped the JSDoc, so domain types annotating `interface Alternative.image` or `Quantity.format` got nothing in the agent's surface. Now `Matrix/AddAlternatives`'s synthesized example shows `image: ""` with the hint pointing at Wikimedia, and an annotated `format` on `Quantity` surfaces alongside the discriminant-kind hint. JSDoc source is recovered from `member.getSourceFile().text` so cross-file domain types (annotations in `@decisive/domain` referenced from `apps/web`) carry their hints transparently. Centralized field resolution into a `resolveMember()` helper used by all three call sites — same `T | undefined` peel rules, same JSDoc rules.

## 2026-04-28 — @llui/agent@0.0.44, llui-agent@0.0.8

**Released:** `@llui/agent@0.0.44`; `llui-agent@0.0.8`

Page-refresh now preserves an active agent session — the AI's existing token stays valid because the browser reattaches a new WS without going through the rotate-on-resume path. Connect-snippet prefix is now the concrete `mcp__llui__connect_session` instead of the placeholder `mcp__<server>__connect_session`.

### `@llui/agent@0.0.44`

- **Added** `RestoreSession` Msg + `AgentSessionPersist` / `AgentSessionClear` effects. `MintSucceeded` now also emits `AgentSessionPersist` alongside `AgentOpenWS` so the host can write the credentials to `sessionStorage`. On boot, the host reads them back and dispatches `RestoreSession` — the reducer re-enters `pending-claude` and re-opens the WS without minting. The agent's existing token stays valid because we don't go through `/resume/claim` (which rotates by design). `Revoke` of the active tid emits `AgentSessionClear` so the persisted blob doesn't outlive the server-side session. Hosts that don't implement the persist/restore loop can ignore both effects — the rest of the connect lifecycle still works (the page falls back to "mint a new session" after refresh, same as before this effect existed). The existing `/resume/claim` flow stays for the browser-closed-and-reopened case where `sessionStorage` is gone but `tids` in `localStorage` may still be alive on the server; that path _must_ rotate the token because the previous bearer might be leaked.
- **Improved** Connect-snippet now uses the concrete prefix `mcp__llui__connect_session` (matches the `claude mcp add --transport stdio llui ...` install command in the docs) instead of the placeholder `mcp__<server>__connect_session`. Some LLMs were copying the placeholder name literally; the concrete form removes the ambiguity for the common case. Users who renamed the server in their MCP config can substitute their name.

### `llui-agent@0.0.8`

- Cascade release for `@llui/agent@0.0.44`. No bridge-level changes.

## 2026-04-28 — @llui/vite-plugin@0.0.38, @llui/agent@0.0.43, llui-agent@0.0.7

**Released:** `@llui/vite-plugin@0.0.38`; `@llui/agent@0.0.43`; `llui-agent@0.0.7`

Eliminate two compounding sources of bogus `'unknown'` schema fields and stop the synthesizer from emitting `null` for the rest. A fresh-LLM dogfood failed when `Matrix/AddCriteria`'s payloadHint contained `clamp: null, bound: null, ease: null` — the agent copied them verbatim, the validator passed (it exempts unknowns), and the renderer crashed reading `.kind` off null.

### `@llui/vite-plugin@0.0.38`

- **Improved** Schema-extractor depth budget now decrements only on **named-type lookups**, not on inline structural moves (array element, inline object literal, inline discriminated-union variants). Cyclic types still terminate via the named-lookup decrement; deeply-nested but finite type trees fully resolve. Concrete: `Matrix/AddCriteria.criteria[].type(quantity).clamp` resolves to its full discriminated-union shape instead of collapsing one hop short. Deepens what the agent sees without growing the budget constant or the bundle size.
- **Added** Detect `T | undefined` (and `undefined | T`, `T1 | T2 | undefined`) as optional T at every property-resolver site (top-level Msg variants, inline object literals, interface bodies, DU variant fields). Decisive-style `field: T | undefined` no longer extracts as required+`unknown`; the agent can omit the field instead of having to spell out `field: undefined` literally.

### `@llui/agent@0.0.43`

- **Fixed** `list_actions` synthesizer omits `unknown`-typed fields from `payloadHint` instead of emitting `null`. Emitting `null` misled agents into copying it verbatim — the validator let it through (it exempts unknowns), the value landed in state, and consumer code crashed on `null.kind` / `null.length`. The agent should now consult `description.messages` for the field's actual shape when the example doesn't mention it. Empty array `[]` replaces `[null]` for arrays whose element schema is `unknown`.

### `llui-agent@0.0.7`

- Cascade release for `@llui/agent@0.0.43`. No bridge-level changes.

## 2026-04-28 — @llui/router@0.0.35, @llui/agent@0.0.42, llui-agent@0.0.6

**Released:** `@llui/router@0.0.35`; `@llui/agent@0.0.42`; `llui-agent@0.0.6`

Two dogfood gaps closed against decisive: route-changing effects from arbitrary reducers now keep `state.route` in sync with the URL, and the agent payload validator stops rejecting required-but-`unknown`-typed fields when missing.

### `@llui/router@0.0.35`

- **Added** `connectedRouter.navigate(route)` effect — pushState plus dispatch the listener-captured navigate message in one operation. Resolves the asymmetry where `link()` did push+send (it has send/factory in scope at click time) while `push()` did pushState only, leaving apps with desynced `state.route` whenever a non-`Router/Navigate` reducer programmatically navigated. Existing `push()` / `replace()` keep their URL-only semantics for the inline-RouteChanged pattern; switch to `navigate()` when you want the framework to handle the round-trip. If `navigate()` runs before `connectedRouter.listener()` mounts, the URL still updates and a `console.warn` surfaces the gap.

### `@llui/agent@0.0.42`

- **Fixed** Payload validator no longer rejects required fields whose schema is `unknown` when they're missing from the payload. The schema extractor emits `field: string | undefined` as required+`unknown` (the union isn't a branded primitive), but the validator's stated philosophy is "treat 'unknown' as any goes" — agents were forced to spell out `details: undefined`, `url: undefined`, … on every authored object, defeating the payload hints. Strict-mode unknown-field warnings are unaffected; this only relaxes the missing-field branch.

### `llui-agent@0.0.6`

- Cascade release for `@llui/agent@0.0.42`. No bridge-level changes.

## 2026-04-28 — 0.0.34 + @llui/agent@0.0.41, @llui/vite-plugin@0.0.37, @llui/test@0.0.35, @llui/vike@0.0.36, @llui/mcp@0.0.29

**Released:** `@llui/{dom,components,router,transitions}@0.0.34`; `@llui/test@0.0.35`; `@llui/vike@0.0.36`; `@llui/mcp@0.0.29`; `@llui/agent@0.0.41`; `@llui/vite-plugin@0.0.37`

Four post-dogfood improvements: `@agentOnly` respects `agentAffordances`, per-binding throw isolation in the runtime, current URL on `describe_visible_content`, and a new `@routeGated` JSDoc tag for compile-time affordance gating.

### Breaking

- **`@llui/dom@0.0.34`** — `AppHandle` adds `setOnBindingError(hook | null): void`. Custom AppHandle implementations (test fakes, mocks, adapter layers) need to provide it; `setOnBindingError: () => {}` is a fine no-op for callers that don't need the hook.
- **`@llui/agent@0.0.41`** — `DescribeVisibleResult` adds `url: string | null`. `MessageAnnotations` adds `routeGate?: string | null`. Both shapes are additive; exhaustive type assertions over the result need updating.

### `@llui/dom@0.0.34`

- **Added** Per-binding throw isolation in the Phase-2 update loop. A single accessor that throws (e.g. scoring fails on a malformed criterion) now leaves its binding's `lastValue` unchanged — DOM stays at the previous value rather than going blank — and continues with sibling bindings on the same commit. Reverses the previous "one bad accessor freezes the entire view" UX.
- **Added** `inst._onBindingError` runtime hook (internal field) and the public `AppHandle.setOnBindingError(hook)` accessor. The agent factory wires it into the dispatch envelope's `drain.errors`, so the LLM sees that a binding crashed without the dispatch reporting transport failure. Without a hook, throws fall back to `console.error` (dev mode, with the existing rich wrapped error message — component name, kind, node descriptor, accessor source) or `console.warn` (prod).

### `@llui/agent@0.0.41`

- **Added** `@agentOnly` schema-source variants now respect `agentAffordances(state)`. When the app provides an affordances hook, `@agentOnly` Msgs surface only when the hook returns them — bulk-edit Msgs like `Matrix/AddCriteria` stop surfacing on routes where they don't apply. Apps without `agentAffordances` keep the previous permissive default ("everything tagged `@agentOnly` is always available").
- **Added** `describe_visible_content` returns the user's current URL (`url: string | null`, read from `window.location.href`). The agent uses this to verify "did my dispatch actually navigate the user?" — apps that bundle navigation into a Msg's effect chain update the URL on commit; the agent reads it back here to confirm the user's view tracked the state change.
- **Added** `@routeGated("predicate")` annotation evaluated at affordance time. The compiler captures the predicate verbatim; the runtime evaluates with `state` bound and gates the variant from `list_actions` when the predicate returns falsy. Compile-time alternative to runtime `agentAffordances(state) => Msg[]` for the common "this Msg is reachable when state.X looks like Y" case.
- **Improved** Agent factory wires `setOnBindingError` to push entries into `drain.errors`. A binding crash during a dispatch lands in the dispatched envelope (`status: 'dispatched'` with the error reported) — sibling bindings update normally, so the page survives.

### `@llui/vite-plugin@0.0.37`

- **Added** `@routeGated("predicate")` JSDoc tag captured into `MessageAnnotations.routeGate` and emitted into the runtime annotations object. Mirrors `@validates`'s grammar but with `state` as the bound variable instead of `v` (the predicate sees the whole app state, not a single field value).

### Cascade releases

- **`@llui/{components,router,transitions}@0.0.34`**, **`@llui/test@0.0.35`**, **`@llui/vike@0.0.36`**, **`@llui/mcp@0.0.29`** — peer-dependency cascade for `@llui/dom@0.0.34`. No package-level changes.

## 2026-04-28 — @llui/agent@0.0.40, @llui/eslint-plugin@0.0.21

**Released:** `@llui/agent@0.0.40`; `@llui/eslint-plugin@0.0.21`

Six follow-up improvements pulled from a real dogfood session against decisive.space-2. The previous batch closed the schema-fidelity gap; this batch closes the agent-experience gaps that surface once an LLM is actually driving an app.

### Breaking

- **`@llui/agent@0.0.40`** — `would_dispatch` adds a new result status `'reducer-threw'` (with `message` and optional `stack`) for the case where the candidate Msg's reducer throws during prediction. `LapDrainMeta` adds an optional `warnings?: Array<{path, code, message}>` field. Both shapes are strictly additive; existing handlers that exhaustively switch over `status` need to add cases or fall through.

### `@llui/agent@0.0.40`

- **Added** `list_actions` filters bindings by Msg-schema membership. Library-internal Msgs leaking through `tagSend` (the sortable component's `move`/`drop`/`cancel`/`start`/`toggleGrab`/`moveBy` etc.) no longer show up in the agent's affordance list. Schema absence (older builds) keeps the previous permissive behavior so this is safe to ship.
- **Added** `would_dispatch` catches reducer throws as `{status: 'reducer-threw', message, stack?}` — same Phase-5 contract `send_message` got last release. The agent's safety net no longer crashes alongside the candidate dispatch.
- **Added** `@validates(...)` predicate text surfaces as a `fieldHint` (`"validates: v >= 0 && v <= 100"`) at affordance time. The agent reads the constraint when shaping its first attempt, not as an after-the-fact rejection.
- **Added** Validator warnings propagate from the strict-mode validator to the dispatch envelope as `drain.warnings`. New optional `getDispatchPolicy()` host accessor lets a server opt into strict; default stays lenient and omits the field entirely.
- **Added** Framework-tracked `LastDispatchOutcome`. The WS layer captures every `send_message` outcome (`dispatched` / `rejected` / `reducer-threw`); `describe_context` prepends a synthetic `LAST DISPATCH …` hint when the most recent outcome had errors or warnings. Apps no longer need to maintain their own `lastDispatchError` state field — the framework owns it.

### `@llui/eslint-plugin@0.0.21`

- **Added** `agent-tagsend-translator-missing` rule. Flags `*.connect(get, send, ...)` calls where the second argument is the raw component `send` rather than a translator (`(libMsg) => send({type: 'X', msg: libMsg})`). The bare-`send` pattern is exactly what leaks library Msgs into the binding registry, polluting the agent's affordance list. The rule's message includes the wrap suggestion inline. Ships in `recommended` and `agent` configs at error severity.

## 2026-04-28 — @llui/agent@0.0.39, @llui/vite-plugin@0.0.36

**Released:** `@llui/agent@0.0.39`; `@llui/vite-plugin@0.0.36`

Five-phase upgrade to agent-boundary validation. The framework now generates a runtime validator from the Msg union's TS types (cross-file shape transitivity, branded primitives, discriminated unions, optional `@validates` predicates), runs it for agent-driven dispatches, and catches downstream throws so a partial-failure dispatch reports as `dispatched` with errors in `drain.errors` rather than masquerading as HTTP 500. Reducers can now trust their inputs are well-formed.

### Breaking

- **`@llui/vite-plugin@0.0.36`** — `MsgFieldType` adds a new richer-descriptor field `validates?: string` (the captured `@validates(...)` predicate). The compiler emits it alongside `optional`/`priority`/`hint`. Code that read `__msgSchema` directly and exhaustively typed the rich-descriptor shape needs to widen for the new field. Apps that didn't poke at the schema directly are unaffected.
- **`@llui/agent@0.0.39`** — `validatePayload` adds new error codes `'unexpected-field'` (strict mode catches typos / hallucinated keys) and `'validates-failed'` (predicate rejection). Existing handlers that exhaustively switch on `code` need to add cases or fall through. New optional 3rd argument to `validatePayload`: `{ policy: 'strict' | 'lenient' }`. Default stays lenient.

### Migration

- For most apps: no migration needed. The schema gets richer automatically; the validator gets stricter only when you opt in via `policy: 'strict'`.
- If you had reducers with hand-written semantic guards (e.g. "this criterion's `ease` field must be a `{kind: ...}` object, not a string"), those guards are now redundant for agent-driven dispatches — the cross-file resolver fully resolves the shape and the validator rejects malformed payloads upstream of the reducer.
- For domain invariants the type system can't express (numeric ranges, format predicates, length bounds), tag the field with `@validates("predicate-expression")`. The predicate has `v` bound to the field value at runtime.

### `@llui/vite-plugin@0.0.36`

- **Added** transitive cross-file shape resolution. The `buildEnrichedTypeIndex` walk now follows imports recursively — when `Criterion` is imported from `domain.ts` and `Criterion` itself references `EaseFunction` (imported by `domain.ts` from `ease.ts`), the resolver pulls `ease.ts`'s declarations into the index too. Previously the inner types collapsed to `'unknown'`; now the full discriminated-union descriptor lands in the schema. Closes the schema gap that produced the `ease: 'linear'` agent-side guess in dogfood testing.
- **Added** branded-primitive resolution. `string & {__brand: 'UID'}`, `number & {readonly __brand: 'Cents'}`, etc. emit as their underlying primitive (`'string'`, `'number'`) so the validator's typeof check passes for any primitive value rather than rejecting against `'unknown'`. Intersections that mix in real (non-`__`-prefixed) fields are left alone — those aren't brands.
- **Added** `@validates("predicate")` JSDoc tag captured into the rich field descriptor. Examples: `@validates("v >= 0 && v <= 100")` for a numeric range; `@validates("/^[a-z0-9-]+$/.test(v)")` for a slug format; `@validates("v.length > 0")` for a non-empty string. Predicates run at the agent boundary only — TypeScript validates the call site for human dispatches.
- **Improved** transitive walk silently skips imports that fail to resolve (bare specifiers like `'fs'`, vite-externalized modules) rather than throwing. Consequence: the schema extractor is robust to non-type-relevant imports anywhere in the transitive closure.

### `@llui/agent@0.0.39`

- **Added** `validatePayload(msg, schema, opts?)` accepts a new `policy` option. `'strict'` rejects fields not in the schema (typos, hallucinated keys) with `code: 'unexpected-field'` and emits warnings for `'unknown'`-typed fields the agent provided values for (`code: 'untyped-field'`). `'lenient'` (default) accepts extras silently; `'unknown'` is a passthrough.
- **Added** `@validates("...")` predicate execution. The compiler emits the predicate string in `MsgSchemaField.validates`; the validator compiles it lazily with `new Function('v', 'return (' + src + ')')` and caches. Predicate failures emit `code: 'validates-failed'` with the predicate source in the message. Predicates run only after structural validation passes — a wrong-type field doesn't double-report. Malformed predicates degrade to no-op rather than breaking dispatch; predicates that throw at evaluation are treated as fail-closed.
- **Added** Phase 5 catch-and-report at the dispatch boundary. A throw inside `host.send` / `host.flush` during a `send_message` (reducer crash, binding-evaluation crash, persist-effect crash) now lands in `drain.errors` and the dispatch returns `{status: 'dispatched', stateDiff, drain: {errors: [...]}}` — instead of HTTP 500 / `{status: 'rejected'}`. The agent gets a structured "dispatch landed AND something errored downstream" signal and can self-correct or back off rather than retrying the same payload.
- **Improved** `MsgSchemaField` rich-descriptor type extended with `validates?: string`. The validator unwraps it via the existing `fieldType()` accessor pattern.

## 2026-04-27 — @llui/eslint-plugin@0.0.20

**Released:** `@llui/eslint-plugin@0.0.20`

Two more silent-staleness lints in the same family as the previous batch — both ship in `recommended` at error severity.

### `@llui/eslint-plugin@0.0.20`

- **Added** `static-items` — symmetric with `static-on`, applied to `each({items})`. Flags factories that don't read state (`items: () => [literal]`, `items: (s) => CONST`). When items doesn't read state the list builds once at mount and the `each` never reconciles — adds/removes/updates never appear in the DOM.
- **Added** `no-sample-in-reactive-position` — generalizes `no-list-render-in-sample`. Flags `text(sample(…))` and `unsafeHtml(sample(…))` — passing sample's string return value to a reactive primitive typechecks (string is a valid static accessor) but the cell never updates. `sample` is an opt-out of reactivity; the rule explains that and points at the right form (`text((s) => …)` or `text(item.field)`).

## 2026-04-27 — 0.0.33 + @llui/agent@0.0.38, @llui/vike@0.0.35, @llui/mcp@0.0.28, @llui/eslint-plugin@0.0.19

**Released:** `@llui/{dom,router,transitions,components}@0.0.33`; `@llui/test@0.0.34`; `@llui/vike@0.0.35`; `@llui/mcp@0.0.28`; `@llui/agent@0.0.38`; `@llui/eslint-plugin@0.0.19`

Reactive ItemAccessor reads at the obvious call site (`text(item.title)`, `show({when: () => item.banned()})`, `branch({on: () => item.kind()})`), a cookbook recipe + `sample` doc warning for variable-length lists, and two ESLint rules to catch the silent-staleness footgun before it ships.

### Breaking

- **`@llui/eslint-plugin@0.0.19`** — `static-on` rule loosens for zero-arg accessors that read from item / memo / closure sources (`on: () => item.kind()` is now valid). Bare-literal zero-arg bodies (`on: () => 'tab'`) still fire. Apps using the new pattern stop false-positiving; apps with literal-bodied accessors see the same error as before.

### `@llui/dom@0.0.33`

- **Added** `text` and `unsafeHtml` on the View bag and primitives accept `() => V` alongside `(s: S) => V`. The runtime already detected zero-arg accessors and routed them through the per-item updater path; the type widening lets `text(item.title)` typecheck. Eliminates the `text(_ => item.title())` papercut that made the static-vs-reactive distinction easy to misread inside an `each.render` callback.
- **Added** `show.when`, `branch.on`, `scope.on` accept `() => V` similarly. Same runtime path; same ergonomic win.
- **Improved** `sample()` docstring spells out the variable-length-list footgun and redirects to the cookbook recipe. The pattern (`sample((s) => s.list.items.map(rowFn))`) looks idiomatic but silently captures rows in closure; cells go stale on in-place updates.

### `@llui/eslint-plugin@0.0.19`

- **Added** `no-eager-item-accessor` flags `text(item.X())` / `unsafeHtml(item.X())` — eager invocation captures the value at view-construction; the cell never updates when row state changes. Fix is to drop the `()`: `text(item.X)` reads reactively. Ships in `recommended` at error severity.
- **Added** `no-list-render-in-sample` flags `.map()` over a state-derived array inside a `sample()` callback — exactly the antipattern that produces stale rendered rows. Use `each` + `ItemAccessor` for variable-length lists. Ships in `recommended` at error severity.
- **Improved** `static-on` accepts zero-arg accessors whose body contains a CallExpression or MemberExpression (item accessors, memo readers, closure-captured selectors). Bare-literal bodies still fire.

### Cascade releases

- **`@llui/{router,transitions,components}@0.0.33`**, **`@llui/test@0.0.34`**, **`@llui/vike@0.0.35`**, **`@llui/mcp@0.0.28`**, **`@llui/agent@0.0.38`** — peer-dependency cascade for `@llui/dom@0.0.33`. No package-level changes.

### Docs

- New cookbook recipe "List of editable rows — reactive cells over `each`" walks through the correct `each` + `ItemAccessor` + reactive bindings shape, including the explicit anti-pattern note on wrapping a list in `sample()`.

## 2026-04-27 — @llui/agent@0.0.37, @llui/vite-plugin@0.0.35

**Released:** `@llui/agent@0.0.37`; `@llui/vite-plugin@0.0.35`

The schema the compiler emits for Msg payloads now describes discriminated unions and number / boolean literal unions, and `would_dispatch` / `send_message` validate every payload against it before the reducer runs. Together this collapses the agent's "guess a shape, dispatch, read prose error, guess again" loop into one round trip — the LLM sees the legal shapes upfront and gets path-keyed structured errors when it gets one wrong.

### Breaking

- **`@llui/vite-plugin@0.0.35`** — `MsgFieldType` (compiler) and `MsgSchemaBareType` (agent) gain a `discriminated-union` shape and `enum` widens from `string[]` to `ReadonlyArray<string | number | boolean>`. Code that read `__msgSchema` directly and assumed `enum: string[]` will need to widen its type. Apps that didn't poke at the schema directly are unaffected.
- **`@llui/agent@0.0.37`** — `would_dispatch` adds a third rejection variant: `{status: 'rejected', reason: 'schema-mismatch', errors: ValidationError[]}`. Existing handlers that matched on `reason: 'invalid' | 'unsupported'` need to also handle the new variant or fall through. `send_message` continues to use `reason: 'invalid'` for the same failures, but the `detail` string is now a compact `path: message; path: message` list rather than free-form English.

### Migration

- Code reading `__msgSchema.variants[*].field`: widen the type to accept the new `discriminated-union` shape and the broadened `enum` value type. The runtime check is one `if (t.kind === 'discriminated-union')` arm.
- Agents that called `would_dispatch` and only handled `reason: 'invalid' | 'unsupported'`: add a case for `reason: 'schema-mismatch'`. The `errors` array is structured (`{path, code, message}`) and is the recommended source — `detail` is no longer set on this rejection variant.

### `@llui/vite-plugin@0.0.35`

- **Added** discriminated-union extraction. A field typed `A | B | C` whose members are object literals sharing one literal-string discriminant property emits as `{kind: 'discriminated-union', discriminant, variants}`. Symmetric with how the top-level Msg union itself is encoded — same shape, recursed.
- **Added** number-literal and boolean-literal unions emit as enum types. `1 | 2 | 3` → `{enum: [1, 2, 3]}`; `true | false` → `{enum: [true, false]}`. Mixed-type literal unions (`'a' | 1`) stay `'unknown'` rather than emit a misleading enum.
- **Added** standalone literal types emit as single-element enums. `flag: true` → `{enum: [true]}`; `value: 5` → `{enum: [5]}`.
- **Improved** `MAX_FIELD_DEPTH` 3 → 5. Realistic payloads (e.g. `Matrix/AddCriteria.criteria[].format.kind` at depth 4) now resolve fully instead of collapsing to `'unknown'` at depth 3.

### `@llui/agent@0.0.37`

- **Added** `validate-payload.ts` — schema-driven structured validator. Walks the compiled schema against a candidate Msg and returns path-keyed `ValidationError[]` on mismatch. Error codes: `unknown-variant`, `missing`, `wrong-type`, `not-in-enum`, `not-array`, `not-object`, `missing-discriminant`, `unknown-discriminant-value`. Discriminated-union branches carry a disambiguating `(discriminant=value)` segment in the path so the LLM can see which branch the error applies to.
- **Added** `would_dispatch` runs the validator before the reducer; mismatches return `{status: 'rejected', reason: 'schema-mismatch', errors}` without firing reducer side-effects. `WouldDispatchHost` gains an optional `getMsgSchema()` accessor.
- **Improved** `send_message` delegates to the shared validator. The bespoke top-level-only validator (~80 LOC inside `send-message.ts`) is gone.
- **Improved** `list_actions` synthesizer emits the first branch of a discriminated-union field as the canonical `payloadHint` example, and `fieldHints` carry a synthetic `Discriminated union — set \`<discriminant>\` to one of: ...` summary at the union path so agents don't have to walk the schema for the simple case.

### Docs

- Design doc 11 §2.3 adds a field-type coverage table mapping TypeScript shapes to schema emit. New §2.3a explains schema-driven validation with example errors.

## 2026-04-27 — @llui/agent@0.0.36

**Released:** `@llui/agent@0.0.36`

`list_actions` now derives the agent's affordance surface from the live binding graph only — what the user can click _right now_. Apps that exposed the full `@intent`-tagged Msg union to the LLM no longer cause "UI mysteriously rearranges when the agent dispatches" because hidden Msgs simply aren't listed.

### Breaking

- **`@llui/agent@0.0.36`** — `list_actions` no longer surfaces `'shared'` Msg variants from the schema fallback. The new default is "what's affordable to the user right now": a `'shared'` variant is offered exactly when a tagged event handler is mounted in a live scope (refcount > 0). Variants in dead branches — `show({when: false})`, unmounted `branch()` cases, removed `each` items — auto-vanish via the existing `addDisposer` machinery. The explicit knobs for "agent should reach this regardless of UI state" are `@alwaysAffordable` (per-variant tag, now read by the runtime) and `agentAffordances(state) => Msg[]` on the component definition. `@agentOnly` remains the canonical "no human path at all."

### Migration

- Tag the bulk seed Msgs and agent-driven navigation that don't have a live UI binding with `@alwaysAffordable` (or `@agentOnly` if no human path exists at all). Concrete examples: `Matrix/AddCriteria`, `Matrix/AddAlternatives`, `Matrix/SetManyCells`, `Matrix/Replace`, `Route/Navigate`.
- For `'shared'` variants whose UI is currently open in the user's screen, no change is needed — their bindings are live, so they continue to surface.
- For `'shared'` variants whose UI is closed but you still want the agent to reach (e.g. cell-edit Msgs the agent should be able to dispatch without opening the editor first), tag them `@alwaysAffordable` or list them from `agentAffordances(state)` for the screens where they should be reachable.
- Escape hatch for the old behavior: `agentAffordances: () => allIntentVariants` on the root component (returns every Msg unconditionally). Almost certainly wrong for non-trivial apps but useful as a temporary unblock.

### `@llui/agent@0.0.36`

- **Breaking** `list_actions` default surface tightened — see top of release block.
- **Added** `@alwaysAffordable` JSDoc tag is now read by the runtime: tagged variants surface as `source: 'always-affordable'` regardless of binding state. Previously the tag was extracted by the compiler but ignored at runtime.
- **Fixed** "UI gets messed up when the agent dispatches a Msg" — the agent's affordance surface now mirrors the user's, so dispatching a Msg never pops a hidden subtree into view in places the user didn't navigate to.

### Docs

- Design doc 11 §1.1.4 (`@alwaysAffordable`) and §4 (Source Tier) explain the new default and why off-screen `'shared'` variants are deliberately hidden.
- `@llui/agent` README's annotation table notes the default behavior and the `@alwaysAffordable` / `agentAffordances` opt-in.
- New `/agents` site section "Upgrading an existing install" explains the `npx -y llui-agent@latest` cache-poke needed to pick up new releases.

## 2026-04-27 — @llui/agent@0.0.35, llui-agent@0.0.5, @llui/vite-plugin@0.0.34

**Released:** `@llui/agent@0.0.35`; `llui-agent@0.0.5`; `@llui/vite-plugin@0.0.34`

Two breaking agent-surface changes ship together: opaque random tokens replace JWTs, and the bridge's session tools drop their redundant `llui_` prefix.

### Breaking

- **`@llui/agent@0.0.35`** — agent tokens are now opaque random bearer strings (`llui-agent_<43-base64url>`, ~54 chars) instead of JWTs (~250 chars). Tokens are stored as SHA-256 hashes server-side. The `signingKey` option is gone from `ServerOptions` / `CoreOptions` / every LAP handler / WS upgrade. `routeToAgentDO`'s third argument is now a `resolveTid: (token) => Promise<string | null>` callback (the worker no longer verifies signatures locally; `TokenStore.findByTokenHash` does the lookup).
- **`llui-agent@0.0.5`** — session-management MCP tools renamed: `llui_connect_session` → `connect_session`, `llui_disconnect_session` → `disconnect_session`. In Claude Code these now appear as the cleaner `mcp__llui__connect_session` instead of the doubled `mcp__llui__llui_connect_session`. The forwarded LAP tools (`describe_app`, `get_state`, `send_message`, …) keep their existing names.
- **`@llui/vite-plugin@0.0.34`** — `AgentPluginConfig.signingKey` is gone (mirrors the agent-server removal). The type is now an empty reserved-for-future-options shape (`Record<string, never>`).

### Migration

- Drop any `signingKey` from your `createLluiAgentServer({ … })` call and from `llui({ agent: { signingKey } })` in `vite.config.ts`.
- Drop `process.env.AGENT_SIGNING_KEY` if you set it — it's no longer read.
- Anywhere you reference the bridge tools by name in your own code, scripts, or prompt instructions, drop the `llui_` prefix from the two session tools.
- If you have stuck Claude sessions where `connect_session` "isn't available" / "doesn't appear in the loaded tools", paste a fresh snippet — the new wording in `@llui/agent@0.0.35` tells the model to look for `mcp__<server>__connect_session` and search for it via tool search if it's deferred (the cause of those failures).

### `@llui/agent@0.0.35`

- **Breaking** opaque tokens replace JWT signing. See top of release block.
- **Added** `TokenStore.findByTokenHash()` and `TokenStore.rotateTokenHash()`.
- **Improved** connect snippet now names the LLui MCP server explicitly and flags Claude Code's deferred-tool behavior, so the model can resolve the namespaced tool on either platform.

### `llui-agent@0.0.5`

- **Breaking** session tools renamed to `connect_session` / `disconnect_session`. See top of release block.
- **Improved** the "not bound" error and the bundled `llui-connect` prompt body now name the LLui MCP server and the CC namespacing pattern, matching the new connect-snippet wording.

### `@llui/vite-plugin@0.0.34`

- **Breaking** `AgentPluginConfig.signingKey` removed. See top of release block.

### Docs

- Replaced `/llm-guide` (which duplicated `llms-full.txt`) with two focused pages: `/debugging` (developer-facing — `__lluiDebug`, `@llui/mcp`, `llui_lint`, `llui-mcp doctor`, ESLint rules, trace export/replay) and `/agents` (end-user + app-author — bridge install, connect snippet flow, `@requiresConfirm`, `@llui/agent` integration recipe).

## 2026-04-26 — @llui/eslint-plugin@0.0.18

**Released:** `@llui/eslint-plugin@0.0.18`

### `@llui/eslint-plugin@0.0.18`

- **Fixed** `controlled-input` rule no longer false-positives on `onBlur`-committed inputs. The blur-commit pattern is a legitimate way to wire a reactive `value` binding: state doesn't change during typing, so the binding doesn't overwrite mid-keystroke; blur fires the dispatch that commits the final value. The accepted commit handlers are now `onInput`, `onChange`, or `onBlur`.

## 2026-04-26 — 0.0.32

**Released:** `@llui/{dom,test,router,transitions,components}@0.0.32`; `@llui/vite-plugin@0.0.33`; `@llui/vike@0.0.34`; `@llui/agent@0.0.34`; `@llui/mcp@0.0.27`; `@llui/eslint-plugin@0.0.17`; `@llui/effects@0.0.10`; `llui-agent@0.0.4`

The agent surface gets a major hardening pass driven by dogfooding `decisive.space-2`: `send_message` defaults to a tight diff-only response, missing `@intent` surfaces as `null` instead of synthesising the variant name, the schema tier surfaces documented shared variants without a live binding, and `describe_visible_content` falls back to a generic semantic walk when the app has no `[data-agent]` tags. The Vite plugin's compile-time diagnostics move to ESLint rules; the `@llui/eslint-plugin` recommended config promotes everything to `error` so LLMs (which only act on errors) actually fix what they see.

### Breaking

- **`@llui/agent@0.0.34`** — `LapMessageResponse.stateAfter` is now opt-in. By default `send_message` returns `stateDiff` only; pass `includeState: true` in the request to get the full snapshot back. Callers that tracked state from the response need to either apply diffs against their snapshot from `connect`/`observe` or set the new flag explicitly.
- **`@llui/agent@0.0.34`** — `LapActionsResponse.actions[].intent` is `string | null`. Variants without `@intent` annotation surface as `null` rather than the variant name. Callers that surface affordances to LLMs should treat `null` as "this action is undocumented" — neither synthesise a label from the variant name nor invent one.
- **`@llui/vite-plugin@0.0.33`** — `failOnWarning` and `disabledWarnings` plugin options removed; `DiagnosticRule` export removed. The compile-time `diagnose()` pass is gone — install `@llui/eslint-plugin` and enable its `recommended` config to get the equivalent (and more) checks at lint time. Apps using `disabledWarnings` should remove the option from `vite.config.ts` and selectively disable rules in their `eslint.config.ts` instead.
- **`@llui/eslint-plugin@0.0.17`** — `configs.recommended` promotes every rule to `error`. The `warn` severity tier is gone. Rationale: warnings get reported but not fixed, so anything we shipped as `warn` effectively never improved on its own. Per-package overrides remain the escape hatch for known false positives.

### Migration

- **`stateAfter`.** If your code reads `result.stateAfter` after a `send_message`, either pass `{ includeState: true }` in the request or apply `result.stateDiff` to your prior snapshot.
- **`intent: null`.** Where you previously read `action.intent` as a non-null string, handle the null case (skip the action, ask the user, or display a "no intent" placeholder).
- **`disabledWarnings` → ESLint config.** Move per-rule mutes from `vite.config.ts`'s `disabledWarnings` array to `eslint.config.ts`: `'llui/<rule>': 'off'`. Same rule names — `empty-props`, `namespace-import`, `accessibility`, `controlled-input`, `child-static-props`, `static-on`, `exhaustive-update`, `bitmask-overflow`, `spread-in-children`, `map-on-state-array`.
- **CI red on first upgrade.** Apps not previously running `@llui/eslint-plugin` will see a wave of new errors from the ported diagnostics. Expected — fix or downgrade per-rule.

### `@llui/agent@0.0.34`

- **Added** `includeState: true` request flag on `send_message`. Default is now to omit `stateAfter` and return `stateDiff` only. For a 100-cell matrix that's ~50kb saved per dispatch.
- **Added** `fieldHints: Array<{path, hint}>` on every action. Lifts `@should("…")` JSDoc hints from the schema tree to the action surface so callers don't have to dig through `description.messages.variants[X].field.hint`. Path is dot/bracket notation rooted at the payload (`"cells[].meta"`).
- **Improved** schema-tier action surfacing. Documented `'shared'` variants (those with `@intent`) now appear in `actions` even without a live UI binding, so an agent can dispatch e.g. `Matrix/SetQuantityValue` directly without first opening the cell editor. Previously only `@agentOnly` variants surfaced from the schema tier.
- **Improved** `describe_visible_content` falls back to a depth- and count-capped semantic walk of the entire root when the app has no `[data-agent]` tagged subtrees. New `source: 'data-agent' | 'fallback' | 'truncated'` field on the response signals which path produced the outline.
- **Breaking** `intent: string | null` and `stateAfter` opt-in — see top of release block.

### `@llui/vite-plugin@0.0.33`

- **Improved** cross-file resolver builds an enriched `TypeIndex` that follows named imports for type aliases referenced inside Msg variant payloads. Literal unions like `GridSorting = 'rank' | 'score'` declared in a sibling file now resolve to `{enum: ['rank', 'score']}` in the schema, instead of `'unknown'`.
- **Breaking** `failOnWarning` / `disabledWarnings` removed — see top of release block.

### `@llui/eslint-plugin@0.0.17`

- **Added** eight rules ported from the Vite plugin's compile-time diagnostics: `empty-props`, `namespace-import`, `accessibility`, `controlled-input`, `child-static-props`, `static-on`, `exhaustive-update`, `bitmask-overflow`. All run as editor squiggles instead of build-only console output, with autofix on the trivial cases.
- **Improved** `spread-in-children` is now scope-aware: only fires on genuinely-dynamic spreads. Bounded array literals (`const items = [...]; div([...items.map(...)])`) and known structural-call results stay silent — that footgun was migrated from the Vite version's scanner.
- **Improved** `agent-msg-resolvable` accepts `never` as a valid Msg type argument for stateless components — the canonical "this component dispatches no messages" declaration. Stops the rule from firing on legitimate display modules.
- **Breaking** `recommended` promoted to all-error — see top of release block.

### `@llui/mcp@0.0.27`

- **Improved** picks up the agent surface improvements via the bumped `@llui/agent` peer.

### `@llui/effects@0.0.10`

- **Improved** no behaviour changes; published in lockstep so consumers see a clean set.

### `llui-agent@0.0.4`

- **Added** `send_message` tool advertises the new `includeState` parameter in its zod schema and description; default behaviour mirrors the `@llui/agent` server (diff-only).

### `@llui/{dom,test,router,transitions,components,vike}@0.0.32` (and `@llui/vike@0.0.34`)

- **Improved** lockstep bump to keep peer-dep ranges aligned with `@llui/dom@0.0.32`. No behaviour changes.

### Docs

- **Updated** `docs/designs/02 Compiler.md` to reflect the diagnostics → ESLint move; the doc now points at the lint plugin for static-analysis rules and keeps the compiler's three-pass focus on prop classification, mask injection, and import cleanup.
- **Updated** `packages/vite-plugin/README.md` with the same redirection.

## 2026-04-25 — 0.0.31

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components}@0.0.31`; `@llui/vike@0.0.33`; `@llui/agent@0.0.33`; `@llui/mcp@0.0.26`; `@llui/eslint-plugin@0.0.16`; `llui-agent@0.0.3`

A consolidated batch shipping the agent surface improvements, hydrate parity work, cross-file/composition resolver, lint-rule hardening, components Msg JSDoc sweep, and the four-mount-path refactor accumulated since the previous release. Several behavior-breaking changes — read the Migration section before upgrading.

### Breaking

- **`@llui/dom@0.0.31`** — `hydrateApp` and `hydrateAtAnchor` no longer dispatch the effects returned by `init()` on hydration. The SSR pass already ran them on the server; re-running on the client typically produced duplicate fetches / subscriptions. Opt back in via `MountOptions.runInitEffectsOnHydrate: true`.
- **`@llui/agent@0.0.33`** — `agentConnect.connect()`, `agentConfirm.connect()`, `agentLog.connect()` now return a static prop bag with reactive accessors (matching the `@llui/components` convention) instead of `(state) => bag`. Previous shape was incompatible with the documented "spread into element helpers" usage. The `copyConnectSnippetButton.onClick` now dispatches a new `CopyConnectSnippet` Msg → `AgentClipboardWrite` effect rather than reading state synchronously.
- **`@llui/agent@0.0.33`** — `MessageAnnotations.humanOnly: boolean` replaced with `dispatchMode: 'shared' | 'human-only' | 'agent-only'`. `LapMessageRejectReason: 'humanOnly'` renamed `'human-only'` to match.
- **`@llui/agent@0.0.33`** — agent-only Msg variants (no UI affordance, LLM-only dispatch) are now expressible via `@agentOnly` JSDoc tag and surface in `list_actions`'s `dispatchMode` field.
- **`@llui/eslint-plugin@0.0.16`** — `agent-missing-intent` and `agent-nonextractable-handler` are now `error` (not `warn`) in `configs.recommended`. CI failures expected on first upgrade for unannotated Msg variants — fix is to add `@intent("...")` or `@humanOnly` JSDoc. The `@humanOnly` JSDoc exemption silences the rule on internal-only variants.
- **`@llui/eslint-plugin@0.0.16`** — Dropped name-based heuristics (`name === 'Msg'` / `endsWith('Msg')`) in favour of typed-lint cross-file detection. Rules now use `parserOptions.projectService` when available; fall back to same-file `component<S, M, E>()` arg names otherwise. Configure typed lint for full coverage.

### Migration

- **Hydrate effects.** If your app relied on `init()` effects firing on hydration, set `MountOptions.runInitEffectsOnHydrate: true` (or `RenderClientOptions.runInitEffectsOnHydrate: true` if using `@llui/vike`). Otherwise no action — the default-off direction is the safer one for SSR setups.
- **Agent connect bag.** Replace `connectParts(state).foo` patterns with `connectParts.foo` (static spread). For `connectParts.foo.bar` reactive accessors, the runtime evaluates them per binding-mask hit; in tests, call them as functions: `connectParts.foo.bar(state)`.
- **`humanOnly` reject reason.** Anywhere your code reads `LapMessageRejectReason === 'humanOnly'`, change to `'human-only'`.
- **`MessageAnnotations.humanOnly`.** Anywhere your code reads `annotations.humanOnly`, change to `annotations.dispatchMode === 'human-only'`.
- **Lint failures on upgrade.** Add `@intent("...")` JSDoc above each agent-dispatchable Msg variant, or `@humanOnly` for variants that are framework-internal / UI-only.
- **Typed-lint upgrade path** (recommended): set `parserOptions.projectService: true` in your ESLint config to get cross-file Msg detection and the most precise `agent-msg-resolvable` checks. Without typed lint the rules emit a one-line "Tip: enable parserOptions.projectService" reminder in their error messages.

### `@llui/dom@0.0.31`

- **Fixed** `hydrateApp` now wires devtools and HMR registration the same way `mountApp` / `mountAtAnchor` / `hydrateAtAnchor` do. Previously SSR-hydrated layouts (e.g. the outermost `@llui/vike` app layout) silently dropped out of `window.__lluiComponents`, never set `window.__lluiDebug`, and `replaceComponent(name, def)` was a no-op against them. New `mount-path-parity.test.ts` enforces the wiring across all four entry points.
- **Improved** `MountOptions.runInitEffectsOnHydrate` flag (default `false`) gates the post-swap dispatch of `init()`-time effects on hydration. See top of release block.
- **Improved** the four mount entry points share a `buildAppHandle()` helper for the AppHandle dispose / flush / send / getState / subscribe surface — ~120 lines of duplicate code eliminated. The parity test guarantees behavioral equivalence.
- **Improved** `__llui_mcp_status` discovery now tries both `/__llui_mcp_status` and `/cdn-cgi/llui_mcp_status` so MCP auto-discovery survives `@cloudflare/vite-plugin`'s catch-all worker routing. Distinguishes 404-from-live-server (don't fall back) from network-error (fall back to compile-time port).

### `@llui/vite-plugin@0.0.32`

- **Fixed** all property-key emission goes through `ts.factory.createStringLiteral` instead of bare strings. Discriminants like `'Router/RouteChanged'`, `'order-cancel'`, or reserved words like `'delete'` now serialize as quoted keys instead of bare identifiers (which produces invalid JS).
- **Improved** new `cross-file-resolver.ts` module follows imports + named re-exports + `export *` barrels (with rename, multi-hop, cycle detection) to locate the file declaring a Msg / State / Effect type. Composed unions like `type Msg = ImportedFoo | { type: 'extra' }` get every variant in `__msgAnnotations` and `__msgSchema` regardless of where the variants are declared. Previously the file-local extractors silently dropped non-co-located variants.
- **Improved** `/agent/*` dev middleware also handles `/cdn-cgi/agent/*` with prefix-strip forwarding — same shadowing fix as `__llui_mcp_status` for cloudflare-vite consumers.
- **Improved** `add-js-extensions.mjs` now discovers packages dynamically. The hardcoded `lint-idiomatic` had been silently skipping the renamed `eslint-plugin-llui` for several releases.

### `@llui/test@0.0.32`

- **Improved** README now shows a real, type-checking testComponent example with `send` / `flush` / `state` / `effects` + `assertEffects`. Replaces the API-signature pseudocode that didn't compile and didn't help users get started.

### `@llui/router@0.0.31`

- **Improved** `@llui/dom` peer range bumped to `^0.0.31`.

### `@llui/transitions@0.0.31`

- **Improved** README snippets tagged `// @doc-skip` where they use illustrative `[...]` placeholders.
- **Improved** `@llui/dom` peer range bumped to `^0.0.31`.

### `@llui/components@0.0.31`

- **Improved** all 57 Msg unions now carry `@intent("…")` / `@humanOnly` JSDoc on every variant (362 variants annotated). Composes correctly into downstream apps' annotation maps via `@llui/vite-plugin`'s cross-file resolver — Claude no longer sees synthesized intent labels for `dialog.open`, `tabs.setValue`, etc. Intent text is approximate (camelCase variant names → "Camel case"); maintainers can polish per-variant. Keyboard-only / programmatic-config variants (`focus*`, `highlight*`, `setItems`, `setDisabled`, …) marked `@humanOnly`.

### `@llui/vike@0.0.33`

- **Added** `getLayoutChain(): readonly AppHandle[]` exported function and widened `RenderClientOptions.onMount` to receive `(chain: readonly AppHandle[])`. Consumers wiring observability bridges, custom devtools, or the LAP agent client at the layout level now have a supported API; the old workaround (`window.__lluiComponents[layoutName]`) was unreliable due to the hydrateApp parity bug fixed in this release.
- **Added** `RenderClientOptions.runInitEffectsOnHydrate` forwarded to every layer in the layout chain. Defaults to `false` matching `@llui/dom`'s default.
- **Added** in the `llui_connect_session` MCP tool result: full `observe` bundle (state + actions + description + context) so Claude has everything it needs to act after the connect call. Previous shape returned only `{appName, appVersion, status}` and Claude had to follow up with separate `observe` / `describe_app` / `get_state` calls.

### `@llui/mcp@0.0.26`

- **Improved** `@llui/dom` peer range bumped to `^0.0.31`.
- **Improved** `@llui/eslint-plugin` dependency picks up the typed-lint hint and rule changes via cascade.

### `@llui/eslint-plugin@0.0.16`

- **Added** new rule `agent-msg-resolvable`: at every `component<S, M, E>()` call, errors when the M type is unresolvable (typo, missing import, namespace import, complex type). Three distinct messages so the fix is obvious. In `configs.recommended` and `configs.agent` at error severity.
- **Added** typed-lint cross-file detection in `agent-missing-intent` and `agent-exclusive-annotations`. With `parserOptions.projectService` configured, the rules walk the whole `ts.Program` (cached on a WeakMap) and match Msg unions by symbol identity — finds aliases declared in separate files with unconventional names. Fall-back to same-file heuristic when typed lint isn't configured.
- **Added** `agentExclusiveAnnotationsRule.modeConflict` flags `@humanOnly` and `@agentOnly` on the same variant.
- **Improved** `createRule` URL repointed at `.../src/rules/${name}.ts` since the previous `docs/rules/${name}.md` path 404'd.
- **Improved** every error message appends a "Tip: enable `parserOptions.projectService`" hint when typed lint isn't configured.
- **Fixed** drop name-based heuristics (`name === 'Msg'`, `endsWith('Msg')`) — false-positive prone on unrelated `*Msg`-named types and redundant once typed lint is enabled.

### `@llui/agent@0.0.33`

- **Breaking** `connect()` static-bag refactor + `dispatchMode` enum + `LapMessageRejectReason 'human-only'` — see top of release block.
- **Added** `@agentOnly` JSDoc tag for Msg variants the LLM can dispatch but the UI doesn't bind. Surfaces in `list_actions[].dispatchMode`.
- **Added** `EffectHandlerHost.agentBasePath` configuration so consumers under `@cloudflare/vite-plugin` can route through `/cdn-cgi/agent/*` (the canonical `/agent/*` paths are shadowed by the cloudflare worker catch-all).
- **Added** `CopyConnectSnippet` Msg + `AgentClipboardWrite` effect for the connect snippet copy affordance, replacing the old synchronous-state-read in the click handler.
- **Added** `llui_connect_session` returns the full `observe` bundle. Eliminates the round-trip pattern where Claude had to call `list_actions` + `describe_visible_content` separately after connect.
- **Improved** every variant of `AgentConnectMsg`, `AgentConfirmMsg`, `AgentLogMsg` carries `@intent` (user-actionable) or `@humanOnly` (framework-internal) JSDoc. Phase D1 composition merges these into downstream apps' annotation maps; previously Claude saw synthesized labels for the agent's own message types.
- **Improved** `effect-handler.ts` split into per-effect handler functions with a thin top-level dispatcher (was a 9-case 150-line monolith).
- **Improved** `agentLog.visibleEntries` memoized by parent-state reference. `each(bag.visibleEntries, …)` no longer re-filters per item.
- **Improved** `@llui/dom` peer range bumped to `^0.0.31`.

### `llui-agent@0.0.3`

- **Improved** `@llui/agent` cascade — picks up the connect-bag refactor, dispatchMode enum, and effects-handler split via dependency.

### Docs

- **Added** `scripts/check-readme-examples.mjs` extracts every fenced `ts/tsx` block from each package's README, runs `tsc` against per-package mini-tsconfigs. Wired to `pnpm verify`. Catches docs that drift from the actual API. `// @doc-skip` opt-out for illustrative-only blocks.
- **Added** `scripts/annotate-component-msg.mjs` is the one-shot sweep that produced the components Msg JSDoc above. Idempotent — skips variants that already carry an LAP tag.

## 2026-04-25 — peer-dep packaging fix

**Released:** `@llui/vite-plugin@0.0.31`, `@llui/test@0.0.31`, `@llui/vike@0.0.32`, `@llui/mcp@0.0.25`, `@llui/eslint-plugin@0.0.15`, `@llui/agent@0.0.32`

Critical packaging fix for `@llui/{vike,test,mcp,agent}`: ship `@llui/dom` as a peer dependency instead of a runtime dependency. The old packaging caused dual `@llui/dom` installs in any consumer whose own `@llui/dom` version differed from what the package was pinned to at publish time, producing `provide() can only be called inside a component's view() function` errors from inside view callbacks where the call was manifestly correct.

### Breaking

- **`@llui/vike@0.0.32`, `@llui/test@0.0.31`, `@llui/mcp@0.0.25`, `@llui/agent@0.0.32`** — `@llui/dom` is now a peer dependency, not a transitive runtime dep. Consumers who relied on transitive resolution must declare `@llui/dom` explicitly in their own project's `dependencies`.

### Migration

- Add `@llui/dom` to your project's dependencies if it isn't there: `pnpm add @llui/dom`. Most projects already import from `@llui/dom` directly and have it declared — only ones that relied purely on transitive resolution will hit "cannot find module".
- If you'd applied a `pnpm.overrides` workaround to force a single `@llui/dom` instance, you can remove it — the peer pattern handles deduplication natively.

### `@llui/vite-plugin@0.0.31`

- **Fixed** `transform.ts` picked up a `.js` extension on one relative import that `add-js-extensions.mjs` had missed.

### `@llui/test@0.0.31`

- **Fixed** `@llui/dom` ships as `peerDependencies` + `devDependencies` instead of `dependencies`. Same dual-install fix as `@llui/vike`.

### `@llui/vike@0.0.32`

- **Fixed** `@llui/dom` ships as `peerDependencies` + `devDependencies` instead of `dependencies`. Resolves dual-install / `provide()`-from-view errors. See top of release block for migration.
- **Added** Cloudflare Workers section in the README — documents the `worker.ts` pattern with `import.meta.env.PROD` guard around the `dist/server/entry.mjs` import. Without the guard, dev workerd loads the stale prod build and trips Vike's prod-in-dev detector. The brillout-recommended `process.env.NODE_ENV` snippet silently fails under workerd (no Node `process`).

### `@llui/mcp@0.0.25`

- **Fixed** `@llui/dom` ships as `peerDependencies` + `devDependencies` instead of `dependencies`. Type-only usage in mcp's source, but the packaging anti-pattern was identical.

### `@llui/eslint-plugin@0.0.15`

- **Fixed** 11 source files now have explicit `.js` extensions on relative imports. The `add-js-extensions.mjs` build pass had been silently skipping this package since the `lint-idiomatic` → `eslint-plugin` rename — its hardcoded list still pointed at the old name. No runtime effect (the package is CommonJS), but now consistent with the rest of the monorepo.

### `@llui/agent@0.0.32`

- **Fixed** `@llui/dom` ships as `peerDependencies` + `devDependencies` instead of `dependencies`. Type-only consumer (`Send`, `AppHandle` from agent's client adapters).
- **Fixed** removed phantom `@llui/effects` dependency. The package never imported from `@llui/effects` — only the README example does, and that's user-side app code. Consumers using `handleEffects` in their own app should declare `@llui/effects` themselves (most already do).

### Docs

- **Improved** root `README.md` package table: replaced the stale `@llui/lint-idiomatic` row with `@llui/eslint-plugin`, and added `@llui/agent` + `llui-agent` rows that had been missing.
- **Improved** `/publish` skill now refuses to bump versions if any non-private package has `@llui/dom` in `dependencies` instead of `peerDependencies`. Cascade list derived from `package.json` files instead of a hand-maintained enumeration, so a newly-added peer can't be silently skipped on the next release.

## 2026-04-24 — @llui/agent@0.0.31

**Released:** `@llui/agent@0.0.31`

Cross-runtime portability rework: `@llui/agent` now runs on Cloudflare Workers (via Durable Objects), Deno / Deno Deploy, and Bun in addition to Node. The `ws` library and `node:crypto` are no longer load-bearing in the runtime-neutral path — only the Node adapter imports them.

### Breaking

- **`@llui/agent@0.0.31` direct consumers of `signToken` / `verifyToken` / `signCookieValue`:** these are now async (return `Promise<T>`). The signatures use `crypto.subtle` HMAC-SHA256, which is web-standard and async by design. Wrap call sites in `await`. LAP server usage via `createLluiAgentServer` is unchanged — the async migration is handled internally.

### Migration

- `signToken(payload, key)` → `await signToken(payload, key)` — same for `verifyToken` and `signCookieValue`.
- No changes needed if you only use `createLluiAgentServer({ ... })` at the top level. The Node path signature is unchanged.
- Non-Node deployments: see [Runtime support](https://llui.dev/api/agent#runtime-support) for the Cloudflare / Deno / Bun recipes.

### `@llui/agent@0.0.31`

- **Added** `@llui/agent/server/core` sub-path — runtime-neutral entry that builds the LAP router, registry, and accept-connection primitive without importing `ws` or any `node:*` module. Works on Node, Bun, Deno, and Cloudflare.
- **Added** `@llui/agent/server/web` sub-path — WHATWG WebSocket adapters. Exports `createWHATWGPairingConnection` (wraps any standard `WebSocket` in a `PairingConnection`), `handleCloudflareUpgrade` (uses `WebSocketPair`), `handleDenoUpgrade` (uses `Deno.upgradeWebSocket`), and `extractToken`.
- **Added** `@llui/agent/server/cloudflare` sub-path — `AgentPairingDurableObject` class + `routeToAgentDO` Worker helper. A single Cloudflare Durable Object owns one session `tid`'s in-memory registry; the Worker's fetch handler routes LAP + WebSocket upgrade calls to the DO by token. Full recipe + `wrangler.toml` snippet in the docs.
- **Added** `AgentCoreHandle.acceptConnection(token, conn)` primitive. Runtime adapters call this after accepting a WebSocket in their native way; it validates the token, updates the token store, writes an audit entry, and registers the `PairingConnection`.
- **Added** `PairingRegistry` interface extracted from the `WsPairingRegistry` class. The in-memory implementation is now `InMemoryPairingRegistry` (backward-compatible `WsPairingRegistry` alias preserved). External implementations (e.g. the Durable Object registry) implement the interface directly. Routing primitives (`register`, `send`, `subscribe`, `onClose`) are separate from request/response helpers (`rpc`, `waitForConfirm`, `waitForChange`), which live in `server/ws/rpc.ts` and can be reused across registries.
- **Improved** WebCrypto migration — HMAC sign/verify now go through `crypto.subtle` (standard across Node ≥ 15, Cloudflare, Deno, Bun). Removed `node:crypto` import. `crypto.randomUUID()` (global web standard) replaces `require('node:crypto').randomUUID`.
- **Improved** LAP handler internals — the registry no longer owns in-flight RPC promise tracking or long-poll wait entries. Each handler subscribes to frames via `registry.subscribe(tid, filter)` for the duration of its call, then unsubscribes. This keeps the registry interface small enough that a Cloudflare Durable Object can implement it cleanly.

### Docs

- **Added** Runtime support matrix and full deployment recipes for Node, Deno, Bun, and Cloudflare + Durable Objects in [`/api/agent`](https://llui.dev/api/agent).

---

## 2026-04-24 — 0.0.30

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components}@0.0.30`; `@llui/vike@0.0.31`; `@llui/mcp@0.0.24`; `@llui/eslint-plugin@0.0.14`; `@llui/agent@0.0.30`; `llui-agent@0.0.2`

Two headline changes: `@llui/mcp` grows from 23 → 38+ tools across four new phases (CDP screenshots + a11y, compiler cache introspection, source grep + test/lint, SSR hydration + render). `@llui/agent` adds the `observe` tool and drained `send_message` semantics, cutting the "check state → act → check state" loop from five MCP round-trips to two.

### Breaking

- **`@llui/lint-idiomatic` is gone.** The rules have been migrated into `@llui/eslint-plugin`. Drop the `@llui/lint-idiomatic` dependency, replace imports with `@llui/eslint-plugin`, and remove the old package from any `eslint.config.ts` entries — the rule ids stay the same.

### Migration

- Remove `@llui/lint-idiomatic` from your `devDependencies`, add `@llui/eslint-plugin`, and adjust your ESLint config imports.
- No code changes required for `@llui/agent` users: the new `observe` tool is additive and the new `waitFor: 'drained'` default for `send_message` is a faster, backward-compatible drop-in.

### `@llui/dom@0.0.30`

- **Added** `getCompiledSource`, `getMsgMaskMap`, `getBindingSource`, and `getHydrationReport` on `LluiDebugAPI` — the runtime hooks that back the new `@llui/mcp` compiler/SSR tools. Zero cost in production; only populated when `installDevTools` runs.

### `@llui/vite-plugin@0.0.30`

- **Added** 50-entry LRU compiler cache storing per-component pre/post transform source, Msg→mask map, and binding source locations. Emitted as non-enumerable `Object.defineProperty` calls so production bundles aren't bloated but MCP tooling can read them in dev.

### `@llui/mcp@0.0.24`

- **Added** 15 new tools across four phases:
  - **CDP (6)** — `llui_screenshot`, `llui_a11y_tree`, `llui_network_tail`, `llui_console_tail`, `llui_uncaught_errors`, `llui_browser_close`. Backed by a lazy Playwright attach (`:9222` user-chrome first, fallback to headless) with ring buffers for console/network/errors.
  - **Compiler (3)** — `llui_show_compiled`, `llui_explain_mask`, `llui_goto_binding_source`. Read from the vite-plugin's new compiler cache.
  - **Source (4)** — `llui_find_msg_producers`, `llui_find_msg_handlers`, `llui_run_test`, `llui_lint_project`. Grep + vitest + ESLint at workspace scope.
  - **SSR (2)** — `llui_hydration_report` (diff client vs server-rendered HTML from `data-llui-ssr-html`), `llui_ssr_render`.
- **Added** CLI flags `--url` (dev-server target for Playwright) and `--headed` (visible browser window) so the CDP fallback can point at an existing dev server or run visibly for debugging.

### `@llui/agent@0.0.30`

- **Added** `observe` LAP endpoint + browser RPC handler. One call returns `{state, actions, description, context}`, folding in what used to take three separate calls (`describe_app` + `get_state` + `list_actions`).
- **Added** drain semantics to `send_message`. The default `waitFor: 'drained'` waits for the message queue to go idle (http/delay/debounce round-trips feed back as messages, then quiesce), then returns the fresh state, actions, and a `drain` block with `effectsObserved`, `durationMs`, `timedOut`, and any unhandled effect errors captured during the window. New params: `drainQuietMs` (default 100ms) and `timeoutMs` (default 5000ms, down from 15s).
- **Improved** Response envelope on `dispatched` now carries `actions` alongside `stateAfter`, so the LLM rarely needs a follow-up `observe` after a send.

### `llui-agent@0.0.2` (agent-bridge)

- **Added** `observe` MCP tool routed to `/lap/v1/observe`. `bridge.ts` caches the returned `description` so subsequent `describe_app` calls short-circuit.
- **Improved** `send_message` tool schema advertises `waitFor: 'drained' | 'idle' | 'none'`, `drainQuietMs`, and `timeoutMs` controls. Tool descriptions updated to steer Claude toward the efficient path.

### `@llui/eslint-plugin@0.0.14`

- **Added** Rules migrated from the removed `@llui/lint-idiomatic` package: `agent-exclusive-annotations`, `agent-missing-intent`, `agent-nonextractable-handler`, `each-closure-violation`, and related idiomatic-LLui rules. Rule ids unchanged — only the importing package moved.

### `@llui/vike@0.0.31`, `@llui/test@0.0.30`, `@llui/router@0.0.30`, `@llui/transitions@0.0.30`, `@llui/components@0.0.30`

- **Improved** Cascade from `@llui/dom@0.0.30`. No user-visible behavior changes; `components`, `router`, `transitions` pick up the new `^0.0.30` peer range.

### Docs

- **Added** [`/api/agent`](https://llui.dev/api/agent) adoption guide (install, dev middleware, client wiring, `@intent` / `@requiresConfirm` / `@humanOnly` annotations, `agentDocs` / `agentContext` / `agentAffordances`, DOM tagging, production server setup, efficient tool usage, security).
- **Added** [`/api/agent-bridge`](https://llui.dev/api/agent-bridge) CLI + Claude Desktop config + tool reference.
- **Updated** Package table on the index page and `llms.txt` to list the agent stack.

---

## 2026-04-22 — @llui/vike@0.0.30

**Released:** `@llui/vike@0.0.30`

Point-fix release for a client-navigation regression introduced in 0.0.26 that broke content-driven sites where multiple routes share a single `ComponentDef`. Reported against the llui.dev docs site; other lockstep packages ship unchanged at 0.0.29.

### `@llui/vike@0.0.30`

- **Fixed** Page layer is no longer counted as a "surviving layer" by the chain diff on client navigation. Since 0.0.26, two routes whose `+Page.ts` files resolved to the same `ComponentDef` reference — the normal pattern for content-driven sites where every page re-exports a shared component (e.g. `DocPage`) and per-route `+data.ts` supplies the content — were treated as a matching chain entry. `firstMismatch` advanced past the page slot, the adapter hit the `isNoOp` short-circuit, and only `onMount` fired: URL bar advanced, DOM stayed frozen on the previous route. The chain diff now bounds `firstMismatch` to the layout prefix, so the page slot is always divergent and `init(data)` re-runs on every nav regardless of `ComponentDef` identity — matching the contract the README already documented ("Navigating from `/dashboard/reports` to `/dashboard/overview` only disposes the `Page`"). Persistent layouts, `propsMsg` dispatch on surviving layouts, hydration envelope handling, and chain growth/shrink semantics are unchanged. Three regression tests cover the same-def nav scenario end-to-end.

---

## 2026-04-21 — 0.0.29

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.29`; `@llui/mcp@0.0.23`; `@llui/lint-idiomatic@0.0.13`; **`@llui/agent@0.0.29`** _(first release)_; **`llui-agent@0.0.1`** _(first release)_

Inaugural release of the LLui agent stack: a full LAP (LLui Agent Protocol) server + browser client + Claude Desktop bridge that lets Claude drive any LLui app directly.

### `@llui/agent@0.0.29` _(new package)_

First release. Provides both the server-side LAP endpoint and the browser-side client slices needed to make a LLui app driveable by Claude.

**Server (`@llui/agent/server`)**

- **Added** `createLluiAgentServer(opts)` factory — mounts a full HTTP+WS agent server. HTTP routes: `POST /agent/mint`, `POST /agent/revoke`, `GET /agent/sessions`, `POST /agent/resume/list`, `POST /agent/resume/claim`. LAP routes: `/lap/v1/describe`, `/lap/v1/message`, `/lap/v1/wait`, `/lap/v1/confirm-result`.
- **Added** WebSocket upgrade handler at `/agent/ws` — authenticates via HMAC token, pairs the browser to a Claude session, relays RPC frames.
- **Added** `signToken` / `verifyToken` — HMAC-SHA256 mint/verify with configurable signing key; falls back to a random per-session key in dev.
- **Added** `InMemoryTokenStore` — default token store; pluggable via the `tokenStore` option.
- **Added** `defaultIdentityResolver` — signed-cookie identity; pluggable via `identityResolver`.
- **Added** `defaultRateLimiter` — 60 req/min per identity; pluggable via `rateLimiter`.
- **Added** `consoleAuditSink` — logs every LAP action to stdout; pluggable via `auditSink`.
- **Added** 6 LAP RPC handlers: `get_state` (JSON-pointer path resolution), `list_actions` (bindings + affordances + annotations), `describe_context`, `query_dom`, `describe_visible_content`, `send_message` (annotation gating + confirm-propose flow).
- **Added** `WsPairingRegistry` — tid→pairing map with rpc correlation and pending-confirmation long-poll support.

**Client (`@llui/agent/client`)**

- **Added** `createAgentClient(opts)` factory — composes the WebSocket client with the HTTP effect handler; accepts `wrapConnectMsg`, `wrapConfirmMsg`, `wrapLogMsg` slices for integration with the host app's `update()`.
- **Added** `agentConnect` headless component — manages WS lifecycle (`awaiting-ws → awaiting-claude → active`), token minting, and the connect-snippet for Claude Desktop.
- **Added** `agentConfirm` headless component — handles the pending-confirmation UI flow (propose → user accept/reject → resolved).
- **Added** `agentLog` headless component — ring-buffered action log (`entries: LogEntry[]`); updated via `wrapLogMsg`.
- **Added** `ws-client` — hello frame dispatch, RPC round-trip, `log-append` frame emission with human-readable intent labels built from `@intent` annotations and fixed labels for read tools (`"Read app state"`, `"List available actions"`, etc.).
- **Added** State-update and log-append frame emission so the host app's local `agent.log` slice mirrors Claude's actions in real time.
- **Fixed** Claude-bound activation signal — `ActivatedByClaude` fires only after the server sends `{t: "active"}`, preventing premature `active` status.
- **Fixed** `WsOpened` / `WsClosed` dispatched to `agentConnect` slice on WebSocket events.
- **Fixed** Unknown msg variants rejected early with a structured error; 500 responses now include real `Error` name/message/stack (first 5 frames) in `detail` so Claude sees actionable diagnostics.

### `llui-agent@0.0.1` _(new package)_

First release. A Claude Desktop MCP bridge CLI (`npx llui-agent`) that connects Claude to any running LLui app's agent endpoints.

- **Added** stdio MCP transport — lists and calls LAP tools on behalf of Claude Desktop.
- **Added** `BindingMap` — per-session `{url, token, describe}` state keyed by session ID.
- **Added** `forwardLap` — generic POST dispatcher that proxies tool calls to the app's LAP routes.
- **Added** `/llui-connect` MCP prompt — guides Claude through the connection handshake.
- **Added** Full MCP tool surface: `llui_connect_session`, `get_state`, `list_actions`, `send_message`, `describe_context`, `query_dom`, `describe_visible_content`, `wait`, `confirm_result`.

### `@llui/dom@0.0.29`

- **Added** `AppHandle.subscribe(listener)` — post-update state-change listener. Called after every update cycle with `(newState, prevState)`. Returns an unsubscribe function. Safe to call from outside `view()`.
- **Added** `LluiComponentDef.__msgAnnotations`, `.__bindingDescriptors`, `.__schemaHash` — injected by the compiler; consumed by `@llui/agent` to populate the hello frame without runtime reflection.

### `@llui/vite-plugin@0.0.29`

- **Added** `extractMsgAnnotations` — reads JSDoc tags (`@intent`, `@humanOnly`, `@alwaysAffordable`, `@readSurface`) from the `Msg` union and emits them as `__msgAnnotations` on the compiled `component()` call.
- **Added** `extractBindingDescriptors` — walks `view()` to collect bound message variants and emits them as `__bindingDescriptors`.
- **Added** `computeSchemaHash` — stable SHA-256 over the message schema; emitted as `__schemaHash` so the agent can detect schema drift without a full describe round-trip.
- **Added** `agent?: boolean | AgentPluginConfig` — extends the existing `agent: true` shorthand with an object form accepting `signingKey`. When set, also auto-mounts `@llui/agent/server` HTTP and WS handlers on the Vite dev server so plain `vite dev` has working agent endpoints without a custom `server.ts`.

### `@llui/lint-idiomatic@0.0.13`

- **Added** Rule `agent-missing-intent` — warns when a user-dispatchable `Msg` variant lacks an `@intent` JSDoc tag, which Claude needs to understand what the action does.
- **Added** Rule `agent-exclusive-annotations` — warns when `@humanOnly` and `@alwaysAffordable` appear on the same variant (mutually exclusive).
- **Added** Rule `agent-nonextractable-handler` — warns when an `onEffect` handler can't be statically associated with an effect type, preventing the compiler from extracting its affordances.
- **Fixed** `@humanOnly` variants are now exempt from `agent-missing-intent` — intent annotations on human-only messages were never required.
- **Improved** Perfect-score threshold updated to 20 to account for the new agent rules.

### `@llui/mcp@0.0.23`

- **Improved** Perfect-score threshold updated to 20 to match the new `@llui/lint-idiomatic` rule set.

### `@llui/{test,router,transitions,components,vike}@0.0.29`

- Rebuilt against `@llui/dom@0.0.29`. No source changes.

---

## 2026-04-19 — 0.0.28

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.28`; `@llui/mcp@0.0.22`

Three consumer-reported issues fixed with TDD-first discipline — each lands with failing-test-then-implementation and no workarounds left in the library.

### Breaking

- **`@llui/components@0.0.28`** — `SortableMsg.start` and `SortableMsg.move` gain required `x: number`. Consumers using `connect()` for their handle/root wiring (the 99% case) see no change — `connect` fills `x` from `e.clientX` automatically. Hand-wired dispatchers that construct these messages directly get a TS error pointing at the missing field; add `x: <number>` alongside the existing `y`.

### Migration

- **Hand-wired sortable dispatchers** — add `x: <clientX or 0>` to every `SortableMsg.start` and `.move` literal in your app. `DragState` fixtures in tests get `startX` / `currentX` alongside the existing `startY` / `currentY` (both default to `0` when you don't have a meaningful position).

### `@llui/dom@0.0.28`

- **Fixed** `branch` and `each` disposers now remove their DOM nodes from the parent, not just their scopes. When an outer structural primitive swaps an arm whose children spread a nested `branch` / `each` directly (no wrapping element), nodes the nested primitive inserted AFTER the outer's initial render — each-reconciled rows, inner-branch post-mount case swaps — used to leak. The parent's cleanup only walked its initial-render `currentNodes` snapshot; anything the nested primitive inserted later was invisible to it. The disposer now walks live entries/nodes + anchor and removes them via `parentNode.removeChild`, guarded so cascade-removed subtrees no-op. `show` and `scope` ride this fix through `branch`. 6 new tests in `test/branch-nested-swap.test.ts` pinning every failure mode the repro covered.
- **Added** `AppHandle.getState(): unknown` — sanctioned escape hatch for reading state outside `view()`. Safe from event handlers, adapter `send` wrappers, async callbacks, timers. Returns the current instance state; throws after `dispose()` so stale reads fail loud. Wired into all four mount paths (`mountApp`, `hydrateApp`, `mountAtAnchor`, `hydrateAtAnchor`) plus the HMR replacement handle.
- **Improved** `sample()`'s "called outside view" error now points specifically at `AppHandle.getState()` with an example. The previous message told users "you called a primitive outside a render context" but didn't say what to do instead; the common-case shape (adapter wraps `send`, needs current state) now gets inline migration guidance with copy-pasteable code.

### `@llui/components@0.0.28`

- **Added** `layout: '2d'` option on `sortable.connect(get, send, { id, layout })`. Opt-in 2D support for flex-wrap and grid layouts where same-row items share a Y coordinate. Under the flag: `findTargetAt` ranks by Euclidean distance instead of Y-only; the dragged item's `style.transform` is `translate(dx, dy)` instead of `translateY(dy)`; non-dragged items between source and target get per-item `style.transform = translate(snapshotDelta)` that opens the correct gap regardless of row wrap; `data-shift` is suppressed in 2D so CSS `translateY(var(--sortable-shift))` rules don't fight with the computed transform. `DragState` now always tracks `{startX, startY, currentX, currentY}` — 1D ignores X at render time. Keyboard `moveBy` stays linear-array in both modes (screen-reader-correct; 2D-spatial keyboard nav is a separate feature).
- **Breaking** `SortableMsg.start` and `.move` gain required `x: number`. See top of release block.

### `@llui/{vite-plugin,test,router,transitions,vike}@0.0.28`

- Rebuilt against the new `@llui/dom` version. No source changes.

### `@llui/mcp@0.0.22`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-19 — 0.0.27

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.27`; `@llui/mcp@0.0.21`

Tightens the `DomEnv` contract introduced in 0.0.24 — follow-up hardening after the portal SSR fix in 0.0.26.

### Breaking

- **`@llui/dom@0.0.27`** — `DomEnv.querySelector(selector)` is now a required method on the interface. Previously optional, with `portal()` silently falling back to `globalThis.document` when a custom env didn't implement it. That fallback was exactly the shape that let a Workers-hostile env slip to production without an error — which is the failure mode 0.0.26 had to fix in the first place. Making the method required means any custom env that forgets to wire up selector resolution fails TS compile instead of crashing at render time. Consumers on the three LLui-shipped envs (`browserEnv`, `jsdomEnv`, `linkedomEnv`) need no action; they already implement it.

### Migration

- **Hand-rolled `DomEnv` implementations** — add `querySelector(selector: string): Element | null` that resolves against your env's document (or returns `null` if your env has no meaningful document concept — portal treats `null` as a no-op).

### `@llui/dom@0.0.27`

- **Breaking** `DomEnv.querySelector` required. See top of release block.
- **Improved** Portal's string-target resolution is now a straight `ctx.dom.querySelector` call with no fallback branches — one less silent-failure mode.

### `@llui/{vite-plugin,test,router,transitions,components,vike}@0.0.27`

- Rebuilt against the new `@llui/dom` version. No source changes.

### `@llui/mcp@0.0.21`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-19 — 0.0.26

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.26`; `@llui/mcp@0.0.20`

Fixes two SSR crashes under Cloudflare Workers + `linkedomEnv` that shipped in 0.0.24 / 0.0.25.

### `@llui/dom@0.0.26`

- **Fixed** `<select value={accessor}>` no longer throws under linkedomEnv. Two-part fix: (1) the element helper now defers applying `value` on a `<select>` until after its children are appended — in real browsers and jsdom, setting `select.value` on an empty select was already a silent no-op (value fell through to the first option once options arrived), and on linkedom it was a hard throw. Deferring makes every env agree; the matching `<option>` ends up `selected` regardless. (2) `linkedomEnv()` now patches `HTMLSelectElement.prototype.value` with a custom get/set pair that walks `<option>` children and toggles `[selected]` per HTML-spec semantics. The patch is idempotent and only runs when the descriptor has no setter, so jsdom / real browser envs routed through the factory are untouched.
- **Fixed** `portal()` no longer reaches for bare `document` at render time, which crashed SSR with `ReferenceError: document is not defined` whenever a portal call appeared inside a `show` / `branch` / overlay render callback on Workers. `DomEnv` gains an optional `querySelector?(selector): Element | null`; `browserEnv`, `jsdomEnv`, and `linkedomEnv` all implement it. Portal resolves string targets via `ctx.dom.querySelector` first, falls back to `globalThis.document` for legacy envs that predate the method, and returns `[]` when neither is available — consistent with portal's existing "target not found" branch. Portal is semantically a client-only primitive; SSR emitting nothing is correct.
- **Added** Optional `querySelector?(selector): Element | null` method on the `DomEnv` interface. Added as optional so pre-existing consumer envs built by hand continue to type-check. All LLui-shipped envs implement it.

### `@llui/{vite-plugin,test,router,transitions,components,vike}@0.0.26`

- Rebuilt against the new `@llui/dom` version. No source changes.

### `@llui/mcp@0.0.20`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-19 — 0.0.25

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.25`; `@llui/mcp@0.0.19`

Follow-up to 0.0.24 — fixes a pre-existing `@llui/vike` package.json bug that survived the DomEnv refactor. No API changes.

### `@llui/vike@0.0.25`

- **Fixed** `jsdom` moved from `dependencies` to `peerDependencies` with `peerDependenciesMeta.jsdom.optional: true`. Before this release, installing `@llui/vike` auto-pulled jsdom into `node_modules` even when the consumer used `createOnRenderHtml({ domEnv: linkedomEnv })` on Cloudflare Workers. Now Workers consumers can skip jsdom entirely — matching `@llui/dom`'s shape, where jsdom and linkedom are both optional peers. Consumers using the default `onRenderHtml` export see the standard peer-dep install prompt (`pnpm install jsdom`).

### `@llui/dom@0.0.25`

- **Fixed** Dropped a stale `@ts-expect-error` directive in `src/ssr/linkedom.ts` that became an unused-directive lint error once pnpm started hoisting linkedom via the optional peer declaration. Replaced with an explicit `as unknown as …` cast that tolerates both resolved and unresolved module shapes at build time. Compiled JS is identical to 0.0.24 — this is a TS-only cleanup.

### `@llui/{vite-plugin,test,router,transitions,components}@0.0.25`

- Rebuilt against the new `@llui/dom` version. No source changes. Compiled output identical to 0.0.24.

### `@llui/mcp@0.0.19`

- Rebuilt against the new `@llui/dom` version. No source changes. Compiled output identical to 0.0.18.

---

## 2026-04-18 — 0.0.24

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.24`; `@llui/mcp@0.0.18`

Removes `globalThis` mutation from SSR. `@llui/dom` now threads a `DomEnv` through its render pipeline as a context object instead of patching the process's window. Ships new sub-entries `@llui/dom/ssr/jsdom` + `@llui/dom/ssr/linkedom` for per-call env construction, which fixes a 9+ MiB Cloudflare Workers bundle regression (the old `initSsrDom` pulled jsdom's `tr46` / `whatwg-url` / `punycode` transitive chain into the Worker bundle even when consumers used linkedom at runtime).

### Breaking

- **`@llui/dom@0.0.24`** — `renderToString(def, state?)` → `renderToString(def, state, env)`. The third `env: DomEnv` argument is required. Same change applies to `renderNodes`. Get an env from `@llui/dom/ssr/jsdom` (`jsdomEnv()`), `@llui/dom/ssr/linkedom` (`linkedomEnv()`), or the new `browserEnv()` helper for client-side tests.
- **`@llui/vike@0.0.24`** — `createOnRenderHtml({ Layout, document })` → `createOnRenderHtml({ domEnv, Layout, document })`. The `domEnv: () => DomEnv | Promise<DomEnv>` factory is required. The default `onRenderHtml` export still ships with a built-in jsdom env for zero-config setups; Workers consumers must use `createOnRenderHtml({ domEnv: linkedomEnv })`.

### Migration

- **Direct SSR users (jsdom):** replace `await initSsrDom()` + `renderToString(def, state)` with `const env = await jsdomEnv()` + `renderToString(def, state, env)`. Import `jsdomEnv` from `@llui/dom/ssr/jsdom`.
- **Cloudflare Workers / strict-isolate runtimes:** switch to `linkedomEnv()` from `@llui/dom/ssr/linkedom`. Your Worker bundle no longer pulls jsdom — the rollup graph walker only sees linkedom.
- **Vike consumers:** add `domEnv: jsdomEnv` (or `linkedomEnv`) to your `createOnRenderHtml` options. Import the factory from `@llui/dom/ssr/jsdom` (or `/linkedom`).
- **Hand-patched globals (legacy linkedom workaround):** delete the `Object.assign(globalThis, …)` shim. `linkedomEnv()` returns a self-contained env that the renderer uses directly.
- **`initSsrDom` callers:** update the import path from `@llui/dom/ssr` to `@llui/dom/ssr/legacy`. The shim still works, but living behind its own sub-entry means `@llui/dom/ssr` no longer pulls jsdom into bundles that don't explicitly opt in. Plan a real migration to `jsdomEnv()` before the shim is removed.

### `@llui/dom@0.0.24`

- **Breaking** `renderToString` / `renderNodes` require a `DomEnv`. See top of release block.
- **Added** `clientOnly({ render, fallback? })` primitive for browser-only subtrees. SSR emits `<!--llui-client-only-start-->` + optional fallback + `<!--llui-client-only-end-->` and never invokes `render`; on the client `render` runs inline, participating in the host component's `View<S, M>` bag and bitmask update cycle normally. Pair with dynamic `import()` inside `render` to keep browser-only libraries (Leaflet, Chart.js, Monaco, etc.) out of the SSR bundle's module graph. Discriminates SSR vs client via `ctx.dom.isBrowser` — `browserEnv()` sets it, `jsdomEnv`/`linkedomEnv` don't. Also available as `bag.clientOnly` on the `View<S, M>` helper (destructured form inside `view`).
- **Added** `foreign.mount` now accepts `Instance | Promise<Instance>` return values. When the promise is pending, the container element is inserted into the DOM immediately and `sync` is deferred; the initial `sync` fires on resolve with whatever props the binding observed during the await. Dispose-before-resolve correctly destroys the instance once it arrives. Rejected promises log to `console.error` (they can't reach `errorBoundary` through the microtask queue). Removes the workaround where users had to structure `foreign.mount` as a synchronous closure that referenced a pre-loaded imperative handle — now `await import('leaflet')` inline works directly.
- **Added** `__clientOnlyStub(name)` helper + `'use client'` module directive handled by `@llui/vite-plugin`. A file whose first non-comment statement is `'use client'` is replaced entirely during SSR builds: every `export const NAME = ...`, `export function NAME`, `export class NAME`, and named `export { ... }` list is rewritten to `export const NAME = __clientOnlyStub('NAME')`, and `export default` becomes `export default __clientOnlyStub('default')`. Top-level imports in the directive'd module are dropped from SSR output — any library that crashes on Node/Workers module-init no longer poisons the SSR bundle. Client builds are unaffected (directive is a no-op); atomic-swap hydration replaces the stub's empty placeholder with the real component DOM. Warns on `export ... from '...'` re-exports that bypass the stubbing pass.
- **Added** `DomEnv` interface + `browserEnv()` factory, both exported from `@llui/dom` and `@llui/dom/ssr`. Defines a minimal DOM contract (createElement, createTextNode, createComment, createDocumentFragment, Element, Node, Text, Comment, HTMLElement, HTMLTemplateElement, ShadowRoot, MouseEvent, parseHtmlFragment) that the runtime consumes instead of reaching for `globalThis`.
- **Added** `@llui/dom/ssr/jsdom` sub-entry exporting `jsdomEnv(): Promise<DomEnv>`. Lazy-imports jsdom on call; each call returns a fresh env.
- **Added** `@llui/dom/ssr/linkedom` sub-entry exporting `linkedomEnv(): Promise<DomEnv>`. Lazy-imports linkedom on call; safe on workerd and other strict-isolate runtimes where jsdom's transitive deps can't resolve.
- **Improved** Every internal `document.*` reference migrated to `ctx.dom.*` threading — 19 files, ~40 call sites. `mountApp` / `hydrateApp` / `renderToString` each seed the render context with a `dom: DomEnv` field the primitives read. Concurrent SSR with different DOM implementations in a single process works correctly.
- **Improved** `elTemplate`'s template cache is now per-env (WeakMap keyed on `DomEnv`) so concurrent SSR across jsdom + linkedom never cross-pollinates HTMLTemplateElement instances between envs.
- **Breaking** `initSsrDom()` moved from `@llui/dom/ssr` → `@llui/dom/ssr/legacy`. The shim still works (emits a one-time `console.warn` pointing at the migration path) but must be imported from the new path. Rationale: co-locating the shim with the clean entry meant `await import('jsdom')` stayed reachable from every Worker bundle that only wanted `renderToString`. Splitting into a named sub-entry ensures the jsdom chunk only appears in bundles that explicitly import the legacy path. Migrate: `import { initSsrDom } from '@llui/dom/ssr/legacy'`, then plan a proper migration to `jsdomEnv()` before it's removed.

### `@llui/vite-plugin@0.0.24`

- **Improved** Compiler replaces its internal `document.createElement('template')` IIFE emission with a call to `__cloneStaticTemplate(html)`, a new `@llui/dom` helper that threads through `ctx.dom`. Static-content template clones now work correctly under SSR without needing a patched globalThis. The plugin auto-injects the helper import when it emits the call.
- **Improved** `elTemplate` patch-function signature gains a third `__dom: DomEnv` parameter. Compiler-emitted patch bodies call `__dom.createTextNode(...)` instead of `document.createTextNode(...)` for reactive-text placeholders. App-authored `elTemplate` calls are unaffected — the new parameter is optional in positional terms (unused params don't need to be declared).

### `@llui/vike@0.0.24`

- **Breaking** `createOnRenderHtml` requires a `domEnv` option. See top of release block.
- **Improved** `pageSlot()` threads through `ctx.dom.createComment` for its anchor comment instead of touching `document` directly. Works under any env (jsdom, linkedom, or a custom one) without globalThis state.
- **Improved** Chain-composition `renderNodes` loop accepts an env parameter and uses it to synthesize end-sentinel comments. No more implicit dependency on a global document being alive during the composition pass.

### `@llui/{test,router,transitions,components}@0.0.24`

- Rebuilt against the new `@llui/dom` version. No source changes.

### `@llui/mcp@0.0.18`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-18 — 0.0.23

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.23`; `@llui/mcp@0.0.17`

Post-`0.0.22` polish pass. Ships a real bug fix: HTTP-mode `@llui/mcp` sessions used to route tool calls through dead relay instances (the per-session `LluiMcpServer`'s relay was never `startBridge()`'d), so any tool that needed the browser would fail with `RelayUnavailableError` even when a browser was attached. Upgrade strongly recommended for anyone running MCP in HTTP mode.

### `@llui/dom@0.0.23`

- **Added** `each.render`'s callback bag now carries `h: View<S, M>`. Inside each-render you can now reach for `h.text`, `h.scope`, `h.sample`, etc. without using the top-level imports — symmetric with how `branch.cases[k]`, `show.render`, and `scope.render` receive the View. Both forms still work; destructure whichever is cleaner.
- **Improved** `slice()` wraps the `each` render callback so a lifted `h: View<Sub, M>` is threaded through correctly — code that uses `slice(h, selector).each({ render })` now sees the Sub-typed View inside the render bag.
- **Improved** Dropped the placeholder `<_S, _M>` generics on the internal `BranchOptionsBase` interface — they weren't used in the body. The three variants that extend it (`BranchOptionsExhaustive`, `BranchOptionsNonExhaustive`, `BranchOptionsWide`) continue to carry S, M as before. No user-visible API change.

### `@llui/mcp@0.0.17`

- **Fixed** HTTP-mode session-relay bug. Each HTTP MCP session used to construct a fresh `LluiMcpServer`, which in turn constructed its own `WebSocketRelayTransport`. Only the `bridgeHost`'s relay ever had `startBridge()` called — session relays were dead instances. Any tool call that needed the browser failed even when a browser was attached because the dispatcher's `ctx.relay` pointed at the unstarted session relay. Fix: new `LluiMcpServer.createSessionMcp()` returns a fresh SDK `Server` routing through THIS instance's registry and relay. `cli.ts` calls it per session instead of spawning a new `LluiMcpServer`. A regression test in `test/http-transport.test.ts` pins the shape by asserting `bridge.running: true` in the error diagnostic (the discriminator between a live `bridgeHost` relay and a dead session-local one).
- **Fixed** MCP server version advertised in the `initialize` handshake is now read from `@llui/mcp/package.json` at module init instead of hardcoded as a literal — the hardcoded `'0.0.15'` silently drifted through the `0.0.16` release. Reads once, falls back to `'unknown'` on read failure.
- **Added** `llui-mcp doctor` honors the standard `NO_COLOR` env var and a new `--plain` flag. Falls back to `OK` / `FAIL` glyphs instead of emoji ✓/✗ for CI logs, screen readers, and corporate terminals that don't render U+2713/U+2717.
- **Deprecated** `new LluiMcpServer(<port>)` numeric-port constructor. The options form `new LluiMcpServer({ bridgePort, attachTo? })` is the only shape that expresses HTTP-transport port sharing; numeric form is mostly dead code outside a couple of bridge tests and will be removed in a future release. JSDoc carries the `@deprecated` tag.

### `@llui/{vite-plugin,test,router,transitions,components,vike}@0.0.23`

- Rebuilt against the new `@llui/dom` version. No source changes.

---

## 2026-04-18 — 0.0.22

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.22`; `@llui/mcp@0.0.16`

Follow-up pass on the dicerun2 feedback batch. The `branch()` exhaustiveness-typing gate lands (deferred from 0.0.21). `@llui/mcp` adopts `@modelcontextprotocol/sdk`, gains an HTTP transport, and becomes plugin-spawnable — one `pnpm dev` starts the whole stack. `@llui/vite-plugin` picks up `verbose`, auto-detects `@llui/mcp` as a dep, warns on mismatched MCP state, and auto-spawns the child in HTTP mode. `@llui/mcp` also ships a `doctor` CLI + structured bridge diagnostic for self-describing failures.

### Breaking

- **`@llui/dom@0.0.22`** — `branch.cases` now enforces exhaustiveness at the type level when `on` returns a literal string union. Existing calls with partial `cases` and no `default` that previously compiled silently now require a `default` builder. Wide `string` returns stay lenient (exhaustiveness can't be checked on an infinite domain).
- **`@llui/mcp@0.0.16`** — `LluiMcpServer.start()` is removed. The hand-rolled stdio JSON-RPC loop is replaced by SDK-backed transports; callers drive the protocol via `connect(transport)` (e.g. `StdioServerTransport`, `StreamableHTTPServerTransport`). Direct stdio consumers of the class must refactor; CLI users are unaffected.
- **`@llui/vite-plugin@0.0.22`** — when `@llui/mcp` is installed and `mcpPort` is omitted, the plugin now **spawns** `llui-mcp --http 5200` as a child of the dev server (previously: wire-only to an externally-managed server). If your `.mcp.json` already runs `llui-mcp` via stdio, the spawn is skipped when the marker file is already present — but switching to HTTP transport in `.mcp.json` (`{ "type": "http", "url": "http://127.0.0.1:5200/mcp" }`) is the recommended path forward.

### Migration

- `branch({ on, cases: { a: …, b: … } })` without `default` over a literal union like `'a' | 'b' | 'c'`: add `default: () => []` (or whatever the fallback should be) so the missing cases compile.
- If you embed `@llui/mcp` programmatically (rare — most consumers use the CLI), replace `server.start()` with `await server.connect(new StdioServerTransport())`. The `start()` method no longer exists.
- If you previously ran `npx llui-mcp` in a separate terminal plus configured the Vite plugin with `mcpPort: 5200`: keep that setup — the plugin detects the existing marker and won't double-spawn. Or switch to the plugin-spawn + HTTP `.mcp.json` flow to drop the second terminal.

### `@llui/dom@0.0.22`

- **Breaking** exhaustiveness typing for `branch()` — see top of release block.
- **Added** `ExhaustiveKeys<K, C>` type helper (public) surfaced for consumers composing their own `branch`-like abstractions.
- **Improved** `branch.ts` reconciler tags the Lifetime with `_kind: 'scope'` when `__disposalCause === 'scope-rebuild'`; devtools disposer-log now distinguishes scope rebuilds from branch swaps end-to-end (runtime side was right in 0.0.21; this fills in the kind-string missing link).
- **Fixed** `BranchOptionsBase<_S, _M>` stops tripping the no-unused-vars lint in downstream consumers.

### `@llui/vite-plugin@0.0.22`

- **Added** `verbose?: boolean` option — emits `[llui]`-prefixed `console.info` logs per compiled component file listing reactive state paths and their bit assignments. Off by default.
- **Added** auto-detect: when `mcpPort` is omitted and `@llui/mcp` resolves from the Vite project root, the plugin now defaults to enabling MCP — previously silent opt-out. Explicit `mcpPort: false` still disables, explicit numeric port still selects wire-only.
- **Added** auto-spawn: when auto-detect succeeds, the plugin reads `@llui/mcp`'s `bin.llui-mcp` entry and spawns `llui-mcp --http <port>` as a child of `server.httpServer`, piping stdout/stderr to Vite with `[mcp]` prefix, killing the child on server close. Skipped when the marker file already exists (something else is managing the server).
- **Added** MCP mismatch warning: when `mcpPort` resolves to null but the marker file exists, the plugin emits a one-shot `console.warn` explaining the opted-out state and how to wire things up.
- **Improved** `scope()` is recognized by the path scanner, `__mask` injection, and the static-`on` lint — it sees the same reactive-accessor treatment as `branch`, `show`, `each`, `memo`.
- **Improved** Pass 2 mask injection: new lint variant fires when `scope.on` / `branch.on` reads no state (key never changes, subtree mounts once and never rebuilds). Usually a bug.

### `@llui/mcp@0.0.16`

- **Breaking** `LluiMcpServer.start()` removed — see top of release block.
- **Added** `@modelcontextprotocol/sdk` dependency. `LluiMcpServer` wraps the SDK's `Server` class; tool list/call handlers register via `setRequestHandler` with Zod-backed schemas. The hand-rolled JSON-RPC loop is gone.
- **Added** HTTP transport via SDK's `StreamableHTTPServerTransport`. `llui-mcp --http [port]` (default 5200) listens on `POST /mcp` for JSON-RPC requests, emits SSE-framed responses, and upgrades `/bridge` for the browser WebSocket relay — one port, dual protocol.
- **Added** `llui-mcp doctor` subcommand — offline diagnostic that walks the full failure-mode tree (marker presence, JSON validity, plugin devUrl stamping, bridge-port TCP connectability, recorded-pid liveness). Prints a ✓/✗ punch list; exits 0 on all-pass.
- **Added** `RelayUnavailableError` (exported) — thrown when a tool call needs the browser and no browser is attached. Carries a `diagnostic: BridgeDiagnostic` payload (connection status, bridge state, browser tabs, marker state, `suggestedFix` sentence). The `tools/call` handler surfaces it as an MCP `isError: true` tool result whose content is JSON-serialized diagnostic — callers see _why_ the call failed, not just that it did.
- **Added** `BridgeDiagnostic` type (exported from `@llui/mcp/transports`) for consumers building their own diagnostics UI.
- **Added** `LluiMcpServerOptions` shape — constructor now accepts `{ bridgePort?, attachTo? }` to share an `http.Server` with an externally-managed HTTP transport. Numeric-port constructor still works for backward compat.
- **Improved** `WebSocketRelayTransport` gains an `attachTo: http.Server` mode alongside the standalone `port` mode — HTTP-transport deployments share a single port for MCP + bridge via upgrade routing on `/bridge`.

### `@llui/{test,router,transitions,components,vike}@0.0.22`

- Rebuilt against the new `@llui/dom` version. No source changes.

### Docs

- `@llui/mcp` README documents both usage patterns (plugin-launched HTTP and manual stdio) with `.mcp.json` examples and a `doctor` troubleshooting section.
- Site API docs + llms-full.txt regenerated.

---

## 2026-04-18 — 0.0.21

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.21`; `@llui/mcp@0.0.15`

Big release. Lands the `scope()` + `sample()` primitives for keyed subtree rebuild, renames the internal `Scope` disposal concept to `Lifetime`, threads the `D` (init-data) generic through every public API, and closes every item from the dicerun2 feedback batch — path-scanner false positives, spread-in-children noise, bitmask diagnostic improvements, plus new plugin options for CI (`failOnWarning`, `disabledWarnings`). Three breaking changes in `@llui/dom`; mechanical migrations.

### Breaking

- **`@llui/dom@0.0.21`** — Internal `Scope` disposal-lifetime type renamed to `Lifetime`. The rename surfaces in two public places: the exported `ScopeNode` type becomes `LifetimeNode`, and `MountOptions.parentScope` becomes `MountOptions.parentLifetime`. The runtime itself, DOM output, disposal semantics, and the `_kind` strings on nodes are unchanged — this is a pure naming fix.
- **`@llui/dom@0.0.21`** — `branch.on` narrows from `string | number | boolean` to `string`. Numeric/boolean discriminants coerce at the call site (`on: s => String(s.code)` or `on: s => s.flag ? 'yes' : 'no'`). `branch.cases` becomes optional, and a new `default?: (h) => Node[]` field runs whenever no case matches — the canonical "dynamic rebuild" shape `branch({ on, default })` works without enumerated cases.
- **`@llui/dom,@llui/test@0.0.21`** — Every public API that takes a `ComponentDef` now threads the `D` (init-data) generic. Covers `mountApp`, `mountAtAnchor`, `hydrateApp`, `hydrateAtAnchor`, `renderToString`, `renderNodes`, `addressOf`, `replaceComponent`, `testComponent`, `testView`. Previously a typed-data component required an `as unknown as ComponentDef<S, M, E>` cast at each call site; that cast is no longer needed (and, for non-void D, no longer compiles without it).

### Migration

- Replace every `MountOptions.parentScope` with `parentLifetime`; same for any `ScopeNode` type import (→ `LifetimeNode`). The only consumer outside `@llui/dom` is `@llui/vike`'s layout chain, which this release updates.
- Wrap numeric/boolean `branch({ on })` in `String(...)` and keep case keys as stringified literals. If `cases` didn't cover every possible key, add a `default` builder — the new runtime will now fall back to it instead of rendering nothing.
- Remove `as unknown as ComponentDef<S, M, E>` casts from `mountApp(container, MyDef, data)` and `testComponent(MyDef, data)` call sites; the `D` generic now flows through. Regenerate types (`pnpm turbo check --force`) to confirm nothing else was papering over a real mismatch.

### `@llui/dom@0.0.21`

- **Added** `scope({ on, render })` — rebuilds a subtree when the string-valued key returned by `on(state)` changes. Each rebuild runs in a fresh `Lifetime` with fresh bindings and `onMount` callbacks. Sugar over `branch({ on, cases: {}, default: render })` with the `'scope-rebuild'` disposer cause. Replaces the "each + epoch + closure-captured snapshot" workaround for "rebuild this region when this counter changes" use cases.
- **Added** `sample(selector)` — one-shot imperative state read inside a render context. Available as a top-level `@llui/dom` import and as `h.sample(...)` on the `View` bag (destructure-friendly inside builders). No binding is created, no mask is assigned; ideal for reading a whole-state snapshot inside a `scope()` arm without making the entire subtree reactive.
- **Added** `branch.default` — fallback builder described under Breaking. With `cases` also now optional, `branch({ on: s => String(s.epoch), default: render })` is a valid dynamic-rebuild shape (though `scope()` is the preferred spelling).
- **Added** `ItemAccessor<T>.current()` — returns the whole current item. Fixes primitive-T ergonomics (where the mapped-field branch collapses to method names like `toString`) and lets object-T callers sample the full record without writing `item(r => r)()`.
- **Improved** `D` generic threaded through every public `ComponentDef`-taking API (see Breaking / Migration). Also cascades into `createComponentInstance` internally — `child()` and `lazy()` widen their pre-existing casts to carry the `D` slot.
- **Improved** `View.branch` / `View.scope` / `View.sample` available on the destructured `h` bag.
- **Fixed** `show()` wraps the boolean `when` via `String(...)` internally to match the new string-only `branch.on` — runtime semantics unchanged for user code.

### `@llui/vite-plugin@0.0.21`

- **Added** `failOnWarning` plugin option — routes every diagnostic through `this.error` instead of `this.warn` so lint regressions fail CI without a custom `build.rollupOptions.onwarn` handler.
- **Added** `disabledWarnings` plugin option — silences specific rules without disabling the lint pass. Every diagnostic is tagged with a `DiagnosticRule` (also exported); the tag appears in brackets at the start of each warning message (e.g. `[spread-in-children]`), so authors know what to pass.
- **Added** `scope` recognized by the path scanner and `__mask` injection — the `on` accessor's state paths contribute to the component bitmask, and Phase 1 reconcile is gated by the same mask machinery `branch`/`each`/`show`/`memo` already use.
- **Added** `static-on` lint — warns when `scope.on` or `branch.on` reads no state. The key never changes, so the subtree mounts once and never rebuilds; usually a bug.
- **Improved** Every diagnostic message is now prefixed with `<file>:<line>:<col>: [<rule>] ` — survives custom `onwarn` handlers that log `warning.message` alone.
- **Improved** Bitmask-overflow diagnostic does co-occurrence analysis — when every sub-path of a top-level field always fires in the same set of accessors, suggests reading the parent object as a single unit (one bit vs. N bits) before recommending `child()` extraction. Cheaper refactor, same budget relief.
- **Fixed** Spread-in-children is now scope-aware. Identifier spreads (`...foo`) and array-method spreads (`...foo.map(...)`, `.concat(...)`, etc.) resolving to bounded bindings — array literal, function-call result, or `.map` on a named bounded receiver — no longer fire. Inline `...[…].map(...)` still warns. Closes four concrete noise cases reported from dicerun2: conditional `push` into a local `Node[]`, `.map` over a `const x = […] as const` tuple, storing a helper-call result in a local first, and `.concat` on two named `Node[]` arrays.
- **Fixed** Path scanner unified between `collect-deps.ts` (runtime bit assignment) and `diagnostics.ts` (bitmask-overflow warning). The diagnostics side previously had its own naïve walker that produced false positives for `each({ key })`, `item((t) => t.field)`, array-method callbacks (`.some`, `.filter`, etc.) inside reactive accessors, and user-land helper properties like `sliceHandler({ narrow })`. All four are now silent.
- **Fixed** `onMsg` handlers no longer inflate the path bitmask via the same unified-scanner change.

### `@llui/test@0.0.21`

- **Added** `reducer({ init, update, name? })` — builds a view-less `ComponentDef` so reducer-only suites can drop a definition into `testComponent()` without padding a `view: () => []` field. Default name `__reducer__` surfaces in devtools/HMR if one ever leaks into a real mount.
- **Improved** `testComponent` and `testView` thread the `D` generic through (see Breaking). Typed init data passes without a cast.

### `@llui/vike@0.0.21`

- **Breaking** Consumes the `Lifetime` rename via `MountOptions.parentLifetime` — see top of release block.

### `@llui/mcp@0.0.15`

- **Breaking** Consumes the `Lifetime` rename via `LifetimeNode` — see top of release block.

### `@llui/{router,transitions,components}@0.0.21`

- Rebuilt against the new `@llui/dom` version. No source changes.

### Docs

- New design spec `docs/superpowers/specs/2026-04-18-scope-primitive-design.md` and matching plan under `docs/superpowers/plans/`.
- Cookbook recipe "Rebuild a subtree when a derived value changes" documents the canonical `scope() + sample()` pattern and deprecates the old `each + epoch + closure-snapshot` workaround.
- Site footer exposes `llms-full.txt` alongside `llms.txt` for discoverability.

---

## 2026-04-18 — 0.0.20

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.20`; `@llui/mcp@0.0.14`

Anchor-based mount primitives land in `@llui/dom`, enabling `@llui/vike`'s `pageSlot()` to emit a bare comment marker instead of a wrapper div. Also in `@llui/dom`: a new `unsafeHtml` primitive for rendering trusted HTML strings (markdown output, syntax-highlighted code, server snippets).

### Breaking

- **`@llui/vike@0.0.20`** — `pageSlot()` now emits `<!-- llui-page-slot -->` instead of `<div data-llui-page-slot="">`. Apps that styled or queried the slot element directly must wrap `pageSlot()` in their own styled element. The scope-tree behavior is unchanged.

### Migration

- If you were styling the page slot (e.g. `.page-slot { display: flex }` or `[data-llui-page-slot] { ... }`), move the styles to an enclosing element you add inside your layout view: `main([pageSlot()])`, `div({ class: 'page-slot' }, [...pageSlot()])`, etc.
- If you were querying the slot via `document.querySelector('[data-llui-page-slot]')`, switch to walking comment nodes (`TreeWalker(..., SHOW_COMMENT)`) or query your own wrapping element.

### `@llui/dom@0.0.20`

- **Added** `mountAtAnchor(anchor, def, data?, opts?)` and `hydrateAtAnchor(anchor, def, serverState, opts?)` — mount or hydrate a component relative to a comment anchor rather than inside a container element. Uses a synthesized end sentinel (`<!-- llui-mount-end -->`) to bracket the owned DOM region; dispose walks between the sentinels so top-level `each` / `show` / `branch` mutations within the component are always cleaned up correctly. Publicly exported — usable outside `@llui/vike` for anywhere you want to embed a reactive component at a comment anchor (e.g. inside rendered markdown).
- **Added** `unsafeHtml(html, mask?)` primitive — escape hatch for rendering trusted HTML strings into the DOM. Accepts a static string or a reactive accessor. The reactive path short-circuits on strict string equality so unchanged HTML preserves subtree identity (focus, selection, listeners attached outside LLui). Callers own sanitization — the parsed subtree is opaque to the framework (no nested bindings, events, or primitives). Wired into `View<S, M>` and `slice()`'s view bag.
- **Improved** `HmrEntry` becomes a discriminated union (`kind: 'container' | 'anchor'`) with a new `registerForAnchor` export. `replaceComponent` handles both kinds with appropriate DOM cleanup + insertion strategies, so hot-swap works for anchor-mounted instances without touching their outer DOM.
- **Improved** new `_removeBetween` and `_findEndSentinel` helpers in `mount.ts`. Both guard a null `parentNode` defensively so a detached anchor at dispose time is a no-op rather than a thrown `TypeError`.

### `@llui/vike@0.0.20`

- **Breaking** `pageSlot()` emits a comment anchor. See top of release block.
- **Improved** SSR stitching in `on-render-html.ts` uses `insertBefore` relative to the anchor plus a synthesized end sentinel per layer, replacing the old `appendChild`-into-marker approach.
- **Improved** client adapter in `on-render-client.ts` dispatches between `hydrateApp`/`mountApp` (root container) and `hydrateAtAnchor`/`mountAtAnchor` (inner anchors) based on node kind. Nav swaps rely on per-layer `handle.dispose()` for region cleanup instead of the old top-down `leaveTarget.textContent = ''`.
- **Improved** exports `_renderChain` and `_mountChainSuffix` `@internal` for direct testing.

### `@llui/{vite-plugin,test,router,transitions,components}@0.0.20`

- **Added** cascade bump — no user-visible changes; picks up the new `@llui/dom@0.0.20` peerDependency range.

### `@llui/mcp@0.0.14`

- **Added** cascade bump — no direct changes. Picks up `@llui/dom@0.0.20` via workspace resolution.

## 2026-04-17 — 0.0.19

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.19`; `@llui/effects@0.0.9`; `@llui/mcp@0.0.13`

Phase 1 of the MCP debug-API expansion lands: 21 new MCP tools, 16 new `LluiDebugAPI` methods, four dev-mode runtime trackers in `@llui/dom`, and a dev-only effect interceptor hook in `@llui/effects`. Plus three correctness fixes carried along from parallel work on `child()`, per-case mask analysis, and Vike page context typing.

### `@llui/dom@0.0.19`

- **Added** 16 new `LluiDebugAPI` methods, populated on `installDevTools`:
  - DOM: `inspectElement`, `getRenderedHtml`, `dispatchDomEvent`, `getFocus`
  - Bindings/scope: `forceRerender`, `getEachDiff`, `getScopeTree`, `getDisposerLog`, `getBindingGraph`
  - Effects: `getPendingEffects`, `getEffectTimeline`, `mockEffect`, `resolveEffect`
  - Time-travel/utility: `stepBack`, `getCoverage`
  - Eval: `evalInPage` (runs user JS via `new Function()` with an observability envelope — state diff, new history entries, new pending effects, dirty bindings).
- **Added** four dev-mode ring-buffer trackers: each-diff log (100), disposer log (500), effect timeline (500), Msg coverage. All zero-cost in production — populated only when `installDevTools` runs, gated on a module-level flag.
- **Added** scope `_kind` tagging (`root | show | each | branch | child | portal | foreign`) set by each structural primitive at creation; reset on pool recycle. Powers `getScopeTree`'s classification without a separate lookup.
- **Added** new exported types: `ElementReport`, `ScopeNode`, `EachDiff`, `DisposerEvent`, `PendingEffect`, `EffectTimelineEntry`, `EffectMatch`, `StateDiff`, `CoverageSnapshot`, `MessageRecord`.
- **Added** `kind='effect'` binding variant for side-effect-only watchers. `applyBinding` is a typed no-op; Phase 2 runs the accessor without diffing or writing `lastValue`. Used internally by `child()`'s prop-watch binding, eliminating per-tick object stringification onto a detached anchor.
- **Fixed** `child()` propsMsg loop vector. Framework-synthesized propsMsg messages now dispatch through `originalSend`, bypassing the `onMsg` wrapper — a naive `onMsg: m => echo(m)` no longer bounces props/set back to the parent and loops forever.
- **Improved** mocked effects auto-deliver their response via the effect's own `onSuccess` callback on a microtask (same timing contract as a real async resolve), making `llui_mock_effect` usable as a testing primitive.

### `@llui/effects@0.0.9`

- **Added** `_setEffectInterceptor(hook | null)` dev-only hook. Zero-cost in production — one null check per dispatch; no allocation when the hook is null. Reserved for Phase 2 (Worker / off-loop effect interception); Phase 1 `@llui/dom` intercepts upstream at the update loop, so Phase 1 callers of the hook won't see invocations. Documented in JSDoc.

### `@llui/vite-plugin@0.0.19`

- **Added** MCP marker file now carries an optional `devUrl` field. The plugin stamps the dev URL when Vite's HTTP server starts listening; marker updates handle both orderings (MCP-before-Vite and MCP-after-Vite). The `llui:mcp-ready` HMR event broadcasts the full marker so the browser relay doesn't depend on `fs.watch` side-effects.
- **Added** diagnostic that warns when a `child()` `props` accessor returns an object literal whose values are themselves freshly-constructed object/array literals. Prop diffing compares top-level keys by `Object.is` — a fresh reference reports "changed" every render, firing `propsMsg` on every parent update.
- **Fixed** `analyzeModifiedFields` now bails out on `SpreadAssignment`s whose source isn't the state parameter (e.g. `...msg.props`). The previous code treated every spread as a noop, which produced narrow `caseDirty` masks excluding fields the spread actually overwrites. Symptom: stale DOM on props/set after a spread-based reducer. `show()` reconcile seemed to work only because mounting a fresh arm created new bindings that happened to read current state.

### `@llui/mcp@0.0.13`

- **Added** 21 new MCP tools routed through a new `ToolRegistry` with layer-tag dispatch (`debug-api | cdp | source | compiler`):
  - View/DOM (5): `llui_inspect_element`, `llui_get_rendered_html`, `llui_dom_diff`, `llui_dispatch_event`, `llui_get_focus`
  - Bindings/scope (6): `llui_force_rerender`, `llui_each_diff`, `llui_scope_tree`, `llui_disposer_log`, `llui_list_dead_bindings`, `llui_binding_graph`
  - Effects (4): `llui_pending_effects`, `llui_effect_timeline`, `llui_mock_effect`, `llui_resolve_effect`
  - Time-travel/utility (5): `llui_step_back`, `llui_coverage`, `llui_diff_state`, `llui_assert`, `llui_search_history`
  - Eval (1): `llui_eval`
- **Improved** internal layout: `packages/mcp/src/index.ts` shrinks from 747 → ~244 lines. Tool handlers live in `tools/debug-api.ts`; WebSocket relay lives in `transports/relay.ts` as `WebSocketRelayTransport implements RelayTransport`. Same public API (`LluiMcpServer`, `connectDirect`, `handleToolCall`).
- **Added** `setDevUrl(url)` on `LluiMcpServer`. Extends the marker write so CDP-fallback consumers (Phase 2) can find the dev URL.

### `@llui/vike@0.0.19`

- **Fixed** `pageContext.data` now honors `Vike.PageContext` augmentations. The server and client hook interfaces previously declared `data?: unknown` inline, so consumer augmentations of Vike's global namespace never reached the hook callbacks — every `document({ pageContext })` / nav callback had to cast. A conditional lookup on `Vike.PageContext` resolves to `unknown` when unaugmented and to the user's type when declared. An ambient stub of the `Vike` namespace lets the package type-check standalone and merge cleanly when `vike` is installed alongside.

### `@llui/{test,router,transitions,components}@0.0.19`

- **Added** cascade bump — no user-visible changes; picks up the new `@llui/dom@0.0.19` peerDependency range.

### Docs

- `packages/mcp/README.md`, `site/content/api/mcp.md`, `site/content/cookbook.md`, `site/content/llm-guide.md`, `CLAUDE.md`, `docs/designs/07 LLM Friendliness.md`, `docs/designs/09 API Reference.md` all updated with Phase 1 additions (tool tables, API types, browser console examples, package row).

## 2026-04-15 — 0.0.18

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.18`; `@llui/mcp@0.0.12`

Hotfix release for a compiler regression in 0.0.17 that silently broke form-error rendering inside child components whose view factored structural blocks into helper functions. Anyone running 0.0.17 against `@llui/components`'s `dialog.overlay` with a form body inside should upgrade.

### Migration

- **Delete any `stripFastPath`-style workaround** that strips `__update` / `__dirty` / `__handlers` from concrete `ComponentDef`s before passing them to `child({ def })`. The compiler fast path is now correct — pass the concrete def directly.
- **Delete any `widenDef`-style wrapper** still in use at a `child({ def })` boundary. 0.0.17's `AnyComponentDef` alias already made the wrapper unnecessary for typing; 0.0.18 removes the runtime reason it was accidentally helping (it was stripping the broken fast path, not widening).

### `@llui/vite-plugin@0.0.18`

- **Fixed** `detectArrayOp` no longer short-circuits structural reconcile when a case's `caseDirty` doesn't intersect the computed `structuralMask`. The optimization was unsafe because `computeStructuralMask` only walks the view function's lexical AST — it does not descend into helper function calls. A view like `view: () => [...show({ when: s => s.mode === 'signin', render: () => [signinFormBody(send)] })]` where `signinFormBody(send)` internally does `...show({ when: s => s.errors.email !== undefined, ... })` produces a `structuralMask` that contains the `mode` bit but misses `errors.email`. The submit case's `caseDirty` then had no overlap with `structuralMask` even though the inner show block's mask DOES depend on `errors`, and the compiler emitted `method = -1` ("skip structural blocks") for the submit handler. At runtime `_handleMsg` skipped Phase 1 entirely, the helper-hidden show blocks never reconciled, and error paragraphs never mounted despite state having changed. The symptom was "submit button click doesn't show validation errors" — reproducible against any component that factors its form body into a helper function. Fixed by removing the unsafe short-circuit. Non-empty cases now always fall through to `'general'` (`method = 0`) unless an explicit array op (clear/remove/mutate/strided) is detected. Phase 1 runs unconditionally; `_handleMsg`'s existing per-block `(block.mask & dirty)` check filters uninterested blocks at near-zero cost. The `modifiedFields.length === 0` short-circuit is preserved — a case that returns `[state, []]` unchanged is a real tautology and still emits `method = -1`. Regression tests in `packages/vite-plugin/test/show-helper-reconcile.test.ts` cover the helper-hidden shape, a minimal cross-function mode+errors variant, and the preserved noop tautology.

### `@llui/dom@0.0.18`

- **Improved** `useContextValue` docstring now has a dedicated "Value capture contract" section spelling out that the returned value is captured once at view-construction time. Storing the return in a closure inside `view()` and reading from event handlers is the correct and efficient pattern for stable dispatcher bags; consumers that need to see later re-publishes from a parent must use the reactive `useContext(ctx)` form. The docstring also documents the pairing rule: `useContextValue` must be used with `provideValue` on the producer side; using it against a state-reading provider will pass `undefined` to the accessor and likely throw or return garbage.

### `@llui/{test,router,transitions,components,vike}@0.0.18`

- **Improved** Cascade bump from `@llui/dom@0.0.18` (tier-1 lockstep). No direct code changes — same contracts as 0.0.17. `components`, `router`, and `transitions` also have their `peerDependencies["@llui/dom"]` range updated from `^0.0.17` to `^0.0.18`.

### `@llui/mcp@0.0.12`

- **Improved** Cascade bump from `@llui/dom@0.0.18` runtime dependency. No direct code changes — same contracts as 0.0.11.

### Docs

- **Improved** Cookbook "Persistent Layouts → Layout ↔ Page communication" recipe now documents the `useContextValue` capture contract inline — when to reach for it vs the reactive `useContext` form.
- **Improved** LLM guide rules bullet extended with the capture contract note so LLMs picking up the context-dispatcher pattern from the guide see the warning.

## 2026-04-15 — 0.0.17

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.17`; `@llui/mcp@0.0.11`

Follow-up release for four reports against 0.0.16's persistent-layout work. Covers a functional gap (no prop updates on surviving layers), a type-system ergonomics issue (`widenDef` invariance across three APIs), a docs filename collision (`+Layout.ts` vs Vike's own convention), and an API shape wart (`useContext` awkward for static dispatcher bags).

### Migration

- **Revert any `widenDef`-style helper** you wrote to pass a concrete `ComponentDef<S, M, E, D>` into `child({ def })`, `createOnRenderClient({ Layout })`, or `createOnRenderHtml({ Layout })`. Concrete component definitions now assign structurally into these APIs via the new `AnyComponentDef` alias — no widening needed.
- **Revert any module-level pub/sub bridge** you wrote to deliver nav data into a persistent layout. `createOnRenderClient` now pushes fresh `lluiLayoutData[i]` into surviving layers through their `propsMsg` handler on every nav — opt in by setting `propsMsg: (data) => ({ type: 'navChanged', data })` on the layout def.
- **Consider switching static dispatcher-bag contexts** from the reactive `provide(ctx, accessor, children)` / `useContext(ctx)` pair to the new `provideValue(ctx, value, children)` / `useContextValue(ctx)` forms. Call sites become `useContextValue(ctx).method(...)` instead of `useContext(ctx)(undefined as never).method(...)`. The reactive forms still exist for context values that track state.
- **Rename any layout file called `+Layout.ts`** (per the previous release's docs) to `Layout.ts` or similar — the `+` prefix is Vike's own framework-adapter convention and collides with `@llui/vike`'s `Layout` option.

### `@llui/vike@0.0.17`

- **Fixed** Surviving layers on client nav now receive fresh `lluiLayoutData[i]` through their `propsMsg` handler. Previously the chain diff identified which layers to keep alive but never delivered the updated data slice — a persistent layout tracking pathname, session, breadcrumbs, or nav-highlight state was frozen at whatever it initialized with on first mount. The adapter now walks the shared prefix after the diff, shallow-key `Object.is`-diffs each surviving layer's new data against its stored slice, and dispatches the layer's `propsMsg(newData)` result through the new `AppHandle.send` channel on change. Layers without `propsMsg` are skipped silently — opt-in. Mirrors `child()`'s prop-diff and dispatch behavior exactly.
- **Fixed** `createOnRenderClient({ Layout })` and `createOnRenderHtml({ Layout })` now accept concrete `ComponentDef<S, M, E, D>` without a widening helper. Previously the `Layout` option was typed as `ComponentDef<unknown, unknown, unknown, unknown>`, which uses property syntax and is contravariant in each type parameter — concrete definitions were rejected with "Type 'void' is not assignable to type 'unknown'" on the `init` field. The option is now typed as `AnyComponentDef` (a new type-erased alias exported from `@llui/dom` using method syntax for bivariance) so structural assignment succeeds without any `widenDef` wrapper. `ChildOptions.def` uses the same alias — the same gap in `child({ def })` is fixed by the same change.
- **Improved** Docs no longer recommend `pages/+Layout.ts` as the layout filename. Vike reserves the `+` prefix for its own framework-adapter config conventions, and `+Layout.ts` specifically is interpreted by `vike-react` / `vike-vue` / `vike-solid` as a framework-native layout config — collides with `@llui/vike`'s `Layout` option. All JSDoc examples, the README, cookbook recipe, LLM guide, and `pageSlot()` primitive doc now show `pages/Layout.ts` (no prefix) with an explicit warning paragraph explaining why.

### `@llui/dom@0.0.17`

- **Added** `AnyComponentDef` exported from `@llui/dom` (and from `@llui/dom/internal` for framework adapters). A type-erased component-definition shape using method syntax for bivariance — concrete `ComponentDef<S, M, E, D>`s assign structurally without any widening helper. Used by `child()`, `createOnRenderClient({ Layout })`, and `createOnRenderHtml({ Layout })` as the consumer-facing type for opaque component definitions at module boundaries. The existing `LazyDef<D>` (used by `lazy()`) remains parameterized on `D` for the lazy-loader case.
- **Added** `AppHandle.send(msg)` exposes the mounted instance's send channel through the handle object, allowing adapter-level code to dispatch messages into long-lived instances from outside their normal view-bound `send` path. No-op after `dispose()`. Used by `@llui/vike`'s persistent-layout chain to push layout-data updates into surviving layer instances on client navigation. `mountApp`, `hydrateApp`, and `hmr.replaceComponent` all populate the new method; existing consumers that only use `dispose()` and `flush()` are unaffected.
- **Added** `provideValue<T>(ctx, value, children)` and `useContextValue<T>(ctx)` as static-bag companions to the existing reactive `provide` / `useContext` primitives. For the common case of publishing a stable dispatcher record (toast queues, session managers, DI containers — anything that doesn't depend on parent state), `provideValue` wraps the value in a constant accessor and `useContextValue` resolves it with a single function call. Replaces the `useContext(ctx)(undefined as never).method(...)` pattern with `useContextValue(ctx).method(...)`. The reactive primitives still exist and are still the right call when the context value DOES need to track state.

### `@llui/{vite-plugin,test,router,transitions,components}@0.0.17`

- **Improved** Cascade bump from `@llui/dom@0.0.17` (tier-1 lockstep). No direct code changes — same contracts as 0.0.16. `components`, `router`, and `transitions` also have their `peerDependencies["@llui/dom"]` range updated from `^0.0.16` to `^0.0.17`.

### `@llui/mcp@0.0.11`

- **Improved** Cascade bump from `@llui/dom@0.0.17` runtime dependency. No direct code changes — same contracts as 0.0.10.

### Docs

- **Added** Doc updates across the `@llui/vike` README, cookbook "Persistent Layouts" recipe, LLM guide section + rules bullet: everything shows `provideValue` / `useContextValue` for the layout-owned dispatcher pattern, uses `pages/Layout.ts` as the filename with an explicit warning against `+Layout.ts`, and the cookbook + llm-guide spell out when to reach for the static-bag primitives vs the reactive ones.
- **Improved** `examples/vike-layout` switched both `ToastContext` and `SessionContext` to `provideValue` + `useContextValue`. Dropped `SessionDispatcher.getUser` from the contexts module with a note explaining why — context accessors can't reach across instance boundaries to read live layout state, so exposing a state-reader dispatcher from a layout context was always subtly broken.
- **Improved** `scripts/publish.sh` now runs `pnpm whoami` as an auth preflight and auto-runs `pnpm login` interactively when the token is expired or missing. Previously a stale token produced nine consecutive `E404` errors (npm returns 404 on PUT for unauthenticated writers to avoid leaking scope existence) which was confusing if you didn't know the pattern. Not a package change — only visible to maintainers running publish.

## 2026-04-15 — 0.0.16

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.16`; `@llui/mcp@0.0.10`; `@llui/lint-idiomatic@0.0.12`

Headline: **persistent layouts** in `@llui/vike`. Declare app chrome (header, sidebar, session state, portalled dialogs) as a `Layout` component that stays mounted across client navigation — only the route's page disposes and re-mounts. Nested layout chains and per-route chain resolvers both supported from day one. Plus the supporting runtime primitives in `@llui/dom`, a compiler walker fix, and two lint-rule false-positive fixes.

### `@llui/vike@0.0.16`

- **Added** `Layout` option on `createOnRenderClient` / `createOnRenderHtml`. Accepts a single `ComponentDef`, an array `[outer, ..., inner]` for nested chains, or a `(pageContext) => chain` function for per-route resolution. Persistent layouts stay mounted across client nav; only the divergent suffix of the chain disposes and re-mounts. Outer-layer DOM — and every portal, focus trap, scroll position, and effect subscription rooted inside it — survives page swaps.
- **Added** `pageSlot()` primitive (exported from `@llui/vike/client`) — a declarative structural marker a layout places in its view to declare where the nested Page or nested Layout renders. Creates its scope as a child of the current render scope so contexts flow from layout providers through the slot into the page via standard `useContext` lookups. Call exactly once per layout; layouts with zero or two-plus slots throw with descriptive errors.
- **Added** Chain diff on nav walks old and new chains in parallel by component identity and preserves every shared prefix layer. Navigating between `/dashboard/reports` and `/dashboard/overview` disposes only the innermost `Page`; navigating from `/dashboard/*` to `/settings` collapses the chain to `[AppLayout]`. Per-route resolvers enable this cleanly.
- **Added** Chain-aware hydration envelope: `window.__LLUI_STATE__` is now `{ layouts: [{ name, state }, ...], page: { name, state } }` for layout-using pages. Entries carry the component name so server/client chain mismatches fail loud with a clear error instead of silently binding wrong state to wrong instance. The legacy flat envelope shape is still read for pages without a configured `Layout` — no migration required for existing apps.
- **Added** Regression tests covering single-layout mount + nav, nested 3-layer chains, context flow through the slot, chain diffing with per-route resolvers, SSR composed rendering, and error paths (missing `pageSlot` in a layout, `pageSlot` called from the innermost page). 10 tests in `packages/vike/test/layout.test.ts`.

### `@llui/dom@0.0.16`

- **Added** `MountOptions.parentScope` on `mountApp` / `hydrateApp` — when provided, the mounted instance's `rootScope` becomes a child of that scope. This is the keystone that makes persistent layouts compose: `@llui/vike`'s `pageSlot()` uses it to parent a page instance into its enclosing layout's scope tree, so `useContext` lookups walk layer boundaries and scope disposal cascades in the right direction on nav.
- **Added** `@llui/dom/internal` subpath export. Surfaces low-level primitives (`getRenderContext`, `setRenderContext`, `clearRenderContext`, `createScope`, `disposeScope`, `addDisposer`) for framework-adapter packages that need to build structural primitives like `pageSlot()` on top of the runtime. Not part of the public app-author API — stability contract applies only to the main `@llui/dom` barrel.
- **Added** `renderNodes` and `serializeNodes` factored out of `renderToString`. Chain renders (e.g. `@llui/vike/server`'s layout-composed SSR) can now render multiple instances, append their outputs into each other's slot markers, and serialize the composed tree once with the union of every layer's bindings. `renderToString` is a trivial one-liner on top and its public contract is unchanged.
- **Fixed** `elSplit` children now flatten nested arrays one level, matching `createElement`'s existing behavior. Patterns like `main([helperReturningNodeArray()])` worked in unit tests (raw path flattens) but silently crashed at SSR build time because the compiled path didn't. Both paths now agree — catches this class of test-vs-production mismatch permanently.

### `@llui/vite-plugin@0.0.16`

- **Fixed** `computeAccessorMask`'s AST walker no longer crashes on chained method calls inside template literals inside reactive accessors. Previously a pattern like `text((_s) => \`$${item.x.toLocaleString()}\`)`inside an`each()`row crashed the whole build with "Cannot read properties of undefined (reading 'kind')" — the row-factory rewrite synthesizes new sub-trees whose inner`PropertyAccessExpression`nodes have no parent pointers, and the walker's`ts.isPropertyAccessExpression(node.parent)`crashed on undefined. Guarded every parent access in the walker; mask accounting is unchanged because resolving a chain from an inner PAE produces a prefix of the outer chain (idempotent`|=`). Regression tests in `accessor-walker-parent.test.ts`.

### `@llui/lint-idiomatic@0.0.12`

- **Fixed** `state-mutation` rule's "Increment/decrement on state" check no longer flags all prefix and postfix unary operators on state access — only `++` and `--` count as mutations. Before the fix, the canonical toggle reducer `return [{ ...state, flag: !state.flag }, []]` was flagged as a mutation because `!` is a prefix unary operator; `-state.x`, `~state.x`, `+state.x` were caught the same way.
- **Fixed** `spread-in-children` rule now exempts `provide` and `pageSlot` alongside the existing structural-primitive exemptions (`each`, `show`, `branch`, `virtualEach`, `onMount`). Both return `Node[]` and must be spread, and the rule was tripping on every layout authoring pattern that placed a context provider or page slot inside an element-helper children array.
- **Fixed** `@llui/lint-idiomatic/vite` plugin now reads source from disk via `readFileSync(id)` inside the transform hook instead of trusting the pipeline `code` argument. Before the fix, `enforce: 'post'` meant the plugin was linting the AST AFTER `@llui/vite-plugin` had rewritten component bodies — compiler-generated row-updater `++` / `--` loops triggered false-positive `state-mutation` warnings that didn't correspond to anything in user source. Reading from disk guarantees we only ever see what the author wrote.

### `@llui/mcp@0.0.10`

- **Improved** Cascade bump from `@llui/dom@0.0.16` and `@llui/lint-idiomatic@0.0.12` runtime dependencies. No direct code changes — same contracts as 0.0.9.

### `@llui/{test,router,transitions,components}@0.0.16`

- **Improved** Cascade bump from `@llui/dom@0.0.16` (tier-1 lockstep). No direct code changes — same contracts as 0.0.15. `components`, `router`, and `transitions` also have their `peerDependencies["@llui/dom"]` range updated from `^0.0.15` to `^0.0.16`.

### Docs

- **Added** New "Persistent Layouts" + "Layout → Page communication via context" recipes in the cookbook under the SSR section.
- **Added** New "Persistent layouts (@llui/vike)" section in the LLM guide with the canonical shape and a new rules bullet so LLMs reach for `pageSlot()` as the idiom.
- **Added** New "Cross-instance scope parenting" subsection in the architecture doc explaining how `parentScope` + `pageSlot()` make context flow layer → layer and how disposal cascades asymmetrically on nav.
- **Added** New `examples/vike-layout` workspace — full working example with root layout (toast stack + session context dispatchers from layout state), nested dashboard layout with sidebar, four routes exercising different chain shapes, per-route chain resolver. All four routes prerender via Vike SSG.

## 2026-04-14 — 0.0.15

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.15`; `@llui/mcp@0.0.9`

Addresses two production reports against `@llui/vike` + `@llui/transitions` page routing, and bakes the browser-e2e test back into the default `pnpm verify` pipeline.

### `@llui/vike@0.0.15`

- **Added** `RenderClientOptions.onLeave(el)` — awaited before dispose, so leave animations can run against the outgoing page's still-mounted DOM. Return a promise to defer the dispose-and-mount swap until the animation finishes.
- **Added** `RenderClientOptions.onEnter(el)` — fires after the new page mounts, for enter animations. Sync; promise returns are ignored. Neither hook fires on the initial hydration render.
- **Added** `fromTransition(t)` adapter — converts any `TransitionOptions` (the shape returned by `routeTransition`, `fade`, `slide`, etc. from `@llui/transitions`) into the `{ onLeave, onEnter }` pair, so wiring route transitions into Vike filesystem routing is one line: `createOnRenderClient({ ...fromTransition(routeTransition({ duration: 200 })) })`.
- **Improved** README documents the full client-navigation lifecycle: `onLeave` → `dispose` → `textContent = ''` → `mountApp` → `onEnter` → `onMount`, with notes on `AbortSignal` semantics for in-flight effects (the signal gates `send()` dispatches but does not cancel in-flight network requests — intentional, avoids losing a successful POST on nav) and scroll handling (Vike's problem via `scrollToTop`, not ours).

### `@llui/transitions@0.0.15`

- **Improved** `routeTransition()` JSDoc now documents both call sites: manual `branch()`-based routing (spread `{ enter, leave }` into the branch call) and `@llui/vike` filesystem routing (wrap via `fromTransition` from `@llui/vike/client`). Previous wording implied the primary path was `branch()` and left Vike users reaching for a helper with nowhere to plug it in.

### `@llui/components@0.0.15`

- **Added** `dialog-dispose.test.ts` regression test: asserts that disposing a mounted app with an open `dialog.overlay` leaves `document.body` clean — no leftover portal content, focus-trap stack empty, body scroll lock count zero, sibling `aria-hidden` / `inert` restored, idempotent on second `dispose()`. Empirically confirms the scope-disposer chain correctly tears down overlay state when `@llui/vike` clears a page during client navigation.

### `@llui/vite-plugin@0.0.15`

- **Fixed** `test/mcp-watch.test.ts` was leaking `fs.watch` handles on the marker directory's parent on every `setup()` call. Over ~200 test invocations the accumulated handles hit macOS's EMFILE cap and sporadically crashed other tests running in parallel. Track active fake servers per test and fire their registered `close` handlers in `afterEach` so the plugin's cleanup path runs.

### `@llui/mcp@0.0.9`

- **Fixed** `test/playwright-e2e.test.ts` reworked to use vite's programmatic `createServer` API with `server.watch: null` and `optimizeDeps.noDiscovery: true`. The previous `spawn('pnpm', ['dev'])` path was unreliable on macOS: vite's default chokidar watcher tries to register directory watches across the whole monorepo at startup and blows through the launchctl-default 256-fd soft limit before printing its ready message, surfacing as a spurious `vite startup timeout` that had broken this suite on every developer machine since it landed.
- **Fixed** Narrowly-scoped `process.on('uncaughtException')` filter installed during the suite swallows only `{ code: 'EMFILE', syscall: 'watch' }` errors originating from vite's `watchPackageDataPlugin`, which registers `fs.watch` on every `package.json` regardless of `server.watch`. Legit exceptions still propagate; the filter is removed in `afterAll`.
- **Improved** Suite is re-included in the default `pnpm verify` pipeline — runs in ~3s against a real Vite dev server and a real Chromium browser. The earlier `LLUI_RUN_E2E` opt-in flag is gone; `loadPlaywright()` probes `playwright.chromium.executablePath()` + `existsSync` so fresh checkouts (before `pnpm install`) and CI jobs without Chromium installed still skip the suite cleanly.
- **Added** `pnpm test:e2e` root script — shortcut for `pnpm --filter @llui/mcp test` when iterating on the browser-integration suite.

### CI

- **Added** Playwright Chromium install + cache step in `.github/workflows/ci.yml`. Cache keyed on `pnpm-lock.yaml`, stored at `~/.cache/ms-playwright`. Cold install is ~30s with `--with-deps`; cache hits run `install-deps chromium` only to refresh system libraries.

## 2026-04-14 — 0.0.14

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.14`; `@llui/{effects,mcp}@0.0.8`; `@llui/lint-idiomatic@0.0.11`

Ten production-sourced bug fixes spanning SSR, the compiler, structural reconciliation, runtime timing, and published build output.

### Breaking

- **`@llui/vite-plugin@0.0.14`** — `mcpPort` is now opt-in. Default is `null`. The `/__llui_mcp_status` middleware and WebSocket companion process are only installed when `mcpPort` is passed explicitly. If you were relying on MCP in dev, add `{ mcpPort: 5200 }` (or any port) to your `llui()` call in `vite.config.ts`. Fixes 404 noise in dev logs for apps that don't use MCP.

### Migration

- If you worked around the `show()` source-order bug by reordering sibling branches, you can revert that change — the original source order now works correctly.
- If you worked around the hoisted `class:` accessor bug by inlining the arrow or using a module-level variable, you can revert to the hoisted-`const`-arrow form.
- If you were using MCP in dev, add `{ mcpPort: <port> }` to `llui()` in `vite.config.ts` — the default is now opt-out rather than opt-in.

### `@llui/dom@0.0.14`

- **Fixed** `show()` / `branch()` block source-order reconciliation. Nested structural blocks were landing _before_ their parent in the flat `inst.structuralBlocks` array because every structural primitive did `blocks.push(block)` _after_ running its builder. When a parent reconciled and disposed nested children, the array collapsed mid-iteration and subsequent sibling blocks could be skipped entirely — a sibling `show()` placed after a form would silently fail to mount. All structural primitives (`branch`, `each`, `virtualEach`) now push their block _before_ running the builder, so parents always precede nested children. Parents now also reconcile before children, avoiding wasted work on subtrees the parent is about to unmount.
- **Fixed** `hydrateApp` dropped `init`-time effects. It was short-circuiting `init()` to reuse `serverState`, silently discarding any effects `init()` returned — so HTTP fetches, subscriptions, and timers never fired on the client after hydration. `hydrateApp` now runs the original `init()` purely to extract its effect list, discards the returned state, and dispatches those effects after mount.
- **Fixed** `elSplit` crashed on raw string children. The children parameter was typed `Node[]` but callers pass mixed `(Node | string)[]` arrays from template helpers. In jsdom (SSR), passing a raw string to `appendChild` throws. `elSplit` now accepts `Array<Node | string>` and wraps strings in `document.createTextNode(...)`.
- **Fixed** `onMount` microtask race. Callbacks were deferred via `queueMicrotask`, which meant a synchronous `dispatchEvent` fired immediately after mount (or a `branch()` case swap) could reach the DOM before the listener registered inside `onMount` had attached. `mountApp`, `hydrateApp`, and `branch()`'s reconcile path now push an `onMount` queue and flush it **synchronously** after new nodes are inserted. The `queueMicrotask` fallback still exists for callbacks registered outside any active mount cycle.
- **Improved** `getRenderContext` error message now enumerates the three common causes when a primitive is called outside a `view()` render context: (1) module-scope primitive calls, (2) module-scope overlay helpers like `dialog.overlay` / `popover.overlay` (which internally use `show()` / `branch()`), (3) primitives called from `setTimeout` / `Promise.then` / async event handlers.
- **Improved** `applyBinding` defensive guard. Throws a `TypeError` the moment any function value reaches the DOM-write layer, naming the binding kind, key, and a source snippet of the offending function. Catches future compiler paths that might leak a function value past the binding emitter.

### `@llui/vite-plugin@0.0.14`

- **Breaking** `mcpPort` is now opt-in. See top of release block.
- **Fixed** hoisted `class:` accessor miscompile. A reactive attribute whose value was an `Identifier` resolving to a `const`-bound arrow (e.g. `const cls = (s) => ...; a({ class: cls })`) compiled to `__e.className = cls` in the static setup, coercing the function to its source string at runtime and producing `<a class="(s) => ...">` in the DOM with no binding wired. The compiler now resolves local `const`-bound arrow identifiers to their initializer and emits a reactive binding identical to the inline-arrow form. Applies to both the `elSplit` split pass and the `elTemplate` subtree-collapse pass. Affects `class`, `style`, attribute, and reactive DOM-property accessors. Event handlers were never affected.
- **Fixed** per-item heuristic scope leak. `isPerItemFieldAccess` was detecting any `item.field` expression as a per-item binding candidate, regardless of whether `item` actually referred to an `each()` render-callback parameter. A plain `arr.map((item) => ...)` outside `each()` would produce a broken binding tuple and crash at runtime. The heuristic now walks up the AST and verifies `item` is bound as a parameter of an `each({ render })` callback, handling destructured and renamed bindings.

### All packages — build output

- **Fixed** ESM imports missing `.js` extensions. `moduleResolution: bundler` was stripping `.js` extensions from emitted `import`/`export` statements, breaking strict Node ESM consumers. A new `scripts/add-js-extensions.mjs` pass rewrites all relative imports during publish — 578 edits across 208 source files in all 10 packages. Published tarballs now resolve cleanly under Node's strict ESM loader.
- **Fixed** sourcemaps referenced missing `.ts` files. Published `.map` files referenced `../src/*.ts` paths not shipped in the tarball, breaking source-map debugging for downstream consumers. All 10 `tsconfig.build.json` files now set `inlineSources: true`, embedding the full TypeScript source inline via `sourcesContent`. Sourcemaps are self-contained.

## 2026-04-13 — @llui/lint-idiomatic@0.0.10, @llui/mcp@0.0.7

**Released:** `@llui/lint-idiomatic@0.0.10`; `@llui/mcp@0.0.7`

### `@llui/mcp@0.0.7`

- **Added** `llui_lint` tool; llm-guide reframed for the dual API.

### `@llui/lint-idiomatic@0.0.10`

- **Improved** Tightened rule set, fixed example snippets, adopted across all in-repo projects.

## 2026-04-13 — @llui/lint-idiomatic@0.0.9

**Released:** `@llui/lint-idiomatic@0.0.9`

### `@llui/lint-idiomatic@0.0.9`

- **Added** Ship as a Vite plugin via a `/vite` subpath export.
- **Improved** Publish flow uses `pnpm publish` and restores `workspace:*` in runtime deps.

## 2026-04-12 — 0.0.13

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.13`; `@llui/mcp@0.0.6`

### `@llui/mcp@0.0.6`

- **Added** Auto-connect MCP relay via Vite middleware + file marker; promoted auto-connect e2e to vitest CI.

### `@llui/dom@0.0.13`

- **Added** Bitmask diagnostic surfaced through MCP; `childHandlers` migration landed end-to-end.

## 2026-04-11 — 0.0.12

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.12`

### `@llui/dom@0.0.12`

- **Added** On-demand MCP relay with devtools documentation.
- **Added** `ChildState` / `ChildMsg` type utilities and `childHandlers` runtime.

### Docs

- **Improved** New cookbook recipes for `slice`, `selector`, `lazy`, `virtualEach`, and `sortable`.

## 2026-04-11 — 0.0.11

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.11`

### `@llui/dom@0.0.11`

- **Added** `sliceHandler` shorthand for child update wiring.
- **Improved** Clearer error messages across the runtime.

## 2026-04-11 — 0.0.10

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.10`

### `@llui/dom@0.0.10`

- **Added** `LazyDef<D>` type eliminates user-side casts when using `lazy()`.

### Docs

- **Fixed** Stale `ComponentDef` signature, component count, and version refs.

## 2026-04-11 — 0.0.9

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.9`

### `@llui/dom@0.0.9`

- **Fixed** Expose the `D` type parameter on the `component()` wrapper.

## 2026-04-11 — 0.0.8

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.8`

### `@llui/dom@0.0.8`

- **Added** `virtualEach()` primitive for large-list windowing.
- **Fixed** Phase 1 iteration crash plus demo/theme bugs.

### `@llui/vite-plugin@0.0.8`

- **Fixed** `__handlers` now unions modified fields across all return paths.

### `@llui/components@0.0.8`

- **Added** `sortable` with visual drag feedback, cross-container drag-and-drop, and keyboard a11y (space to grab, arrows to move, escape to cancel).
- **Fixed** `sortable` snapshots item positions at drag start (no flicker) and resolves stale index after sequential drags.

### `@llui/lint-idiomatic@0.0.8`

- **Fixed** `spread-in-children` exempts structural primitives; `each-closure-violation` handles destructured params and render boundaries.

### Docs & examples

- **Added** Root exports for `validateSchema` / `reorder` / theme helpers; new `form-validation` and `i18n-lazy` example apps.
- **Improved** API reference and examples for `virtualEach`, `sortable`, `themeSwitch`, and `form`.

## 2026-04-10 — 0.0.7

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.7`

### `@llui/dom@0.0.7`

- **Added** `lazy()` primitive for code-split component boundaries.

### `@llui/vite-plugin@0.0.7`

- **Fixed** SVG class binding.

### `@llui/components@0.0.7`

- **Added** `form` (Standard Schema), `sortable`, `themeSwitch`; dashboard example app.
- **Fixed** Accessibility audit: 13 violations → 0.

### `@llui/test@0.0.7`

- **Fixed** Typechecking enabled, fixing 109 latent type errors.

### `@llui/lint-idiomatic@0.0.7`

- **Added** Two new rules.

### Docs

- **Improved** Docs site — dark mode.

## 2026-04-09 — 0.0.6

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.6`

### `@llui/dom@0.0.6`

- **Added** SVG and MathML element helpers.

### `@llui/components@0.0.6`

- **Added** `inView` component; RTL keyboard navigation across all directional components.
- **Added** Locale context for i18n (English defaults, zero-setup for English apps) and locale-aware `format` utilities wrapping `Intl`.
- **Fixed** Benchmark chart animations and format stability.

### Docs & CI

- **Added** Animated benchmark charts.
- **Added** GitHub Actions workflow for format, build, check, lint, and test.
- **Fixed** Example app — use `ItemAccessor<Repo>` so `repoItem` shorthand type-checks.

## 2026-04-08 — 0.0.5

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.5`

### `@llui/vite-plugin@0.0.5`

- **Added** Compiler-generated per-message-type handlers (`__handlers`) and compiler-generated `__update` replacing the generic Phase 1/2 loop.
- **Added** Row factory: compiler-generated shared update function for `each()` rows with a runtime fast path (`entry + __rowUpdate`).
- **Added** Detects array operation patterns (e.g. filter) for specialized reconcilers.
- **Fixed** Row factory correctly scopes selector definitions (IIFE wrap), rewrites accessor calls, and preserves user variables.

### `@llui/dom@0.0.5`

- **Fixed** Restore per-row disposer with a generation guard, fixing the Clear memory leak.
- **Fixed** Selector memory leaks: lazy bucket compaction, empty bucket cleanup, bulk clear on `each()` reconcile.
- **Fixed** Set `currentDirtyMask` in `__handleMsg` for memo consistency.
- **Improved** Phase 1 mask gating skips structural blocks on irrelevant changes; shared Phase 2; swap reduced to O(2) with bulk scope disposal.
- **Improved** Scope pooling reuses disposed scope objects to reduce GC pressure; `reconcileRemove` walks in O(n) without a Map.
- **Improved** Strided `reconcileChanged` for every-Nth-item updates; item updaters moved from scope to entry for direct access; render bag object reused across `each()` entries.

### Docs & infra

- **Added** Docs site — benchmarks page auto-generated from `jfb-baseline.json`.
- **Improved** `bench:setup` script validates the detected `jfb` repo before use.

## 2026-04-07 — 0.0.4

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike}@0.0.4`

### `@llui/dom@0.0.4`

- **Added** `branch` / `show` callbacks receive the `View<S,M>` bag.

### `@llui/vike@0.0.4`

- **Added** Sub-path exports; SSG extensions powering the new `llui.dev` docs site with auto-generated API docs for all 10 packages.
- **Fixed** Dispose previous page on client navigation; enable Vike client routing for SPA navigation.

### Docs

- **Fixed** Shiki CSS variables theme (no `!important`, proper light/dark), strip duplicate `h1`, fix entity encoding and content accuracy.

## 2026-04-06 — 0.0.3

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.3`

### Breaking

- **`@llui/effects@0.0.3`** — effects API v2: typed constructors, flexible body, adds `websocket` and `retry`. All existing effect call sites need to move to the typed constructors.

### `@llui/effects@0.0.3`

- **Added** `upload` effect with progress tracking; `clipboard`, `notification`, and `geolocation` effects.

### `@llui/router@0.0.3`

- **Added** Route guards via `beforeEnter` / `beforeLeave` hooks.

### `@llui/transitions@0.0.3`

- **Added** Route transitions and `stagger` for `each()`; spring physics.

### `@llui/components@0.0.3`

- **Added** Complete default theme for all 54 components; `aria-owns` wiring.

### `@llui/lint-idiomatic@0.0.3`

- **Added** 9 new rules: `effect-without-handler`, `forgotten-spread`, `string-effect-callback`, `nested-send-in-update`, `imperative-dom-in-view`, `accessor-side-effect`, plus 3 aria/error-message rules.

### `@llui/dom@0.0.3`

- **Improved** Runtime error messages.

### Docs

- **Improved** Document the styling layer in architecture, API reference, and README; update all effect examples for typed constructors; update system prompt for effects v2 + `View<S,M>`.

## 2026-04-06 — 0.0.2

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.2`

Initial multi-package release — core TEA runtime (scope tree, bindings, update loop, `mountApp`), element helpers, structural primitives (`show`, `branch`, `each`, `memo`, `portal`, `onMount`), Vite plugin with prop-split and bitmask injection, test harness, effects builders, router, transitions, 54 headless components, idiomatic lint rules, and Vike SSR adapter. 977 tests at release.
