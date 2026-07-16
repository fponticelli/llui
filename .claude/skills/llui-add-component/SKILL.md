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

- **`interface XState`** — JSON-serializable, **value-based** (selection/list state keys off
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

## Shared utils — reuse, don't reinvent (`packages/components/src/utils/`)

`focus-trap.ts`, `dismissable.ts`, `interact-outside.ts`, `overlay-engine.ts`
(`createOverlay`), `roving.ts` (roving tabindex — `firstEnabled`/`nextEnabled`/
`focusRovingItem`), `typeahead.ts`, `floating.ts`, `portal-target.ts` (`resolvePortalTarget`),
`aria-hidden.ts`, `remove-scroll.ts`, `presence-end.ts` (guard `animationend`/`transitionend`
against bubbling — advance presence only on `e.target === e.currentTarget`), `direction.ts`
(`flipArrow` for RTL), `anatomy.ts`. Higher-level compositions belong in
`packages/components/src/patterns/`.

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
  dismissable layer takes an escape router.

Finish with `pnpm --filter @llui/components build check test`.
