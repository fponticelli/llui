# Proposal: shadcn/ui integration for `@llui/dom` + `@llui/components`

Status: **IMPLEMENTED** (Option B, all three phases) — kept as the rationale record
Date: 2026-08-26

> **What shipped.** See §7 for the delivered shape and the differences from this plan.
> The evidence sections below describe the tree BEFORE the change and are left as
> written, because the reasoning is what makes the invariants in `CLAUDE.md` legible.

## TL;DR

"Integrate shadcn/ui" cannot mean "run shadcn components" — those are React + Radix +
JSX and none of that survives contact with a build-once, no-VDOM runtime. What it can
mean is adopting the four **separable** layers shadcn actually is, and llui already has
three of them in some form:

| shadcn layer                                                           | llui today                                                               | move                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Token contract (CSS vars, oklch, `.dark`)                              | own names (`--color-surface`, `data-theme=dark`)                         | **align**                        |
| Class recipes (CVA strings per part/variant)                           | `src/styles/classes/*` — exists, 0 in-repo consumers, 116 dead utilities | **replace**                      |
| Behavior (Radix primitives)                                            | 68 headless components, superset of Radix                                | **keep llui's**                  |
| Presentational primitives (Button/Card/Input/Badge/…)                  | absent                                                                   | **add ~12**                      |
| Distribution (registry + `npx shadcn add`, copy source into your repo) | nothing                                                                  | **build — best fit of all four** |

Recommendation: **Option B**, staged. Phase 1 (token + skin alignment) stands alone and
pays for itself by fixing a shipped-but-broken layer.

---

## 1. What the code actually says

Everything below was read or measured, not assumed. Where a measurement contradicted a
first reading, both are recorded (§5).

### 1.1 There are already TWO styling channels

`@llui/components` ships both:

1. **`src/styles/theme.css`** — 1806 lines: an `@theme {}` token block plus ~207
   `[data-scope='x'][data-part='y']` baseline rules. Tailwind v4 is an **optional** peer.
2. **`src/styles/classes/*.ts`** — 62 files exporting `xClasses(variants)` → a record of
   Tailwind class strings per part, built on a hand-rolled CVA (`styles/utils/variants.ts`:
   `cx` + `createVariants`, with `base` / `variants` / `defaultVariants` / `compoundVariants`).

Channel 1 is healthy. Channel 2 is not.

### 1.2 Channel 2 is unused and measurably broken

- **Zero consumers.** Nothing outside `packages/components/test/` imports `*Classes()`.
  `examples/components-demo` — the one demo that installs Tailwind — imports
  `theme.css` + `theme-dark.css` and hand-writes utility classes. It never calls a class helper.
- **Its tests can't catch breakage.** They are substring assertions
  (`expect(cls.content).toContain('max-w-lg')`). Tailwind is never invoked.
- **`tailwindcss` is not installed anywhere in the repo** (optional peer, no root dev-dep).

I compiled every class token from `styles/classes/*.ts` against **real Tailwind v4.3.3**,
using the repo's own `@theme` block. Of 372 distinct tokens, these produce **no CSS at all**:

| dead utility                                                        | occurrences | why                                                                            |
| ------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `duration-fast`                                                     | 89          | v4's namespace is `--transition-duration-*`, theme.css declares `--duration-*` |
| `z-popover`                                                         | 9           | namespace is `--z-index-*`, theme.css declares `--z-*`                         |
| `z-dialog`                                                          | 6           | same                                                                           |
| `z-tooltip`                                                         | 3           | same                                                                           |
| `duration-normal`                                                   | 3           | same as `duration-fast`                                                        |
| `animate-in`, `fade-in`                                             | 2           | need `tw-animate-css`; not a dependency anywhere                               |
| `bg-success`, `bg-warning`, `bg-primary-subtle`, `text-text-subtle` | 4           | tokens never defined in `@theme`                                               |

**116 occurrences across 55 of 62 files.** Practical effect if anyone adopted this layer:
every transition is instant, and dialog / popover / tooltip surfaces get **no z-index**.

Verified fixes (each compiles): rename to `--transition-duration-fast` / `--z-index-dialog`,
or use `duration-[150ms]` / `z-[100]` / `z-(--z-dialog)`.

### 1.3 The headless layer is a near-perfect skin target

- **`connect()` never emits a `class`.** Zero `class:` keys across all 66 component
  modules. A skin layer is therefore **purely additive** — it cannot regress focus,
  dismissal, ARIA, or the overlay engine.
