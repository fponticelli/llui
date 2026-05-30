# LLui Bundle Size

Bundle size is not a vanity metric. For a framework that positions itself as "what the compiler removes is what you don't pay for," every byte in the final bundle is a falsifiable claim. This document explains how to measure those bytes rigorously, why the architecture enables aggressive elimination, what each feature contributes, how to compare LLui against other frameworks without deceiving yourself, and what to do when the numbers are larger than they should be.

---

## What to Measure

### Metrics, in priority order

**1. Gzip bytes (level 9)**
This is the primary metric. Every CDN capable of serving a static site supports gzip. Level 9 is the maximum compression effort; CDNs typically serve between level 6 and level 9. Using level 9 for measurement gives a consistent lower bound on transfer size and is what nearly all public framework benchmarks report. Measure this for every JS chunk individually, then sum.

```bash
gzip -9c dist/assets/index-*.js | wc -c
```

**2. Brotli bytes (level 11)**
Brotli at level 11 represents the theoretical minimum for a modern client on a CDN that supports `Content-Encoding: br`. Level 11 is slow but deterministic. Most CDNs that support brotli use level 4–6 for on-the-fly compression; pre-compressed assets served from object storage can reach level 11. Report this alongside gzip. If your gzip/brotli ratio is unexpectedly high (above ~0.85), the code has low symbol reuse, which may indicate generated code rather than shared library code — a symptom of inlining gone too far.

```bash
brotli --best -c dist/assets/index-*.js | wc -c
```

**3. Raw minified bytes**
Raw bytes tell you what the minifier (terser, esbuild) sees before any compression. A large gap between minified and gzip indicates high repetition — text that compresses well, which is usually good. A small gap indicates the code is already entropy-dense (short variable names, few repeated patterns), which is characteristic of well-minified output. Track raw bytes when diagnosing whether a size regression is in the minifier output or only in the compressed output.

**4. Number of JS chunks**
Code splitting affects _perceived_ load time independently of total size. A 10 kB app in one chunk loads faster on a cold HTTP/1.1 connection than 10 kB spread across four chunks. Under HTTP/2 the tradeoff shifts: more chunks means finer cache granularity. Report chunk count alongside byte counts. For a typical LLui app without route-level splitting, the output should be one chunk (the component code) plus Vite's preload helper if applicable.

**5. Per-primitive cost delta**
Import one feature at a time, build, measure. The delta from a baseline (core runtime only, no view logic) to the next measurement is the cost of that feature. This is the only way to distinguish "the core runtime grew" from "branch() grew." Maintain a spreadsheet of deltas across releases and treat regressions in any individual delta as a bug.

### Granularity

Measure at two levels:

- **Full-app measurement**: a representative application (see the comparison methodology below) built and measured end-to-end. This is the number you publish.
- **Per-feature microbenchmark**: a minimal harness that imports exactly one primitive, calls it once, and exports a DOM node. This isolates the cost of each export. The harness must go through the full Vite build pipeline — not `tsc`, not `esbuild` in library mode — because Vite's Rollup-based bundler is what downstream users will use.

---

## How the Compiler Reduces Bundle Size

The signal transform lowers an authored component's DIRECT view to the runtime form, then standard Rollup tree-shaking does the elimination. Two mechanisms matter for size. Understanding each is prerequisite to diagnosing when they fail.

### 1. Authoring-helper lowering

The authoring helpers in `@llui/dom` — `div`, `span`, `button`, … (each built by `elementHelper(tag)`), plus `text`, `each`, `show`, `branch`, `foreign`, `lazy`, `virtualEach` — are real runtime functions so view code factored into helper functions composes. But in a component's direct view, those calls are an OPTIMIZATION target: the transform rewrites them to the lower-level runtime emitters and rewrites the import accordingly. In source a developer writes:

```ts
import { div, span, button, text } from '@llui/dom'

view: ({ state, send }) => [
  div({ class: 'container' }, [
    span([text(state.map((s) => s.label))]),
    button({ onClick: () => send({ type: 'click' }) }, [text('Go')]),
  ]),
]
```

