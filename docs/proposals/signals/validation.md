# Signals: Real-World Validation

Empirical validation of the signals design against six consumer apps, run with a
throwaway aggressive-analyzer prototype (`/tmp/llui-sigval/`, syntax-only, TS 6
compiler API) over the _current_ arrow-accessor code — which is exactly the body
shape the new analyzer consumes (param = root-tainted).

**Scope of the corpus**: 1381 reactive _value_ accessors (render callbacks
excluded), ~1300 state fields across the six apps.

## Headline

| Risk                             | Verdict                         | Detail                                                                           |
| -------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| 1 — analyzer precision           | **Mostly green, one known gap** | 77% narrowed mechanically; ~17% coarse, almost entirely one refactorable pattern |
| 2 — rules reject real code       | **Green**                       | 15 rejections in 1381 (1%); real cost is escape-hatch migration, not new rules   |
| 3 — `.at()` expresses real state | **Green**                       | 0 Map/Set/Promise/index-sig/function fields across ~1300 fields                  |
| 4 — path counts vs bitmask       | **Chunked masks justified**     | components reach ~40 paths (>31), ≤62 mostly holds                               |

## Risk 1 — Analyzer precision (the core test)

Per app:

| app               | value accessors | narrowed | coarse  | clean % |
| ----------------- | --------------- | -------- | ------- | ------- |
| health            | 112             | 107      | 5       | 95%     |
| landscape-planner | 139             | 129      | 0       | 93%     |
| dicerun           | 525             | 453      | 41      | 86%     |
| dungeonlogs       | 463             | 311      | 147     | 67%     |
| decisive.space    | 98              | 54       | 39      | 55%     |
| lance             | 44              | 15       | 29      | 34%     |
| **total**         | **1381**        | **1069** | **261** | **77%** |

Coarse breakdown: of 261 ROOT-COARSE accessors, **25 are benign** (identity
`(p) => p` — the whole value is genuinely used) and **236 are
"whole-state-to-helper escapes"**: `(s) => formError(s)`, `(s) => vaultSummary(s)`,
`(s) => authChipLabel(s)`. The analyzer correctly coarsens these to root (sound —
the helper is opaque, so any field may be read), but they over-fire on every state
change.

### The dominant finding

**The single recurring coarse pattern, across every app, is deriving values
through helper functions that take the whole state**: `(s) => helperFn(s)`. This
is the same `Props<T,S>` issue Dicerun already fought. The signals model **does
not auto-fix it** — `state.map(s => formError(s))` coarsens identically, because
the intra-procedural analyzer cannot see into `formError`.

### Decision: inter-procedural narrowing, confined to local modules

The chosen path is **(B) follow local helpers and narrow through them**, with
**(A) a slice lint** as the floor/teaching signal and **(C) coarsen** as the
always-safe fallback. The three are layered, not alternatives.

**Why B is sound** — inter-procedural narrowing is the _same_ analyzer applied
transitively: a helper `(s: State) => …` is itself a closed function with a single
state-typed parameter, so the analyzer recurses into it with the param tainted by
the caller's argument path, then substitutes back. The "coarsen on any
uncertainty" fallback carries over, so the superset property (imprecision
coarsens, never misses) is preserved by construction.

**Conditions to follow a call `f(arg)`** (else coarsen the argument to wholesale):

1. `f` resolves statically to one concrete definition (not a param, not a
   dynamically-selected value).
2. `f` is defined in a **local module** (not node_modules — dependency functions
   stay opaque, or later read a published manifest).
3. `f` reaches state only through its parameters — no state-typed free-variable
   capture (must be checked; in TEA there is no ambient store, so this nearly
   always holds).
4. Within a recursion-depth / cycle bound.

**Function summary** = `{ paramReadPaths, returnTaint }`. The `returnTaint` (the
path of the slice a helper returns) is what handles the "navigate the result"
pattern — `const sess = session(s); sess.chat.visible` narrows to
`vault.session.chat.visible`. Computed once per function, cached, reusable across
call sites.

**Why local confinement loses almost nothing**: the coarse helpers in the data
(`vaultSummary`, `authChipLabel`, `formError`, `session`) are all app-local, so
B-confined-to-local captures the bulk of the 236.

> **Verified correction (2026-05):** the shipping compiler _already_ does
> cross-file + local-helper narrowing — `packages/compiler/src/cross-file-walker.ts`
> and `computeAccessorMask`/`extractAccessorPaths` follow `(s) => helper(s)` into the
> helper body when the Vite cross-file Program is present (v2b landed, commit
> `4f4f2da`). The prototype used here is **intra-procedural only**, so the **236
> coarse cases / 18.9% are an upper bound** — the real shipping behavior already
> narrows many of them. Inter-procedural narrowing is therefore **extend-existing
> machinery (small-to-medium)**, NOT "pull v2b forward." The function-summary shape
> `{paramReadPaths, returnTaint}` already exists as `viaParams` / `readsThroughResultOf`
> in `manifest.ts` (tested). The remaining work is routing the `.map(s => f(s))`
> arrow-lift shape through the existing `descendIntoHelper` in the file-local mask
> path; the cross-_package_ manifest emit/consume layer is the only genuinely
> unbuilt piece, and local-confined narrowing doesn't need it.

