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
Code splitting affects *perceived* load time independently of total size. A 10 kB app in one chunk loads faster on a cold HTTP/1.1 connection than 10 kB spread across four chunks. Under HTTP/2 the tradeoff shifts: more chunks means finer cache granularity. Report chunk count alongside byte counts. For a typical LLui app without route-level splitting, the output should be one chunk (the component code) plus Vite's preload helper if applicable.

**5. Per-primitive cost delta**
Import one feature at a time, build, measure. The delta from a baseline (core runtime only, no view logic) to the next measurement is the cost of that feature. This is the only way to distinguish "the core runtime grew" from "branch() grew." Maintain a spreadsheet of deltas across releases and treat regressions in any individual delta as a bug.

### Granularity

Measure at two levels:

- **Full-app measurement**: a representative application (see the comparison methodology below) built and measured end-to-end. This is the number you publish.
- **Per-feature microbenchmark**: a minimal harness that imports exactly one primitive, calls it once, and exports a DOM node. This isolates the cost of each export. The harness must go through the full Vite build pipeline — not `tsc`, not `esbuild` in library mode — because Vite's Rollup-based bundler is what downstream users will use.

---

## How the Compiler Reduces Bundle Size

The Vite plugin does three distinct things that reduce the final bundle. Understanding each mechanism is prerequisite to diagnosing when they fail.

### 1. Element helper elision

`elements.ts` exports approximately fifty functions — `div`, `span`, `button`, `input`, `ul`, `li`, and so on. Each is a thin wrapper around `document.createElement(tag)` that applies the LLui prop and child conventions. In source code, a developer writes:

```ts
import { div, span, button } from '@llui/core';

view: (state, send) => div({ class: 'container' }, [
  span({}, [text(() => state.label)]),
  button({ onClick: () => send({ type: 'click' }) }, [text('Go')]),
])
```

After the compiler runs, every call to `div(...)`, `span(...)`, `button(...)` is rewritten to `elSplit(tag, ...)` where `tag` is the string literal for the element name. The compiler simultaneously removes those names from the import statement. The resulting code imports nothing from `elements.ts`. Rollup's module graph analysis sees no remaining references to any export of `elements.ts` and eliminates the entire module. Without the compiler, all ~50 element helpers are included in every bundle regardless of which elements the app actually uses.

The precondition for elision is that the compiler's import-cleanup pass correctly rewrites every call site and removes every imported name. If a single reference to `div` survives (e.g., because the compiler misidentified a call site — a `div` imported from a user module with the same name), that reference keeps `elements.ts` alive. Verify elision is working with `rollup-plugin-visualizer`: `elements.ts` must not appear in the treemap for any app that used the compiler.

### 2. Static prop extraction

A prop is static when its value does not depend on state — it is a literal string, a literal number, a non-reactive callback, or any expression that does not contain an arrow function of the form `(s: S) => expr`. For static props, the compiler emits direct property assignments in the `staticFn` pass:

```ts
// Source
div({ class: 'container', id: 'root' }, [...])

// After compilation (conceptual)
const el = elSplit('div', [...]);
el.className = 'container';
el.id = 'root';
```

The binding infrastructure — `createBinding`, `applyBinding`, the mask comparison, the `lastValue` tracking — is never instantiated for these assignments. Because those code paths are not reachable from any call site in the bundle, Rollup's reachability analysis eliminates them. This does not eliminate the binding infrastructure entirely (reactive props still need it), but it prevents the infrastructure's per-binding allocation overhead from scaling with the number of static props.

### 3. Dead import removal

The compiler makes import statements progressively shorter as it identifies which names are no longer referenced. Each name removed from an import statement is one fewer edge in Rollup's module graph. When all names from a given module are removed, the module becomes unreachable and is eliminated in full. This works at import granularity, not export granularity — a module with twenty exports is kept alive by a single reference to any one of them.

The practical consequence: if your application imports `branch` but not `each`, `each`'s reconciliation algorithm is not in your bundle. If it imports neither, neither is present. The compiler does not need to do anything special for this — it is standard Rollup tree-shaking — but the compiler's element elision pass makes it possible for the element module to be fully eliminated, which would not happen otherwise.

---

## How Tree-Shaking Works in This Architecture

Rollup (and therefore Vite) performs tree-shaking by constructing a module graph and performing reachability analysis starting from the entry points. An export is included if and only if some reachable import path references it. This means:

**Side-effect-free modules are a prerequisite.** If a module has top-level statements with observable side effects — DOM access, module-level `Map` initialization, global registration — Rollup must include it regardless of whether any of its exports are referenced, because dropping it would change program behavior. Every LLui module must have `"sideEffects": false` declared in `package.json` (or scoped to the relevant paths). Verify this is set; without it, Rollup conservatively includes every module imported by any other included module.