After the transform, `div(...)`/`span(...)`/`button(...)` become `el(tag, props, children)` calls (with the tag as a string literal), a reactive `text(state.map(...))` becomes `signalText(produce, deps)`, and a static `text('Go')` becomes `staticText('Go')`. The transform drops the authoring names it lowered away from the import statement. Where the whole direct view is lowered, the per-tag helper closures (`div`, `span`, …) are no longer referenced and Rollup eliminates them; what survives is the small fixed set of emitters (`el`, `signalText`, `staticText`, `react`, plus whichever structural emitters are used).

The precondition is that the transform recognizes every call site and prunes the matching import names. If a helper reference survives (e.g. an aliased import the transform did not match, or a helper used outside a direct view), that reference keeps the helper closures alive. Verify with `rollup-plugin-visualizer`: the per-tag helper closures should not dominate the treemap for a compiled app.

### 2. Static vs reactive prop / text split

A prop or text value is static when it does not depend on state — a literal, or any expression with no signal read (`state.map`/`state.at`/`derived`). The transform emits those as plain values (`staticText('Go')`, a literal prop in the `el(...)` props object) with no binding. Reactive values — those reading a signal — lower to a `produce` function plus the dependency-path array (`signalText(s => …, ['label'])`, or a reactive prop via `react(produce, deps)`). The binding/reconciler machinery is instantiated only for the reactive ones, so a view full of static attributes does not scale binding allocation with attribute count.

### 3. Dead import removal (standard tree-shaking)

Each authoring/runtime name the transform removes from an import statement is one fewer edge in Rollup's module graph. Because the structural emitters are independently importable, an app that uses `branch` but not `each` does not carry `signalEach`'s reconciliation algorithm. The transform does nothing special here beyond pruning imports — it is standard Rollup tree-shaking — but the lowering in mechanism 1 is what lets the per-tag helper closures drop out, which would not happen if every `div(...)` call survived verbatim.

---

## How Tree-Shaking Works in This Architecture

Rollup (and therefore Vite) performs tree-shaking by constructing a module graph and performing reachability analysis starting from the entry points. An export is included if and only if some reachable import path references it. This means:

**Side-effect-free modules are a prerequisite.** If a module has top-level statements with observable side effects — DOM access, module-level `Map` initialization, global registration — Rollup must include it regardless of whether any of its exports are referenced, because dropping it would change program behavior. Every LLui module must have `"sideEffects": false` declared in `package.json` (or scoped to the relevant paths). Verify this is set; without it, Rollup conservatively includes every module imported by any other included module.

**The core runtime cannot be tree-shaken below its minimum.** `mountSignalComponent` (behind `mountApp`/`component`), the synchronous `send` loop, scope creation and disposal, and the chunked-mask reconciler (dirty-path gate + output-equality skip) are required by every LLui application. They are reachable from the entry point unconditionally. This is the irreducible minimum. No compiler optimization eliminates this floor.

**Structural primitives are independently tree-shakeable.** `each`/`signalEach`, `show`/`signalShow`, `branch`/`signalBranch`, `portal`, `foreign`/`signalForeign`, `lazy`/`signalLazy`, `virtualEach`/`signalVirtualEach`, `onMount`, and the context primitives (`createContext`/`provide`/`useContext`) are each separate exports, reachable only if the application imports them (directly or via the lowered emitter). Standard tree-shaking handles this. There is no `child`, `memo`, `combine`, or `errorBoundary` export in the signal runtime — composition is view functions, so a "child" adds no runtime primitive at all.

**The element emitter `el` is always included.** The transform lowers element-helper calls to `el(tag, props, children)` (and `elNS` for SVG). `el` is therefore referenced in essentially every compiled output. It is small, but it is fixed overhead — the cost of replacing the per-tag helper closures with one shared emitter. `signalText`/`staticText` and `react` are similarly reachable whenever the view has any text or reactive prop.

**Barrel file imports break tree-shaking for some bundlers.** `@llui/dom`'s package root re-exports from `src/signals/index.ts`. Rollup handles this re-export barrel correctly. But some environments (Jest with `moduleNameMapper`, older webpack configurations, Parcel 1) treat barrel files as atomic and include everything. This is a property of the consuming bundler, not of `@llui/dom`; Vite/Rollup users are unaffected.

---

## Per-Primitive Cost Analysis

