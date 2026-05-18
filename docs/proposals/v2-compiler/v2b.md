# v2b — Cross-File Analysis, Runtime Contract, Test Migration

**Status:** Proposal. Open for revision until adopted.
**Depends on:** v2a.
**Blocks:** v2c (loosely — v2c can ship before v2b if needed, but the diagnostic-schema work in v2c is easier after v2b lands).

Read [`README.md`](./README.md), [`shared.md`](./shared.md), and v2a's [implementation roadmap](./v2a.md) for context first.

---

## 1. Scope

v2b is the load-bearing user-visible phase. It bundles four interdependent pieces:

1. **Cross-file walker** — descends into helper calls across file boundaries, the technical work that closes the sentinel-`show()` gap.
2. **Library manifest format (`__llui_deps.json`)** — the boundary contract for published packages.
3. **Runtime contract change** — `__compilerVersion` on `ComponentDef`, the `createInstance` versioning gate, the `track()` runtime stub.
4. **Test migration** — `packages/dom/test/`'s ~84 mount-using test files migrate to a `defineTestComponent()` builder that opts into the optimized path.

These ship together because they have to. The walker's correctness depends on the manifest schema; the runtime gate depends on the compiler emitting `__compilerVersion`; the test migration depends on the gate. Splitting them across separate PRs would re-introduce the cost-without-benefit problem that motivated descoping all four out of v2a.

**Exit criterion (high level):** the sentinel `show()` blocks in dicerun2 (`apps/web/src/pages/my-rolls/+Page.ts:2393,2401,2406`, `pages/studio/+Page.ts:223`) are deleted, the app still works correctly, and no `track()` is needed for the deleted blocks. Plus: every `packages/dom/test/` file green post-migration.

---

## 2. Cross-file analysis (the §6.3 work)

### 2.1 View-helper resolution rule

The compiler maintains a project-wide graph of which files transitively contribute reads to which components. Walked lazily on demand, cached aggressively.

For a component in `src/+Page.ts`, computing `__prefixes` requires the component's own view function plus every helper transitively called from the view. The walker resolves helper calls via the TypeScript symbol table — `getSymbolAtLocation` gives us the declaration, which gives us the file and AST.

**Termination rule (drafted; promotes to committed once the validation gate below has run).** A function call is followed into the callee iff the callee qualifies as a _view helper_. A function is a view helper iff at least one of the following holds, determined from its declared TypeScript signature using the **declared (not inferred) type** of the function — i.e., `ts.TypeChecker.getTypeOfSymbolAtLocation` against the symbol's declared signature, not its expression-position widened type:

1. It accepts a parameter assignable to `View<S, M>` or one of the documented structural subsets below. The subsets are an **enumerated whitelist** — not a "matches any of these names" rule — and each is covered by a golden-file fixture:
   - `View<S, M>` (the full bag).
   - `{ send: Send<M> }` (send-only, e.g. event-handler wrapper helpers).
   - `{ send: Send<M>; text: TextFn<S> }` (send + text accessor — covers `themeBtn`/`localeSwitch`-style helpers in `examples/dashboard/src/main.ts`).
   - `{ text: TextFn<S> }` (text accessor only).
   - `{ send: Send<M>; show: ShowFn<S, M>; each: EachFn<S, M>; branch: BranchFn<S, M> }` (event-handler + structural primitives, no text accessors).
     The matcher uses `ts.TypeChecker.isTypeAssignableTo` against the declared subset type, _not_ property-name string matching — so `(v: string) => Text` parameter shapes (anonymous in `examples/todomvc/src/main.ts:200`) match through `TextFn<S>`'s type alias as long as the alias resolves. New subsets require a doc revision _and_ a fixture; the rule does not silently grow.

2. Its **declared** return type is assignable to `Node`, `Node[]`, `Node | undefined`, or `ReadonlyArray<Node>`. Helpers that rely on TypeScript's expression-position return-type inference (no explicit annotation) are _not_ picked up by this rule and require either an explicit annotation or the `@llui-helper` tag — this is intentional, because inference often widens to union shapes (`JSX.Element | undefined`, `Node | string | undefined`) that miss assignability.

3. It is explicitly marked with the `/** @llui-helper */` JSDoc tag.

Async helpers (declared return type assignable to `Promise<Node>` or `Promise<Node[]>`) are explicitly **not** view helpers under this rule — they cannot validly produce DOM in LLui's synchronous view model. A call site that returns a Promise into a view position is a hard error (`llui/async-view-helper`), not opaque.

Any other call is treated as opaque: the walker does not descend. If the call site is structurally a view position (its result flows into a view-returning expression) and the callee is opaque, the analyzer emits an `llui/opaque-view-call` diagnostic and contributes FULL_MASK at the boundary. Users resolve this by:

- adding an explicit return-type annotation (most common case — TS inference is the silent culprit);
- adding `@llui-helper` to intentional helpers whose return type genuinely can't be annotated (e.g., heavy generics);
- using `track()` (§3) for genuinely dynamic dispatch.

This rule is mechanical, type-checker-driven, and falsifiable by golden-file tests. It is not implementor-discretion.

### 2.2 Validation gate (v2b blocker)

The walker itself ships in v2b, so the rule cannot be exercised against real source until then. Before the `__llui_deps.json` schema is frozen and the walker is enabled in default config, spike a prototype walker and run it against `dicerun2` (~49k LOC of LLui consumer code) and `decisive.space-2` (~28k LOC). Record:

- the count and locations of `llui/opaque-view-call` diagnostics produced,
- how many resolve by adding an explicit return type vs. by adding `@llui-helper` vs. by needing `track()`,
- any helper shapes the rule misclassifies in either direction (false positives, silent FULL_MASK escapes).

**Recovery plan if the gate fails.** "Fails" means any of: (a) the diagnostic count exceeds ~50 instances per 10k LOC of consumer source, (b) more than 10% of those instances need `@llui-helper` rather than a return-type annotation (the rule is mis-targeted), or (c) any silent FULL_MASK escape is observed. Recovery options, in order of preference:

