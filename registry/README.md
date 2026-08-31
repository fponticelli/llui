# @llui/registry

Component **source** served as JSON from [llui.dev/r](https://llui.dev/r) and copied
into consumer projects by [`@llui/cli`](../packages/cli). Private — it is never
published as an npm package.

```
registry/
  registry.json      index: one item per component
  llui/lib/          shared helpers (cn, mergeClass, classPart)
  llui/ui/           components
```

## Product contract and artifact kinds

`registry.json.productContract` is the canonical inventory shared by the CLI, tests and
generated registry index. It classifies every public `@llui/components/*` subpath and every
published `registry:ui` item, including its canonical identity, direct aliases, category,
machine import, typed copied artifacts, styling support, presentation coverage and scenario
identity. Each copied artifact owns its `llui add` name, artifact kind and styling
classification. It may inherit the canonical display/scenario identity when those facts are
genuinely shared; variants in a multi-artifact product declare their scenario identities
explicitly. Do not maintain a second list in prose; `llui list` renders the resolved contract.

`category` remains the user-facing taxonomy. The required `presentation.family` is a separate,
single-owner visual-language cohort used to divide alignment and gallery work without deriving
another inventory. Its four values are `forms-controls`, `navigation-data`, `menus-overlays` and
`specialized-tools`. Aliases and copied artifacts never repeat that field: resolving either name
returns its canonical entry and therefore inherits the canonical presentation profile.

Each profile classifies both supported paths, `baseline` and `registryTailwind`, with exactly one
coverage mode:

- `styled` means the product directly ships the path's complete default visual treatment.
- `partial` means it directly ships meaningful treatment but deliberately leaves a named part of
  the presentation to composition or the consumer. Its rationale states that boundary.
- `composed` means the product owns no styling on this path but has a real presentation made from
  the named canonical products. References are canonical (never aliases), visually available on
  the same path, unique, non-self-referential and acyclic. Composition is valid for either a public
  or machine-free canonical product.
- `styleless` means the public package machine or pattern is intentionally useful without owned
  visuals. It requires `machine.kind: "public"`, and the canonical `styling.styleless` flag must
  agree. That headless artifact remains usable alongside either presentation path even when the
  path ships no direct skin.
- `not-applicable` means the canonical product is machine-free and therefore has no public
  headless artifact. It requires `machine.kind: "none"`.

Every non-`styled` mode explains itself. `styled` and `partial` correspond exactly to a true
`styling.baseline` / `styling.registryTailwind` flag; `composed`, `styleless` and
`not-applicable` correspond to false. The older booleans therefore stay useful to callers that
only need availability, while the profile supplies the reason and composition boundary needed by
the gallery, docs and future visual-system evolution.

The contract keeps four artifacts distinct:

- **Machines** are headless package imports. Some have a copied skin; others are useful
  only as a state/ARIA primitive and have no `llui add` target.
- **Skins** are copied adapters for machine parts. A skin names its public machine, or is
  explicitly marked as application-owned state when no package machine exists.
- **Patterns** are first-class composed package exports. They may have a copied adapter,
  but are not relabelled as a primitive machine.
- **Presentational items** are copied element helpers with no invented machine.

Aliases point straight to one canonical identity and retain the target copied artifact's kind,
so a pattern alias is never relabelled as a skin. Variant skins such as a calendar/date picker
or drawer/sheet remain separate copied artifacts—with their own install, display and scenario
identity—rather than pretending to be aliases. `scenarioId` is the renderer-neutral identity
that gallery surfaces may share later; renderer functions stay in their own apps and are
deliberately not named by this contract.

## Fidelity to shadcn/ui

Recipes are ported VERBATIM from shadcn/ui's source (new-york-v4, MIT © 2023
shadcn), measured at a **98% mean class-set match** across the 45 components with
an upstream counterpart — 38 of them at 100%.

Two items are ports of something that could not come across whole, and each says
so in its own header: **`form`** is upstream's five recipes re-bound to
`@llui/components/patterns/form-field` where upstream binds react-hook-form, and
**`chart`** carries upstream's `ChartConfig` → `--color-<key>` bridge and its
tooltip/legend recipes, but draws with `@llui/components/chart` because Recharts
is React-only.