- **The data-attribute surface is rich and already shadcn-shaped:** 624 `data-part`,
  623 `data-scope`, 124 `data-state`, 94 `data-disabled`, plus `data-orientation`,
  `data-side`, `data-highlighted`, `data-selected`, `data-invalid`, `data-value`.
  shadcn's `data-[state=open]:` / `data-[side=top]:` / `data-[disabled]:` variant idiom
  works against llui parts with no runtime change.
- **Reactive classes already bind.** `ElProps` types every key as
  `AttrValue = Reactive<string|number|boolean|null|undefined>`, and
  `signals/element.ts:applyProp` binds a raw `Signal` handle in a prop slot
  (`class: state.map(s => cn(…))` → a real binding, not `[object Object]`).
- **The compiler already steers React idiom home:** the `attr-name` lint rule is a
  build error on `className` with an autofix to `class`.

### 1.4 Gaps

- **No presentational primitives.** No button / card / badge / input / textarea / label /
  separator / skeleton / alert / sheet in either `components/` or `styles/classes/`.
  These are roughly a third of what people mean by "shadcn".
- **Token names diverge.** llui: `--color-surface`, `--color-text`, `--color-text-muted`,
  hex values, dark via `prefers-color-scheme` + `[data-theme='dark']`.
  shadcn: `--background`/`--foreground` pairs (`--primary` / `--primary-foreground`,
  plus `card`, `popover`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`,
  `chart-1..5`, `sidebar-*`), oklch, dark via a `.dark` class, one `--radius` with a
  derived scale.
- **No `cn()`.** No `clsx` / `tailwind-merge` / `class-variance-authority` anywhere; `cx`
  concatenates without conflict resolution, so a consumer override (`class: 'p-2'`) loses
  to the recipe's `p-4` by source order rather than winning.

---

## 2. Options

### Option A — Token + skin alignment (no CLI)

Adopt shadcn's token contract in `theme.css`, rewrite `styles/classes/*` against it, fix
the 116 dead utilities, add the ~12 missing presentational primitives, add a real `cn()`.

**Pros**

- Fixes a shipped, broken, untested layer — worth doing on its own merits.
- Any shadcn theme (including tweakcn / the theme generators) drops straight in.
- Purely additive to the headless layer; no `connect()` change.
- Small, reviewable, no new package.

**Cons**

- Breaking for anyone on the current token names (acceptable per repo policy, but it is a
  real `@llui/components` major).
- Leaves **three** style channels (data-part CSS, class helpers, consumer classes) — the
  duplication that produced the dead layer in the first place.
- Delivers none of what people actually like about shadcn: owning the source.

### Option B — Option A + an llui registry and CLI (`llui add button`) — **recommended**

Ship shadcn's _distribution model_: a registry of llui-source components that a CLI copies
into the consumer's repo. The registry-item JSON schema is documented and explicitly
supports third-party registries (`registry:ui`, `files[].path/type/target`, `cssVars`,
`dependencies`, `registryDependencies`), so we can either mirror it or reuse it verbatim.

**Pros**

- **It is a better fit for llui than for React.** Copied-in source is compiled by the
  consumer's own `@llui/vite-plugin`: they get view lowering, the non-bypassable lint
  rules, and — the differentiator — `$ms`/`$es`/`$ss`/`$ma` agent metadata and
  `__lluiVariants` on their own components. A precompiled library gives them none of that.
  This directly serves the "LLM-first authoring" thesis.
- Sidesteps the peer-dependency landmines: copied source has no `@llui/dom` edge of its
  own, so it cannot cause the two-`currentContext` outage the peer rule exists to prevent.
- Kills the third style channel — the class recipe lives in the consumer's file, editable,
  and `styles/classes/*` can be deleted rather than repaired.
- Lets the presentational primitives (Button, Card, …) ship as registry items rather than
  as new exports we must version forever.

**Cons**

- A real new surface: a CLI, a registry host, a schema, and version/update semantics for
  copied files. That is the whole cost of the option.
- 68 components × parts × variants is a large authoring job; the existing dead layer is
  direct evidence of how expensive an unexercised skin surface is to keep honest.
- Copy-in means no patch delivery — a fix in a recipe reaches nobody until they re-add.
- Needs a golden test that actually **compiles Tailwind**, or it rots the same way (§4).

### Option C — Automated port of shadcn's React source

Transpile the registry's TSX into llui view code.

**Pros**: nominal parity, tracks upstream.
**Cons**: rejected. It requires a JSX→build-once-view transpiler with hook semantics
llui deliberately does not have; the output would bypass `operator-on-signal` /
`pure-derive-body` reasoning and produce code no human wants to own. Radix behavior
would also be _worse_ than what `@llui/components` already ships (overlay engine,
nested-layer ownership, engine-focus discipline). Not worth it.

---

## 3. Recommendation

**Option B, staged.** Phase 1 is Option A and is independently justified.

- **Phase 1 — tokens + `cn()`.** Move `theme.css` to the shadcn variable contract
  (`--background`/`--foreground` pairs, oklch, single `--radius`), keep the `[data-scope]`
  baseline rules on the new names, add `.dark` alongside the existing `[data-theme]` /
  `prefers-color-scheme` mechanism. Add `cn()` (clsx + tailwind-merge, or a vendored
  equivalent to stay dependency-light). Add the Tailwind compile test.
- **Phase 2 — presentational primitives.** Button, Card, Input, Textarea, Label, Badge,
  Separator, Skeleton, Alert, Sheet, Sonner-equivalent (llui has `toast`), Table skin.
  These are class recipes + tiny view helpers, not state machines.
- **Phase 3 — registry + CLI.** `llui add <item>`, registry-item JSON, `registry:ui` items
  wrapping existing `@llui/components` headless imports. Delete `src/styles/classes/*`
  and its `./styles/*` export map entries in the same change.

Attribution: shadcn/ui is MIT (© 2023 shadcn). Ported class recipes need a
`NOTICE`/header credit; that is the whole legal obligation.

---

## 4. Risks and the one non-negotiable

**The layer must be verified against a real Tailwind build, in CI.** The 116 dead
utilities existed because 62 files of tests asserted substrings of strings that were never
compiled. Any skin layer we ship needs a test that runs `@tailwindcss/cli` over every
emitted token and fails on a token that produces no rule. Without it, this proposal
reproduces the exact defect it is fixing, at three times the size.

Other risks:

- Token rename is a `@llui/components` major and breaks `examples/components-demo` and
  any consumer overriding `--color-*`.
- `tw-animate-css` becomes a (optional) peer if we keep shadcn's enter/exit animations —
  and llui's presence machine (`presence.ts`, `data-state=opening/closing`) does not use
  shadcn's `data-[state=open]:animate-in` names. Pick one; do not ship both.
- `cn()` pulls `tailwind-merge` (~6 kB gz). Acceptable for a copied-in file, less so as a
  hard dep of `@llui/components`.
- Consumers writing `cn('base', isOpen && 'open')` where `isOpen` is a Signal hit the
  `operator-on-signal` build error. Correct behavior, but it needs a docs page —
  the idiom is `class: state.at('open').map(open => cn('base', open && 'open'))`.

---

## 5. Second-guessing the findings

Two first readings were wrong and were corrected by measurement:

1. **"Tailwind v4 has no `--z-*` or `--duration-*` namespace, so these are unfixable."**
   Wrong. The namespaces exist as `--z-index-*` and `--transition-duration-*`; the docs
   table I first read is abridged. Isolated compiles confirm `--z-index-dialog` →
   `z-dialog` works and `--z-dialog` does not. The defect is a **wrong variable name**,
   not a missing feature — a much cheaper fix than "rewrite to arbitrary values".

2. **"`theme.css`'s own `var(--duration-fast)` rules are dead too."**
   Wrong. That conclusion came from compiling only the extracted `@theme` block, where
   Tailwind tree-shakes unused theme vars. Compiling `theme.css` the way the demo imports
   it emits every token _and_ all 207 `[data-scope]` rules. **The baseline stylesheet is
   healthy; only the class-helper layer is broken.** This matters for the proposal: it is
   an argument for deleting channel 2, not for rebuilding channel 1.

Still unverified, and worth checking before committing to Phase 3:

- Whether the official `shadcn` CLI can be pointed at a non-React registry, or whether we
  need our own CLI. The docs confirm third-party registry _items_ and URL/GitHub refs, but
  not that the CLI is framework-agnostic. Assume our own CLI until proven otherwise.
- Bundle/perf impact of a `cn()` call per part per render on the list-render hot path
  (`populate` is explicitly perf-tuned; a recipe call in a keyed `each` row is worth a
  benchmark before it ships).

## 6. Reproducing the measurements

```bash
mkdir tw && cd tw && npm i tailwindcss@^4 @tailwindcss/cli@^4
# 1. every class token from styles/classes/*.ts, compiled against theme.css's @theme block
#    -> 116 occurrences across 55/62 files resolve to no CSS
# 2. theme.css imported whole -> all tokens + 207 [data-scope] rules survive
npx @tailwindcss/cli -i input.css -o out.css --content content.html
```

---

## 7. What shipped

All three phases, plus two things the plan did not anticipate.

**Phase 1 — tokens.** `packages/components/src/styles/theme.css` now carries shadcn's
token contract in plain `:root` / `.dark` blocks (oklch, paired surfaces, one
`--radius`), mapped into Tailwind's `--color-*` namespace by `@theme inline` so a
`.dark` override reaches `bg-card` with no regenerated CSS. Non-colour scales are a
plain `@theme` — `inline` is impossible there because Tailwind's namespace name IS
`--radius-lg`, so mapping it to itself is circular. All 207 `[data-scope]` baseline
rules were re-tokenised mechanically, with overlay scopes routed to `--popover` rather
than `--card`. The five dead namespaces are fixed (`--transition-duration-*`,
`--z-index-*`). `theme-dark.css` activates on `.dark`, `[data-theme='dark']` AND
`prefers-color-scheme`. `styles/classes/*` and its 62 test files are **deleted**, along
with 61 export-map entries.

**Phase 2 — registry.** `registry/` is a private workspace member with 17 items: ten
presentational (`button`, `card`, `input`, `textarea`, `label`, `badge`, `separator`,
`skeleton`, `alert`, `table`), six skins over `@llui/components` (`switch`, `tabs`,
`accordion`, `dialog`, `popover`, `tooltip`), and `utils` (`cn` / `mergeClass` /
`classPart`). `scripts/build-registry.mjs` emits `site/public/r/*.json`, wired into the
site's `generate` script so the drift job keeps it honest.

**Phase 3 — CLI.** `@llui/cli` (`llui init` / `add` / `list`), 28 tests.

### Differences from the plan

- **`cn()` is not in `@llui/components`.** It lives in the registry's `lib/utils`, which
  declares `clsx` + `tailwind-merge` as its own npm dependencies — so the ~6 kB lands
  only in projects that opt in, which §4 listed as a risk with no resolution.
- **`mergeClass` was not planned and is load-bearing.** `class` is
  `Reactive<string | …>`, so a caller may hand a component a Signal; `cn()` alone
  stringifies it to `"[object Object]"`. Every registry component routes `class` through
  `mergeClass`, which maps the signal instead.
- **`tw-animate-css` was NOT adopted.** §4 said to pick one animation vocabulary; the
  registry uses plain `transition-*` utilities driven by `data-[state=…]`, which matches
  LLui's own presence machine (`opening`/`closing`) instead of importing a second one.
- **The check covers `examples/components-demo` too**, not just the registry — and that
  is where it earned its keep twice over (below).

### What the checks caught

The Tailwind compile guard is `scripts/test/tailwind-classes.test.ts`; the type-check is
`pnpm check:registry`. Between them they found six real defects during implementation,
which is the argument for both:

| Found                                                                                           | By                |
| ----------------------------------------------------------------------------------------------- | ----------------- |
| `interface X extends ElProps` silently drops the index signature (`props.class` stops existing) | `check:registry`  |
| `mergeClass`'s parameter must be `unknown` — `ElProps`'s index signature also admits handlers   | `check:registry`  |
| Three components' recipes invisible to the class extractor (a per-file `part` factory)          | the vacuity guard |
| A template-literal recipe with its classes inside an interpolation                              | the vacuity guard |
| `bg-surface-2` in the demo — a token that never existed in ANY version of the theme             | the compile check |
| `.input` (3 call sites) and `text-error` in the demo — defined nowhere at all                   | the compile check |

A faithful mutation confirms the guard has teeth: reverting the z-index tokens to
`--z-*` (the exact defect that shipped) turns it red and names `z-dialog`, `z-popover`
and `z-tooltip` with their files. Restoring them turns it green.

### Corrections to §5's open questions

- "Whether the official shadcn CLI can be pointed at a non-React registry" — not
  pursued. `@llui/cli` is our own, and the registry format is a documented subset of
  shadcn's so that stays reversible.
- "Bundle/perf impact of a `cn()` call per part per render" — **not applicable as
  framed.** The registry components are element helpers that run at BUILD time (`view()`
  runs once), not per render, so a recipe call in a keyed `each` row happens once per row
  creation and not on update. Still worth a benchmark if a recipe ever moves inside a
  `.map` body, which is a different shape.
