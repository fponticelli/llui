---
name: llui-add-component
description: >-
  Follow this exact procedure when adding a NEW headless component to @llui/components
  (packages/components) — a behavior+state+a11y module in the family of dialog/tabs/
  select/menu/tree-view/accordion, exposing init/update/connect (+ overlay for overlay
  components). Use it whenever you're building a new interactive widget inside the LLui
  components package: the connect() part-bag contract, the overlay engine, ARIA/id
  wiring, i18n via LocaleContext, value-based list identity, the shared utils to reuse,
  and the THREE export edits are all easy to get wrong. This is framework-internals work
  on the component library (NOT app code — that's llui-app-dev — and NOT a runtime
  primitive). Load it before writing the component.
---

# Adding a headless component to `@llui/components`

Headless = behavior + state + a11y, **no imposed styling**. Copy the closest existing
module: `packages/components/src/components/tabs.ts` (connect-only), `dialog.ts`
(overlay), or `accordion.ts`.

## Module contract

A component is a plain module exporting `init`, `update`, `connect` (and `overlay` for
overlay components), plus a namespace object at the bottom.

- **`interface XState`** — JSON-serializable (including only finite numbers), **value-based** (selection/list state keys off
  item _values_ — strings — never indices or object identity; a reused list row's index goes
  stale on filter/reorder).
- **`type XMsg`** — discriminated union with a `type` field. Annotate variants with JSDoc
  `@intent("…")` / `@humanOnly` for the agent surface (see tabs.ts).
- **`init(opts): XState`** — no signal args.
- **`update(state, msg): [XState, never[]]`** — pure, synchronous, exhaustive
  `switch (msg.type)`. Most headless components emit no effects → `never[]`.
- **`connect(state: Signal<XState>, send: Send<XMsg>, opts: ConnectOptions): XParts`** —
  takes the **sliced signal handle** (the consumer passes `state.at('tabs')`), never an
  accessor. Returns a **part-bag**: an object of prop-bags the consumer spreads onto
  elements. Reactive props are `state.map(s => …)` signals; event handlers are wrapped in
  **`tagSend(send, ['variant', …], fn)`** (from `@llui/dom`) so the agent protocol knows
  which Msg variants a handler dispatches. Wrap EVERY handler in `tagSend`.
- **`overlay(opts): Mountable`** (overlay components only) — delegate to the shared
  **`createOverlay`** engine (`utils/overlay-engine.ts`); it wires portal + focus-trap +
  dismissal + positioning. Takes `{ state, send, parts, content: () => Renderable, transition?, ... }`.
  The returned `Mountable` must be placed in the consumer's view.
- **Namespace export:** `export const tabs = { init, update, connect, ... }` /
  `export const dialog = { init, update, connect, overlay, isMounted, isPresent }`.

## Part-bags, a11y, ids

Parts carry static ARIA/`data-*` attributes + reactive `Signal` props + ids derived from
`opts.id` (e.g. `${base}:trigger:${value}`). `ConnectOptions` always includes a required
`id: string` (for ARIA cross-references like `aria-controls`/`aria-labelledby`) plus
component-specific options. Use `data-scope` / `data-part` / `data-state` conventions for
stable selectors. Address repeated items by value via sub-parts (e.g. `tabs.connect(...).item('a').trigger`).

## i18n

Pull locale strings with `const locale = useContext(LocaleContext)` (from `../locale.js`)
and prefer `opts.someLabel ?? locale.<component>.<key>`. Add any new user-facing strings to
`packages/components/src/locale.ts` (the `Locale` type + the `en` default).

## Shared interaction primitives — reuse, don't reinvent

The low-level browser behavior lives in **`@llui/interactions`**: dismissal, focus trapping,
outside interaction, nested-layer ownership, positioning/floating, portal targets, scroll
locking, ARIA hiding, roving focus, typeahead, direction, and presence-end guards. Components
keeps compatibility re-exports in `packages/components/src/utils/`; use those from component
modules so `createOverlay` and existing components share one internal seam, but change the
primitive at its source in `packages/interactions/src/` when behavior must change. Never fork a
second document-level listener or layer registry. `@llui/components` must peer- and dev-depend on
both `@llui/dom` and `@llui/interactions` so consumers get one shared singleton of each.

`packages/components/src/utils/overlay-engine.ts` still owns the higher-level `createOverlay`
composition. Higher-level widget compositions belong in `packages/components/src/patterns/`.

## Export wiring — THREE edits

1. **`packages/components/src/components/index.ts`** — add `export * as <name> from './<name>.js'`
   AND a `export type { XState, XMsg, XParts, … } from './<name>.js'` block.
2. **`packages/components/package.json`** `exports` map — add the subpath:
   `"./<name>": { "types": "./dist/components/<name>.d.ts", "import": "./dist/components/<name>.js" }`.
