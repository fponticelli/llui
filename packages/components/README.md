# @llui/components

66 headless UI components for [LLui](../../README.md). Pure state machines with no DOM opinions — you own the markup and styling via `data-scope` / `data-part` attributes.

## Scope & philosophy

Each component is a pure state machine: `init` / `update(state, msg) → [state, effects]` / `connect(state, send) → parts`. The machine owns **behavior** — keyboard interaction, ARIA semantics, selection/focus/validation logic, lifecycle — and nothing else.

What lives in the **machine**:

- Discriminated-union messages and JSON-serializable state (no DOM nodes, timers, or class instances in state).
- ARIA roles/attributes and WAI-ARIA APG keyboard patterns, exposed as reactive `parts` you spread onto your elements.
- Direction-aware keyboard semantics: direction-sensitive components take an optional `dir` (`'ltr' | 'rtl'`) and flip horizontal-arrow keys + logical floating placement accordingly.
- Side effects as **data** — anything async (HTTP, lazy loading, debounce) is returned as an effect for your `onEffect` handler; the machine never performs I/O.

What stays the **consumer's** responsibility (deliberately not shipped):

- Markup and CSS. Components emit `data-scope` / `data-part` / `data-state` hooks; visual styling — including CSS logical-property mirroring for RTL — is yours (an opt-in theme + Tailwind class helpers are available under `@llui/components/styles/*`).
- Driving time and observers: `setInterval`/`requestAnimationFrame` ticks (timer, toast countdown), `IntersectionObserver` (in-view, async-list sentinel, toc scroll-spy), and pointer-event wiring for drag (sortable, slider, carousel swipe, image-cropper) — the machine exposes pure helpers and tick/drag messages; you own the listeners.
- Bring-your-own heavy deps: a QR encoder (qr-code), canvas rendering (signature-pad), and the actual data fetch behind every `load*` effect.
- Exit-animation timing: overlays expose a `'closing'` `data-state` + `isPresent` and wait for an `animationend`; the CSS transition itself is yours (and unmount is synchronous when no animation is configured).

**Roadmap.** There's no frozen set — planned enhancements and new components are tracked as GitHub issues under the [`components`](https://github.com/fponticelli/llui/labels/components) label.

## Install

```bash
pnpm add @llui/components
```

Peer dependency: `@llui/dom`.

## Usage

Each component exports `init`, `update`, `connect`, and a barrel object:

```typescript
import { component, div, button } from '@llui/dom'
import { tabs } from '@llui/components/tabs'

type State = { tabs: tabs.TabsState }
type Msg = { type: 'tabs'; msg: tabs.TabsMsg }

const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ tabs: tabs.init({ items: ['a', 'b', 'c'], value: 'a' }) }, []],
  update: (s, m) => {
    const [t] = tabs.update(s.tabs, m.msg)
    return [{ tabs: t }, []]
  },
  view: ({ send, text }) => {
    const t = tabs.connect<State>(
      (s) => s.tabs,
      (m) => send({ type: 'tabs', msg: m }),
      { id: 'demo' },
    )
    return [
      div({ ...t.root }, [
        div({ ...t.list }, [
          button({ ...t.item('a').trigger }, [text('Tab A')]),
          button({ ...t.item('b').trigger }, [text('Tab B')]),
          button({ ...t.item('c').trigger }, [text('Tab C')]),
        ]),
        div({ ...t.item('a').panel }, [text('Content A')]),
        div({ ...t.item('b').panel }, [text('Content B')]),
        div({ ...t.item('c').panel }, [text('Content C')]),
      ]),
    ]
  },
})
```

### Pattern

1. **`init(opts?)`** — creates the initial state
2. **`update(state, msg)`** — pure reducer, returns `[newState, effects[]]`
3. **`connect(get, send, opts?)`** — returns parts objects with reactive props, ARIA attributes, and event handlers. Spread parts onto your elements: `div({ ...parts.root }, [...])`
4. **Overlay helpers** (dialog, popover, menu, etc.) — `overlay()` wires up portals, focus traps, dismiss layers, and positioning

