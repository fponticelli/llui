# Proposal: Unified composition model + path-keyed reactivity

**Status:** Design note. Pre-prototype. Locks the technical decisions necessary to spike a compiler + runtime change before committing to full implementation.

**Date:** 2026-05-16

**Branch:** `explore/controlled-components`

---

## 1. Problem

LLui today exposes two composition mechanisms:

- **View functions** (Level 1, default). Parent owns state, child is a function called from the parent's view.
- **`component()` + `child()`** (Level 2, opt-in). Sub-tree gets its own state, bitmask, scope tree, send wrapper, propsMsg/onMsg machinery, HMR entry.

Across two real-world apps the user maintains, the picture is split: `decisive.space-2` uses one `component()` at the root and zero `child()` calls (120 top-level state fields, runs in `FULL_MASK` mode); `dicerun2` uses 49 `component()` declarations and 62 `child()` calls — with **nine source-code comments explicitly citing the 31-path bitmask ceiling as the reason** for the boundary.

This is the root cause: **the flat 31-bit dirty mask scoped to a component boundary forces architectural decomposition for performance reasons.** `child()` is the only escape valve we ship, so apps either decompose to relieve mask pressure (dicerun2) or accept `FULL_MASK` (decisive).

That decision — flat-mask reactivity — is the load-bearing constraint. Removing it removes the need for two composition mechanisms.

## 2. Target model

A single, uniform composition story:

- **One store per `mountApp`.** State is a tree of arbitrary depth.
- **Views are functions.** Modules export `update(slice, msg) → [slice, effects]` and `view(slice, dispatch) → Node[]`. Sub-trees are function calls. No `component()` for sub-trees.
- **`combine()` composes reducers.** Slice reducers route by message namespace; effects bubble.
- **Reactivity is path-keyed.** The compiler emits, per accessor, a list of "minimal reference-stable prefixes" into state. The dirty walker compares `prev` and `next` at those prefixes; binding fires iff any prefix changed by reference.
- **`subApp` is the only state-isolation primitive.** Lives at `@llui/dom/escape-hatch`. Used for genuine app-in-app cases (third-party UI with own lifecycle, isolated 60fps drag layer, deferred chunks with own state). Requires `reason: string`; ESLint rule warns; expected usage <5 across both real apps.

What disappears: `component()` for sub-trees, `child()`, `propsMsg`, `onMsg`, the addressed-children registry, the send-wrap chain, the per-child scope tree, the flat bitmask compiler pass, the 31-bit ceiling.

## 3. Compiler: path-prefix emission

Today's pass 2 emits, per accessor, a single bit position into a 31-bit mask. The target pass emits a **list of prefix accessors** — functions of `state` that produce the minimal reference-stable handle for what the accessor reads.

Encoding:

```ts
// Source accessor:
;(s: S) =>
  s.matrix.criteria[i].weight[
    // Compiler-emitted prefix list (single prefix, structural-share stable):
    (s) => s.matrix.criteria
  ]
//                       ^ if any criterion mutates, this array reference changes
//                         under immutable update; criterion[i].weight included
```

For each accessor:

