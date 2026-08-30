# @llui/components

66 headless UI components for [LLui](../../README.md). Pure state machines with no DOM opinions — you own the markup and styling via `data-scope` / `data-part` attributes.

## Scope & philosophy

Each component is a pure state machine: `init` / `update(state, msg) → [state, effects]` / `connect(state, send) → parts`. The machine owns **behavior** — keyboard interaction, ARIA semantics, selection/focus/validation logic, lifecycle — and nothing else.

What lives in the **machine**:

- Discriminated-union messages and JSON-serializable state (no DOM nodes, timers, or class instances in state).
- ARIA roles/attributes and WAI-ARIA APG keyboard patterns, exposed as reactive `parts` you spread onto your elements.
- Direction-aware keyboard semantics: direction-sensitive components take an optional `dir` (`'ltr' | 'rtl'`) and flip horizontal-arrow keys + logical floating placement accordingly.
- Side effects as **data** — anything async (HTTP, lazy loading, debounce) is returned as an effect for your `onEffect` handler; the machine never performs I/O.

Numeric inputs preserve that JSON-state contract. Grid values use each component's documented
clamping behavior, invalid initialization options fall back to the field's ordinary default, and
runtime position/measurement messages containing `NaN` or infinity are ignored atomically.
Divisors such as pagination `pageSize` and a numeric image-cropper `aspectRatio` must be finite and
greater than zero; `aspectRatio: null` remains the explicit unconstrained crop.

What stays the **consumer's** responsibility (deliberately not shipped):

- Markup and CSS. Components emit `data-scope` / `data-part` / `data-state` hooks; visual styling — including CSS logical-property mirroring for RTL — is yours (an opt-in theme + Tailwind class helpers are available under `@llui/components/styles/*`).
- Driving time and observers: `setInterval`/`requestAnimationFrame` ticks (timer, toast countdown), `IntersectionObserver` (in-view, async-list sentinel, toc scroll-spy), and pointer-event wiring for drag (sortable, slider, carousel swipe, image-cropper) — the machine exposes pure helpers and tick/drag messages; you own the listeners.
- Bring-your-own heavy deps: a QR encoder (qr-code), canvas rendering (signature-pad), and the actual data fetch behind every `load*` effect.
- Exit-animation timing: overlays expose a `'closing'` `data-state` + `isPresent` and wait for an `animationend`; the CSS transition itself is yours (and unmount is synchronous when no animation is configured).

**Roadmap.** There's no frozen set — planned enhancements and new components are tracked as GitHub issues under the [`components`](https://github.com/fponticelli/llui/labels/components) label.

## Install

```bash
pnpm add @llui/components @llui/dom @llui/interactions
```

Peer dependencies: `@llui/dom` and `@llui/interactions`. Both carry shared runtime registries,
so the application and its libraries must resolve one instance of each.

## Usage

Each component exports `init`, `update`, `connect`, and a barrel object:

