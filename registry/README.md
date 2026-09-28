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
identity—rather than pretending to be aliases. A canonical product's `scenarioId` joins its
baseline and registry presentations; a copied artifact's `scenarioId` identifies that specific
presentation target. Neither is a product-local case ID: families own cases and JSON inputs in
the shared presentation-scenario catalog, while renderer functions stay in their own apps and
are deliberately not named by either contract. Registry gallery code imports the protocol only
from `@llui/cli/presentation-scenarios`; it must not import that browser-pure seam from the CLI
root or add DOM, CSS, Tailwind or LLui runtime payloads to the catalog. Compiled cases are frozen
semantic snapshots. A registry adapter receives a resolved case and owns its rendering entirely;
family-local renderer helpers remain outside the serialized catalog and outside ProductContract.
Source cases are exact JSON protocol records; registry renderer adapters are separate maps keyed
by `scenarioId` and case `id`, never extra fields attached to a case.

## Fidelity to shadcn/ui

Recipes are ported from shadcn/ui's source (new-york-v4, MIT © 2023 shadcn), keeping
the upstream classes and adding only what LLui needs: logical RTL utilities,
`forced-colors:` variants and LLui's `data-*` attributes. When the port was measured, the class sets matched upstream at a **98% mean**
across the components with an upstream counterpart, most of them exactly; recipes added
since were ported the same way.

Two items are ports of something that could not come across whole, and each says
so in its own header: **`form`** is upstream's five recipes re-bound to
`@llui/components/patterns/form-field` where upstream binds react-hook-form, and
**`chart`** carries upstream's `ChartConfig` → `--color-<key>` bridge and its
tooltip/legend recipes, but draws with `@llui/components/chart` because Recharts
is React-only.

**`chip` has no upstream counterpart** and is excluded from that measurement
rather than counted as a miss. It is `badge`'s geometry with its colour derived from its
value (`chipHue` in `@llui/components/styles`), which shadcn has no equivalent
of — see `llui/ui/chip.ts` for why the two colour declarations live in the recipe
and not in a `--chip-fill` token.

What remains is not approximation. It is, in order of size:

1. **Radix runtime variables.** `origin-(--radix-…-transform-origin)` and
   `h-[var(--radix-navigation-menu-viewport-height)]`. Radix's positioner writes
   these; LLui's floating layer does not, so the classes would resolve to
   `var(--undefined)`. Dropping them costs the zoom animation its trigger-edge
   origin — the only visual difference in those files. The one Radix variable
   LLui DOES have an equivalent for is translated, not dropped:
   `max-h-(--radix-…-available-height)` becomes
   `max-h-[var(--llui-floating-available-height,calc(100dvh-2rem))]`, written by
   `attachFloating` (the fallback covers the frame before the first measure).
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

