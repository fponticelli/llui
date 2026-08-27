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

Install `@llui/components`, `@llui/dom`, and `@llui/interactions` together. The latter two
are peers and must each resolve to one shared instance: duplicate interaction registries
split focus traps, dismiss layers, nested-layer ownership, and scroll locks.

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
    mapSend(send, (msg) => ({ type: 'dialog', msg })), // child Msg → parent Msg
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
- **Finite numeric state:** never write `NaN`/`±Infinity` or an invalid divisor into a
  component slice. Current machines reject or normalize them, and unbounded limits are
  optional fields rather than infinity sentinels. Persisted snapshots from older versions
  are not rewritten automatically.
- **select/combobox identity is value-based:** in current versions, highlight/selection state is `highlightedValue: string | null` (not an index) and the `highlight` message carries `value`, not `index`. If you read `highlightedIndex` or send `{ type: 'highlight', index }`, you're on an old model — migrate to value identity. This exists because value-keyed list rows are reused on filter/reorder, so an index goes stale.
- **Lists inside components** (menu items, tree nodes, select options) follow the same each-keying + gatability rules as any list (SKILL.md items 3–4, 10).
- **i18n:** locale strings are read from `LocaleContext` at connect time and land as static attributes; a runtime locale switch requires remounting unless the app threads a reactive locale. Note this if the app switches languages live.
- **Nested portals need scoped ownership:** custom portaled children inside a modal use
  `registerNestedLayer(() => root, { owner: () => logicalOwner })`. Missing or unresolved
  owners now fail closed and warn in development; do not rely on a placement relationship
  to imply focus/dismissal ownership. Built-in overlays wire this automatically.

## Custom interaction primitives (@llui/interactions)

Import `attachFloating`, `pushDismissable`, `pushFocusTrap`, focusability, modal-isolation,
direction, and roving-focus primitives from `@llui/interactions` when building custom UI
without a component machine. `@llui/components/utils` remains a compatibility re-export,
but new standalone consumers should use the smaller package directly. Register every pushed
layer against the placing scope's cleanup and keep the shared peer singleton.

## Forms + validation

`validateSchema` (Standard Schema) + the `form-field` pattern give pre-wired field
state, errors, and submission. For **async** validation, thread a request id through the
validate/result messages and drop stale results — an out-of-order resolution otherwise
overwrites a newer one. (The `form-field` pattern does this; hand-rolled async validation
must replicate it.)

## Styling them: the registry

The machines carry no classes. Most apps style them with the **registry** — shadcn/ui's
recipes copied into the project by `@llui/cli` (`llui init`, `llui add button dialog`) and
spread onto the part bags. The copied file is the app's own source and is expected to have
been edited; `llui add` never overwrites without `--overwrite`.

Full walkthrough: **https://llui.dev/components**. What matters in review:

- **`tokens.css`, NOT `theme.css`.** `theme.css` is the opt-in BASELINE stylesheet, and its
  `[data-scope][data-part]` rules are UNLAYERED — unlayered CSS beats `@layer utilities`, so
  importing it alongside registry components makes every recipe lose to it. Silently: both
  stylesheets are present and correct, and the wrong one wins. An app importing both has a bug
  even if nothing looks obviously off yet.
- **Style state from `data-*`, and check the machine publishes it.** Every part bag emits
  `data-state` / `data-disabled` / `data-orientation` and friends; the branch belongs in the
  recipe (`data-[state=open]:bg-muted`), not in a computed class. A recipe naming an attribute
  nobody emits is valid CSS that never matches — no error, no warning. The part bag's TYPE is
  the list. Watch the near-miss spellings: bare presence (`data-highlighted`) versus an enum
  (`data-[state=highlighted]`), and `data-axis` versus `data-orientation`.
- **A `class` override wins**, because the registry routes it through `tailwind-merge`. A
  reactive class puts the conditional INSIDE the `.map` body — the compiler rejects an operator
  applied to a Signal.
- **`overlay()` gives you neither position nor backdrop.** Pass `positionerClass` for the
  `fixed inset-0` and the z-index; render the backdrop yourself inside `content()`, where it
  wants `absolute inset-0`.

### Traps that look like framework bugs

Each is silent, and each has cost real debugging time:

- **Some machines deliberately do not track the pointer.** `slider` and `splitter` are
  keyboard-complete but ignore the mouse until the app wires the drag, because only the view
  knows which element's rect a percentage is measured against. Each exports the helper
  (`valueFromPoint`, `positionFromPoint`) and expects an `onMount` attaching
  `pointermove`/`pointerup` **to the window**. Symptom: arrow keys work, the mouse does nothing.
- **Some parts do not hide themselves.** A radio indicator, a command palette's empty state.
  Gate them in CSS off the parent's `data-state`, or every radio renders filled.
- **A part bag value is not always an attribute.** `combobox`'s `liveRegion` carries `text` (a
  child) and `form-field`'s `errorText` carries `issues` (an array). Spreading those whole emits
  `text="…"` on an empty live region, which announces nothing. Destructure.
- **A live region must stay MOUNTED** — toggle with `hidden`, never `show`.
- **Do not wrap a field in a panel recipe.** `ComboboxRoot` is the `Command` palette SURFACE,
  with `overflow-hidden`; wrapping a labelled input in it clips the input's focus ring on three
  sides, which paints as a thick border along one edge and reads as a styling bug.

When a styling report is visual, **look at the render before measuring attributes**. Reading
`getComputedStyle` in a background tab is actively misleading — Chrome pauses transitions there
and returns whatever value the property is stuck at.