```typescript
import { component, div, button, text } from '@llui/dom'
import { tabs } from '@llui/components/tabs'

type State = { tabs: tabs.TabsState }
type Msg = { type: 'tabs'; msg: tabs.TabsMsg }

const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ tabs: tabs.init({ items: ['a', 'b', 'c'], value: 'a' }) }, []],
  update: (s, m) => {
    const [t] = tabs.update(s.tabs, m.msg)
    return [{ ...s, tabs: t }, []]
  },
  view: ({ state, send }) => {
    const t = tabs.connect(state.at('tabs'), (m) => send({ type: 'tabs', msg: m }), { id: 'demo' })
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
3. **`connect(state: Signal<Slice>, send, opts?)`** — takes a signal handle for the component's state slice (e.g. `state.at('tabs')`), returns parts objects with reactive props, ARIA attributes, and event handlers. Spread parts onto your elements: `div({ ...parts.root }, [...])`
4. **Overlay helpers** (dialog, popover, menu, etc.) — `overlay()` wires up portals, focus traps, dismiss layers, and positioning

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
- APG grid keyboard nav (arrows, Home/End, Ctrl+Home/End, PageUp/Down, Space to select the row, Enter to activate) with a single roving tab stop; works with rows rendered via each or virtualEach.
- **The header row is part of the roving sequence** (`rowIndex: -1`, exported as `TABLE_HEADER_ROW_INDEX`), as in APG's data-grid examples where "the column headers are focusable because the columns provide sort functionality". Arrow up from row 0 to reach it; Enter/Space there toggles that column's sort. It is also the grid's tab stop when there are no rows at all, so an empty grid stays reachable.
- **Select-all is reached through the header.** `selectAllCheckbox(columnId)` takes the id of the column whose `columnheader` hosts it, and Enter/Space on that focused header sends `toggleAll`. The id is a required argument rather than a `connect()` option precisely because the checkbox is keyboard-unreachable without it: as an option it could be forgotten, and forgetting it failed silently. Where the named column is also `sortable`, select-all wins on Enter/Space in `multiple` mode and the header falls back to sorting in every other mode — put the checkbox in a column of its own to avoid the ambiguity. A `columnId` not present in `columns` never takes the roving stop and never toggles.
- The checkbox parts carry `tabindex="-1"` by design. A `role="grid"` has exactly ONE tab stop, so every selection control is operated from the roving cell or header — Space on the cell for the row, Enter/Space on the select-all header for all of them. Their own Space handlers still apply when a checkbox is focused programmatically.
- Ctrl/Cmd+A is deliberately **not** bound. APG's "Control + A: selects all cells" is a cell-selection idiom; this grid selects _rows_ and `toggleAll` toggles rather than selects, so binding it would hijack the browser's select-all for different semantics.

- **Breadcrumbs** — hierarchical navigation trail with WAI-ARIA landmark/list semantics, `aria-current="page"` on the active (last) item, and automatic middle-collapse to `first … last N items` (with an expandable ellipsis trigger) when `maxVisible` is exceeded.
- meter — role="meter" gauge for a scalar measurement within a known range (disk usage, battery, a lab result against its reference range), distinct from progressbar. Reports aria-valuemin/max/now plus a formatted aria-valuetext that NAMES the band the reading is in. State carries `bands` — N named regions, each with its own tone, laid out across the track and exposed as `parts.bands` / `parts.band(id)` with a `marker` at the reading; `low`/`high`/`optimum` are init options compiling to the native three segments. `data-state` is the current band's tone (`optimal` / `suboptimal` / `critical` / `neutral`). Read-only (no keyboard).

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

Shared helpers used internally and exported for advanced use. New code that needs interaction
primitives without component machines should install `@llui/interactions` and import them directly:

```ts
import { attachFloating, pushDismissable, pushFocusTrap } from '@llui/interactions'
```

The existing `@llui/components/utils` subpath remains supported for compatibility and is
tree-shakeable: importing it does not pull component modules into the bundle.

Granular utility and formatter subpaths are also available when a library wants to expose the
smallest possible dependency edge:

```ts
import { TreeCollection } from '@llui/components/utils/tree-collection'
import { formatNumber } from '@llui/components/format/format-number'
```

The formatter extraction question from
[#49](https://github.com/fponticelli/llui/issues/49) was evaluated separately. The in-repo
runtime consumers are the dashboard and i18n-lazy examples, which also import LLui component
machines, plus the date-picker implementation inside this package. GitHub code searches for
`@llui/components/format`, `@llui/components/format/format-number`, and external root imports of
`formatNumber` found no standalone consumer. Without a separate install-graph use case, the
formatters remain in `@llui/components`; the granular `./format/*` exports keep that decision
reversible without making consumers pull the component graph.

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
| `nested-layer`   | `registerNestedLayer` — count a sibling-portal overlay as "inside"       |

### Nested overlays inside a dialog (`registerNestedLayer`)

The three "outside-aware" utilities above (`dismissable`, `aria-hidden`, `focus-trap`) define _inside_ as a single content element. But an interactive overlay opened from within a dialog — a `select` listbox, a markdown-editor floating toolbar, any typeahead/menu — is often `portal()`-ed to a **body-level sibling**, so it is logically nested but physically _outside_ the dialog's content. Left unhandled, clicking it dismisses the dialog, `inert` makes it dead, and Tab can't reach it.

A portaled surface declares both its portal root and the element it logically belongs to:

```ts
onMount((owner) => registerNestedLayer(() => overlayRootElement(), { owner }))
```

While registered, the element (and its descendants) is treated as inside only for an asking layer that contains `owner`, directly or through another nested layer. Prefer resolver forms for live portal roots and owners. Missing or unresolved ownership fails closed: it grants no scoped focus/modal/outside exemption and warns once per registration in development. Unscoped `getNestedLayers()` remains a registry-wide inspection view.

**Registration is per-aspect and per-owner.** A registration names the aspects it participates in — `outside` (`dismissable`), `focus` (`focus-trap`), `hide` (`aria-hidden`) — defaulting to all three. It is exempt only when its owner belongs to the asking layer. This preserves transitive nesting without letting an unrelated or unattributable portal escape every modal on the page.

`@llui/components`' own non-modal portaled overlays (`popover`/`select`/`combobox`/`menu`/`context-menu`/`menubar`/`hover-card`/`tooltip`/`searchable-select`) register themselves automatically while open, for `focus` + `hide` only: their outside-click cooperation comes from the dismissable **stack**, which is ordered (only the topmost layer claims an outside-click) and therefore strictly better than the registry's global answer. The exception is an overlay that pushes no dismissable layer at all — a `tooltip` with `closeOnEscape: false` — which registers `outside` too, because nothing on the stack speaks for it.

**Modal surfaces (`dialog`, `drawer`, a `popover` with `trapFocus`) never register.** They are the layer everything else nests _inside_; registering one would let a trap on the layer beneath Tab into it, and would make its own **content** read as "inside a nested layer" for an overlay open on top of it — a click anywhere in the dialog's panel would stop dismissing an inner `select`. (The registered element is the overlay's `content`, and `dialog` renders `backdrop`, `positioner` and `content` as three separate parts, so the dialog's _background_ is outside the registration either way.) Their place in the ordering comes from always occupying the dismissable stack — including when both `closeOnEscape` and `closeOnOutsideClick` are `false`, where the layer claims nothing but still stops the layer beneath from misreading a click inside the modal as an outside interaction.

**`hide` is weaker than `focus`.** `aria-hidden` snapshots its exempt set once, when the sweep runs, and nothing re-runs it. A registration therefore only reaches the sweep if it is live _before_ the modal opens — in the usual ordering (dialog opens, then a select inside it) the select's portal content does not exist yet. `focus-trap` re-reads the registry on every Tab, so `focus` is the half that actually carries a non-modal overlay's registration.

### Live regions and the modal sweep

`aria-hidden` never hides a **live region** — `aria-live="polite"`/`"assertive"`, `role="alert"`, `role="status"`, `role="log"`, and `<output>` (implicit `role="status"`, unless it carries an explicit `role`) — because a hidden live region is simply never read out, so a toast raised while a dialog is open would be silent for screen-reader users. This needs no registration and covers your own regions as well as `toast`/`async-list`/`clipboard`/`date-input`/`field`. Exemption is precise: the sweep descends through an ancestor that merely _contains_ a live region and still hides everything hanging off the path down to it.

Two caveats. **`inert` cannot be split from `aria-hidden`**, so an exempt region keeps its whole subtree reachable: a `role="log"` transcript containing links is Tab-reachable from behind a modal. Keep live regions to announcement text and put controls outside them. And **the match does not pierce shadow roots** — a live region inside one is not exempt (the sweep only walks light-DOM ancestors of the modal, so this bites only when the two live in different trees).

### Escape and the dismissable stack

Escape is offered to the layers top-down until one **claims** it. A layer declines by setting `disableEscape` or returning `false` from its `onEscape` router; the key then falls through to the layer beneath instead of being swallowed.

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

// ✓ ok — named component-object import from the root. The root uses
//          named leaf re-exports, so unrelated components tree-shake.
//          A subpath still avoids parsing the aggregate export surface.
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
const parts = editable.connect(state.at('name'), send, {
  validate: (value) => {
    if (value.length < 3) return ['Too short']
    return null // valid
  },
})
```

Supported on: editable, number-input, tags-input, pin-input, file-upload.
