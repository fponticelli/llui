# Headless components (@llui/components)

`@llui/components` is ~66 **headless** components (behavior + state + a11y, no imposed
styling). Reach for one before hand-rolling any interactive widget: dialog, popover,
tooltip, hover-card, menu, context-menu, menubar, select, combobox, tabs, accordion,
tree-view, toast, drawer, slider, number-input, color-picker, rating, timer, tour,
checkbox, radio-group, switch, and more. Patterns (pre-wired multi-component helpers)
live under `@llui/components/patterns/*`: `data-table`, `command-menu`, `searchable-select`,
`confirm-dialog`, `wizard`, `form-field`.

## Import per component (subpath)

```ts
import { dialog } from '@llui/components/dialog'
import { tabs } from '@llui/components/tabs'
import { select } from '@llui/components/select'
```

Each component module exports `init`, `update`, `connect` (and its `State`/`Msg` types).
Optional styling: `import '@llui/components/styles/theme.css'`. The root barrel also
exports i18n/format helpers: `LocaleContext`, `en`, `formatDate`, `formatNumber`,
`formatRelativeTime`, `validateSchema`.

## The `connect` + part-bag pattern

A component is a **slice** of your app state. The parent owns the slice and routes the
component's messages through its own `Msg` union with a flat switch.

```ts
// State: { dialog: dialog.DialogState, ... }
// Msg:   { type: 'dialog'; msg: dialog.DialogMsg } | ...
// update:  case 'dialog': { const [d, fx] = dialog.update(state.dialog, msg.msg); return [{ ...state, dialog: d }, fx] }

view: ({ state, send }) => {
  const dlg = dialog.connect(
    state.at('dialog'), // the SLICED signal handle, not an accessor
    (m) => send({ type: 'dialog', msg: m }), // map child Msg → parent Msg
    { id: 'edit-profile' }, // ConnectOptions: stable id for aria wiring
  )
  return [
    button({ ...dlg.trigger }, [text('Edit')]), // spread the part bag onto your element
    // ... plus the overlay (below)
  ]
}
```

Key points:

- **`connect(sliceSignal, send, opts?)`** takes the narrowed `Signal` (`state.at('dialog')`), never a getter. Passing an accessor or the whole root is a bug.
- The returned **part bag** holds pre-wired attribute/handler bundles you **spread** onto your own elements (`{ ...dlg.content }`). You supply the markup and classes; the bag supplies role/aria/`data-*`/event wiring.
- Sub-parts are addressed by id where a component has repeated items: `tabs.connect(...).item('a').trigger`, `...t.item('a').panel`.
- Give a stable `id` so aria relationships (`aria-controls`/`aria-labelledby`) resolve.

## Overlay components: `overlay({ state, send, parts, content })`

Overlay-family components (dialog, popover, tooltip, hover-card, menu, context-menu,
select, combobox, drawer, alert-dialog) additionally expose `overlay(...)`, which builds
the portal'd surface with focus-trap, dismissal (Escape/outside-click), and positioning
wired in. Place the returned `Mountable` in your view.

```ts
const dlgOverlay = dialog.overlay({
  state: state.at('dialog'),
  send: (m) => send({ type: 'dialog', msg: m }),
  parts: dlg,
  content: () => [
    div({ ...dlg.content }, [
      button({ ...dlg.closeTrigger }, [text('×')]),
      h3({ ...dlg.title }, [text('Edit profile')]),
      p({ ...dlg.description }, [text('…')]),
    ]),
  ],
  transition, // optional @llui/transitions hook
})
// view: [ button({ ...dlg.trigger }, [text('Edit')]), dlgOverlay ]
```

Dialog parts: `trigger, backdrop, positioner, content, title, description, closeTrigger`.
Dialog messages: `open, close, toggle, setOpen, animationEnd, transitionEnd`.

## Review points specific to components

- **Slice, not root:** `connect(state.at('slice'), …)`. `connect(state, …)` or `connect(() => state.slice, …)` is wrong.
- **Message routing:** the component's messages must be handled — a `case 'dialog'` in the parent `update` that calls `dialog.update(state.dialog, msg.msg)` and stores the result. A missing case means the component never updates.
- **Overlay placement:** the `overlay(...)` `Mountable` must be in the view array (see checklist item 2 — a discarded one is inert). The trigger and the overlay are separate placements.
- **Presence/animation:** with `skipAnimations: false` (exit animations), the component stays mounted in a `closing` state until an `animationEnd`; don't assume synchronous unmount.
- **select/combobox identity is value-based:** in current versions, highlight/selection state is `highlightedValue: string | null` (not an index) and the `highlight` message carries `value`, not `index`. If you read `highlightedIndex` or send `{ type: 'highlight', index }`, you're on an old model — migrate to value identity. This exists because value-keyed list rows are reused on filter/reorder, so an index goes stale.
- **Lists inside components** (menu items, tree nodes, select options) follow the same each-keying + gatability rules as any list (SKILL.md items 3–4, 10).
- **i18n:** locale strings are read from `LocaleContext` at connect time and land as static attributes; a runtime locale switch requires remounting unless the app threads a reactive locale. Note this if the app switches languages live.

## Forms + validation

`validateSchema` (Standard Schema) + the `form-field` pattern give pre-wired field
state, errors, and submission. For **async** validation, thread a request id through the
validate/result messages and drop stale results — an out-of-order resolution otherwise
overwrites a newer one. (The `form-field` pattern does this; hand-rolled async validation
must replicate it.)