3. **Keep the module pure** — no side-effecting imports; any CSS lives under
   `packages/components/src/styles/` and is imported separately, so `sideEffects` stays clean
   for tree-shaking.

## Test — `packages/components/test/components/<name>.test.ts` (+ optional `.integration.test.ts`)

Follow `tabs.test.ts` / `dialog.test.ts`:

- **Unit-test `update`** transitions directly (it's a pure reducer) — cover every `Msg`.
- **Mount via the test harness** and assert part-bag attributes, ARIA wiring, and keyboard
  behavior. Integration tests prove real interactions (e.g. `menu.integration.test.ts` drives
  focus/dismissal end to end).
- For overlay components, assert focus goes somewhere on open and is restored on close, and
  that presence advances only on the element's _own_ animation end.

## Common footguns (from real bugs)

- **`connect` takes `state.at('slice')`**, not an accessor or the whole root.
- **Presence** must guard bubbled `animationend`/`transitionend` (`presence-end.ts`), or a
  child animation finishing during close unmounts the overlay early.
- **List/selection identity is value-based** — never persist a build-time index for identity.
- **Async validation** (forms) must be request-sequenced so a stale result can't overwrite a newer one.
- **Escape in a nested overlay** (submenu) should unwind one level, not close everything — the
  child must register ownership with `registerNestedLayer`; if ownership is ambiguous, fail
  closed instead of letting both parent and child handle the event.
- **Focus tests must cross the claimed boundary.** Use raw `HTMLElement.focus()` inside the
  browser page, assert the actual spread part attributes first, and choose a Tab direction that
  traverses the disputed trap edge.

Before reporting interaction coverage, apply and inspect a faithful mutation of the behavior,
then record the per-test kill/survival table with reasons. A malformed mutation that also breaks
teardown or paired bookkeeping is not evidence.

## Styling — a downstream obligation, not an optional extra

A component with a VISUAL surface is not finished when its machine is, and there are TWO
consumers of its `data-*` contract, not one:

1. **`registry/llui/ui/<name>.ts`** — the shadcn-styled skin, copied into consumer projects by
   `llui add`, rendered in `examples/registry-demo`.
2. **`packages/components/src/styles/theme.css`** — the opt-in BASELINE stylesheet, which
   styles the same parts with `[data-scope][data-part]` rules for apps with no Tailwind build.
   A component with no rules here is simply unstyled for every baseline consumer.

`scripts/test/registry-attrs.test.ts` cross-checks BOTH against the machine's part-bag types,
so a selector naming an attribute you never publish fails the build on either side. Add the
component to the registry's `MACHINE_OF` and, if its scope needs it, the sheet's
`THEME_MACHINE_OF` — each map has a vacuity check, so a new scope cannot silently fall out of
coverage.

For the registry half specifically, two guards will fail the build if you skip either:

- **`scripts/test/registry-attrs.test.ts`** cross-checks every `data-*` / `aria-*` a recipe
  styles against what the machine's part-bag TYPES declare. It has a vacuity check on its
  `MACHINE_OF` map, so a new skin that names no machine fails rather than silently falling out
  of coverage — add it there (`[]` for a layout-only skin).
- **`scripts/test/registry-demo-sync.test.ts`** requires every published registry item to be
  copied into the demo, byte-identical to what `llui add` produces today.

Two things about the ATTRIBUTE NAMES your `connect` publishes, both learned from shipped bugs:

- **Match the package's existing spelling.** A highlight is a bare `data-highlighted`, not
  `data-state="highlighted"` — `select`, `combobox`, `listbox` and `tags-input` all use the bare
  flag, and `menu-machine` diverging meant every dropdown, context-menu and menubar item had no
  highlight at all. `data-state` means open/closed. Grep a sibling machine before inventing a
  name; a recipe naming an attribute nobody emits is valid CSS that never matches.
- **A part bag's value is an ATTRIBUTE unless it obviously is not.** `combobox`'s `liveRegion`
  carries `text` (a child) and `form-field`'s `errorText` carries `issues` (an array), so
  spreading those bags whole emits `text="…"` on an empty live region. If a part must carry a
  non-attribute, say so in its doc comment — the types catch the array, nothing catches the
  string.

**RENDER it before believing it.** Every rendering pass over this registry has found defects that
the type-check, the class compiler and the attribute guard all pass: a part bag frozen at build
time, a machine that needs consumer-wired pointer tracking, a focus ring clipped by an ancestor's
`overflow-hidden`. Measuring attributes is not the same as looking at the page, and a screenshot
has settled several cases where measurement gave a confident wrong answer.

Finish with `pnpm --filter @llui/interactions build check test` when shared behavior changed,
then `pnpm --filter @llui/components build check test`.