1. Walk the AST; collect property-access chains from the state parameter.
2. For each chain, compute the **shortest prefix that is reference-stable under structural-sharing** — i.e., the deepest path that the user can mutate without making this prefix re-equal. For most chains this is the chain itself (`s.user.profile.name` → prefix `s.user.profile.name`).
3. Deduplicate: if accessor reads both `s.user.name` and `s.user.email`, emit both prefixes separately (so name-only changes don't fire email bindings). If it reads `s.user` directly OR a method like `s.user.toString()`, emit `s.user` (covers both).
4. Encode each prefix as a closure: `(s) => s.user.name`. Emit at compile time, inlined.

Conditional and union reads (`s.x ? s.y : s.z`) → emit union of prefixes from all branches. Same as today.

Method calls (`s.users.find(...)`) → emit the receiver as prefix. Same as today.

Per-item `each` accessors (`(item) => item.field`) → prefix is per-row scope (covered by row's own dirty-check pass; orthogonal to top-level walker).

## 4. Runtime: dynamic prefix-indexed bitmask

Naïve approach (call every prefix accessor per binding per update) is ~15x slower than today's mask check. Mitigation: **allocate a dynamic bit index per unique prefix at binding registration time.**

Setup (mount):

- Maintain a `Map<prefixFn, bitIndex>` per scope.
- When a binding registers, look up each of its prefixes; if absent, assign next bit (0..30 fast path; bigint promotion when >31 unique prefixes; see §4.1).
- Binding stores its prefix list AND the OR'd bitmask of those prefixes' bits.

Update cycle:

```ts
// 1. Compute dirty mask: walk the prefix table, check refs prev→next
let dirty = 0
for (const [prefixFn, bit] of scope.prefixIndex) {
  if (prefixFn(prev) !== prefixFn(next)) dirty |= bit
}

// 2. Iterate bindings, gate by mask (unchanged from today)
for (const b of bindings) {
  if ((b.mask & dirty) === 0) continue
  applyBinding(b, next)
}
```

Step 1 is `O(unique prefixes)`, step 2 is `O(bindings)`. Both faster than today for large state trees because unique-prefix count grows much slower than top-level-field count (most apps share prefixes heavily — e.g., 50+ bindings reading `s.user.*` use one prefix).

### 4.1 Overflow when unique prefixes exceed 31

Promote to a multi-word representation (pair of `uint32`, or a small `Uint32Array`). The check becomes `(b.mask[0] & dirty[0]) | (b.mask[1] & dirty[1])` — still O(1) per binding, just 2-3× slower than the single-word path. The promotion happens dynamically when the 32nd prefix is registered. The fast path stays as fast as today for sub-31-prefix scopes.

For very-deep state (>62 prefixes), promote again. The point isn't to avoid promotion — it's that **the user never has to think about it.** No more architectural restructuring for mask budget reasons.

## 5. `combine()` — reducer composition

```ts
// Slice reducer
function matrixUpdate(
  state: Matrix,
  msg: MatrixMsg,
): [Matrix, Effect[]] { ... }

// Top-level composition
const update = combine<AppState, Msg, Effect>({
  matrix: matrixUpdate,
  criteria: criteriaUpdate,
  ui: uiUpdate,
})
```

Routing: `msg.type` starting with `${sliceName}/` routes to that slice (`matrix/setName` → `matrixUpdate`). Cross-cutting messages (no `/` or unknown prefix) fall through to an optional `_top` reducer in the map. Slice reducers see only their slice; effects bubble through unchanged.

This is `combineReducers` from Redux in slightly different clothes. Mechanical; no novelty risk.

## 6. Migration patterns

For each pattern in the two real apps:

| Today                                                                         | Tomorrow                                                                                                                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `child({ def, key, props: (s) => ({…slice…}), onMsg: m => null })` (no onMsg) | Move child's state under the parent's state at the slice position; call `subviewModule.view(h)` directly. Compose `subviewModule.update` into parent via `combine()`. |
| `child({ … props … onMsg: m => parentMsg })`                                  | Same as above. The `onMsg` mapping becomes a normal action-message routing in the slice reducer or a transform in `combine()`.                                        |
| `child({ def })` for bitmask budget reasons                                   | Disappears entirely. Path-keyed reactivity makes the budget irrelevant. Code becomes a view function.                                                                 |
| `component()` declarations for sub-features                                   | Become exported `update`/`view` function pairs.                                                                                                                       |
| `propsMsg(props)` handlers in child reducers                                  | Disappear. Sub-view reads parent state directly; no synthetic prop diff.                                                                                              |
| `mountAtAnchor` for vike persistent layouts                                   | Unchanged. Sub-app boundaries between layout/page are legitimate `subApp` cases.                                                                                      |
| `foreign()`, `clientOnly()`                                                   | Unchanged.                                                                                                                                                            |

**Estimated migration cost:**

- decisive.space-2: ~1-2 weeks. Nest 120 fields into ~15 feature slices; split `update.ts` (3,241 LOC, 197 cases) into slice reducers; one `combine()` call at root.
- dicerun2: ~2-3 weeks. 62 `child()` call sites + 49 component declarations rewritten as view functions + slice reducers. Bulk of work is the cosmetic conversion; semantically each `child()` already maps to a known slice via `props`.

Both apps get smaller, faster, and architecturally consistent.

## 7. Performance expectations

Comparing to today:

- **decisive.space-2:** currently in `FULL_MASK` mode (120 fields > 31). After change: each binding gates on its actual prefix's dirty bit; most bindings skip on most updates. Expected: significant speedup on every update cycle. Worth benchmarking — this is the most dramatic case.
- **dicerun2:** currently allocates per-child scope trees, send wrappers, propsMsg dispatch, HMR entries. After change: zero per-call allocations for sub-views. Expected: faster + lower memory, especially in `each()`-heavy views.
- **Bundle size:** Remove ~3-4 KB from `@llui/dom` (child.ts, addressed.ts, propsMsg machinery). Add ~1 KB for `combine()` and prefix-walker. Net smaller.
- **Update cycle worst case:** O(unique-prefixes + bindings) vs. today's O(top-level-fields + bindings). Strictly equal or better in all realistic apps.

## 8. Open questions (for the spike to answer)

1. **Prefix-shortening correctness.** Are there accessor patterns where the compiler can't derive a stable prefix? Hypothesis: no — every property-access chain from `state` has a syntactically-determinable stable prefix. Need to verify against `each().items` accessors, `branch().on` discriminants, computed conditional reads, and TypeScript narrowing.
2. **Prefix-equality cost in practice.** Naïve cost: one accessor call + one `===` per unique prefix per update cycle. If unique-prefix count grows linearly with app complexity, is this a real concern at 500+ prefixes? Benchmark.
3. **Overflow promotion.** Cleanest representation for >31 prefixes: pair of `uint32` (max 62) vs. `Uint32Array` of fixed length vs. `bigint`. Pair-of-uint32 is probably fastest for the common overflow case (32-62 prefixes); benchmark vs. bigint.
4. **Migration ergonomics.** Does `combine()`'s `${sliceName}/` routing cover the messages real apps actually produce, or are too many messages cross-cutting? Audit decisive's 197 cases for distribution.
5. **HMR compatibility.** Today's HMR registry keys by `def.name` (per-component). In the unified model the only component is the root. HMR still hot-swaps `update`/`view` at the root; preservation of in-flight slice state across edits works as today. Validate.
6. **Devtools / MCP impact.** Today's MCP tools enumerate components and their state. Tomorrow there's one component — state is one tree. Tools must address slices instead of components; agent protocols need re-validation. Possibly a feature win (one tree to introspect), possibly a UX shift requiring tool updates.

## 9. Validation gate (the spike)

Before committing to full implementation, build a minimal prototype:

1. **Test app.** 5-10 top-level state fields, 3 levels of nesting, ~30 bindings spread across the tree. Half on top-level fields, half on nested fields.
2. **Compiler change.** Extend `@llui/vite-plugin`'s pass 2 to emit prefix arrays alongside (or instead of) bitmasks. Keep both code paths during the spike for A/B comparison.
3. **Runtime change.** Implement the dynamic prefix-indexed walker in `@llui/dom/update-loop`. Gate behind a flag so today's bitmask path stays available.
4. **Benchmark.** Use `pnpm bench` (or a focused micro-benchmark) to measure update cost on the test app. Compare:
   - Bitmask (today's path)
   - Prefix-walker, fast path (<31 unique prefixes)
   - Prefix-walker, overflow path (force >31 prefixes synthetically)
5. **Gate criteria for proceeding:**
   - Fast path within 10% of today's bitmask cost
   - Overflow path within 50% of today's `FULL_MASK` cost
   - Compiler change implementable in <5 distinct AST transforms (no architectural blowup)
   - No accessor pattern from `decisive` or `dicerun2`'s current view code defeats prefix derivation

If the prototype clears all five, proceed to full implementation + migration. If it fails any, document why and revisit.

## 10. Non-goals for this proposal

- Signals (Solid/Vue style runtime reactivity). Different runtime model entirely.
- Hooks-style local state slots. Reintroduces hidden state.
- Lenses / typed optics. TypeScript ergonomics don't justify it.
- Multi-store. Conflicts with the one-tree introspection benefit.
- Backward compatibility with current `child()` / `component()` API. Apps are migrated explicitly.

## 11. What lands when the spike clears

1. `@llui/vite-plugin`: prefix-emission compiler pass.
2. `@llui/dom`: dynamic prefix-indexed dirty walker; remove `child()`, `addressed.ts`, propsMsg machinery, send wrapping; keep `component()` definition shape but reduce to root-only.
3. `@llui/dom/escape-hatch`: `subApp(container, def, options & { reason: string })`. Just a renamed export of today's `mountApp` with an isolation contract.
4. `@llui/dom`: `combine({slice: reducer, ...})` helper.
5. `@llui/eslint-plugin`: `no-subapp-without-reason`; `prefer-view-functions` (warn on any pre-migration imports).
6. Updated design docs: 01 Architecture rewritten with one model; 07 LLM Friendliness updated; new "Migration from v0.0.x to v0.1" guide.
7. Test apps and components-demo migrated as proof.
8. Both real apps migrated separately by their owner.

---

**Decision points locked by this note:**

- Prefix-list encoding (closure list, deduplicated, derived from compile-time AST walk).
- Dynamic-prefix-indexed bitmask with fast path ≤31, multi-word overflow.
- `combine()` API shape: map of slice reducers, `prefix/`-based routing.
- `subApp` as the only state-isolation primitive, hidden behind an escape-hatch import path with a required `reason`.
- Both apps will migrate; no backward-compat shim.

**Next step:** spike per §9. Estimated calendar: 4-6 days of focused work.