**The core runtime cannot be tree-shaken below its minimum.** `mountApp`, `processMessages`, `applyBinding`, scope creation and disposal, and the dirty-bit evaluation loop are all required by every LLui application. They are reachable from the entry point unconditionally. This is the irreducible minimum — approximately 3–4 kB gzip for the full runtime. No compiler optimization eliminates this floor.

**Structural primitives are independently tree-shakeable.** `branch`, `each`, `show`, `portal`, `foreign`, `child`, `memo`, `errorBoundary` are each separate exports. They are only reachable if the application imports them. The compiler does not need to do anything here — standard tree-shaking handles it. The only requirement is that these exports do not call each other at module initialization time (they do not; they are factory functions).

**`elSplit` is always included.** The compiler replaces all element helper calls with `elSplit` calls. `elSplit` is therefore always referenced in compiled output. It is a small function — a few dozen bytes — but it cannot be eliminated. This is the cost of the element helper elision optimization: you replace ~50 individually-reachable functions with one always-reachable function. The net result is a large win, but `elSplit` is fixed overhead in every app.

**Barrel file imports break tree-shaking for some bundlers.** An import like `import { div, span, each, branch } from '@llui/core'` re-exports everything from `llui/index.ts`. If `index.ts` is a barrel that re-exports from sub-modules, Rollup handles it correctly. But some environments (Jest with `moduleNameMapper`, older webpack configurations, Parcel 1) treat barrel files as atomic and include everything. The Vite plugin's template for generated code should use direct sub-module imports where possible. User-facing imports from `'llui'` are fine for development; the build output should not contain them verbatim after the compiler runs.

---

## Per-Primitive Cost Analysis

The following is a conceptual breakdown of what each primitive contributes to the bundle when imported and used. All figures must be measured empirically against the actual implementation and reported as gzip delta from the previous baseline. These are estimates based on functional complexity; treat them as hypotheses to verify, not as guarantees.

**Core runtime** (always included, ~3–4 kB gzip)
- `mountApp` and the component initialization path
- `processMessages`: the message queue drain loop (microtask-batched `send()`)
- `flush()`: synchronous update cycle trigger (~5 lines, negligible addition)
- Scope creation, child scope registration, `disposeScope`
- `applyBinding` and the binding update loop
- `__dirty` injection infrastructure (the runtime side of the dirty-bit protocol)
- `elSplit`: the compiled element constructor

This is the floor. Every application pays it.

**+ `text()`** (negligible; included in core)
`text()` creates a `Text` node and registers a binding against it. The infrastructure for this is part of `applyBinding` in the core. `text()` itself is a two-line function.

