# Follow-up Topics — Next Session

Topics discussed and explicitly deferred, or noticed and not yet dug into, while
designing signals. All are part of the v1 picture.

## Composition — RESOLVED

Signals adopt the `unified-composition-model` wholesale (it's already on `main`):
one root component; decompose via **view functions taking `Signal<T>` slice-bags**
(bag mirrors the root view bag — primary slice named `state`, extra slices named,
plus `send`) + **`combine()`** slice reducers; **`subApp`** as the only isolation
valve (pure isolation by default; `LiveSignal` materialization if a reactive slice
must cross in, reusing the `foreign` mechanism). No reactive sub-boundary —
path-keyed reactivity + chunked masks remove the bitmask ceiling that `child()`
existed to relieve. `.at()` subsumes `slice()`. One mask scope simplifies the
runtime (no foreign-scope bits in the gate). Folded into the signals proposal's
Composition section. **Only open sub-question:** whether `subApp` ever needs the
reactive `LiveSignal` bridge in practice, or pure isolation always suffices —
decide when a real case appears.

## Verified during reconciliation (no longer open questions)

- **Cross-file / inter-procedural narrowing machinery already ships** on `main`
  (`cross-file-walker.ts`, `manifest.ts` summary schema = `{paramReadPaths,
returnTaint}`, wired into the Vite build, v2b commit `4f4f2da`). So the chosen
  inter-procedural narrowing is extend-existing, not a v2b pull-forward. The only
  unbuilt piece is the cross-_package_ `__llui_deps.json` emit/consume layer.
- **`dirty-mask-precision/` is superseded** by signals (goal adopted, mechanism
  replaced; `03-implicit-each-children` fully obsolete). Banners added.
- **`track()` is subsumed/retired** by signals — note this in v2-compiler docs.

## Resolved during the signals design (no longer open)

These were on the original follow-up list but got decided and folded into
[the signals proposal](./signals/README.md):

- **Chunked masks** — decided. The runtime stays bitmask (signals erased, not a
  live graph); chunked masks remove the 31/62 cliff. Benchmarked: speed is a
  wash, memory decisively favors bitmask (~32 bytes vs ~2.1 MB per 1000-row
  list). See README "Runtime" section.
- **Output equality check** — decided. Bindings compare produced value to
  last-written and skip the DOM write if unchanged; makes residual coarse deps
  cheap. In README.
- **ScopeTracker / ComponentWalker refactor** — **largely moot.** The shadowing
  bug class disappears with signals (the analyzer follows symbol bindings on a
  single-rooted body, not named `s` across the walker fleet). A shared walker
  base may still be marginally nice for the surviving non-reactivity rules, but
  it's no longer urgent and should not be pre-invested in.
- **`.at` vs `.map` granularity discipline** — dissolved by the aggressive
  dependency analyzer. `state.map(s => s.user.name)` narrows to the same dep as
  `state.at('user.name')`. No authoring discipline required, no rule needed.

## B. v1 Architectural Surface

### B1. Effect lifecycle in types

Effects declare lifecycle metadata in their type shape:

```ts
| Effect<'FetchUser', { id: string }, { cancellable: true; scope: 'component' }>
| Effect<'OpenAuth', { provider: 'google' }, { preserveGesture: true }>
```

Runtime enforces: auto-cancel `scope: 'component'` effects on unmount; flag/error
effects requiring user-gesture preservation when not dispatched from a sync event
handler.

**Why**: 4 of 6 consumer apps hit auth / user-gesture bugs the framework gave no
help with (dicerun sign-out race, health Google sign-in gesture loss, WebAuthn
passkey async-loss). Compiler-enforceable.

**Open**: whether `preserveGesture` is a static compiler check (flag `send` of
such msgs from a context not visibly originating from a sync handler) or a
runtime stamp-on-message check. Static preferred.

### B2. Type-driven agent metadata

Replace JSDoc `@intent` / `@example` / `@confirm` with branded msg-variant
wrappers:

```ts
type Msg =
  | Effect<'GetUser', { id: string }> // side-effecting
  | Query<'CountItems', {}> // pure read
  | Action<'AddTodo', { text: string }> // mutation
  | Internal<'Tick'> // not agent-callable
```

Defaults derive from the wrapper; opt-in JSDoc only for overrides.

**Why**: Dicerun has ~103 msg variants each carrying JSDoc. ~80% annotation
reduction projected. Six `agent-*` compile rules collapse to one type-shape check.

**Validate before committing**: rewrite ~10 Dicerun msgs both ways and confirm
LLM authoring is at least as fluent.

**Interaction**: B1 and B2 both reshape the msg/effect type surface — design them
together.

### B3. `area()` vs `child()` boundary

Today `child()` is the only way to reset bitmask budget; it's heavy (own update
cycle + scope tree). Proposal: `area()` — a lighter primitive with its own
bitmask scope but a shared update cycle; the compiler decides whether to lower it
to a real component or inline it.