The following is a conceptual breakdown of what each primitive contributes to the bundle when imported and used, under the signal runtime. **The concrete byte figures below are STALE — they were measured against the deleted mask-binding runtime and have not been re-measured against the signal runtime. Treat every number as a placeholder to re-measure, not as a current value or a guarantee.** Use the per-feature microbenchmark methodology (above) to regenerate them; report each as a gzip delta from the core-runtime baseline.

**Core runtime** (always included — re-measure floor)

- `mountSignalComponent` and the component initialization path (`mountApp`/`component` route here)
- the synchronous `send` loop (queue + reducer + reconcile + effect dispatch)
- `flush()`: a no-op kept for harness/agent parity (synchronous `send` has nothing to flush)
- scope creation, child-scope registration, teardown/disposal
- the chunked-mask reconciler: the dirty-path gate and output-equality skip
- `el` / `elNS`: the element emitters the transform lowers helper calls to
- `signalText` / `staticText` / `react`: text and reactive-prop emitters

This is the floor. Every application pays it. (Floor byte figure: re-measure.)

**+ reactive `text`** (negligible; emitters are in core)
A reactive `text(state.map(...))` lowers to `signalText(produce, deps)` — a `Text` node plus one path-keyed binding. A static `text('x')` lowers to `staticText` (no binding). The emitters are part of the core floor.

