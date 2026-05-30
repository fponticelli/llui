# LLui Compiler

The LLui compiler is a compile-time transformation that lowers high-level signal authoring syntax into the lower-level runtime form, enforces a set of non-bypassable correctness rules, and emits introspection metadata for the agent/debug surface. It is the `@llui/compiler` package; the `@llui/vite-plugin` package is the Vite adapter that wires it into a build.

This document describes the technology choice, the single signal transform and the analysis infrastructure it shares, the compile-time lint rules, what genuinely benefits from compile-time work, what should not be attempted, and the correctness invariants the transform must preserve.

There is **one transform path**. The earlier three-pass bitmask compiler — static/dynamic prop split, `__dirty`/`__prefixes` synthesis, mask injection, `elSplit`/`elTemplate` emission, per-message `__handlers`, import elision — was deleted with the legacy runtime. Nothing below describes a fallback to it because it no longer exists.

---

## Recommended Technology Stack

**Use the TypeScript Compiler API exclusively.** All AST work stays on `ts.createSourceFile` / `ts.forEachChild` / `ts.is*` predicates. The transform is source→source: it parses the file, computes byte-offset edits, and splices them back, leaving everything it doesn't touch byte-for-byte intact.

### Why not Babel / SWC / a custom parser

Babel's TypeScript support is a best-effort syntax strip with a different AST shape and no `ts.TypeChecker`. SWC has no type information in its transform pass and no stable JS-authored custom-transform API. A custom parser would have to track every TypeScript syntax addition forever. The TypeScript Compiler API gives an accurate, stable AST for free, exposes a `ts.TypeChecker` when cross-file resolution needs one, and is the same language the compiler is written in — no context switch to debug or extend it.

### Vite Integration

The plugin registers with `enforce: 'pre'` so it runs before Vite's own TypeScript stripping; otherwise the AST it sees would already have lost type structure. The `transform()` hook runs per file, on demand, as the module graph resolves — the correct granularity, since each file is analyzed independently (cross-file _resolution_ chases imports explicitly; see below). Vite handles HMR invalidation and module caching.

---

## Signal File Detection

The adapter treats a `.ts`/`.tsx` file as a **signal file** when it both imports `@llui/dom` and contains a `component(` / `component<` call:

```ts
if (/component\s*[<(]/.test(code) && /from\s*['"]@llui\/dom['"]/.test(code)) {
  /* run lint, lower, emit */
}
```

This pair is unambiguous: `@llui/dom` _is_ the signal runtime. The closing-quote-anchored import pattern excludes the type-only / SSR-env sub-entries (`@llui/dom/internal`, `@llui/dom/ssr/*`, `@llui/dom/devtools`), so a file that imports only those never trips detection. A signal file may use `.at()`, only `.map()`, or a fully static view — all are handled. Non-signal `.ts`/`.tsx` files pass through untouched.

For each detected signal file the adapter, in order: (1) runs the signal lint and throws on any diagnostic via `this.error` (a build error — the only effective channel; see CLAUDE.md), (2) resolves cross-file Msg/State/Effect types for full introspection metadata, (3) lowers the direct view and splices introspection metadata, and (4) in dev with MCP enabled, prepends the relay bootstrap.

---

## The Signal Transform

`transformSignalComponentSource(source, opts)` (`compiler/src/signals/transform-component.ts`) lowers a component's **direct view** to runtime helpers. The lowering is an **optimization**, not a requirement: it erases the runtime signal-handle allocation for views written inline in `component({ ... view: ({ state }) => [ … ] })`. Anything it can't lower — a view that delegates to view-helper functions, a block-body view, an aliased/multi-slice bag — still works, because the authoring helpers (`text`, `div`, `each`, `show`, `branch`, …) are **real runtime functions** that consume signal handles and build the same mask-gated bindings (see 03 Runtime DOM.md and the `signals/authoring.ts` / `signals/handle.ts` modules). The transform never has to handle every shape to stay correct; it lowers the common shape and leaves the rest to the runtime.

### What the lowering does