1. **Tighten the rule** if the spike shows misclassification — narrow case 2 or add a fourth case discovered during the spike. Re-run the gate.
2. **Ship a codemod** that adds explicit return-type annotations to all helpers in the consumer's codebase that the spike identifies. v2b ships the codemod, not user cleanup.
3. **Defer the rule** to v2b.1 and ship v2b with `track()` + manifests only.

The rule does not promote to "committed" until this run completes, one of the three options is chosen, and the choice + its rationale + the gate's measured numbers are appended to this section.

Pre-flight evidence: a spike against `@llui/components` + 9 in-repo examples found ~14 helpers classified WALKED, ~6 OPAQUE (4 resolvable by annotation, 1 candidate for `@llui-helper`, 1 genuine non-helper). Diagnostic rate estimated 5–15 per 10k LOC — well under the 50 threshold. The dicerun2 + decisive.space-2 gate either confirms this or names the divergence.

**Golden fixtures required regardless of gate outcome.** Three fixture categories lock in deliberate behavior:

1. **One golden per case-1 subset** (`View<S, M>`, `{ send }`, `{ send, text }`, `{ text }`, `{ send, show, each, branch }`) — assert WALKED with the correct read set.
2. **The `connect()`-returns-parts-object pattern.** `packages/components/src/components/carousel.ts:182`-style `connect()` returns a `Parts` object of `(s: S) => X` accessor thunks, _not_ `Node[]`. The rule correctly does not walk it. A golden fixture covers (a) `connect()` called directly with a `viaParams`-resolved manifest, (b) `connect()` wrapped by a consumer helper _without_ a return-type annotation — which goes opaque and must emit `llui/opaque-view-call`, not silently degrade.
3. **Inference-widened return types.** A helper without an explicit return annotation whose inferred type widens to `JSX.Element | undefined` or similar must NOT match case 2. Golden fixture asserts opaque + diagnostic.

### 2.3 Recursion and cycles

Recursion terminates at:

- **Cycles** (a `visited` set per query; cycles are reported with `llui/helper-cycle` and treated as resolved-to-fixed-point on the second visit).
- **Type-erased boundaries** (`AnyComponentDef`, dynamic dispatch via `track()`).
- **Imports from packages that ship a `__llui_deps.json` manifest** (§4): the manifest is consulted instead of source.

---

## 3. The `track()` primitive

For cases where static analysis genuinely can't see through (dynamic dispatch, plugin registries, context-chained reads): an explicit, named primitive.

### 3.1 Shape

```ts
// Inside a view, declares paths the surrounding component depends on
// but which static analysis can't infer from this file alone.
track({ deps: (s: State) => [s.pluginRegistry, s.activePluginName] })
```

`track` returns nothing visible (no DOM nodes). It registers paths with the host component's `__prefixes`. The compiler picks up the `deps` accessor like any other reactive accessor.

**Runtime cost: zero.** `track()` is a compile-time declaration only. After `compiler-core` reads the `deps` accessor and folds its paths into the host component's `__prefixes`, the call-site expression is rewritten to nothing — the statement is stripped from the emitted output, and the `track` symbol is removed from the import list. A `track()` call in source produces no JS in the bundle, no allocation at mount, no work in the update cycle. This is asserted by a golden-file fixture: a component with `track()` and a component without it emit byte-identical view-function bodies (modulo the `__prefixes` table).

The runtime _does_ export a `track` symbol — a stub that throws `LluiCompilerSkippedError` if called at runtime. This is the §6 FULL_MASK fallback path: if a `ComponentDef` bypassed the compiler, the stub's throw on first `track()` evaluation tells the user explicitly _which_ call they need to either compile or remove, instead of silently degrading.

### 3.2 Why this exists

Some patterns are genuinely beyond static analysis:

- Plugin registries: `pluginRegistry[name].render(h, send)` where `name` is state
- Helpers returned by `useContext` chains where the context provider is in a third file
- Helpers stored in arrays and dispatched by index

For these, the developer declares the deps explicitly. The intent is clear from the primitive's name.

### 3.3 `track()` is rare by design

The architecture commits to making `track()` unnecessary in the common case:

- The view-helper resolution rule (§2.1) covers all statically-typed helpers.
- The library manifest (§4) covers all published helpers.
- Slice-accessor substitution (§4.4) covers `withSlice`-style patterns.

The lint rule `llui/prefer-static-deps` warns when `track()` is used in a position where static analysis would have caught the same paths. When the rule has a structural alternative to suggest, it provides an autofix. A clean codebase has zero `track()` calls; the primitive exists so users have a correct way out when the analysis falls short.

### 3.4 What it replaces