### Composition with `sliceHandler`

```typescript
import { mergeHandlers, sliceHandler } from '@llui/dom'

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.tabs,
    set: (s, v) => ({ ...s, tabs: v }),
    narrow: (m) => (m.type === 'tabs' ? m.msg : null),
    sub: tabs.update,
  }),
  // ... more slices
)
```

## Components (66)

> **RTL / direction.** Direction-sensitive components (tabs, radio-group, toggle-group, rating-group, slider, angle-slider, splitter, carousel, menu, context-menu, navigation-menu, pagination, …) accept an optional `dir` (`'ltr' | 'rtl'`, default `'ltr'`) on `init` and a `setDir` message to change it at runtime. Under `'rtl'` they swap horizontal-arrow keyboard semantics (ArrowLeft ↔ ArrowRight; vertical arrows and Home/End are never flipped) and flip logical floating placement (`*-start`/`*-end`). This covers keyboard and placement only — visual mirroring via CSS logical properties (or `dir`/`direction`) remains the consumer's responsibility.

### Form controls

accordion, checkbox, collapsible, editable, field, fieldset, number-input, password-input, pin-input, radio-group, rating-group, search-field, slider, switch, tabs, tags-input, toggle, toggle-group, toolbar

- **field** — label/description/error ARIA wiring for a single control: derives stable control/label/description/error ids from one base id, exposes a `control` bag (id, `htmlFor`, `aria-labelledby`, reactive `aria-describedby`/`aria-invalid`/`aria-required`, `disabled`, `readOnly`) plus a `description` hint and a polite `errorText` live region — zero manual ids.
- **fieldset** — group wiring: native `<fieldset>`/`<legend>` (role group, `aria-labelledby`), group-level `disabled` propagation (mirrored to `aria-disabled`), and an optional polite group error region for cross-field validation.
- **toolbar** — roving-tabindex container for grouping buttons, toggles, and menu triggers. Single tab stop with arrow-key roving (orientation-aware), Home/End, separator/disabled skipping, optional focus wrap, and labelled groups. Interaction-agnostic: it only manages focus, items supply their own behavior.
- search-field — role="search" landmark with a type="search" input and clear button; Escape clears (when non-empty), Enter submits the current value; debounce live search consumer-side with @llui/effects

### Overlays

alert-dialog, combobox, context-menu, dialog, drawer, hover-card, menu, menubar, navigation-menu, popover, select, toast, tooltip, tour

- **Exit animations (presence lifecycle).** Overlay components (dialog, drawer, alert-dialog, popover, hover-card, tooltip, menu, context-menu, toast, …) support exit animations via a shared presence lifecycle. A closing overlay exposes `data-state="closing"` on its content and stays mounted until `animationend`/`transitionend`, then unmounts; when no animation is configured (the default), close unmounts synchronously with no hang. Use the exposed `isPresent` helper to gate the structural block so the node stays mounted through its exit transition.
- menubar — desktop-style application menu bar (File/Edit/View) that composes N menu machines with WAI-ARIA APG keyboard: ArrowLeft/Right move between top-level triggers, open-mode arrow/hover switching, roving tabindex (single tab stop), ArrowDown/Enter/Space open-and-focus-first-item, Escape closes and restores trigger focus.
- Delegates per-menu content/item/checkbox/radio/group/submenu parts to the menu machine via menubar.menu(id); render each dropdown with menubar.overlay({ menuId }).

### Data display

async-list, avatar, breadcrumbs, carousel, cascade-select, listbox, meter, pagination, progress, qr-code, scroll-area, steps, table, toc, tree-view