**`PaginationLink` is a `<button>`, not upstream's `<a>` (#264 review item 9).**
This is a deliberate, explained deviation, not drift: `@llui/components/pagination`
publishes reactive `data-selected`/`aria-current` state and its roving-focus
helper addresses BUTTON elements specifically (`focusRovingItem`'s `itemPart`
convention), and pagination here is an in-app state change (the page the
machine tracks), never a document navigation to a different URL — there is no
`href` a `<a>` would meaningfully carry. Reverting to `<a>` would leave the
keyboard roving-focus wiring unable to find the element it moves focus to.

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
   `data-state` / `data-disabled` / `data-orientation` / `data-side`. **Breaking
   (#265): `registry/llui/ui/sonner.ts`'s `Toast`/`Sonner` recipe no longer takes a
   `variant` prop.** The six `ToastType` visuals (background/border tint, icon,
   forced-colors border style) are driven entirely by `data-[type=…]:` selectors
   reading the machine's own reactive `data-type` attribute, never a `variant`
   resolved once from a peeked value at the call site — the same freeze bug this
   rule exists to prevent. Spread `parts.root` straight through; there is nothing
   else to pass.
4. **Do not wrap a `Button` in a part that is already a `<button>`.** Many parts
   render one — `CollapsibleTrigger`, `SidebarTrigger`, `AccordionTrigger`,
   `DialogClose`, `Checkbox`, `Switch`. Nesting gives invalid HTML and the inner
   element swallows the click target. Borrow the look instead:
   `class: buttonVariants({ variant: 'outline', size: 'sm' })`. Both demo
   sections hit this; a `button button` query is the quickest way to catch it.
5. **Use an intersection for prop types**, not `interface X extends ElProps` — an
   interface extending `ElProps` drops its index signature, so `props.class` and every
   spread `data-*` key stop type-checking.
6. **A disclosure root (`Accordion`/`Collapsible`) is built with `withExitCompletion`,
   and `exitCompletion: Mountable` is a REQUIRED THIRD ARGUMENT, never a field on
   the attribute props bag.** It used to be a field on the props object, but a
   call site's own fresh literal (`{ ...parts.root, exitCompletion:
   parts.exitCompletion }`) fails against `ElProps`'s index signature — TypeScript
   checks every property of an intersected type against ANY reachable index
   signature when the literal is fresh, regardless of which constituent declared
   the property. `parts.exitCompletion` is the machine's own `connect()` part that
   settles a RETAINED `close`/`toggle`/`setValue`/`setOpen` (one carrying
   `retain: true`, e.g. via `parts.close(...)`) on a skin with no exit motion — a
   raw programmatic close with no `retain` closes instantly and never enters
   `closing`; `withExitCompletion` (in `llui/lib/utils.ts`) wraps a
   `classPart`-built root so it appends that part after the caller's children
   itself, and the required third argument means
   `Accordion({ ...parts.root }, [...])` (missing it) is a type error, not a
   runtime surprise — the whole call is
   `Accordion({ ...parts.root }, [...], { exitCompletion: parts.exitCompletion })`.
   Forgetting to place `parts.exitCompletion` at ALL is no longer a hang —
   whether it is mounted lives in a runtime registry keyed by the machine's own
   `opts.id`, never in state, and `@llui/components`' reducer only retains a
   `closing` phase when the closing message itself carries `retain: true` (stamped
   by `connect()`'s own trigger handlers from that registry) — a forgotten part
   means the registry never counts an attach, so every close is instant instead,
   with a synchronous, once-per-id dev-mode warning — so the required field here is
   about not silently losing the requested exit ANIMATION in a registry skin, not
   about avoiding a stuck instance. See `@llui/components`'s README (`accordion /
collapsible exit motion`) for the full contract.

## `@llui/*` dependencies carry a derived minimum

Write every `@llui/*` entry in an item's `dependencies` as `@llui/<pkg>@workspace:^`
— never a bare name, never a version. `pnpm build:registry` replaces it with
`@llui/<pkg>@^<version>`, that package's version in `packages/`, exactly as
`pnpm publish` rewrites a manifest; a bare name or a written-out version fails the
build. `llui add` treats the pinned version as a MINIMUM and refuses (without
`--force`) to copy an item into a project with an older package installed — a skin
that uses a new token or part attribute otherwise copies cleanly and breaks at
runtime (#273). `llui add --registry ./registry` resolves `workspace:^` the same way,
from this directory's own `node_modules`. Non-`@llui` dependencies stay plain npm
specs. `scripts/test/registry-dependency-minimums.test.ts` checks the whole built
registry.

## Checks

```bash
pnpm check:registry    # tsc over the source AND test/ (nothing else in the repo compiles either)
pnpm test:scripts      # compiles every emitted class with real Tailwind; fails on dead ones
pnpm build:registry    # regenerate site/public/r/*.json
```

`check:registry` runs the package's own `check` script, which compiles two
configs: `tsconfig.json` (the shipped `llui/` source, in the shape a consumer
compiles it) and `tsconfig.test.json` (`test/` and `vitest.config.ts`, with node
types). Vitest transpiles the tests with esbuild and never type-checks them, so
without the second config a type error in a test fails nothing
(`scripts/test/registry-typecheck-coverage.test.ts` pins both file sets).

The second one is not optional decoration. The layer this replaced had 62 test files
asserting substrings of class strings that no build ever compiled, and 116 utility
occurrences across 55 of them produced no CSS at all.