**+ `branch()` / `signalBranch`** (stale estimate: re-measure)
`branch` adds discriminant evaluation, scope swap, comment-node placeholder management, and arm invocation. It does not include keyed reconciliation (that is `each`'s domain).

**+ `show()` / `signalShow`** (stale estimate: re-measure)
`show` is a two-arm conditional (the truthy arm, optional `orElse`). Small wrapper over the same scope-swap machinery `branch` uses.

**+ `each()` / `signalEach`** (stale estimate: re-measure — likely the largest primitive)
`each` adds key-based reconciliation: per-row scope + `item`/`index` signal construction, keyed lookup/reuse, and the DOM reordering algorithm (insert/move/remove to match the new keyed array). The reordering algorithm dominates its cost.

**+ `virtualEach()` / `signalVirtualEach`** (stale estimate: re-measure)
`virtualEach` adds windowing on top of `each`'s keyed model: scroll-offset math, an overscan window, and a spacer to preserve scroll height. Only the viewport rows (+overscan) exist in the DOM.

**+ `portal()`** (stale estimate: re-measure)
`portal(render, target?)` adds target resolution, node insertion at the target, and teardown to remove those nodes when the owning scope disposes. No reconciliation.

**+ `foreign()` / `signalForeign`** (stale estimate: re-measure)
`foreign` adds container creation, instance lifecycle (`mount`/`unmount`), and materialization of each declared `state` signal to a `LiveSignal` (`peek` + `bind`) handed to `mount`. The library owns the DOM inside the container; LLui owns the container and drives the declared signals. Independently tree-shakeable.

**+ `lazy()` / `signalLazy`** (stale estimate: re-measure)
`lazy` renders a fallback immediately, then swaps in an asynchronously loaded component (or an error arm on reject). Adds the loader/swap path on top of scope management.

**+ `onMount()`** (stale estimate: re-measure)
`onMount(cb)` runs `cb(rootEl)` after insertion and registers its returned cleanup as a teardown.

**+ context (`createContext` / `provide` / `useContext`)** (stale estimate: re-measure)
A typed provider/consumer pair scoped to the build. `provide(ctx, value, render)` exposes a value to a subtree; `useContext(ctx)` reads it (or the default). Independently tree-shakeable.

> There is no `child`, `memo`, `combine`, or `errorBoundary` in the signal runtime — none of them contribute bytes. Composition is view functions (zero runtime primitive); a derived value used in multiple slots is just a `state.map(...)` per slot, gated by the reconciler.

**+ core `delay` and `log` effects** (stale estimate: re-measure) — built-in
`delay` is `setTimeout` + dispatch; `log` is a structured `console.log`. Trivial and always available through the core effect path.

**+ `@llui/effects` package** (stale estimate: re-measure, tree-shakeable)
Two parts: (1) composable effect-description builders — `http`, `cancel` (overloaded: `cancel(token)` cancel-only, `cancel(token, inner)` cancel-and-replace), `debounce`, `timeout`, `interval`, storage/broadcast builders, `sequence`, `race` — small factories that produce plain data objects; and (2) `handleEffects<E, M>()`, a chain whose `.use(plugin)` adds pass-through handlers and `.else(handler)` returns the terminal `(ctx) => void` handler. The chain keeps a cancellation-controller registry, debounce timer map, and `AbortSignal` integration for cleanup. Each builder is independently tree-shakeable. Note the wiring: `handleEffects().else(...)` returns a `(ctx: { effect, send, signal }) => void` function, whereas a component's `onEffect` is `(effect, api)`; bridge them by capturing a lifecycle `AbortController` and calling `handler({ effect, send: api.send, signal })`.

**+ `@llui/vike` adapter** (stale estimate: re-measure)
The Vike adapter wires `createOnRenderHtml`/`createOnRenderClient` (and `pageSlot` for persistent layouts). The Vike client runtime is separate. Both are absent in SPA mode. See 08 Ecosystem Integration §1.

**`@llui/test` package** (devDependency — zero production bytes)
The `@llui/test` package (`testComponent`, `testView`, `defineTestComponent`, `assertEffects`, `propertyTest`, `replayTrace`, `reducer`, `recordAgentSession`/`replayAgentSession`) is a devDependency and contributes zero bytes to production bundles. The reducer-level harnesses (`testComponent`, `propertyTest`, `replayTrace`) call `update()` directly and never import the DOM runtime; `testView` does import `mountApp`, but only runs in the test environment (jsdom/happy-dom). Because `@llui/test` never appears in application import graphs, Rollup's reachability analysis excludes it unconditionally — no `sideEffects` annotation or special build configuration needed.

---

## The Comparison Methodology

### Why framework comparisons are routinely wrong

Most published framework size comparisons fail because they compare different things: a counter app in one framework against a full-featured app in another, or they use different build tools, or they measure raw bytes while the page title says "gzip." The result is noise dressed as signal. This section defines a comparison that is honest and reproducible.

### The benchmark application: TodoMVC subset

All frameworks implement the same feature set, no more, no less:

- Text input with Enter-key submission to add a new item
- Rendered list of items, each with a toggle checkbox and a delete button
- Toggle-all checkbox that sets every item's completion state
- Filter tabs: All / Active / Completed — shown simultaneously, switching via click
- "N items left" count, grammatically correct singular/plural
- "Clear completed" button, visible only when at least one completed item exists
- Pre-seeded state: three items, the second of which is completed

This is the TodoMVC specification minus localStorage persistence and routing. It exercises all structural primitives (`each` for the list, `branch` or `show` for the clear-completed button visibility, `show` for conditional class application), event handling, computed derived state, and conditional rendering. It is large enough to be representative and small enough that bundle size is not dominated by application code.

No framework's implementation may include: routing, localStorage, animations, CSS frameworks, or polyfills not required by the ES2020 target. Third-party UI component libraries are not permitted.

### Build configuration

Every framework uses:

```
Build tool: Vite (same major version for all)
Minifier: terser (Vite default)
Tree-shaking: enabled (Rollup default)
Target: ES2020
Source maps: disabled (they inflate chunk sizes)
```

Use the framework's official Vite integration. For React, this means `@vitejs/plugin-react` with Babel. For Svelte, `@sveltejs/vite-plugin-svelte`. For Solid, `vite-plugin-solid`. For LLui, the LLui Vite plugin. No non-standard bundler optimizations. No `build.lib` mode (which changes tree-shaking semantics). Use `build.rollupOptions` only for configurations the framework's own documentation recommends.

### Measurement script

```bash
#!/usr/bin/env bash
# Run from the repository root.
# Requires: gzip, brotli (brew install brotli on macOS)

for fw in llui svelte solid react; do
  (cd benchmarks/bundle-size/$fw && pnpm build 2>/dev/null)
  echo "=== $fw ==="

  total_raw=0
  total_gz=0
  total_br=0
  chunk_count=0

  for f in benchmarks/bundle-size/$fw/dist/assets/*.js; do
    raw=$(wc -c < "$f")
    gz=$(gzip -9c "$f" | wc -c)
    br=$(brotli --best -c "$f" | wc -c)
    total_raw=$((total_raw + raw))
    total_gz=$((total_gz + gz))
    total_br=$((total_br + br))
    chunk_count=$((chunk_count + 1))
    printf "  chunk %s: raw=%d gz=%d br=%d\n" "$(basename "$f")" $raw $gz $br
  done

  printf "  TOTAL: raw=%d B  gzip=%d B  brotli=%d B  chunks=%d\n\n" \
    $total_raw $total_gz $total_br $chunk_count
done
```

This script sums all `.js` assets in `dist/assets/`. If a framework emits `.mjs` assets, adjust the glob. The `--best` flag to `brotli` is equivalent to level 11. Run the script on the same machine for all frameworks in the same session — OS-level disk caching and CPU frequency scaling affect timing but should not affect byte counts.

### What makes a comparison publishable

A comparison is publishable when:

1. The source code for all four implementations is in the repository, in the same commit, built with the same Vite version.
2. The measurement script is in the repository and produces the reported numbers when run.
3. The numbers are gzip-9 bytes, not raw bytes, not "minified + gzip" without specifying the level.
4. The feature parity of all four implementations is verified by running the same Playwright test suite against all four builds.

A comparison that fails any of these criteria is anecdote, not measurement.

---

## How to Improve Bundle Size

These steps are ordered by expected impact-to-effort ratio. Work from the top down; do not jump to step 4 before verifying steps 1 and 2.

### 1. Verify tree-shaking is working

This is a prerequisite, not an optimization. Use `rollup-plugin-visualizer`:

```ts
// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [llui(), visualizer({ open: true, gzipSize: true, brotliSize: true })],
})
```

After building, open the generated `stats.html`. `elements.ts` must not appear in the treemap. If it does, the compiler's import-cleanup pass failed to remove all references to element helpers. Common causes: the compiler missed a renamed import (`import { div as d } from '@llui/dom'`), a call site was in a position the AST visitor did not traverse (e.g., inside a type assertion), or the user has a local file also named `elements.ts` that shadows the LLui import. Fix the compiler; do not work around it.

### 2. Audit the core runtime for unused branches

The core runtime is always included, but it may contain conditional branches that are never exercised. Verify that each structural primitive appears in the visualizer only when the application uses it. If `signalEach` appears but the application only uses `show`, there is a transitive import pulling it in when it should not be.

Identify dead branches within the always-included core. If a core path only executes for a primitive the application never uses (e.g. context resolution when no `provide`/`useContext` is present), consider splitting that path into a separate export that is only pulled in when needed.

### 3. Split the structural emitters into separate entry points

If `signalEach`'s reconciliation algorithm and `signalBranch`'s scope-swap logic live in the same module, importing either pulls in both. Separate them at the module boundary so an application using only `branch` does not pay for `each`'s reordering algorithm. This is a refactor with no user-facing API change — only the internal module structure changes. (Re-measure the `each`-only saving for list-free apps.)

### 4. Reduce the `el` emitter footprint via further lowering

The transform lowers element-helper calls to `el(tag, props, children)`. A more aggressive transform could emit direct DOM construction for static-heavy elements:

```ts
// Instead of: el('div', { class: 'container' }, children)
// Emit:
const _el = document.createElement('div')
_el.className = 'container'
_el.append(...children)
```

This shrinks the shared `el` emitter's responsibilities and makes construction directly minifiable. The tradeoff is more emitted code per call site (higher raw bytes; gzip recovers most of it via string reuse) and a more complex transform. High-complexity, high-payoff; defer until the compiler architecture is stable.

### 5. Prerender static subtrees to HTML template cloning

If an entire subtree has no reactive bindings — no signal reads, no `branch`/`each`/`show` — it looks identical on every build. The transform can detect this and emit a `<template>` clone instead:

```ts
// Source: a static header with no bindings
header({ class: 'app-header' }, [h1([text('My App')])])

// Emitted:
const _tmpl = document.createElement('template')
_tmpl.innerHTML = '<header class="app-header"><h1>My App</h1></header>'
const el = _tmpl.content.cloneNode(true)
```

Template cloning is faster than imperative construction and the emitted code is smaller. The transform must prove that no binding exists anywhere in the subtree — including nested children. Conservative: any signal read or structural primitive disqualifies it. Meaningful for large static layout shells; negligible for reactive-heavy apps.

### 6. Annotate pure emitter calls with `/*@__PURE__*/`

Terser and esbuild treat `/*@__PURE__*/` as a hint that a call has no side effects and its result is droppable if unused. Annotate the emitted `el`, `signalText`, `signalEach`, `signalBranch`, … calls:

```ts
const el = /*@__PURE__*/ el('div', ...)
```

This lets the minifier eliminate whole subtrees in dead-code arms. Small for typical apps, meaningful in generated code with many conditional paths.

### 7. Fold zero-dependency reactive slots to static

A reactive slot whose `produce` reads no state (empty `deps`) never changes — it should be emitted as a static value (`staticText`, a literal prop) with no binding. The transform already emits literals as static; this catches the edge case where an arrow function touches no signal despite being written reactively. Folding these eliminates the binding allocation and reconciler registration per instance.

### 8. Keep emitted imports specific

When the transform emits runtime imports (e.g. for `el`/`signalText`), it imports the internal helpers from `@llui/dom/internal` (a dedicated subpath), not from the package root barrel. This keeps the emitted import specifier stable under the bundler's property-rename pass and avoids pulling more than necessary on bundlers without deep barrel optimization.

---

## What to Avoid

**Adding runtime dependencies.** Any third-party package added as a runtime dependency of LLui (not devDependency) becomes part of every LLui user's bundle. `lodash`, `rxjs`, and similar utility libraries contain tens of kilobytes of code. There is no case where adding a runtime dependency is better than writing 20–30 lines of targeted utility code inline.

**Monolithic runtime module.** A single `runtime.ts` file that exports everything prevents per-feature tree-shaking. The bundler must either include all of it or none of it; it cannot include only `branch` and exclude `each` if they are in the same module. Module structure must match the tree-shaking granularity you want.

**Top-level side effects in any module.** Any statement at module scope that has observable effects — registering a global event listener, writing to `window`, calling `document.createElement`, populating a module-level `Map` — forces the bundler to include that module regardless of whether any exports are referenced. Review every LLui module for top-level side effects. Lazy initialization (populating a map on first function call, not at module load) is the correct pattern.

**Dynamic requires and computed imports.** `require(someVar)` and `import(computedPath)` are opaque to static analysis. Any module loaded this way cannot be tree-shaken. The compiler must emit only static import paths.

**Using `export * from './module'` without enumeration in barrel files.** Star re-exports are harder for some bundlers to tree-shake than named re-exports, because the bundler must analyze the re-exported module to know which names are available. Prefer explicit `export { name } from './module'` in all barrel files.

---

## What Seems Like It Helps But Doesn't

**Tuning terser options beyond defaults.** Terser's default configuration is already close to optimal for well-structured code. Options like `passes: 3` or `unsafe: true` produce marginal additional savings (typically < 2%) at the cost of slower builds and occasionally incorrect transformations for code with unusual patterns. The minifier is not the bottleneck; the module graph is.

**Custom Rollup plugins for further compression.** Adding a Rollup plugin that post-processes the output (removing semicolons, compressing string literals, etc.) saves bytes that gzip and brotli will recover anyway. Compressed size is dominated by semantic content, not syntactic decoration. A semicolon that the minifier already removed cannot be removed again.

**Externalizing `tslib`.** TypeScript compiler helpers (`__awaiter`, `__extends`, etc.) are emitted inline by default. Externalizing them to `tslib` saves < 500 bytes in a typical app, adds a runtime dependency, and requires every downstream bundler to handle the external correctly. The tradeoff is not worth it.

**Setting `build.target: 'esnext'` when `ES2020` is already the target.** The difference between `ES2020` and `esnext` in Vite's esbuild syntax transform is negligible for LLui's syntax profile. LLui does not use async generators, class static blocks, or other syntax that would generate substantial transform overhead. The savings from removing transpilation overhead are under 500 bytes for a typical application.

**Increasing Vite's `build.chunkSizeWarningLimit`** to silence warnings. This hides problems rather than solving them. A warning is diagnostic signal; investigate what is large before deciding to ignore the warning.

**Source map stripping as a "size optimization."** Source maps are separate files (`*.map`) and are not served to end users unless explicitly requested. They do not affect transfer size. Disabling source maps only removes the ability to debug production issues.

---

## Headline Metric: Gzip vs. Brotli

**Gzip-9 is the headline metric.** Every CDN, every static hosting provider, and every HTTP server supports gzip. It is the universally comparable number and matches what js-framework-benchmark and all major framework benchmarks report. Brotli is reported alongside gzip in every measurement, but gzip-9 is the number used in titles, comparisons, and changelogs.

**Brotli: report both level 6 and level 11.** Level 11 is the theoretical best case for pre-compressed static assets. Level 6 is what CDNs that support brotli use for on-the-fly compression (Cloudflare, Fastly, AWS CloudFront). The two numbers bound the range of what users actually receive. When the gzip/brotli-11 ratio exceeds 0.85, it indicates low symbol reuse — a diagnostic signal that the compiler may be inlining too aggressively.

```bash
# Full measurement: gzip-9, brotli-6 (CDN realistic), brotli-11 (pre-compressed best)
for f in dist/assets/*.js; do
  raw=$(wc -c < "$f")
  gz9=$(gzip -9c "$f" | wc -c)
  br6=$(brotli -q 6 -c "$f" | wc -c)
  br11=$(brotli --best -c "$f" | wc -c)
  printf "  %s: raw=%d gz9=%d br6=%d br11=%d\n" "$(basename "$f")" $raw $gz9 $br6 $br11
done
```

---

## Resolved Questions

**At what gzip size does LLui become competitive with Solid?** Resolved: this is an empirical question that the comparison methodology (§ The Comparison Methodology) answers directly. Build the TodoMVC subset in both Solid and LLui with identical Vite configuration, run the measurement script, compare gzip-9 totals. The core runtime floor of 3–4 kB gzip puts LLui in Solid's range (~4–6 kB for TodoMVC). The answer depends on how much application-level code the LLui compiler emits vs. Solid's compiler. The methodology section already requires this exact measurement — it is not an open question, it is a pending measurement.

**Single-update binding elimination.** Resolved: deferred to v2. This optimization requires `ts.TypeChecker` integration and a purity analysis that the current compiler does not perform. The binding registration overhead for these one-shot patterns is negligible at the per-component level (~20–40 bytes per binding). The optimization becomes meaningful at scale (hundreds of bindings across dozens of components), which is a v2 concern. The compiler architecture (§4 of "How to Improve Bundle Size") already describes the prerequisite infrastructure.

**Brotli level representativeness.** Resolved: report gzip-9 (headline), brotli-6 (CDN realistic), brotli-11 (pre-compressed best). See "Headline Metric: Gzip vs. Brotli" above. All three numbers appear in every measurement. The reader interprets based on their deployment configuration.

**Per-feature isolation vs. full-app measurement.** Resolved: both are required, at different cadences. Per-feature microbenchmarks run on every PR (CI regression gate). Full-app measurements run on release milestones (competitive comparison). Per-feature microbenchmarks use a minimal harness that imports exactly one primitive, builds through the full Vite pipeline, and reports gzip delta from a baseline that imports only the core runtime. Full-app measurements use the TodoMVC subset. Artifacts from microbenchmarks are not meaningful — a single use of `branch` does not exercise code-splitting paths, but the delta still catches regressions in the primitive's implementation size.

**Static subtree prerendering tradeoff.** Resolved: implement in v1 with a conservative heuristic — only subtrees where every node is a literal element with literal string/number props and literal `text()` children qualify. No type-checker integration required; the analysis is syntactic: "does this subtree contain any arrow function, any identifier that is not a known literal, or any structural primitive (`branch`, `each`, `show`)?" If not, emit a `<template>` clone. This handles nav bars, footers, icon components, and static layout shells — the most common cases. Subtrees with even one reactive binding are ineligible. The compiler complexity is low (one additional AST pass after the signal-lowering pass) because the heuristic is conservative. Expected coverage: 10–30% of nodes in typical applications.

**Bundle size scaling with component count.** Resolved: measure empirically using a synthetic scaling harness. Generate apps with 1, 5, 10, 25, 50 components of identical structure (each has the same number of bindings, same structural primitives). Plot total gzip against component count. The expected curve is: fixed core runtime + linear per-component cost, where the per-component cost is dominated by `el` calls and reactive-slot (`signalText`/`react`) registrations. The `el` tag arguments (`'div'`, `'span'`, etc.) compress well under gzip (high symbol reuse), so the observed growth rate should be sub-linear in gzip bytes even if raw bytes grow linearly. Include this scaling harness in the benchmark suite and report the per-component marginal gzip cost.