**+ `branch()`** (estimate: +400–700 bytes gzip)
`branch` adds: discriminant evaluation, scope swap logic, comment-node placeholder management, and the case-builder invocation path. It does not include the reconciliation algorithm (that is `each`'s domain). Branch is the most commonly used structural primitive after `text`.

**+ `show()`** (estimate: +50–100 bytes gzip beyond `branch`)
`show` is implemented as a two-case `branch` where one case is an empty builder. It imports and calls `branch`. If `branch` is already in the bundle, `show` adds only its wrapper logic.

**+ `each()`** (estimate: +800–1200 bytes gzip)
`each` adds: key-based reconciliation, entry management (creation, keyed lookup, reuse), and the DOM reordering algorithm. The reordering algorithm — deciding whether to insert, move, or remove DOM nodes to match a new array — is the largest single piece of code in the structural primitives. It dominates `each`'s cost.


**+ `child()`** (estimate: +300–500 bytes gzip) — Level 2 composition only
`child` adds: props watcher (shallow-diff of props accessor output, `propsMsg` conversion and enqueue), child component registry, recursive mount into a `<llui-child>` wrapper, and disposer registration. If the application uses typed addressed effects, the global component registry and address builder infrastructure are also pulled in. Applications that use only Level 1 composition (view functions) do not import `child()` and pay zero cost for it — it is fully tree-shakeable.

**+ `portal()`** (estimate: +150–250 bytes gzip)
`portal` adds: target-element resolution, node insertion at the target, and disposer registration to remove those nodes when the owning scope is disposed. No reconciliation — portal does not manage lists.

**+ `foreign()`** (estimate: +200–350 bytes gzip)
`foreign` adds: container element creation, instance lifecycle management (mount/destroy), a single binding registration for the `props` accessor with shallow-equality comparison, and the `sync` dispatch on prop change. No reconciliation, no structural blocks, no DOM walking inside the container. The container is an opaque boundary — LLui tracks the `props` accessor via the standard bitmask infrastructure and calls `sync` when it changes. Applications that do not import `foreign()` pay nothing for it — it is independently tree-shakeable. The cost is comparable to `portal` plus one binding.

**+ `memo()`** (estimate: +50–100 bytes gzip)
`memo` is a closure that caches its last input and output. It is the smallest non-trivial primitive. Most of its cost is already paid by the binding infrastructure it uses.

**+ `onMount()`** (estimate: +50–100 bytes gzip)
`onMount` queues a microtask via `queueMicrotask` and registers a cancellation disposer. The function body is ~10 lines.

**+ `errorBoundary()`** (estimate: +100–200 bytes gzip)
`errorBoundary` wraps a scoped builder in a try/catch and renders a fallback subtree on throw. It is independently tree-shakeable — apps that do not import it do not pay for it.

**+ `delay` and `log` effect handlers** (estimate: +50–100 bytes gzip each) — built-in, core runtime
`delay` is `setTimeout` with message dispatch. `log` is `console.log` with a structured prefix. Both are trivial and always available.

**+ `@llui/effects` package** (estimate: +500–800 bytes gzip, tree-shakeable)
The `@llui/effects` package provides two things: (1) composable effect description builders — `http`, `cancel` (overloaded: `cancel(token)` for cancel-only, `cancel(token, inner)` for cancel-and-replace), `debounce`, `sequence`, `race` — which are small factory functions that produce plain data objects, and (2) `handleEffects<Effect>()`, a chain that interprets those descriptions at runtime inside `onEffect`. The chain includes a cancellation token registry, debounce timer map, and `AbortSignal` integration for cleanup on unmount. Each builder is independently tree-shakeable — an application that uses only `http` and `cancel` pays only for those builders plus the shared chain runtime (~200–300 bytes gzip). The `.else()` and `.on()` methods add negligible overhead. The `.done()` terminal is compile-time only (zero runtime cost). This package is versioned separately from the core runtime.

**+ `@llui/zag` adapter** (estimate: ~3KB gzip shared, plus per-machine cost)
The `@llui/zag` package provides `useMachine` and `normalizeProps` (the bridge between Zag finite state machines and LLui's reactivity model) plus LLui-idiomatic wrappers around each component. This is a shared cost paid once regardless of how many Zag components are used. Individual Zag machines are independently tree-shakeable: Dialog ~3KB, Select ~4KB, Combobox ~5KB, Tooltip ~2KB. An app using Dialog and Select pays ~3KB (adapter) + ~3KB (Dialog machine) + ~4KB (Select machine) = ~10KB gzip total. See 08 Ecosystem Integration §1.

**+ `@llui/vike` adapter** (estimate: ~1.5KB gzip)
The Vike integration adapter configures `onRenderHtml` and `onRenderClient` hooks. The Vike client runtime adds ~5KB gzip. Both are tree-shakeable in SPA mode (where Vike is not used). See 08 Ecosystem Integration §2.

**`@llui/test` package** (devDependency — zero production bytes)
The `@llui/test` package (`testComponent`, `testView`, `assertEffects`, `propertyTest`, `replayTrace`) is a devDependency and contributes zero bytes to production bundles. It imports the component definition type but does not import the runtime — `testComponent()` calls `update()` directly, accumulates effects, and exposes `.state` and `.effects` for assertions. `testView()` mounts a component in a JSDOM or lightweight DOM and returns a query API, but this runs only in the test environment. Because `@llui/test` never appears in application import graphs, Rollup's reachability analysis excludes it unconditionally. No `sideEffects` annotation or special build configuration is needed — standard devDependency semantics handle it. Estimated install size: ~5–10 kB (uncompressed source), dominated by the `propertyTest` fuzzer and the `replayTrace` serializer.

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
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    llui(),
    visualizer({ open: true, gzipSize: true, brotliSize: true }),
  ],
});
```

After building, open the generated `stats.html`. `elements.ts` must not appear in the treemap. If it does, the compiler's import-cleanup pass failed to remove all references to element helpers. Common causes: the compiler missed a renamed import (`import { div as d } from '@llui/core'`), a call site was in a position the AST visitor did not traverse (e.g., inside a type assertion), or the user has a local file also named `elements.ts` that shadows the LLui import. Fix the compiler; do not work around it.

### 2. Audit the core runtime for unused branches

The core runtime is always included, but it may contain conditional branches that are never exercised. For example: if the application does not use `errorBoundary`, that export's code should not appear in the visualizer. Verify that each structural primitive appears in the visualizer only when the application uses it. If `branch` appears but the application only uses `show`, there is a transitive import pulling `branch` in when it should not be.

Identify dead branches within the always-included core. If `processMessages` contains a path that only executes for addressed effects but the application never uses `AddressedEffect`, consider splitting that path into a separate export that is only pulled in when needed.

### 3. Split branch/each/show into separate entry points

Currently, if `each`'s reconciliation algorithm and `branch`'s scope-swap logic live in the same module, importing either pulls in both. Separate them at the module boundary so that an application using only `branch` does not pay for `each`'s reordering algorithm. This is a refactor with no user-facing API change — only the internal module structure changes. Expected impact: saving `each`'s ~800–1200 bytes gzip for apps that do not use lists.

### 4. Eliminate the elSplit runtime helper via compiler inlining

`elSplit` is a runtime function that every compiled application currently calls. With more aggressive compiler inlining, the compiler could emit direct DOM construction code:

```ts
// Instead of: const el = elSplit('div', children, staticFn, bindFn)
// Emit:
const el = document.createElement('div');
el.className = 'container';
el.append(...children);
scope.bindings.push({ node: el, accessor: s => s.count, ... });
```

This eliminates `elSplit` from the bundle entirely and makes the element construction code directly minifiable. The tradeoff is that the compiler must emit more code per call site (higher raw bytes before compression) and the compiler itself becomes substantially more complex. The compression ratio for repeated `document.createElement` calls is favorable — gzip and brotli compress repeated strings well — so the net gzip impact may be negative (smaller). This is high-complexity, high-payoff; defer until the compiler architecture is stable.

### 5. Prerender static subtrees to HTML template cloning

If an entire subtree has no reactive bindings — no accessor functions, no `branch`, no `each` — it will look identical on every render. The compiler can detect this and emit a `<template>` element clone instead:

```ts
// Source: a static header with no bindings
header({ class: 'app-header' }, [
  h1({}, [text('My App')]),
])