**`chip` has no upstream counterpart** and is excluded from that 45 rather than
counted as a miss. It is `badge`'s geometry with its colour derived from its
value (`chipHue` in `@llui/components/styles`), which shadcn has no equivalent
of — see `llui/ui/chip.ts` for why the two colour declarations live in the recipe
and not in a `--chip-fill` token.

What remains is not approximation. It is, in order of size:

1. **Radix runtime variables.** `origin-(--radix-…-transform-origin)`,
   `max-h-(--radix-…-available-height)`,
   `h-[var(--radix-navigation-menu-viewport-height)]`. Radix's positioner writes
   these; LLui's floating layer does not, so the classes would resolve to
   `var(--undefined)`. Dropping them costs the zoom animation its trigger-edge
   origin — the only visual difference in those files.
2. **`cmdk` selectors.** `command`'s `[&_[cmdk-group-heading]]` block targets
   that library's own attributes. There is no cmdk here;
   `@llui/components/patterns/command-menu` publishes `data-highlighted` like
   every other LLui list.
3. **A measurement limit, not a gap.** The comparison reads each file's own
   recipes; a few upstream classes it reports as missing are present under the
   `data-slot` → `data-part` rename (e.g. `select`'s
   `*:data-[part=select-value]:…`). Check the file before believing the number.

Where upstream and LLui disagree on the ATTRIBUTE **or the VALUE** that drives a
state, both are bound rather than one being chosen. The value case is the easier
one to miss: shadcn writes `data-invalid="true"` and every LLui machine publishes
the BARE `data-invalid`, so `data-[invalid=true]:text-destructive` matched nothing
in `field.ts` for as long as it shipped — three rules, all green under the
name-level check. `scripts/test/registry-attrs.test.ts` now checks values too.

The attribute case — `scroll-area` carries `data-[axis=…]` AND
`data-[orientation=…]`, `input-otp` carries `data-[active=true]` AND
`focus-visible:`. A shadcn snippet pasted in behaves the same as an LLui part bag.

**Bind both only when both mean the same thing.** `resizable` used to carry
`aria-[orientation=…]` alongside `data-[orientation=…]` and that was a BUG, not
belt-and-braces: react-resizable-panels reports the axis of the DIVIDER while
`splitter` reports the axis of the SPLIT, so for one layout the handle is
`data-orientation="horizontal"` and `aria-orientation="vertical"` at the same
time. Both rules applied, the later won, and the divider rendered as a bar
across the top of the group instead of a rule between the panels. It compiled,
it spread, the suite was green — a render is the only thing that shows it.
Check what an attribute MEANS on both sides before pairing them.

## Rules for anything added here

1. **Route `class` through `mergeClass`, never `cn` directly.** `class` is
   `Reactive<string | …>`, so a caller may pass a Signal; `cn()` stringifies it to
   `"[object Object]"`. `mergeClass` maps it instead.
2. **Write recipes where the checker can read them** — as an argument to `cn` /
   `mergeClass` / `classPart`, or inside `createVariants`. A recipe reached through a
   new local helper is invisible to `scripts/lib/registry-classes.mjs` and silently
   unchecked. Prefer `createVariants` over a template literal for a conditional recipe:
   the checker reads a template's static text only.
3. **Express state with `data-*` variants**, not computed classes. Every part bag emits
   `data-state` / `data-disabled` / `data-orientation` / `data-side`.
4. **Do not wrap a `Button` in a part that is already a `<button>`.** Many parts
   render one — `CollapsibleTrigger`, `SidebarTrigger`, `AccordionTrigger`,
   `DialogClose`, `Checkbox`, `Switch`. Nesting gives invalid HTML and the inner
   element swallows the click target. Borrow the look instead:
   `class: buttonVariants({ variant: 'outline', size: 'sm' })`. Both demo
   sections hit this; a `button button` query is the quickest way to catch it.
5. **Use an intersection for prop types**, not `interface X extends ElProps` — an
   interface extending `ElProps` drops its index signature, so `props.class` and every
   spread `data-*` key stop type-checking.

## Checks

```bash
pnpm check:registry    # tsc over the source (nothing else in the repo compiles it)
pnpm test:scripts      # compiles every emitted class with real Tailwind; fails on dead ones
pnpm build:registry    # regenerate site/public/r/*.json
```

The second one is not optional decoration. The layer this replaced had 62 test files
asserting substrings of class strings that no build ever compiled, and 116 utility
occurrences across 55 of them produced no CSS at all.