- **table** — Headless table / data-grid machine: sortable columns, row selection, and WAI-ARIA grid keyboard navigation — row DATA stays in the consumer (the machine tracks row IDs, sort, selection, and the focused cell only).
- Sorting cycles asc→desc→none (configurable via descFirst); the machine stores and emits sort state while the consumer performs the actual sort, so server-side sort works by feeding pre-sorted rows back in.
- Single/multiple row selection with tri-state select-all checkbox and Shift+click range selection.
- APG grid keyboard nav (arrows, Home/End, Ctrl+Home/End, PageUp/Down, Space to select, Enter to activate) with a single roving tab stop; works with rows rendered via each or virtualEach.

- **Breadcrumbs** — hierarchical navigation trail with WAI-ARIA landmark/list semantics, `aria-current="page"` on the active (last) item, and automatic middle-collapse to `first … last N items` (with an expandable ellipsis trigger) when `maxVisible` is exceeded.
- meter — role="meter" gauge for a scalar measurement within a known range (disk usage, battery, etc.), distinct from progressbar. Reports aria-valuemin/max/now plus a formatted aria-valuetext, and derives a `low`/`optimal`/`high` threshold band (native <meter> semantics) exposed via data-state for threshold styling. Read-only (no keyboard).

### Pickers

color-picker, date-input, date-picker, time-picker, angle-slider

### Media / canvas

file-upload, floating-panel, image-cropper, marquee, presence, signature-pad, timer

### Patterns

`@llui/components/patterns/confirm-dialog` — pre-wired alert-dialog for destructive confirmations.

- formField — field ARIA wiring + form touched-tracking + Standard Schema error display, pre-wired: one composed slice, one `formField(name)` spread per input, with touch-gated error visibility (touched || submitted) and sync/async validation built in
- `wizard` — multi-step flow combining the `steps` component with per-step validation gating. `next` validates the current step (sync predicate / Standard Schema, or async via the `validateStep` effect → `stepValid`/`stepInvalid`) before advancing; pass marks completed + advances, fail marks errored + stays.
- `prev` is never gated; `goTo`/`stepTrigger` jumps respect linear-mode + completion gating. `nextTrigger` is disabled and aria-busy while an async validation is pending, guarding against double-advance.
- command-menu — a ⌘K command palette composing dialog + combobox (grouped, filtered listbox)
- Filters by label and keywords, maintains a most-recent-first recents ranking in the reducer
- execute{commandId} is the single @intent surface, so agents drive the palette without keyboard simulation
- watchHotkey(send, combo?) mount helper binds a global hotkey (default mod+k) and returns a cleanup fn
- Double-Escape behavior (clear query, then close) and an empty-state part for no-match rendering
- **dataTable** — server-paginated, sortable, selectable data table composing the `table`, `pagination`, and async-list-status machines.
- Sort/page/pageSize changes emit a `data-table:loadPage` effect ({ page, pageSize, sort, queryId }); the consumer fetches and replies `pageLoaded { queryId, rows, total }`.
- A `queryId` version counter gives stale-response protection: a slow response for an older request is dropped, so it can never clobber a newer page.
- Selection policy `clearOnPageChange` (default true) scopes select-all to the current page and clears on page/sort change; set false for cross-page persistent selection.
- `connect()` re-exports wired table + pagination parts plus `loadingOverlay` (aria-busy), `emptyState` (role=status), and `errorState` (role=alert) live regions.
- **searchableSelect** — a select with a filter input ("a select, but searchable"), preset over `combobox`. Filter-only input (typed text never becomes the committed value), shadcn-style anatomy (trigger button shows the selection; search input inside the popup above the listbox), single/multiple modes, clearable, empty-state live region, plus combobox async/groups passthrough.

## Utilities

Shared helpers used internally and exported for advanced use:

