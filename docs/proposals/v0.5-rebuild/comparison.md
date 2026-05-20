# v0.5 Rebuild — Comparison and Decision

This doc is the side-by-side comparison of the four options in this
directory. Read after `README.md`; it assumes you've absorbed the goals
(bundle, perf, DX) and the v0.4 baseline (34.9 / 11.0 / 9.7 kB).

If you want one option to pick up and execute, read this doc plus the
matching `option-*.md` and you're done.

> **Read the `README.md` § "State of `docs/proposals/v2-compiler/`"
> before applying this matrix.** v2a is landed; v2b is largely landed
> (`track()`, `__compilerVersion`, cross-file walker all shipped); v2c
> is partially landed (module decomposition feature-complete,
> diagnostic schema shipped). This changes how each option below is
> read — in particular, Option B's effort/scope estimates and Option
> C's cross-package manifest story are smaller than the per-option
> docs describe. The numbers in the matrix below have **not** been
> updated for the post-v2 landing baseline; treat them as upper
> bounds.

> **Empirical update (2026-05-19): there is no Select regression to
> fix.** Median-of-3 measurement (`pnpm bench --runs 3`) puts LLui's
> Select at **3.4 ms** — faster than Solid (4.2), vanillajs (4.5),
> Svelte (5.7), and the previous single-run baseline (3.8 ms). The
> "+9–34 % Select outlier" framing across the v0.5 docs came from
> comparing noisy single-run measurements; median-of-3 reveals it as
> measurement artifact, not real regression. **Anywhere in this doc
> set that says "fix Select" or treats Select as a v0.5 motivator
> should be ignored.**
>
> Two complementary measurements falsified Option B's "fix Select"
> pitch on the way to this conclusion:
>
> 1. Synthetic perf comparison (jsdom, 16–1024 bindings, one binding
>    per prefix — Option B's best case): flat and registry dispatch
>    tied within ±5 %. V8 inline-caches the per-binding AND-gate so
>    the linear scan disappears against per-binding work.
> 2. Real Chrome bench instrumentation via `_handleMsg` + the
>    puppeteer harness's console-pipe (probe added temporarily, then
>    reverted). For jfb's actual Select op:
>    - `update()`: 0.005–0.350 ms (median ~0.01 ms)
>    - structural reconcile: 0–0.005 ms (each-block mask doesn't
>      intersect — `selected` changed, `items` didn't)
>    - **Phase 2: 0.020–0.660 ms (median ~0.06 ms)** — scans the 1000
>      row class bindings, AND-gates each, applies the 2 that changed
>    - **total framework time: ~0.07 ms median**
>    - jfb's reported Select: **3.8 ms** — i.e. ~3.7 ms is browser
>      style/layout/paint, not framework dispatch
>
> The +9–34% Select regression vs LLui's April baseline (3.2 → 3.8 ms,
> a 0.6 ms shift) cannot mostly be in framework code because framework
> total is only ~0.07 ms median. ~5–10 % of the regression could be
> framework-side; ~90–95 % is browser-side.
>
> **Option B's registry can't help jfb specifically** because all 1000
> row-class bindings subscribe to the SAME prefix (`s.selected`). The
> registry's keyed-by-prefix lookup is O(1) but the iteration over the
> matching set is still O(1000) — same work as the flat scan. Option B
> wins only when bindings are SPREAD across many prefixes (a config
> the bench doesn't exhibit).
>
> A separate experiment tested whether `el.className = value` would
> reduce browser style-invalidation cost vs `setAttribute('class',
value)`. Result: `className =` made Select **+39 %** slower (and
> Update 10th +32 %, Swap +30 %) — `setAttribute` was the right
> choice all along. Reverted; finding stands as anti-recipe.
>
> **Treat Option B's perf pitch as unsupported by data.** The bundle
> pitch (5–7 kB gz target) is also unverified — Phase 2 in isolation
> adds +417 gz; net savings depend on Phase 4 actually dropping the
> flat path. With Select itself proven non-problematic, the Select-
> blocker branch of the decision tree below is moot. See
> `packages/dom/test/select-perf-investigation.test.ts` for the
> in-repo bench used in this investigation.

---

## The matrix

| Axis                               | A (Signals)                                      | B (Hybrid)                        | C (Closed runtime)                        | D (Squeeze)                             |
| ---------------------------------- | ------------------------------------------------ | --------------------------------- | ----------------------------------------- | --------------------------------------- |
| **Bundle target (gz)**             | 3–5 kB                                           | 5–7 kB                            | 3–5 kB                                    | 8–9.5 kB                                |
| **Perf target — Select**           | ≤ 2.5 ms (Solid parity)                          | ≤ 2.5 ms                          | unchanged (Select +9–34 %)                | unchanged                               |
| **Perf target — other ops**        | ±5 % of Solid                                    | ±5 % of v0.4                      | identical to v0.4                         | identical to v0.4                       |
| **User API change**                | Yes — TEA contract breaks                        | None                              | None                                      | None                                    |
| **Agent protocol change**          | Yes (depending on impl)                          | None                              | None                                      | None                                    |
| **Lint rule impact**               | All 41 audited/rewritten                         | None                              | None                                      | None                                    |
| **Compiler scope**                 | Big — new signal-graph pass, drop bitmask passes | Small — tuple-shape change        | Big — manifest + inlining infra           | None                                    |
| **Runtime scope**                  | Big — replace mount, update-loop, primitives     | Medium — replace Phase 2 dispatch | None (only delivery)                      | None                                    |
| **Build pipeline change**          | None                                             | None                              | Vite plugin required at runtime           | None                                    |
| **Cross-package authoring impact** | Components/router/etc. need port                 | None                              | Each lib needs a `llui-features` manifest | None                                    |
| **HMR semantics**                  | Reworked                                         | Unchanged                         | Unchanged                                 | Unchanged                               |
| **SSR impact**                     | Reworked (signals + linkedom)                    | Unchanged                         | Adapter needs the inline pass             | Unchanged                               |
| **Tests delta**                    | ~200 tests rewritten                             | ~10–20 minor                      | ~50 paths/imports                         | None                                    |
| **Effort (1 person-weeks)**        | ~12                                              | ~2.5                              | ~5                                        | ongoing (≤ 4 weeks total for all tiers) |
| **Reversibility**                  | New branch; revert is the whole thing            | Two paths coexist behind a flag   | Phase 4 is the point of no return         | Per-tier revert                         |
| **Open research items**            | 6                                                | 4                                 | 6                                         | 3                                       |

---

## Cumulative bundle-size visual

Approximate jfb-bench bundle (gzipped) per option at completion:

```
v0.4 today    ███████████ 11.0
Option D      █████████   9.0
Option B      ███████     6.5
Option A      ████        4.0
Option C      ████        4.0
Solid         ████        4.5  (reference)
vanillajs     ██          2.5  (reference)
```

The 4× gap to Solid is real and architecturally bounded. Options A and C
both target closing it, via very different routes:

- A wins on **runtime semantics** (signal subscriptions replace Phase 2
  scans).
- C wins on **delivery** (only the runtime you use ships).

Combining them is possible but unwise — pick one architectural direction
per release cycle.

---

## Bench `Select` outlier (the perf gap)

Today's bench `Select` clocks at 3–4 ms vs Solid's ~2 ms.

- **Option A** fixes this by replacing Phase 2 entirely. Single-path
  dispatch → only the subscribed effects fire.
- **Option B** fixes this by replacing Phase 2 with a path-keyed
  subscriber map. Single-path dispatch → only that prefix's bindings
  fire.
- **Option C** does not fix this. Runtime semantics unchanged.
- **Option D** does not fix this. Runtime semantics unchanged.

If `Select` is a blocker, A or B is required.

---

## Decision tree

```
Q1: Is bundle parity with Solid (≤ 5 kB gz) a hard requirement?
├── YES
│   │
│   ├── Q2: Are we willing to break the TEA `update(s,m) → [s',e]` contract?
│   │   ├── YES → Option A
│   │   └── NO  → Option C
│   │
│   └── (Note: Option B targets 5–7 kB gz, doesn't fully clear the bar)
│
├── NO — but the Select +9–34 % outlier is a blocker
│   └── Option B
│
└── NO — and Select is acceptable
    │
    ├── Q3: Are we mid-cycle / bandwidth-constrained?
    │   ├── YES → Option D
    │   └── NO  → Probably Option B (lowest-risk meaningful improvement)
    │
    └── (Q3-no: re-evaluate whether the v0.5 budget exists at all)
```

---

## Recommended sequence (if multi-cycle work is on the table)

The options aren't fully independent. A defensible **multi-release path**:

- **v0.5:** Option B. ~2.5 weeks. Closes the Select gap, gets to ≈ 6 kB
  gz. Public API unchanged. Low risk.

- **v0.5.x:** A few Option D tiers (Tier 8 transitions, Tier 11
  structural-block skip, Tier 12 element-helper drop). Cumulative ~1 kB
  gz, pushing to ≈ 5 kB gz.

- **v0.6 (later):** If we still want Solid parity / cross-package
  per-app pruning, pick Option C. Option B's runtime is already a
  per-prefix-subscriber model; templating it for inlining is incremental.

Avoid sequencing **A then C** — A leaves no runtime to template. Avoid
sequencing **C then A** — A reworks the templates from scratch, throwing
away C's manifest work.

A **B → C** sequence is the most coherent. A standalone Option A is
also coherent, just expensive and risky.

---

## Recommendation (with rationale)

**Pick Option B** unless the v0.5 thesis is specifically "best-in-class
bundle + perf, willing to rebuild the user API."

Reasoning:

1. **B closes the perf gap** (`Select` outlier) — the one thing Option D
   can't fix without rebuilding. This is the most visible perf complaint
   and the one users / bench-readers see.

2. **B preserves everything** — user API, agent protocol, lint rules,
   HMR, SSR, cross-package consumers, examples. No migration cost
   downstream. Compare to Option A, which forces a rewrite of `@llui/components`,
   `@llui/router`, every example, and the lint rule library.

3. **B's effort is bounded** — ~2.5 weeks vs A's 12 weeks. The
   measurement gates (Phase 1: registry alone; Phase 3: bench app on
   registry mode) are clean and de-risked.

4. **B leaves the future open.** B's per-prefix-subscriber-map runtime
   is a natural stepping-stone to either A (split prefixes into signals)
   or C (inline the registry as a template). D-style tiers can be added
   on top.

The cost: B doesn't fully close the bundle gap. It targets 5–7 kB gz, not
3–5. If bundle parity is the headline goal, B is insufficient.

In that case, **Option C** is the right pick. Same bundle target as A
without the architectural rewrite, at the cost of a build-pipeline
dependency (Vite plugin becomes mandatory). C's biggest risk is
cross-package authoring complexity — manageable if we commit to the
`llui-features` manifest approach early.

**Option A** is the right pick only if the user API is itself a
constraint we want to break — i.e., the TEA `update(s,m) → [s',e]`
contract has become limiting and we want signal-style mutation. In that
case A is the most coherent path; B and C just delay the inevitable.

**Option D** is the right pick if v0.5 itself is the wrong question —
i.e., other LLui work is the priority and a 2-week + bundle work doesn't
fit. D's tiers can be shipped opportunistically without committing to a
v0.5 timeline at all.

---

## What would change my mind

I'd flip the recommendation from B to A if:

- Real-world usage shows TEA's pure-update semantics are limiting users
  (e.g., complaints about immutable state perf, complex `update()`
  bodies that signals would simplify).
- Solid-class bundle is a hard release requirement we can't compromise
  on.
- We have a 3-month implementation window and willingness to ship a v0.5
  major-version that breaks consumers.

I'd flip from B to C if:

- The Select perf gap turns out to be cosmetic / unmeasurable in real
  apps (the absolute time is 4 ms; possibly noise-bound in production).
- Cross-package authoring stays in-house long enough to absorb the
  manifest model without external library coordination.
- Bundle parity becomes a marketing line we're willing to commit to.

I'd flip from B to D if:

- Other LLui-product work (agent surface, MCP integration, route lib
  features) takes priority for v0.5.
- We're comfortable shipping 9–10 kB gz as the v0.5 floor.

These flips are all rational given different priorities. The doc set
intentionally doesn't pick one — that decision is a team call informed by
priorities outside the bundle-size data.