The sentinel `show({ when: (s) => { void s.foo; return false }, render: () => [] })` pattern (dicerun2's `apps/web/src/pages/my-rolls/+Page.ts:2406` and `pages/studio/+Page.ts:223`) becomes:

```ts
track({ deps: (s) => [s.fromCommunityOpen, s.communityResults /* ... */] })
```

In most cases of that codebase, even `track()` is unnecessary — the helpers in question are statically-typed view helpers in other files, which the v2b cross-file walker resolves directly. `track()` is the fallback for the residual cases where dispatch is genuinely dynamic.

---

## 4. Library boundary — `__llui_deps.json`

### 4.1 The problem

`@llui/components` (and any third-party package) ships compiled JS. Source ASTs aren't available at consumer build time. The compiler can't walk imported helpers to derive their dependencies.

### 4.2 The fix: schema (v1)

Every published `@llui/*` package (and any third-party package that wants compiler-level integration) emits a manifest at publish time. The manifest declares each exported helper's reactive footprint — the paths it reads directly, the paths it reaches through accessor parameters, and the context-provider keys it consumes.

A note on scope: LLui's built-in slice primitive (`slice()` in `packages/dom/src/primitives/slice.ts`) is _not_ manifest-driven. It returns a View bag whose method calls compose with `lift`, which is too tightly coupled to the runtime's primitive set to express through a generic schema. `slice()` and the other primitives (`show`, `each`, `branch`, `scope`, `memo`, `sample`, `selector`, `text`, `unsafeHtml`, `clientOnly`) are understood directly by `compiler-core`. The manifest schema handles third-party and userland helpers that _use_ those primitives — the long tail.

The schema below is the result of validating against the real `@llui/components` surface (§4.3). The shapes are the minimum needed for the entire components package to round-trip; nothing here is speculative.

```ts
interface Manifest {
  version: 1
  compilerVersion: string
  helpers: Record<string, HelperEntry>
  components: Record<string, ComponentEntry>
}

interface HelperEntry {
  // Distinguishes "returns Node[]" (walked at call site) from "returns a
  // parts bag" (spread at call site; each spread is a fresh accessor read).
  kind: 'view-helper' | 'parts-helper'

  // Paths the helper reads from its OWN state shape — not the consumer's.
  helperLocalPaths: string[]

  // Per-parameter substitution metadata. Index N here corresponds to the
  // helper's Nth declared parameter.
  viaParams: ParamSpec[]

  // Context-provider keys this helper consumes (via useContext, ctx, etc.).
  // The provider lives in the consumer's tree, not the call site — so this
  // cannot reduce to viaParams.
  contextReads?: ContextRead[]
}

type ParamSpec =
  | { index: number; shape: 'accessor'; innerReads: InnerRead[] }
  | { index: number; shape: 'accessor'; readsThroughResultOf: number; innerReads: InnerRead[] }
  | { index: number; shape: 'options-bag'; fields: Record<string, FieldSpec> }
  | { index: number; shape: 'send' } // a Send<M> parameter; never read for paths
  | { index: number; shape: 'thunk-returning-nodes' } // walked as a continuation of the host view
  | { index: number; shape: 'opaque' } // do not attempt to extract reads

type FieldSpec =
  | { shape: 'accessor'; innerReads: InnerRead[] }
  | { shape: 'accessor'; readsThroughResultOf: number; innerReads: InnerRead[] }
  | { shape: 'send' }
  | { shape: 'thunk-returning-nodes' }
  | { shape: 'opaque' }

type InnerRead =
  | { kind: 'rooted'; path: string } // helper-local read (within helper's state shape)
  | { kind: 'param-result'; from: number } // whole result of parameter N
  | { kind: 'param-result-path'; from: number; path: string } // sub-path within parameter N's result

interface ContextRead {
  context: string // canonical id, e.g. '@llui/components#LocaleContext'
  subPaths: string[]
}
```

`helperLocalPaths` are reads expressed in terms of the helper's _own_ state shape — rooted in whatever state the helper directly sees, not in the consumer's state. `viaParams` declares parameter-threading metadata so the consumer's compiler can substitute the call-site accessor and resolve to host-state paths.

**Three shape primitives merit explicit naming:**

- **`param-result-path`** (the dominant `InnerRead` kind across the components package). A `connect()` body reads `paused`, `current`, `count` _within_ the result of its first accessor parameter. The whole-result `param-result` variant is the special case where the entire returned value is consumed (`withSlice`-style HOFs); the path-qualified version covers everything else.
- **`options-bag`** (`ParamSpec` shape). Real-world helpers bundle the accessor inside an options object — `OverlayOptions { get, send, parts, content }`. Without this shape, every options-bag-style API in `@llui/components` (popover, select, dialog, tour) would degrade to FULL_MASK at every consumer call site.
- **`contextReads`** (top-level on each `HelperEntry`). Context providers live in the consumer's tree, not at the call site, so context dependency cannot reduce to `viaParams`. The `context` field is a canonical string (`<package-name>#<export-name>`) — symbols don't survive JSON serialization. A publish-time check asserts the symbol's `_name` matches the canonical id; mismatches fail the manifest build.

**`kind: 'parts-helper'` vs. `'view-helper'`.** Parts bags don't get walked at the call site — they get _spread_ into elements later by the consumer. The substitution algorithm in §4.4 needs to know which mode applies: a `view-helper` is resolved once per call site; a `parts-helper` contributes the same read set to every spread of its returned parts.

### 4.3 Worked examples — the three real shapes

The schema is validated against three real helpers from `@llui/components`. Each is the smallest exemplar of one of the three previously-flagged shape categories.

#### 4.3.1 Parts-helper with `param-result-path` reads — `carousel.connect()`

Library source (excerpted from `packages/components/src/components/carousel.ts:182`):

```ts
export function connect<S>(
  get: (s: S) => CarouselState,
  send: Send<CarouselMsg>,
  opts: ConnectOptions,
): CarouselParts<S> {
  return {
    root: {
      'data-paused': (s) => (get(s).paused ? '' : undefined),
      onPointerEnter: tagSend(send, ['pause'], () => send({ type: 'pause' })),
    },
    nextTrigger: { disabled: (s) => !canGoNext(get(s)) }, // reads `current`, `count`, `loop`
    slide: (index: number) => ({
      'data-active': (s) => (get(s).current === index ? '' : undefined),
      hidden: (s) => get(s).current !== index,
    }),
  }
}
```

Manifest entry:

```json
"connect": {
  "kind": "parts-helper",
  "helperLocalPaths": [],
  "viaParams": [
    { "index": 0, "shape": "accessor", "innerReads": [
      { "kind": "param-result-path", "from": 0, "path": "paused" },
      { "kind": "param-result-path", "from": 0, "path": "current" },
      { "kind": "param-result-path", "from": 0, "path": "count" },
      { "kind": "param-result-path", "from": 0, "path": "loop" }
    ]},
    { "index": 1, "shape": "send" },
    { "index": 2, "shape": "opaque" }
  ]
}
```

Consumer code `connect((s: AppState) => s.carousel, send, {})` resolves to `carousel.paused`, `carousel.current`, `carousel.count`, `carousel.loop` in the consumer's `__prefixes`.

#### 4.3.2 Options-bag forwarding — `popover.overlay()`

Library source (excerpted from `packages/components/src/components/popover.ts:199`):

```ts
export function overlay<S>(opts: OverlayOptions<S>): Node[] {
  return show<S, PopoverMsg>({
    when: (s) => opts.get(s).open,
    render: () => portal({ target, render: () => opts.content() }),
  })
}
```

`OverlayOptions<S>` packs the accessor (`get`), `send`, the parts bag from `connect`, and a `content: () => Node[]` thunk into a single object. Manifest entry:

```json
"overlay": {
  "kind": "view-helper",
  "helperLocalPaths": [],
  "viaParams": [
    { "index": 0, "shape": "options-bag", "fields": {
      "get":     { "shape": "accessor", "innerReads": [
                     { "kind": "param-result-path", "from": 0, "path": "open" } ]},
      "send":    { "shape": "send" },
      "parts":   { "shape": "opaque" },
      "content": { "shape": "thunk-returning-nodes" }
    }}
  ]
}
```

The `content` field's `thunk-returning-nodes` shape tells the consumer's compiler "walk this thunk as a continuation of the host view" — the thunk closes over whatever accessors it captures from the consumer's `view()` scope, and those captures must be path-walked the same way the consumer's own view body is.

#### 4.3.3 Context-consuming helper — `pagination.connect()`

Library source (excerpted from `packages/components/src/components/pagination.ts:180`):

```ts
export function connect<S>(get, send, opts = {}): PaginationParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const label = opts.label ?? ((s: S) => locale(s).pagination.label)
  return {
    nextTrigger: {
      'aria-disabled': (s) => {
        const st = get(s)
        return st.page >= totalPages(st) || st.disabled ? 'true' : undefined
      },
    },
  }
}
```

Manifest entry:

```json
"connect": {
  "kind": "parts-helper",
  "helperLocalPaths": [],
  "viaParams": [
    { "index": 0, "shape": "accessor", "innerReads": [
      { "kind": "param-result-path", "from": 0, "path": "page" },
      { "kind": "param-result-path", "from": 0, "path": "disabled" },
      { "kind": "param-result-path", "from": 0, "path": "pageCount" },
      { "kind": "param-result-path", "from": 0, "path": "siblingCount" }
    ]},
    { "index": 1, "shape": "send" },
    { "index": 2, "shape": "options-bag", "fields": { "label": { "shape": "opaque" } } }
  ],
  "contextReads": [
    { "context": "@llui/components#LocaleContext",
      "subPaths": ["pagination.label", "pagination.prev", "pagination.next"] }
  ]
}
```

The consumer's `provide(LocaleContext, (s: AppState) => s.i18n, ...)` is what determines which host paths feed this helper's bindings. The consumer's compiler composes the provider's accessor with each `subPaths` entry to resolve `i18n.pagination.label`, etc., into `__prefixes`.

#### 4.3.4 Two-parameter HOF — `withSlice` (third-party shape)

For a third-party HOF that takes an accessor + a render function:

```ts
export function withSlice<S, T>(slice: (s: S) => T, render: (sub: T) => Node[]): (s: S) => Node[] {
  return (s) => render(slice(s))
}
```

```json
"withSlice": {
  "kind": "view-helper",
  "helperLocalPaths": [],
  "viaParams": [
    { "index": 0, "shape": "accessor", "innerReads": [] },
    { "index": 1, "shape": "accessor", "readsThroughResultOf": 0,
      "innerReads": [{ "kind": "param-result", "from": 0 }] }
  ]
}
```

`readsThroughResultOf: 0` on parameter 1 tells the consumer's compiler "this parameter's body reads paths within the result of parameter 0, not within the consumer's host state."

### 4.4 Substitution semantics

The substitution algorithm is part of the compiler's public contract:

1. For each call site of a manifest-described helper, the compiler resolves each argument that corresponds to a `viaParams` entry.
2. **`shape: 'accessor'`** parameters (`(s) => ...`) are walked the same way view accessors in user source are walked: paths are extracted from the body.
3. **`shape: 'options-bag'`** parameters are unpacked: each field listed in `fields` is resolved against the call-site object literal's matching property. Missing properties default to opaque. `shape: 'accessor'` recurses into step 2; `shape: 'thunk-returning-nodes'` recurses into step 7; `shape: 'send'` and `shape: 'opaque'` contribute nothing. Non-literal object arguments trigger `llui/opaque-options-bag` and contribute FULL_MASK unless the variable's symbol resolves to another manifest entry.
4. The helper's `innerReads` are then composed:
   - `{ kind: 'rooted', path: 'items' }` → direct contribution when the helper's host state shape coincides with the consumer's (rare).
   - `{ kind: 'param-result', from: N }` → paths extracted from parameter N's body, prefixed by parameter N's accessor.
   - `{ kind: 'param-result-path', from: N, path: P }` → walks parameter N's accessor (the lift), contributes `lift(s).P` to `__prefixes`. **Dominant kind across `@llui/components`.**
5. `readsThroughResultOf: N` → parameter's accessor body operates on the result of parameter N. Path extraction emits paths in N's output space; substitution composes through N's accessor.
6. **`contextReads`** are resolved independently: for each `{ context, subPaths }` entry, the consumer's compiler looks up the canonical context id against the consumer's `provide(...)` call sites. The provider's accessor is the lift; each `subPath` becomes `provider(s).<subPath>` in `__prefixes`. If no `provide(...)` for that context id exists, emit `llui/missing-context-provider` (error in CI mode; warn in dev — same dev/CI split as [`shared.md`](./shared.md) §14.4).
7. **`shape: 'thunk-returning-nodes'`** → walked as a continuation of the host view scope. Whatever accessors the thunk closes over from the consumer's `view()` body are path-walked.
8. **`kind: 'parts-helper'` vs. `'view-helper'`** governs caching: a `view-helper` contributes its resolved read set once per call site; a `parts-helper` contributes once per parts-bag _return value_ (call-site-keyed). Spreads aren't separately walked; the manifest already named the reads.
9. If a parameter is not an arrow accessor (e.g., a function reference passed through), the compiler falls back to whatever manifest data exists for the referenced function. If none exists, FULL_MASK applies at that call site, with `llui/opaque-view-call`.

**Substitution is bounded.** An accessor body can call another helper that itself takes accessors. The walker maintains:

- **Depth limit.** A per-call-site substitution stack with a hard depth of 8. Exceeding the limit emits `llui/substitution-depth-exceeded` and contributes FULL_MASK. Conservative — real `dicerun2` helper chains are 2–3 deep — and observable in tests.
- **Substitution-visited set.** Keyed by `(helper-symbol, parameter-index)`. Revisiting the same pair during one substitution chain terminates with `llui/substitution-cycle`. Distinct from `llui/helper-cycle`, which fires on the helper _call graph_.
- **Termination proof.** Depth catches diverging non-cyclic chains; visited catches cyclic ones. Either alone is insufficient. Both guarantee O(depth × manifest-size) per call site.

### 4.5 Generation

`@llui/cli publish-deps` runs the analyzer over a package's `src/` and writes `dist/__llui_deps.json`. This is wired into `scripts/publish.sh` as a step before `pnpm publish`. The manifest is also generated automatically by the Vite adapter for workspace packages during local development, so workspace-internal helpers behave the same as published-package helpers.

---

## 5. Runtime contract — `__compilerVersion`

### 5.1 The contract change

v2b adds a `__compilerVersion` optional field to `ComponentDef` (and to the parallel `AnyComponentDef` and `LazyDef<D>` interfaces in `packages/dom/src/types.ts:116–172`). The compiler writes `__compilerVersion: '0.3.0'` (or whatever) on every component it emits. The runtime reads it.

When the runtime mounts a component, it checks `componentDef.__compilerVersion >= minimum`. Mismatched versions: hard error in dev, telemetry-grade warning in prod.

A `ComponentDef` mounted _without_ `__compilerVersion` at all (hand-rolled definition or build that bypassed the compiler) is recognized as such and runs in `genericUpdate` — the existing slow path. A `console.warn` (deduplicated per `def.name`) makes the fallback visible.

### 5.2 The gate is not a new code path

`genericUpdate` in `packages/dom/src/update-loop.ts:486–526` already runs the original Phase 1 / Phase 2 update cycle when `__update` is absent, and `dirty = FULL_MASK` is triggered at `update-loop.ts:427` when `__prefixes` is absent. v2b adds only the versioning gate and the warn-once on top — no new dispatch branch.

**Location of the gate.** Inside `createInstance` (`packages/dom/src/update-loop.ts:155`), immediately after the existing `__dirty`-rejection guard at lines 167–176. The two checks share a pattern: one-shot per-instance validation at construction.

Pseudocode:

```ts
function assertCompilerCompatibility(def: ComponentDef</* … */>): void {
  const v = (def as { __compilerVersion?: string }).__compilerVersion
  if (v === undefined) {
    // hand-rolled or uncompiled — fall through to genericUpdate.
    // Warn once per def.name (module-scope Set<string>).
    warnUncompiledOnce(def.name)
    return
  }
  if (v === '__test__') return  // @llui/test sentinel — see §6
  if (!isCompatible(v, RUNTIME_MIN_COMPILER_VERSION)) {
    if (import.meta.env?.DEV) {
      throw new Error(`[llui] def "${def.name}" compiled by v${v}; runtime requires ≥ v${RUNTIME_MIN_COMPILER_VERSION}`)
    }
    console.warn(/* prod telemetry-grade */)
  }
}
```

When `v === undefined`, this function does **nothing structural**. The existing `__update`/`__handlers`/`__prefixes` branches in `processMessages` already make the right decisions when those fields are absent.

### 5.3 Partial-compile defs are treated as uncompiled

A def with `__handlers` and `__update` but no `__compilerVersion` is _not_ a half-trusted fast path — the runtime ignores both fast-path fields and falls through to `genericUpdate`. A half-trusted dispatch branch is a footgun: the compiler is the only legitimate source for these fields, and a def that has them without a version stamp is by definition not from a known compiler.

---

## 6. Test migration

### 6.1 The migration surface — verified by inspection

The real surface is _not_ `@llui/test`'s `testComponent`, which is a pure-reducer harness that never calls `mountApp` (`packages/test/src/test-component.ts:12–47` — verified). The vulnerable surface is:

- **~84 test files in `packages/dom/test/`** that mount raw `ComponentDef` literals through `mountApp` directly. The heaviest are `optimizations.test.ts` (21 `mountApp` calls), `mount.test.ts` (14), `context.test.ts` (12).
- **`testView` in `@llui/test`** (`packages/test/src/test-view.ts:55`) — the one `@llui/test` API that mounts. Adopts the builder internally; no API change for callers.

### 6.2 The circular-dependency resolution

`packages/dom/test/` cannot import from `@llui/test` because `@llui/test` depends on `@llui/dom`. v2b resolves this by:

1. **Private internal builder.** A new file `packages/dom/src/internal/test-component-builder.ts` is the single source of truth for the builder. Published _only_ as a private export consumed by both packages' test helpers; the runtime production bundle never includes it (tree-shaking asserted by a bundle-size fixture).
2. **Public wrapper in `packages/dom/test/helpers/defineTestComponent.ts`** — used by tests in `packages/dom/test/`.
3. **Public wrapper in `packages/test/src/defineTestComponent.ts`** — used by `@llui/test` consumers.

This avoids dependency inversion (`@llui/test` as a devDep of `@llui/dom` was considered and rejected — it would make `@llui/test`'s API surface load-bearing on the runtime package's tests).

### 6.3 What the builder does

`defineTestComponent({...})` synthesizes:

- `__compilerVersion: '__test__'` — the runtime's sentinel-version short-circuit
- An identity `__prefixes` table from the test's declared state shape (every top-level field gets one bit)
- A generic `__update` implementation that runs the user's `update()` function with bitmask gating against the synthesized prefixes

Tests opt into the optimized path explicitly by calling `defineTestComponent({...})` instead of writing a raw object literal.

### 6.4 The FULL_MASK fallback test set

A small set of tests explicitly _targets_ the `genericUpdate` fallback (the contract that hand-rolled defs still work). These use the raw object literal pattern and assert that `warnUncompiledOnce` fires once and the component behaves correctly. These are categorized in `packages/dom/test/fallback/` so a future contributor sees the intent.

---

## 7. Migration (v2b pass)

`@llui/cli migrate-to-v2` v2b pass rewrites:

- Sentinel `show()` blocks marked for review (the codemod identifies them but doesn't auto-delete).
- Optional helper return-type annotations added where §2.1 would otherwise emit `llui/opaque-view-call` and an explicit return type is the resolution. **This is the recovery-plan option-2 codemod, shipping unconditionally in v2b regardless of the §2.2 gate's measured threshold** — cheap insurance for consumer codebases with looser annotation discipline.

**Sentinel blocks are marked, not auto-deleted.** This is the correct call on first principles. A sentinel `show()` and a "real" `show()` whose `when` happens to `void` paths are syntactically indistinguishable; the v0.2.0 walker treated them identically by design (that was the workaround). The v2b walker's claim that those paths are now redundant is only true after manifests are correct and the cross-file resolution actually fires for that callsite — which §2.2 explicitly admits is the unproven part of the system. Auto-deleting on v2b-day-one would weld the codemod's correctness to the walker's correctness, and any walker false negative becomes a silent reactivity regression in user code with no diff to inspect. Mark-for-review forces a human to confirm each deletion against the diagnostic output.

### What breaks (v2b)

The proposal honestly cannot promise "ships unchanged source" for an arbitrary consumer. Three risk axes:

1. **Helper annotation wave from §2.1.** A 50k-LOC consumer whose codebase relies on TypeScript return-type inference will see `opaque-view-call` diagnostics on every helper without an explicit return type. The v2b codemod adds annotations for cases (a) of §2.2's recovery options; the residual is manual `@llui-helper` annotation for case (b).

2. **Hand-rolled `ComponentDef` regressions from §5.** Any `ComponentDef` literal not produced by the compiler (test scaffolds, custom mount wrappers, library wrappers) lacks `__compilerVersion` and silently runs through `genericUpdate`, with only a `console.warn` and no diff to inspect. A 50k-LOC app routinely has a handful of these. The v2a build-time integrity check catches the _zero-compiled-components_ case; it does not catch the _some-compiled-some-not_ case.

3. **Sentinel deletion is the user's load-bearing payoff but is gated on `@llui-helper` annotations being correct.** The codemod marks; the user reviews; the walker resolves. If the walker fails to resolve a helper read that a sentinel was registering, a sentinel deletion becomes a stale-UI bug. The reference apps in [`shared.md`](./shared.md) §15.4 are what surfaces this before it reaches consumers.

For in-repo consumers, all three risks are zero (verified in v2a §2.5). For an absent ~50k-LOC consumer like `dicerun2`, realistic cost is medium.

---

## 8. Exit criteria

v2b is done when **all** of the following hold:

- [ ] §2.1 termination rule shipped; the §2.2 validation gate has been run against `dicerun2` + `decisive.space-2`; the gate's measurements + chosen recovery option (if needed) are recorded in this file.
- [ ] §2.2 golden fixtures (5 case-1 subset goldens + 1 `connect()`-parts-bag golden + 1 inference-widened golden) all pass.
- [ ] `__llui_deps.json` schema v1 (§4) is frozen.
- [ ] §4.3 worked examples (carousel.connect, popover.overlay, pagination.connect, withSlice) all round-trip through the substitution algorithm against fixture consumers and produce correct `__prefixes`.
- [ ] Manifests generated for `@llui/components`, `@llui/router`, `@llui/transitions`. The remaining ~27 components in `@llui/components` round-trip; if a fourth shape surfaces, schema extended once.
- [ ] `track()` primitive shipped + `llui/prefer-static-deps` lint rule shipped. Golden fixture asserts `track()` compiles to zero bundle bytes.
- [ ] §5 runtime contract: `__compilerVersion` on `ComponentDef`, `AnyComponentDef`, `LazyDef<D>`. `createInstance` versioning gate landed at `packages/dom/src/update-loop.ts:155`. `warnUncompiledOnce` keyed by `def.name`. `track()` runtime stub throws `LluiCompilerSkippedError`.
- [ ] §6 test migration: `packages/dom/src/internal/test-component-builder.ts` exists; `packages/dom/test/helpers/defineTestComponent.ts` exists; `packages/test/src/defineTestComponent.ts` exists. All ~84 mount-using tests in `packages/dom/test/` migrated. `testView` in `@llui/test` adopts the builder internally with no public API change. The `packages/dom/test/fallback/` set verifies the `warnUncompiledOnce` path.
- [ ] §7 codemod shipped (sentinel marking + optional annotation addition). Migration runs cleanly against the project's own examples, `dicerun2`, and `decisive.space-2` before stable release.
- [ ] **Load-bearing concrete win**: dicerun2's sentinel `show()` blocks at `apps/web/src/pages/my-rolls/+Page.ts:2393,2401,2406` and `pages/studio/+Page.ts:223` are deleted; the app still works correctly; no `track()` is needed for the deleted blocks.

---

## 9. v2b Implementation Roadmap

### 9.1 Phase 0 — Pre-implementation reading

Estimated effort: 1 session.

Read in order:

1. v2a's roadmap and §7 cross-phase handshake artifacts ([`v2a.md`](./v2a.md) §7). v2b builds on v2a's API surface.
2. [`shared.md`](./shared.md) §6 Compiler Internals, §13 Source Maps, §14 Versioning, §15 Resilience.
3. `docs/designs/01 Architecture.md` and `docs/designs/03 Runtime DOM.md` — mandatory for the runtime-contract work.
4. `docs/designs/04 Test Strategy.md` — mandatory for the test migration.
5. `packages/dom/src/update-loop.ts:155–224` (`createInstance`), `:375–478` (`processMessages`), `:486–526` (`genericUpdate`). These are the runtime functions v2b modifies.
6. `packages/dom/src/types.ts:8–172` — `ComponentDef`, `AnyComponentDef`, `LazyDef<D>`.
7. `packages/components/src/components/{carousel,popover,pagination}.ts` — the three §4.3 worked-example helpers.
8. Sample 5 mount-using files in `packages/dom/test/` — get a feel for the migration shape.

Done when you can answer:

- What does `genericUpdate` actually do, and why does it produce correct results in the absence of `__update`?
- Where would the version gate go, and what other guards already live there?
- How does a `connect()` parts-bag get consumed by a typical consumer (find a real call site in `@llui/components`)?

### 9.2 Phase 1 — Cross-file walker prototype + §2.2 validation gate

Estimated effort: 2 sessions. **This is the blocker.** Walker is prototype-grade only; no production-readiness commitment yet.

Steps:

1. Build a prototype walker in `packages/compiler/src/cross-file-walker.ts`. It applies the §2.1 termination rule and emits diagnostics. No manifest support yet — only follows symbols inside the project's source tree.
2. Run the prototype against `dicerun2` (clone outside the repo). Record:
   - Total `opaque-view-call` count by file.
   - Breakdown by resolution category (annotation / `@llui-helper` / `track()`).
   - Helper shapes the rule misclassifies.
3. Run against `decisive.space-2`. Same record.
4. Append measurements to §2.2.
5. Apply the §2.2 recovery plan if any threshold fails. Commit the chosen option in writing here.

**Exit:** §2.2 recovery option chosen, measurements recorded, the §2.2 golden fixtures pass.

### 9.3 Phase 2 — Manifest schema round-trip against `@llui/components`

Estimated effort: 1.5 sessions. The §4 schema is drafted; this phase validates.

Steps:

1. Write the §4.3 manifest entries by hand for `carousel.connect`, `popover.overlay`, `pagination.connect`. Round-trip through a fixture consumer in `packages/compiler/test/fixtures/manifest-roundtrip/`. Assert correct `__prefixes`.
2. Generate manifests for the remaining ~27 components in `@llui/components`. For each, round-trip through a fixture consumer.
3. If a fourth shape surfaces, extend the schema once before freezing. Likely candidates worth pre-flighting: higher-order helpers that _return_ view-helpers, helpers with mutually-recursive accessor parameters.
4. Freeze `__llui_deps.json` schema v1. Lock its JSON Schema definition in `packages/compiler/src/manifest-schema.json`.

**Exit:** all ~30 components in `@llui/components` round-trip through fixture consumers with correct `__prefixes`. Schema frozen.

### 9.4 Phase 3 — Production cross-file walker + manifests

Estimated effort: 2 sessions.

Steps:

1. Build the production cross-file walker on top of the prototype. Adds:
   - Manifest consumption at package boundaries.
   - Caching keyed by `(helper-symbol, manifest-version, dependency-hash)`.
   - Reverse-deps tracking for HMR ([`shared.md`](./shared.md) §6.5).
2. Wire `compiler.compileFile()` to call the walker when computing `__prefixes`.
3. Build `@llui/cli publish-deps` (the manifest generator). Wire into `scripts/publish.sh`.
4. Generate manifests for `@llui/dom` (empty), `@llui/components`, `@llui/router`, `@llui/transitions`, the remaining packages.
5. Add the §2.2 case-1 + `connect()`-parts-bag + inference-widened golden fixtures to the compiler's test suite.

**Exit:** the cross-file walker is wired into `compileFile`; manifests exist on disk for all in-repo `@llui/*` packages; golden fixtures pass; the §4 substitution algorithm passes its termination tests.

### 9.5 Phase 4 — `track()` primitive

Estimated effort: 1 session.

Steps:

1. Add `track` export to `@llui/dom`'s public API as the runtime stub that throws `LluiCompilerSkippedError`.
2. In `@llui/compiler`, add `track()` recognition: the compiler reads the `deps` accessor, folds its paths into the host component's `__prefixes`, and rewrites the call-site expression to nothing (strip the statement, remove the import).
3. Golden fixture: a component with `track()` and a component without it emit byte-identical view-function bodies (modulo `__prefixes`).
4. Add `llui/prefer-static-deps` lint rule. Autofix when the rule has a structural alternative.

**Exit:** `track()` shipped with zero bundle cost; lint rule autofixes the easy cases.

### 9.6 Phase 5 — Runtime contract (`__compilerVersion`)

Estimated effort: 1 session.

Steps:

1. Add `__compilerVersion?: string` to `ComponentDef`, `AnyComponentDef`, `LazyDef<D>` in `packages/dom/src/types.ts:8–172`. Optional in all three.
2. Add `RUNTIME_MIN_COMPILER_VERSION` constant alongside `FULL_MASK` at the top of `packages/dom/src/update-loop.ts`.
3. Add `assertCompilerCompatibility()` per §5 pseudocode, inside `createInstance` immediately after the `__dirty` rejection guard at `update-loop.ts:167–176`.
4. Add `warnUncompiledOnce()` — module-scope `Set<string>` keyed by `def.name`.
5. Update the compiler's emission so every emitted component has `__compilerVersion: '<current>'`. The version constant lives at `packages/compiler/src/version.ts` and is published alongside the package.
6. Verify: an existing raw-object-literal `ComponentDef` in a hand-rolled test fixture still works, runs through `genericUpdate`, fires `warnUncompiledOnce` once per `def.name`.

**Exit:** the gate is live; existing hand-rolled fixtures still work; warn-once fires correctly.

### 9.7 Phase 6 — Test-suite migration

Estimated effort: 2 sessions. The biggest test-touch in v2b.

Steps:

1. Build the private internal builder at `packages/dom/src/internal/test-component-builder.ts`. It synthesizes the `__compilerVersion: '__test__'` + identity `__prefixes` + generic `__update` per §6.3.
2. Build public wrapper `packages/dom/test/helpers/defineTestComponent.ts` consuming the internal builder.
3. Build public wrapper `packages/test/src/defineTestComponent.ts` consuming the internal builder.
4. Update `@llui/test`'s `testView` (`packages/test/src/test-view.ts:55`) to use the builder internally. No public API change.
5. Write a migration script that walks `packages/dom/test/*.ts`, identifies raw `mountApp({...})` call sites, and rewrites the `ComponentDef` argument to `defineTestComponent({...})`. Run the script. Manually fix any edge cases the script can't handle.
6. Categorize and move the small set of tests that _target_ the `genericUpdate` fallback into `packages/dom/test/fallback/` with named `*.fallback.test.ts` files. These assert `warnUncompiledOnce` behavior and FULL_MASK reactivity.
7. Add a bundle-size fixture that asserts the internal builder is tree-shaken from the production runtime bundle.

**Exit:** all ~84 mount-using tests in `packages/dom/test/` migrated. `pnpm --filter @llui/dom test` green. Bundle-size fixture asserts tree-shaking.

### 9.8 Phase 7 — Migration codemod (v2b pass)

Estimated effort: 1 session.

Steps:

1. Extend `@llui/cli migrate-to-v2` with v2b-pass logic per §7:
   - Sentinel-block identification: scan for `show({ when: ... void s. ... return false ... })` patterns; mark with a `// MIGRATION-V2B: REVIEW SENTINEL` comment.
   - Optional return-type annotation: scan for helpers the §2.1 rule would mark opaque; add the annotation if it's a simple `Node[]` case.
2. Run the codemod against the project's own examples and the in-repo `@llui/components`. Verify zero spurious changes.
3. Run against `dicerun2` and `decisive.space-2`. Manually verify the marked sentinels match the §2.2 spike's findings.

**Exit:** codemod ships; in-repo consumers stay green; the dicerun2 sentinel blocks are correctly marked.

### 9.9 Phase 8 — Load-bearing concrete win

Estimated effort: 0.5 session.

Steps:

1. In a `dicerun2` clone, run the v2b codemod. Manually review and delete the four named sentinel blocks (`my-rolls/+Page.ts:2393,2401,2406`; `studio/+Page.ts:223`).
2. Boot the app; verify reactivity is correct (every binding that the sentinel was registering still fires at the right time). Use the `@llui/mcp`'s `whyDidUpdate` tool if needed.
3. Record the result in this file: sentinel deletion count, any `track()` calls that turned out to be required, any helpers that needed `@llui-helper` annotation post-migration.

**Exit:** v2b's load-bearing concrete win is verified against the named consumer. Result recorded.

---

## 10. Measurement record (filled in after v2b runs)

### Cross-file walker validation gate (§2.2)

| Project                     | Total `opaque-view-call` | Per 10k LOC | Resolution: annotation | Resolution: `@llui-helper` | Resolution: `track()` | Misclassifications |
| --------------------------- | ------------------------ | ----------- | ---------------------- | -------------------------- | --------------------- | ------------------ |
| dicerun2 (~49k LOC)         | _TBD_                    | _TBD_       | _TBD_                  | _TBD_                      | _TBD_                 | _TBD_              |
| decisive.space-2 (~28k LOC) | _TBD_                    | _TBD_       | _TBD_                  | _TBD_                      | _TBD_                 | _TBD_              |

Chosen recovery option: _TBD_. Rationale: _TBD_.

### Manifest round-trip (§4.3)

| Helper                   | Round-trip status | `__prefixes` correct | Fourth-shape needed? |
| ------------------------ | ----------------- | -------------------- | -------------------- |
| `carousel.connect`       | _TBD_             | _TBD_                | _TBD_                |
| `popover.overlay`        | _TBD_             | _TBD_                | _TBD_                |
| `pagination.connect`     | _TBD_             | _TBD_                | _TBD_                |
| Remaining ~27 components | _TBD_             | _TBD_                | _TBD_                |

### Load-bearing concrete win (§9.9)

Sentinel deletion count: _TBD_. `track()` calls added: _TBD_. `@llui-helper` annotations added: _TBD_. App reactivity verified by: _TBD_.

---

## 11. Failure paths

### 11.1 If the §2.2 validation gate fails

Recovery plan in §2.2 already names three options (tighten / codemod / defer). Pick one in writing, commit, re-run the spike. v2b does not ship until the gate passes under the chosen option.

### 11.2 If the §4 schema needs a fifth shape

Extend the schema once before freezing. Each new shape gets a worked example in §4.3 and a round-trip test in `packages/compiler/test/fixtures/`. The schema's `version: 1` does _not_ increment for additive shape additions during v2b development — only on the first stable release. Once frozen, future shape additions go through the §14.4 forward-incompatible upgrade path.

### 11.3 If the runtime gate breaks an existing test

Most likely cause: an existing test fixture relies on `__update`/`__handlers` being a fast path even when `__compilerVersion` is absent. Per §5.3, this is the partial-compile case and is now treated as fully uncompiled. The test should either migrate to `defineTestComponent()` (so it gets a sentinel version) or move into `packages/dom/test/fallback/` (so it asserts the `genericUpdate` path on purpose). Both are §6.4 options.

### 11.4 If sentinel deletion breaks dicerun2 reactivity

This is the §11.2 walker failure mode. Don't proceed. Diagnose by `whyDidUpdate`-style introspection; either fix the walker (extend the manifest, fix the §2.1 rule, add a missing shape) or restore the sentinel with a `// TODO: v2b walker missing path` comment. The recovery plan from §2.2 may need re-running.