// Emitted:
const _tmpl = document.createElement('template');
_tmpl.innerHTML = '<header class="app-header"><h1>My App</h1></header>';
const el = _tmpl.content.cloneNode(true);
```

Template cloning is faster than imperative construction and the emitted code is smaller. The compiler must prove that no binding exists anywhere in the subtree — including deeply nested children. This is a conservative analysis; any dynamic expression anywhere in the subtree disqualifies the optimization. Expected impact: meaningful for apps with large static layout shells; negligible for apps where most nodes are reactive.

### 6. Annotate pure factory calls with `/*@__PURE__*/`

Terser and esbuild recognize the `/*@__PURE__*/` annotation as a hint that a function call has no side effects and its result can be discarded if unused. Annotate `elSplit`, `branch`, `each`, and all other LLui factory calls:

```ts
const el = /*@__PURE__*/ elSplit('div', ...);
```

This enables the minifier to eliminate entire subtrees in dead-code branches. Without the annotation, the minifier conservatively retains calls whose results are unused because it cannot prove they have no side effects. Impact is small for typical apps but meaningful in generated code with many conditional paths.

### 7. Constant folding for zero masks

If the compiler determines that a prop has no reactive bindings (mask is 0), the binding object itself is unnecessary — the value should just be set once in `staticFn` and never tracked. The compiler currently handles this for fully-static props, but may not handle the edge case where a prop's expression touches no state fields despite being written as an arrow function. Identifying and folding these zero-mask bindings eliminates binding allocation and registration overhead per instance.

### 8. Avoid barrel re-exports in internal plugin templates

When the LLui Vite plugin generates output code (e.g., the `elSplit` import), it should import from the specific module that defines `elSplit`, not from `'llui'` index. If it imports from the index and the index re-exports from multiple modules, bundlers that do not support deep barrel optimization will include more than is necessary.

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

**Static subtree prerendering tradeoff.** Resolved: implement in v1 with a conservative heuristic — only subtrees where every node is a literal element with literal string/number props and literal `text()` children qualify. No type-checker integration required; the analysis is syntactic: "does this subtree contain any arrow function, any identifier that is not a known literal, or any structural primitive (`branch`, `each`, `show`)?" If not, emit a `<template>` clone. This handles nav bars, footers, icon components, and static layout shells — the most common cases. Subtrees with even one reactive binding are ineligible. The compiler complexity is low (one additional AST pass after the element elision pass) because the heuristic is conservative. Expected coverage: 10–30% of nodes in typical applications.

**Bundle size scaling with component count.** Resolved: measure empirically using a synthetic scaling harness. Generate apps with 1, 5, 10, 25, 50 components of identical structure (each has the same number of bindings, same structural primitives). Plot total gzip against component count. The expected curve is: fixed core runtime + linear per-component cost, where the per-component cost is dominated by `elSplit` calls and binding registrations. The `elSplit` string arguments (`'div'`, `'span'`, etc.) compress well under gzip (high symbol reuse), so the observed growth rate should be sub-linear in gzip bytes even if raw bytes grow linearly. Include this scaling harness in the benchmark suite and report the per-component marginal gzip cost.
