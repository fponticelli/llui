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

## Two kinds of item

- **Presentational** — `button`, `card`, `input`, `textarea`, `label`, `badge`, `chip`,
  `separator`, `skeleton`, `alert`, `table`. Element helpers with a class recipe. No
  state, no `update`, no scope.
- **Skins** — `switch`, `tabs`, `accordion`, `dialog`, `popover`, `tooltip`. The right
  tag and the classes for `@llui/components` parts. The state machine, keyboard handling
  and ARIA stay in the package; the consumer spreads the part bag in.

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