The component visitor finds `component({ … })` calls whose `view` is an arrow/function expression that (a) destructures a `state` field from its bag parameter (`({ state })` or `({ state: s })`) and (b) returns a concise array literal (`=> [ … ]` or `=> ([ … ])`). For such a view it rewrites each returned node expression and replaces only the array's byte range.

The view-expression rewrite (`transform-view.ts`) maps authored reactive slots to runtime calls:

- `text(state.at('count'))` → `signalText((s) => s.count, ['count'])`
- `text('literal')` → `staticText('literal')`
- `div({ class: <signal> }, [..])` → `el('div', { class: react((s) => …, [..]) }, [..])`
- structural primitives → `signalEach` / `signalShow` / `signalBranch` (and `signalForeign`)

Static props, event handlers, and non-signal values are preserved verbatim; children are transformed recursively. Each-row render callbacks rebind roots so an `item` param resolves against `ctx.item` and the component `state` against `ctx.state`.

The runtime helpers it can emit are `signalText`, `staticText`, `el`, `react`, `signalEach`, `signalShow`, `signalBranch`, and `signalForeign`. After rewriting, the transform injects `import { … } from '@llui/dom'` for exactly the helpers it actually used.

### What is left to the runtime (the un-lowered path)

When a view doesn't match the direct-view shape — it's a block body, it delegates to a helper like `dialog.overlay({ … })`, or its bag is aliased in a way the direct rewrite doesn't cover — the transform leaves the authored calls intact. At runtime, `text`/`div`/`each`/`show`/`branch`/`foreign` (the authoring surface) detect signal handles, pull `produce`+`deps` from them, and build identical bindings. The signal handle (`pathHandle` in `signals/handle.ts`) carries `produce`/`deps` precisely so view-helper composition works without static lowering. (Supporting block-body and multi-slice views in the lowering itself is a tracked optimization, not a correctness gap.)

### Introspection metadata emission

When agent metadata or dev mode is enabled, the transform splices metadata properties into the component config after the `view` property:

- `__msgSchema`, `__effectSchema` — discriminated-union schemas of `Msg` / `Effect`.
- `__stateSchema` — the state shape.
- `__msgAnnotations` — per-message JSDoc annotations (`@intent`, `@example`, `@humanOnly`, …).
- `__schemaHash` — a stable hash of the schemas, for hot-reload schema-change detection.
- `name` — inferred from the binding (`const Counter = component({…})`) unless the author set one.
- `__componentMeta: { file, line }` — dev-only source location.

User-provided fields take precedence (the splicer skips any field already present in the config). Schema extraction reuses the shared analysis infra below; the optional `@llui/compiler-introspection` and `@llui/compiler-devtools` factories (registered by the Vite plugin at import time) supply the introspection and devtools emitters.

---

## Shared Analysis Infrastructure

The cross-cutting analysis modules survive from the prior architecture and back both the transform and the cross-file resolution path:

- **Cross-file resolver** — follows identifier references across import / re-export / barrel boundaries via the TypeChecker (`getAliasedSymbol`) to find a type's or accessor's declaring file.
- **Msg/State schema extractors** (`msg-schema.ts`, `state-schema.ts`) — read a discriminated union or state shape into a JSON-Schema-subset: literal/primitive field types and `{ enum: [...] }` for string-literal unions; complex types fall back to `'unknown'` (passes validation unconditionally). Composition-aware: a `type Msg = ImportedFoo | { type: 'extra' }` walks into the imported union so the schema/annotations are complete.
- **Annotation extractor** (`msg-annotations.ts`) — reads per-variant JSDoc.
- **Accessor / dependency analysis** (`extract-deps.ts`, `collect-deps.ts`) — classifies signal expressions and their dependency paths; this is what the lint and the view-lowering both key off for roots and signal-rootedness.
- **Schema hash** (`schema-hash.ts`).