**Where the risk actually is** — not correctness (the fence holds), but
engineering: a call-graph + summary cache; HMR/incremental invalidation of
_callers_ when a helper changes (the fiddly part); and `pure-derive-body` must
recurse the same call graph (a `.map` calling a local helper that `fetch`/`send`s
is still impure). Because every un-followable case coarsens safely, **partial B is
shippable** — land the easy cases, let deep chains / tricky HMR coarsen, and
postpone the rest if it proves a hurdle during implementation. Every gap is a perf
gap, never a bug.

**Cost (now verified, not estimated)** — the cross-file scaffolding has **already
shipped** (see the verified-correction box above): cross-file walker + the
`{paramReadPaths, returnTaint}` summary schema exist and are wired. So B is "route
the `.map(s => f(s))` arrow-lift shape through the existing `descendIntoHelper` and
wire returnTaint to mask emission" — extend-existing, not a v2b pull-forward. The
cross-_package_ `__llui_deps.json` emit/consume layer remains unbuilt, but
local-confined narrowing does not need it.

### Important caveat on the 77%

The corpus is **old-model code** written when whole-state helpers were idiomatic.
A mechanical translation preserves that style and its coarseness. An _idiomatic_
signals rewrite (helpers taking slices, taught by examples + the rule above) would
land materially higher. **77% is a floor, not the achievable rate.** Apps with no
whole-state-helper habit already hit 93–95% (health, landscape-planner).

### Soundness held

Every coarse result was an _over_-approximation (root or parent path), never a
missed dep. The "imprecision coarsens, never misses" property held across all
1381 cases — consistent with the design's central claim.

## Risk 2 — Do the new rules reject real code?

Rejections: **15 of 1381 (1%)**, all `node-construction` (value accessors that
build DOM — should be `each`/structural primitives; a handful, likely a few
genuine + some user-helper-returns-nodes the detector miscounted). **No
legitimate pattern is broken by the new rules.**

The real migration cost is **escape-hatch usage**, concentrated unevenly:

| app               | sample | track | getState | .current() |
| ----------------- | ------ | ----- | -------- | ---------- |
| decisive.space    | 38     | 63    | 63       | 31         |
| dungeonlogs       | 90     | 0     | 1        | 107        |
| dicerun           | 14     | 8     | 17       | 4          |
| health            | 5      | 0     | 0        | 0          |
| lance             | 0      | 0     | 0        | 0          |
| landscape-planner | 0      | 0     | 0        | 0          |

→ **decisive.space and dungeonlogs will be the hardest migrations** (heavy
`track`/`getState`/`.current()`/`sample`). lance and landscape-planner are nearly
escape-hatch-free. This directly informs migration sequencing: start with the
clean apps, leave decisive.space/dungeonlogs last when the codemod is mature.

## Risk 3 — Does `.at()` express real state shapes?

**Green, unambiguously.** Across ~1300 state fields in 320 `*State` types:

| measure                                        | count |
| ---------------------------------------------- | ----- |
| Map / WeakMap / Set / WeakSet / Promise fields | **0** |
| index signatures (`Record` / `{[k]: V}`)       | **0** |
| function-typed fields                          | **0** |

Every consumer state field is expressible as a static `.at()` path. The
`Map`/`Set`/dynamic-key concerns we flagged as "edge cases" **do not occur in
practice**. (Scan is conservative — direct property signatures only; deeply
aliased types could hide a few — but the signal is strong: real LLui state is
plain, JSON-shaped, statically navigable, consistent with the JSON-serializable
state constraint.)

## Risk 4 — Path counts vs the bitmask budget

Max distinct dependency paths in a single file (proxy for per-component path
count):

| app               | max paths/file |
| ----------------- | -------------- |
| dicerun           | 40             |
| health            | 30             |
| landscape-planner | 27             |
| dungeonlogs       | 26             |
| lance             | 15             |
| decisive.space    | 8              |

Real components reach **~40 paths** — past the old 31 single-word limit, under 62.
This **confirms chunked masks are necessary** (the 31 cliff is hit in practice)
and that ≤62 covers current reality with headroom, but not comfortably — narrowing
(Risk 1) _increases_ path counts, so chunked masks are the right call rather than
relying on the two-word ceiling.

## Net implications for the design

1. **`.at()` path model — locked.** Risk 3 is green; no state-shape accommodation
   needed.
2. **Chunked masks — confirmed necessary** by real path counts, not just theory.
3. **Inter-procedural narrowing (local-confined) is the chosen analyzer design** —
   the same sound analyzer recursed into local helpers via `{paramReadPaths,
returnTaint}` summaries, coarsening on any un-followable call. **The machinery
   already ships on `main`** (cross-file walker + `manifest.ts` summary schema), so
   this is extend-existing, not a v2b pull-forward; the 236-coarse figure is an
   upper bound from the intra-procedural prototype. Partial implementation is
   shippable because gaps coarsen safely.
4. **Slice lint stays as the floor**: _value accessor passing the whole state to a
   call → pass a slice._ Not the fix (B is), but the teaching signal and the thing
   that keeps code idiomatic while B is partial.
5. **Soundness property held empirically** across 1381 cases — the safety story is
   real.
6. **Migration sequencing**: clean apps first (lance, landscape-planner, health),
   escape-hatch-heavy apps last (decisive.space, dungeonlogs).

## Prototype limitations (honesty)

- Syntax-only with name-based scope tracking (not full symbol resolution); rare
  shadowing could misattribute — but always in the sound (coarsening) direction.
- High-confidence detection undercounts accessors (sample is a lower bound).
- Render-vs-value split via a node-producer name set; user helpers returning nodes
  may be misbucketed (small effect).
- Corpus is old-model code; coarse rate is an upper bound on idiomatic signals
  code.