**Why**: Lance and Dicerun both refactored into child boundaries reactively after
hitting the wall.

**Reconsider given chunked masks**: with the 62-path cliff gone, the _forcing_
reason for `area()` weakens. It may still be worth it for mask-precision and
locality, but it's no longer cliff-driven. Decide after chunked masks land.

## C. v1 Polish

### C1. `foreign()` → `embed()` with first-class lifecycle

Rename and harden the imperative-subtree escape hatch: compiler enforces
`unmount` is declared; lifecycle tracked so `send` from inside gets a stable
receiver across re-parenting; companion `@llui/embed-helpers` with adapters for
ProseMirror, Monaco, CodeMirror, MapLibre.

**Why**: Lance uses `foreign()` for ProseMirror + Monaco; the integration is
bespoke per call site. Bless the pattern.

### C2. Compiler internal hygiene

Shared `BANNED_CALLS` table across `pure-update-function`, `pure-derive-body`,
and the operator-on-signal rule. Less urgent than originally framed (no walker
fleet to unify post-signals), but the pure-derive-body / pure-update-function
overlap is real and worth deduping.

### C3. Reference apps in-tree (Lance / Dicerun mini)

Trim-down forks (~30 fields, ~50 msgs) in `apps/lance-mini`, `apps/dicerun-mini`,
as CI consumers — any compiler change breaking them blocks release. Also the
LLM's training corpus for production-scale LLui.

**Why**: would have prevented ≥4 of 5 major LLui bug clusters (all surfaced
_after_ a release). Highest-leverage anti-regression investment.

## D. v1 Adjacent (may defer post-v1)

### D1. SSR / Vike with signals

Signals are view-layer only; SSR needs to either walk the signal graph once to
produce static HTML or emit value-resolved output bypassing signals. Hydration
story needs definition. `@llui/vike` has no fix history — likely under-exercised.

### D2. Devtools / introspection with signals

With signals erased to masks, "what does this binding depend on" becomes the
analyzer's emitted path set — which is exactly the introspection surface. Expose
per-binding dep paths, current values, dirty propagation via `@llui/mcp`.

### D3. Performance baseline

Where does signals + chunked-masks + output-equality-check land vs current LLui
on js-framework-benchmark? Measure before the v1 cut.

## E. Cross-cutting

### E1. The LLM authoring guide (<50 lines)

The system-prompt-shaped doc:

- Read state via `.at(path)`, `.map(fn)`, or `.peek()`.
- `.peek()` only in handlers/effects/lifecycle; never in `.map`/`derived`.
- Combine independent signals with `derived([...], fn)`.
- Structure changes use `each` / `branch` / `show`.
- State is plain data in `update`; signals only in `view` + imperative callbacks.
- Never operate on a signal directly (no `sig + 1`, no `` `${sig}` ``) — use `.map`.

Acceptance test: an LLM produces a non-trivial component from a cold prompt with
no errors. If it sprawls past ~100 lines or the LLM keeps mis-writing, the
surface still has friction.

### E2. Migration codemod

After one hand-migration, automate the mechanical patterns: `(s) => s.X.Y` →
`state.at('X.Y')`, `item.current().X` → `item.at('X')`, `h.getState()` →
`.peek()`, etc.

### E3. Doc updates

- `docs/designs/01 Architecture.md` — replace accessor model
- `docs/designs/02 Compiler.md` — replace walker description with the aggressive
  analyzer + soundness invariant
- `docs/designs/03 Runtime DOM.md` — clarify binding shape, output-equality-check,
  chunked masks
- `docs/designs/09 API Reference.md` — full new types
- `docs/designs/13 Migration…` — extend / replace with signals migration guide

## Suggested priority for next session

1. **B1 + B2** (effect lifecycle + agent metadata) — highest-leverage v1 surface
   decisions; they interact, design together.
2. **C3** (in-tree reference apps) — cheap, highest anti-regression leverage.
3. **B3** (`area()`) — decide whether it survives now that the cliff is gone.
4. **C1 / C2** (embed, internal hygiene).
5. **D-series** (SSR, devtools, perf) — after B + C.