The Vite adapter (`preResolveTypeSources` / `preExtractCompositional`) plumbs cross-file results into the transform via `opts.typeSources` (for `State`, which isn't a union) and `opts.preExtracted` (for the composition-aware `Msg`/`Effect`/annotations). When a type lives in a sibling file, this is what keeps the emitted metadata complete instead of silently half-populated.

---

## Compile-Time Lint Rules

`lintSignalSource(source, fileName)` (`compiler/src/signals/rules.ts`) runs the signal rules over the authored source and returns diagnostics with resolved line/column. The Vite adapter surfaces **every** diagnostic as a build error through `this.error` — they are non-bypassable by design. LLMs ignore lint warnings; a build that fails closed is the only reliable channel (this is also why there is no `@llui/eslint-plugin` — the rules are compiler errors, ~44 in total across correctness/agent-protocol/conventions).

The signal-specific rules:

- **`peek-in-slot`** — `sig.peek()` used in a reactive slot. `.peek()` reads once and never updates; legitimate only inside event handlers and `.map`/derived bodies. The walker tracks a `peekOk` flag, flipping it true when descending into `on*` handler props and `.map`/`derived` callback bodies.
- **`operator-on-signal`** — a reactive signal used as an operand of an arithmetic/comparison/logical binary expression, a template-literal span, a ternary condition, or a unary expression. A signal is not a value; derive with `.map(v => …)`. (A `.peek()` chain yields a plain snapshot and is allowed.)
- **`no-node-construction-in-body`** — an element/text helper (`div`, `text`, `el`, `signalText`, …) called inside a `.map`/derived body. Derive bodies produce plain values; build DOM with a structural primitive (`each`/`branch`/`show`).
- **`pure-derive-body`** — a side effect (`fetch`, `send`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`), a reactive primitive (`.peek`/`.at`/`.map` on a signal-rooted receiver), or a non-deterministic call (`Date.now`, `Math.random`) inside a `.map`/derived body. **Correctness-critical** — the analyzer's soundness (a path read only through such an expression would be invisible to dependency tracking) depends on these bans.
- **`whole-state-to-call`** — a bare `state` root (empty dep path) passed straight to a call in a reactive position. Reading the whole state as a binding's dep makes it re-run on every change; pass a slice (`state.at('…')`) to keep the dep narrow.

The walker is **scope-aware**: `each`/`show`/`branch` render callbacks introduce signal-typed params (item, index, narrowed variant) that are checked exactly like the `state` root inside those bodies — `item.at('done') ? a : b` errors in a row just as `state.at('flag') ? a : b` does at the top level. The view body is linted under the same root alias the lowering uses (the bag's `state` alias), so an aliased bag like `({ state: s }) => [text(s.at('n') + 1)]` is checked, not silently passed. `key` callbacks receive a **plain** value and stay un-rooted.

---

## What Adds Value

### Direct-view lowering erases handle allocation

For the common inline-view shape, lowering `text(state.at('count'))` to `signalText((s) => s.count, ['count'])` removes the per-slot runtime signal-handle object and its `.at`/`.map` chain. The runtime authoring path is correct without it, but the lowered form is the zero-allocation fast path for the hot view.

### Non-bypassable correctness rules

Because the rules are build errors, an LLM cannot generate a subtly-wrong reactive slot (a `.peek()` in a slot, an operator on a signal, a side effect in a derive) and have it merely warn. The build fails with a precise message and source location. This is the deliberate inversion of the usual lint model and the reason `@llui/eslint-plugin` was deleted rather than kept.

### Introspection metadata for the agent surface

The emitted schemas/annotations let the dev runtime validate messages, advertise affordances, and explain state to an LLM agent without the developer hand-writing any of it. Composition-aware cross-file extraction means types organized across files still yield complete metadata.

### Source→source string output

The transform computes byte-offset edits and splices them, applied back-to-front so offsets stay valid. Untouched code is preserved exactly, which keeps the diff between authored and emitted source minimal and makes the lowering easy to reason about.

---

## What to Avoid

### Regex-based structural transforms

Regex on source text breaks on multiline objects, string values containing the target, template literals, comments, and reformatting. The cheap string pre-checks (`/component\s*[<(]/`, the import test) are used only to _decide whether to parse_; all structural work goes through the AST.

### Re-introducing the bitmask compiler

The two-word `mask`/`maskHi`, `__dirty`/`__prefixes` synthesis, `elSplit`/`elTemplate` collapse, per-message `__handlers`, stride-loop detection, and import elision are gone. They served the deleted runtime. The chunked-mask runtime computes dirty sets at runtime from reference-equality (see 03 Runtime DOM.md); the compiler emits no mask tables and no `__dirty`.

### Forcing every view shape through the lowering

The lowering handles the direct-view shape and bails (leaves the source intact) on everything else. That bail is correct: the runtime authoring helpers consume signal handles and build identical bindings. Attempting to statically lower block bodies, helper delegation, and arbitrary bag aliasing would add fragile special-casing for no correctness benefit — only a (sometimes) marginal allocation win. Expand the lowering only where the allocation win is measured and the shape is common.

### Per-file compilation caching

Vite already caches `transform()` results by content hash. A second cache would duplicate that and add invalidation bugs.

---

## Correctness Invariants the Transform Must Preserve

These must hold for every transformed file. A change that violates one is a bug, not an optimization.

**1. Dependency soundness.** A lowered binding's emitted `deps` must be a conservative **superset** of the paths its accessor reads. The runtime gates a binding out when none of its deps are dirty; a dep that is too narrow strands stale DOM (a silent false negative), while a dep that is too broad merely wastes a `produce` (harmless). The lowering must never emit a `deps` array narrower than the accessor's true reads. This is the compile-time half of the end-to-end guarantee in `mask.ts`; the `pure-derive-body` rule exists to keep the analysis able to see every read.

**2. Semantic equivalence of lowered vs. authored.** A lowered `signalText`/`el`/`signalEach`/… call must build the same DOM and the same bindings the authoring helper would have built from the signal handle. The two paths coexist by construction (`authoring.ts` delegates to the same `dom.ts` helpers the lowering emits), so the equivalence is structural, not coincidental.

**3. The lint must fail closed.** Every signal diagnostic is surfaced as a build error. A rule that detects a known-unsafe shape must not downgrade to a warning. The `pure-derive-body` and `peek-in-slot` rules in particular guard analyzer soundness and reactive correctness respectively.

**4. Metadata never overrides author intent.** When splicing `__msgSchema`/`name`/etc., any field the author wrote is left untouched. The check is property-name presence in the config AST, not string matching.

**5. Detection must not catch type-only / SSR-env imports.** The import test is anchored to the closing quote of `'@llui/dom'`, so `@llui/dom/internal`, `@llui/dom/ssr/*`, and `@llui/dom/devtools` do not trip signal-file detection. A file importing only those is not a signal file.

**6. Untouched source is byte-preserved.** Edits are byte-offset splices applied back-to-front; code outside an edit range is emitted verbatim.

---

## Open Questions and Future Directions

### Lowering block-body and multi-slice views

The direct-view lowering currently requires a `state`-destructuring bag and a concise array body. Block bodies (`view: ({ state }) => { … return [ … ] }`) and multi-slice bags fall back to the runtime authoring path — correct, but they pay the handle-allocation cost. Extending the lowering to these shapes is a tracked optimization (it requires the rewriter to follow locals declared in the block and re-root them), valuable where such views are hot.

### Cross-file accessor lowering

Cross-file _type_ resolution (for metadata) is implemented. Lowering a view that calls an in-repo view-helper in a sibling file — folding the paths that helper reads into the host binding's deps so the helper's slots stay narrowly gated — is the harder, deferred direction. Today such a view runs entirely via the runtime authoring helpers (correct, handle-allocating); a cross-file walker that descends into the helper to lower it is future work.

### Dead-arm elimination for `branch`

If a state type makes a `branch` arm unreachable, the compiler could drop it from the bundle. This needs the TypeChecker to read the discriminant's type and Rollup-level tree-shaking of the dead arm factory.

### Source map generation

The transform emits string output without a source map (`map: { mappings: '' }`), so runtime stack traces point at lowered positions. `magic-string` (already a Vite dependency) tracks offset edits and can emit a precise map while preserving trivial mapping for untouched source — a developer-experience improvement, not an optimization.