| Utility          | Purpose                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `typeahead`      | First-letter search across menu, select, listbox, tree-view              |
| `TreeCollection` | Indexed tree traversal — visibleItems, labels, indeterminate computation |
| `floating`       | `@floating-ui/dom` wrapper for popover/menu positioning (dir-aware)      |
| `direction`      | RTL helpers — `flipArrow`, `resolveDir`/`resolveTextDirection`           |
| `focus-trap`     | Stack-based focus containment for modals                                 |
| `dismissable`    | Esc / outside-click dismiss layer stack                                  |
| `aria-hidden`    | `aria-hidden` on siblings of a modal for screen readers                  |
| `remove-scroll`  | Body scroll lock for modals/drawers                                      |

## Styling (opt-in)

Components are fully headless by default. An opt-in styling layer provides two complementary mechanisms:

### CSS theme — `theme.css`

Import once at your app root for a complete default look based on `data-scope`/`data-part` attribute selectors:

```typescript
import '@llui/components/styles/theme.css'
```

Includes design tokens (`@theme`) and enter/exit animations for overlays. Override any token in your own CSS:

```css
@theme {
  --color-primary: #8b5cf6;
  --radius-lg: 1rem;
}
```

For dark mode, import the separate dark theme file **after** Tailwind and theme.css:

```typescript
import '@llui/components/styles/theme-dark.css'
```

This activates automatically via `prefers-color-scheme: dark`. Force light with `<html data-theme="light">`, force dark with `<html data-theme="dark">`. The dark file is separate because Tailwind 4's `@theme` scanner would otherwise merge dark tokens into the root theme.

### JS class helpers — Tailwind utility strings

Each component has a class helper that returns Tailwind utility strings per part, with size/variant props:

```typescript
import { tabsClasses } from '@llui/components/styles/tabs'

const cls = tabsClasses({ size: 'sm', variant: 'pill' })
// cls.root, cls.list, cls.trigger, cls.panel, cls.indicator

div({ ...t.root, class: cls.root }, [
  div({ ...t.list, class: cls.list }, [
    button({ ...t.item('a').trigger, class: cls.trigger }, [text('Tab A')]),
  ]),
  div({ ...t.item('a').panel, class: cls.panel }, [text('Content A')]),
])
```

Or import everything from the barrel:

```typescript
import { tabsClasses, dialogClasses, cx } from '@llui/components/styles'
```

### Variant engine

The `createVariants` utility powers all class helpers and is exported for custom components:

```typescript
import { createVariants, cx } from '@llui/components/styles'

const button = createVariants({
  base: 'inline-flex items-center font-medium',
  variants: {
    size: { sm: 'px-2 py-1 text-sm', md: 'px-4 py-2' },
    intent: { primary: 'bg-primary text-white', ghost: 'bg-transparent' },
  },
  defaultVariants: { size: 'md', intent: 'primary' },
  compoundVariants: [{ size: 'sm', intent: 'ghost', class: 'font-normal' }],
})

button({ size: 'sm', intent: 'ghost' }) // → class string
```

## Imports

Three forms, in order of preference:

```typescript
// ✓ best — sub-path import. Bypasses the barrel entirely; smallest
//          bundle, fastest cold builds (no parse cost for unused
//          components).
import { dialog } from '@llui/components/dialog'

// ✓ ok — named import from the barrel. Tree-shakeable, but the
//          bundler still has to parse every transitively-exported
//          module before it can prove the unused ones are dead.
import { dialog } from '@llui/components'

// ✗ bad — namespace import. Defeats tree-shaking: drags every
//          component's state machine into the bundle. Avoid it —
//          prefer a sub-path or named import.
import * as C from '@llui/components'
```

Every component ships its own entry point — sub-path is the right default
for a new file:

```typescript
import { tabs } from '@llui/components/tabs'
import { dialog } from '@llui/components/dialog'
import { timer } from '@llui/components/timer'
```

## Validation

Input components accept an optional `validate` callback on `ConnectOptions` that gates state changes:

```typescript
const parts = editable.connect<S>(get, send, {
  validate: (value) => {
    if (value.length < 3) return ['Too short']
    return null // valid
  },
})
```

Supported on: editable, number-input, tags-input, pin-input, file-upload.
