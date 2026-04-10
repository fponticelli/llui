---
title: '@llui/components'
description: '54 headless components + opt-in CSS theme and Tailwind class helpers'
---

# @llui/components

54 headless UI components for [LLui](../../README.md). Pure state machines with no DOM opinions -- you own the markup and styling via `data-scope` / `data-part` attributes.

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

1. **`init(opts?)`** -- creates the initial state
2. **`update(state, msg)`** -- pure reducer, returns `[newState, effects[]]`
3. **`connect(get, send, opts?)`** -- returns parts objects with reactive props, ARIA attributes, and event handlers. Spread parts onto your elements: `div({ ...parts.root }, [...])`
4. **Overlay helpers** (dialog, popover, menu, etc.) -- `overlay()` wires up portals, focus traps, dismiss layers, and positioning

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

## Components (54)

### Form controls

accordion, checkbox, collapsible, editable, number-input, password-input, pin-input, radio-group, rating-group, slider, switch, tabs, tags-input, toggle, toggle-group

### Overlays

alert-dialog, combobox, context-menu, dialog, drawer, hover-card, menu, navigation-menu, popover, select, toast, tooltip, tour

### Data display

async-list, avatar, carousel, cascade-select, listbox, pagination, progress, qr-code, scroll-area, steps, toc, tree-view

### Pickers

color-picker, date-input, date-picker, time-picker, angle-slider

### Media / canvas

file-upload, floating-panel, image-cropper, marquee, presence, signature-pad, timer

### Patterns

`@llui/components/patterns/confirm-dialog` -- pre-wired alert-dialog for destructive confirmations.

## Utilities

Shared helpers used internally and exported for advanced use:

| Utility          | Purpose                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `typeahead`      | First-letter search across menu, select, listbox, tree-view               |
| `TreeCollection` | Indexed tree traversal -- visibleItems, labels, indeterminate computation |
| `floating`       | `@floating-ui/dom` wrapper for popover/menu positioning                   |
| `focus-trap`     | Stack-based focus containment for modals                                  |
| `dismissable`    | Esc / outside-click dismiss layer stack                                   |
| `aria-hidden`    | `aria-hidden` on siblings of a modal for screen readers                   |
| `remove-scroll`  | Body scroll lock for modals/drawers                                       |

## Styling (opt-in)

Components are fully headless by default. An opt-in styling layer provides two complementary mechanisms:

### CSS theme -- `theme.css`

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

### JS class helpers -- Tailwind utility strings

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

button({ size: 'sm', intent: 'ghost' }) // -> class string
```

## Sub-path imports

Every component has its own entry point for tree-shaking:

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

<!-- auto-api:start -->

## Component Reference

All 55 components follow the same pattern:

```typescript
import { componentName } from '@llui/components/component-name'

// State machine
const state = componentName.init({
  /* options */
})
const [newState, effects] = componentName.update(state, msg)

// Connect to DOM
const parts = componentName.connect<State>((s) => s.field, send, { id: '...' })
// Use parts: div({ ...parts.root }, [button({ ...parts.trigger }, [...])])
```

---

### Accordion

**State** (`AccordionState`):

| Field         | Type       |
| ------------- | ---------- |
| `value`       | `string[]` |
| `multiple`    | `boolean`  |
| `collapsible` | `boolean`  |
| `disabled`    | `boolean`  |
| `items`       | `string[]` |

**Messages:** `toggle`, `open`, `close`, `setValue`, `setItems`, `focusNext`, `focusPrev`, `focusFirst`, `focusLast`

**Init options:** `value?: string[], multiple?: boolean, collapsible?: boolean, disabled?: boolean, items?: string[]`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `item`

**Utilities:** `focusTarget()`

---

### Alert Dialog

**State:** `AlertDialogState` (see parent component)

**Connect options:** `AlertDialogConnectOptions`

---

### Angle Slider

**State** (`AngleSliderState`):

| Field      | Type      |
| ---------- | --------- |
| `value`    | `number`  |
| `min`      | `number`  |
| `max`      | `number`  |
| `step`     | `number`  |
| `disabled` | `boolean` |
| `readOnly` | `boolean` |

**Messages:** `setValue`, `increment`, `decrement`, `setMin`, `setMax`

**Init options:** `value?: number, min?: number, max?: number, step?: number, disabled?: boolean, readOnly?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `control`, `thumb`, `valueText`, `hiddenInput`

---

### Async List

**State** (`AsyncListState`):

| Field     | Type             |
| --------- | ---------------- |
| `items`   | `T[]`            |
| `page`    | `number`         |
| `hasMore` | `boolean`        |
| `status`  | `AsyncStatus`    |
| `error`   | `string \| null` |

**Messages:** `loadMore`, `pageLoaded`, `pageFailed`, `reset`, `setItems`, `retry`

**Init options:** `items?: T[], page?: number, hasMore?: boolean`

**Parts:** `root`, `sentinel`, `loadMoreTrigger`, `retryTrigger`, `errorText`

---

### Avatar

**State** (`AvatarState`):

| Field    | Type          |
| -------- | ------------- |
| `status` | `ImageStatus` |

**Messages:** `loadStart`, `loaded`, `error`, `reset`

**Init options:** `status?: ImageStatus`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `image`, `fallback`

---

### Carousel

**State** (`CarouselState`):

| Field       | Type                      |
| ----------- | ------------------------- |
| `current`   | `number`                  |
| `count`     | `number`                  |
| `loop`      | `boolean`                 |
| `autoplay`  | `boolean`                 |
| `interval`  | `number`                  |
| `paused`    | `boolean`                 |
| `direction` | `'forward' \| 'backward'` |

**Messages:** `goTo`, `next`, `prev`, `setCount`, `pause`, `resume`, `setAutoplay`

**Init options:** `current?: number, count?: number, loop?: boolean, autoplay?: boolean, interval?: number`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `viewport`, `indicatorGroup`, `nextTrigger`, `prevTrigger`, `slide`

**Utilities:** `canGoNext()`, `canGoPrev()`

---

### Cascade Select

**State** (`CascadeSelectState`):

| Field      | Type                 |
| ---------- | -------------------- |
| `levels`   | `CascadeLevel[]`     |
| `values`   | `(string \| null)[]` |
| `disabled` | `boolean`            |

**Messages:** `setLevels`, `setValue`, `clear`

**Init options:** `levels?: CascadeLevel[], values?: (string | null)[], disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `clearTrigger`, `level`

---

### Checkbox

**State** (`CheckboxState`):

| Field      | Type           |
| ---------- | -------------- |
| `checked`  | `CheckedState` |
| `disabled` | `boolean`      |
| `required` | `boolean`      |

**Messages:** `toggle`, `setChecked`, `setDisabled`

**Init options:** `checked?: CheckedState, disabled?: boolean, required?: boolean`

**Parts:** `root`, `hiddenInput`, `indicator`

---

### Clipboard

**State** (`ClipboardState`):

| Field    | Type      |
| -------- | --------- |
| `value`  | `string`  |
| `copied` | `boolean` |

**Messages:** `setValue`, `copy`, `copied`, `reset`

**Init options:** `value?: string`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `trigger`, `input`, `indicator`

**Utilities:** `copyToClipboard()`

---

### Collapsible

**State** (`CollapsibleState`):

| Field      | Type      |
| ---------- | --------- |
| `open`     | `boolean` |
| `disabled` | `boolean` |

**Messages:** `toggle`, `open`, `close`, `setOpen`

**Init options:** `open?: boolean, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `trigger`, `content`

---

### Color Picker

**State** (`ColorPickerState`):

| Field      | Type      |
| ---------- | --------- |
| `hsl`      | `Hsl`     |
| `alpha`    | `number`  |
| `disabled` | `boolean` |

**Messages:** `setHsl`, `setHue`, `setSaturation`, `setLightness`, `setAlpha`, `setHex`

**Init options:** `hsl?: Hsl, alpha?: number, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `hueSlider`, `saturationSlider`, `lightnessSlider`, `hexInput`, `swatch`

---

### Combobox

**State** (`ComboboxState`):

| Field              | Type             |
| ------------------ | ---------------- |
| `open`             | `boolean`        |
| `value`            | `string[]`       |
| `inputValue`       | `string`         |
| `items`            | `string[]`       |
| `disabledItems`    | `string[]`       |
| `filteredItems`    | `string[]`       |
| `highlightedIndex` | `number \| null` |
| `selectionMode`    | `SelectionMode`  |
| `disabled`         | `boolean`        |

**Messages:** `open`, `close`, `setInputValue`, `selectOption`, `setValue`, `clear`, `highlightNext`, `highlightPrev`, `highlightFirst`, `highlightLast`, `highlight`, `selectHighlighted`, `setItems`

**Init options:** `value?: string[], inputValue?: string, items?: string[], disabledItems?: string[], selectionMode?: SelectionMode, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `input`, `trigger`, `positioner`, `content`, `item`, `empty`

**Utilities:** `overlay()`

---

### Context Menu

**State** (`ContextMenuState`):

| Field           | Type             |
| --------------- | ---------------- |
| `open`          | `boolean`        |
| `x`             | `number`         |
| `y`             | `number`         |
| `items`         | `string[]`       |
| `disabledItems` | `string[]`       |
| `highlighted`   | `string \| null` |

**Messages:** `openAt`, `close`, `highlight`, `highlightNext`, `highlightPrev`, `selectHighlighted`, `select`, `setItems`

**Init options:** `items?: string[], disabledItems?: string[]`

**Connect options:** `ConnectOptions`

**Parts:** `trigger`, `positioner`, `content`, `item`

---

### Date Input

**State** (`DateInputState`):

| Field      | Type           |
| ---------- | -------------- |
| `input`    | `string`       |
| `value`    | `Date \| null` |
| `min`      | `Date \| null` |
| `max`      | `Date \| null` |
| `error`    | `DateError`    |
| `disabled` | `boolean`      |
| `readOnly` | `boolean`      |
| `required` | `boolean`      |

**Messages:** `setInput`, `setValue`, `clear`, `setMin`, `setMax`, `setDisabled`

**Init options:** `input?: string, value?: Date | null, min?: Date | null, max?: Date | null, disabled?: boolean, readOnly?: boolean, required?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `input`, `clearTrigger`, `errorText`

---

### Date Picker

**State** (`DatePickerState`):

| Field          | Type             |
| -------------- | ---------------- |
| `value`        | `string \| null` |
| `visibleMonth` | `number`         |
| `visibleYear`  | `number`         |
| `focused`      | `string`         |
| `min`          | `string \| null` |
| `max`          | `string \| null` |
| `weekStartsOn` | `0 \| 1`         |
| `disabled`     | `boolean`        |

**Messages:** `setValue`, `setFocused`, `prevMonth`, `nextMonth`, `prevYear`, `nextYear`, `selectFocused`, `moveFocus`, `focusStartOfWeek`, `focusEndOfWeek`, `focusToday`, `clear`

**Init options:** `value?: string | null, visibleMonth?: number, visibleYear?: number, min?: string | null, max?: string | null, weekStartsOn?: 0 | 1, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `grid`, `row`, `prevMonthTrigger`, `nextMonthTrigger`, `dayCell`

---

### Dialog

**State** (`DialogState`):

| Field  | Type      |
| ------ | --------- |
| `open` | `boolean` |

**Messages:** `open`, `close`, `toggle`, `setOpen`

**Init options:** `open?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `trigger`, `backdrop`, `positioner`, `content`, `title`, `description`, `closeTrigger`

**Utilities:** `overlay()`

---

### Drawer

**State** (`DrawerState`):

| Field  | Type      |
| ------ | --------- |
| `open` | `boolean` |

**Messages:** `open`, `close`, `toggle`, `setOpen`

**Init options:** `open?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `trigger`, `backdrop`, `positioner`, `content`, `title`, `description`, `closeTrigger`

**Utilities:** `overlay()`

---

### Editable

**State** (`EditableState`):

| Field      | Type      |
| ---------- | --------- |
| `value`    | `string`  |
| `editing`  | `boolean` |
| `draft`    | `string`  |
| `disabled` | `boolean` |

**Messages:** `edit`, `setDraft`, `submit`, `cancel`, `setValue`

**Init options:** `value?: string, editing?: boolean, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `preview`, `input`, `submitTrigger`, `cancelTrigger`, `editTrigger`

---

### File Upload

**State** (`FileUploadState`):

| Field           | Type             |
| --------------- | ---------------- |
| `files`         | `File[]`         |
| `rejectedFiles` | `RejectedFile[]` |
| `disabled`      | `boolean`        |
| `multiple`      | `boolean`        |
| `accept`        | `AcceptValue`    |
| `maxFiles`      | `number`         |
| `maxSize`       | `number`         |
| `minFileSize`   | `number`         |
| `required`      | `boolean`        |
| `readOnly`      | `boolean`        |
| `invalid`       | `boolean`        |
| `dragging`      | `boolean`        |

**Messages:** `setFiles`, `addFiles`, `removeFile`, `removeRejected`, `clear`, `clearRejected`, `dragEnter`, `dragLeave`, `drop`, `setInvalid`

**Init options:** `files?: File[], disabled?: boolean, multiple?: boolean, accept?: AcceptValue, maxFiles?: number, maxSize?: number, minFileSize?: number, required?: boolean, readOnly?: boolean, invalid?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `dropzone`, `trigger`, `hiddenInput`, `label`, `clearTrigger`, `itemGroup`, `item`

---

### Floating Panel

**State** (`FloatingPanelState`):

| Field           | Type                                                              |
| --------------- | ----------------------------------------------------------------- |
| `position`      | `{ x: number; y: number }`                                        |
| `size`          | `{ width: number; height: number }`                               |
| `minSize`       | `{ width: number; height: number }`                               |
| `maxSize`       | `{ width: number; height: number } \| null`                       |
| `open`          | `boolean`                                                         |
| `minimized`     | `boolean`                                                         |
| `maximized`     | `boolean`                                                         |
| `dragging`      | `boolean`                                                         |
| `resizing`      | `ResizeHandle \| null`                                            |
| `restoreBounds` | `{ x: number; y: number; width: number; height: number } \| null` |
| `disabled`      | `boolean`                                                         |

**Messages:** `open`, `close`, `minimize`, `restoreFromMinimized`, `maximize`, `restoreFromMaximized`, `toggleMinimize`, `toggleMaximize`, `dragStart`, `dragMove`, `dragEnd`, `resizeStart`, `resizeMove`, `resizeEnd`, `setPosition`, `setSize`

**Init options:** `position?: { x: number; y: number }, size?: { width: number; height: number }, minSize?: { width: number; height: number }, maxSize?: { width: number; height: number } | null, open?: boolean, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `dragHandle`, `content`, `minimizeTrigger`, `maximizeTrigger`, `closeTrigger`, `resizeHandle`

---

### Hover Card

**State** (`HoverCardState`):

| Field  | Type      |
| ------ | --------- |
| `open` | `boolean` |

**Messages:** `show`, `hide`, `setOpen`

**Init options:** `open?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `trigger`, `positioner`, `content`, `arrow`

---

### Image Cropper

**State** (`ImageCropperState`):

| Field         | Type                                |
| ------------- | ----------------------------------- |
| `image`       | `{ width: number; height: number }` |
| `crop`        | `CropRect`                          |
| `aspectRatio` | `number \| null`                    |
| `minSize`     | `number`                            |
| `dragging`    | `boolean`                           |
| `resizing`    | `ResizeHandle \| null`              |
| `disabled`    | `boolean`                           |

**Messages:** `setImage`, `setCrop`, `setAspectRatio`, `dragStart`, `dragMove`, `dragEnd`, `resizeStart`, `resizeMove`, `resizeEnd`, `reset`, `centerFill`

**Init options:** `image?: { width: number; height: number }, crop?: CropRect, aspectRatio?: number | null, minSize?: number, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `image`, `cropBox`, `resizeHandle`, `resetTrigger`

---

### In View

**State** (`InViewState`):

| Field     | Type      |
| --------- | --------- |
| `visible` | `boolean` |

**Messages:** `enter`, `leave`

**Connect options:** `ConnectOptions`

**Parts:** `root`

---

### Listbox

**State** (`ListboxState`):

| Field                | Type             |
| -------------------- | ---------------- |
| `value`              | `string[]`       |
| `items`              | `string[]`       |
| `disabledItems`      | `string[]`       |
| `disabled`           | `boolean`        |
| `selectionMode`      | `SelectionMode`  |
| `highlightedIndex`   | `number \| null` |
| `typeahead`          | `string`         |
| `typeaheadExpiresAt` | `number`         |

**Messages:** `select`, `setValue`, `clear`, `highlight`, `highlightNext`, `highlightPrev`, `highlightFirst`, `highlightLast`, `selectHighlighted`, `setItems`, `typeahead`

**Init options:** `value?: string[], items?: string[], disabledItems?: string[], disabled?: boolean, selectionMode?: SelectionMode`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `item`

---

### Marquee

**State** (`MarqueeState`):

| Field          | Type               |
| -------------- | ------------------ |
| `running`      | `boolean`          |
| `direction`    | `MarqueeDirection` |
| `durationSec`  | `number`           |
| `pauseOnHover` | `boolean`          |
| `hovered`      | `boolean`          |
| `disabled`     | `boolean`          |

**Messages:** `play`, `pause`, `toggle`, `hoverPause`, `hoverResume`, `setDirection`, `setDuration`

**Init options:** `running?: boolean, direction?: MarqueeDirection, durationSec?: number, pauseOnHover?: boolean, disabled?: boolean`

**Parts:** `root`, `content`

**Utilities:** `isRunning()`, `cssAnimationDirection()`, `axis()`

---

### Menu

**State** (`MenuState`):

| Field                | Type             |
| -------------------- | ---------------- |
| `open`               | `boolean`        |
| `items`              | `string[]`       |
| `disabledItems`      | `string[]`       |
| `highlighted`        | `string \| null` |
| `typeahead`          | `string`         |
| `typeaheadExpiresAt` | `number`         |

**Messages:** `open`, `close`, `toggle`, `highlight`, `highlightNext`, `highlightPrev`, `highlightFirst`, `highlightLast`, `selectHighlighted`, `select`, `setItems`, `typeahead`

**Init options:** `open?: boolean, items?: string[], disabledItems?: string[], highlighted?: string | null`

**Connect options:** `ConnectOptions`

**Parts:** `trigger`, `positioner`, `content`, `item`

**Utilities:** `overlay()`

---

### Navigation Menu

**State** (`NavMenuState`):

| Field      | Type             |
| ---------- | ---------------- |
| `open`     | `string[]`       |
| `focused`  | `string \| null` |
| `disabled` | `boolean`        |

**Messages:** `openBranch`, `closeBranch`, `toggleBranch`, `closeAll`, `focus`

**Init options:** `open?: string[], focused?: string | null, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `item`

---

### Number Input

**State** (`NumberInputState`):

| Field      | Type             |
| ---------- | ---------------- |
| `value`    | `number \| null` |
| `min`      | `number`         |
| `max`      | `number`         |
| `step`     | `number`         |
| `disabled` | `boolean`        |
| `readOnly` | `boolean`        |
| `rawText`  | `string`         |

**Messages:** `setValue`, `setRawText`, `commit`, `increment`, `decrement`, `toMin`, `toMax`, `setDisabled`

**Init options:** `value?: number | null, min?: number, max?: number, step?: number, disabled?: boolean, readOnly?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `input`, `increment`, `decrement`

---

### Pagination

**State** (`PaginationState`):

| Field        | Type      |
| ------------ | --------- |
| `page`       | `number`  |
| `pageSize`   | `number`  |
| `total`      | `number`  |
| `siblings`   | `number`  |
| `boundaries` | `number`  |
| `disabled`   | `boolean` |

**Messages:** `goTo`, `next`, `prev`, `first`, `last`, `setPageSize`, `setTotal`

**Init options:** `page?: number, pageSize?: number, total?: number, siblings?: number, boundaries?: number, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `prevTrigger`, `nextTrigger`, `item`, `ellipsis`

**Utilities:** `totalPages()`, `pageItems()`

---

### Password Input

**State** (`PasswordInputState`):

| Field      | Type      |
| ---------- | --------- |
| `value`    | `string`  |
| `visible`  | `boolean` |
| `disabled` | `boolean` |

**Messages:** `setValue`, `toggleVisibility`, `setVisible`

**Init options:** `value?: string, visible?: boolean, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `input`, `visibilityTrigger`

---

### Pin Input

**State** (`PinInputState`):

| Field          | Type       |
| -------------- | ---------- |
| `values`       | `string[]` |
| `length`       | `number`   |
| `type`         | `PinType`  |
| `mask`         | `boolean`  |
| `disabled`     | `boolean`  |
| `focusedIndex` | `number`   |

**Messages:** `setValue`, `setAll`, `focus`, `clear`, `backspace`

**Init options:** `length?: number, type?: PinType, mask?: boolean, disabled?: boolean, values?: string[]`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `label`, `input`

---

### Popover

**State** (`PopoverState`):

| Field  | Type      |
| ------ | --------- |
| `open` | `boolean` |

**Messages:** `open`, `close`, `toggle`, `setOpen`

**Init options:** `open?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `trigger`, `positioner`, `content`, `title`, `description`, `arrow`, `closeTrigger`

**Utilities:** `overlay()`

---

### Presence

**State** (`PresenceState`):

| Field           | Type             |
| --------------- | ---------------- |
| `status`        | `PresenceStatus` |
| `unmountOnExit` | `boolean`        |

**Messages:** `open`, `close`, `toggle`, `animationEnd`, `setPresent`

**Init options:** `present?: boolean, unmountOnExit?: boolean`

**Parts:** `root`

**Utilities:** `isMounted()`, `isVisible()`, `isAnimating()`

---

### Progress

**State** (`ProgressState`):

| Field         | Type                  |
| ------------- | --------------------- |
| `value`       | `number \| null`      |
| `min`         | `number`              |
| `max`         | `number`              |
| `orientation` | `ProgressOrientation` |

**Messages:** `setValue`, `setMax`

**Init options:** `value?: number | null, min?: number, max?: number, orientation?: ProgressOrientation`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `track`, `range`, `label`, `valueText`

**Utilities:** `percent()`, `valueState()`

---

### Qr Code

**State** (`QrCodeState`):

| Field             | Type                   |
| ----------------- | ---------------------- |
| `value`           | `string`               |
| `matrix`          | `boolean[][]`          |
| `errorCorrection` | `ErrorCorrectionLevel` |

**Messages:** `setValue`, `setMatrix`, `setErrorCorrection`

**Init options:** `value?: string, matrix?: boolean[][], errorCorrection?: ErrorCorrectionLevel`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `svg`, `background`, `foreground`, `downloadTrigger`

---

### Radio Group

**State** (`RadioGroupState`):

| Field           | Type             |
| --------------- | ---------------- |
| `value`         | `string \| null` |
| `items`         | `string[]`       |
| `disabledItems` | `string[]`       |
| `disabled`      | `boolean`        |
| `orientation`   | `Orientation`    |

**Messages:** `setValue`, `setItems`, `selectNext`, `selectPrev`, `selectFirst`, `selectLast`

**Init options:** `value?: string | null, items?: string[], disabledItems?: string[], disabled?: boolean, orientation?: Orientation`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `item`

---

### Rating Group

**State** (`RatingGroupState`):

| Field          | Type             |
| -------------- | ---------------- |
| `value`        | `number`         |
| `count`        | `number`         |
| `allowHalf`    | `boolean`        |
| `disabled`     | `boolean`        |
| `readOnly`     | `boolean`        |
| `hoveredValue` | `number \| null` |

**Messages:** `setValue`, `hover`, `clickItem`, `hoverItem`, `incrementValue`, `decrementValue`, `toEnd`

**Init options:** `value?: number, count?: number, allowHalf?: boolean, disabled?: boolean, readOnly?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `item`

---

### Scroll Area

**State** (`ScrollAreaState`):

| Field        | Type                  |
| ------------ | --------------------- |
| `overflowX`  | `boolean`             |
| `overflowY`  | `boolean`             |
| `scrolling`  | `boolean`             |
| `hovered`    | `boolean`             |
| `visibility` | `ScrollbarVisibility` |

**Messages:** `setScroll`, `setScrolling`, `setHovered`

**Init options:** `visibility?: ScrollbarVisibility`

**Parts:** `root`, `viewport`, `content`, `scrollbarX`, `scrollbarY`, `thumbX`, `thumbY`, `corner`

---

### Select

**State** (`SelectState`):

| Field                | Type             |
| -------------------- | ---------------- |
| `open`               | `boolean`        |
| `value`              | `string[]`       |
| `items`              | `string[]`       |
| `disabledItems`      | `string[]`       |
| `selectionMode`      | `SelectionMode`  |
| `highlightedIndex`   | `number \| null` |
| `disabled`           | `boolean`        |
| `required`           | `boolean`        |
| `typeahead`          | `string`         |
| `typeaheadExpiresAt` | `number`         |

**Messages:** `open`, `close`, `toggle`, `selectOption`, `setValue`, `clear`, `highlight`, `highlightNext`, `highlightPrev`, `highlightFirst`, `highlightLast`, `selectHighlighted`, `setItems`, `typeahead`

**Init options:** `value?: string[], items?: string[], disabledItems?: string[], selectionMode?: SelectionMode, disabled?: boolean, required?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `trigger`, `positioner`, `content`, `hiddenSelect`, `item`, `valueText`

**Utilities:** `overlay()`

---

### Signature Pad

**State** (`SignaturePadState`):

| Field      | Type             |
| ---------- | ---------------- |
| `strokes`  | `Stroke[]`       |
| `current`  | `Stroke \| null` |
| `drawing`  | `boolean`        |
| `disabled` | `boolean`        |
| `readOnly` | `boolean`        |

**Messages:** `strokeStart`, `strokePoint`, `strokeEnd`, `strokeCancel`, `undo`, `redo`, `clear`, `setStrokes`

**Init options:** `strokes?: Stroke[], disabled?: boolean, readOnly?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `control`, `clearTrigger`, `undoTrigger`, `guide`, `hiddenInput`

---

### Slider

**State** (`SliderState`):

| Field                   | Type          |
| ----------------------- | ------------- |
| `value`                 | `number[]`    |
| `min`                   | `number`      |
| `max`                   | `number`      |
| `step`                  | `number`      |
| `disabled`              | `boolean`     |
| `orientation`           | `Orientation` |
| `minStepsBetweenThumbs` | `number`      |

**Messages:** `setValue`, `setThumb`, `increment`, `decrement`, `toMin`, `toMax`, `setDisabled`

**Init options:** `value?: number[], min?: number, max?: number, step?: number, disabled?: boolean, orientation?: Orientation, minStepsBetweenThumbs?: number`

**Parts:** `thumb`, `root`, `control`, `track`, `range`, `thumb`, `value`

**Utilities:** `valueFromPoint()`, `closestThumbIndex()`

---

### Splitter

**State** (`SplitterState`):

| Field         | Type          |
| ------------- | ------------- |
| `position`    | `number`      |
| `min`         | `number`      |
| `max`         | `number`      |
| `step`        | `number`      |
| `orientation` | `Orientation` |
| `disabled`    | `boolean`     |
| `dragging`    | `boolean`     |

**Messages:** `setPosition`, `increment`, `decrement`, `toMin`, `toMax`, `startDrag`, `endDrag`

**Init options:** `position?: number, min?: number, max?: number, step?: number, orientation?: Orientation, disabled?: boolean`

**Parts:** `root`, `primaryPanel`, `secondaryPanel`, `resizeTrigger`

**Utilities:** `positionFromPoint()`

---

### Steps

**State** (`StepsState`):

| Field       | Type       |
| ----------- | ---------- |
| `current`   | `number`   |
| `completed` | `number[]` |
| `errors`    | `number[]` |
| `steps`     | `string[]` |
| `linear`    | `boolean`  |
| `disabled`  | `boolean`  |

**Messages:** `goTo`, `next`, `prev`, `complete`, `markError`, `clearError`, `reset`

**Init options:** `current?: number, completed?: number[], steps?: string[], linear?: boolean, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `nextTrigger`, `prevTrigger`, `item`

**Utilities:** `stepStatus()`

---

### Switch

**State** (`SwitchState`):

| Field      | Type      |
| ---------- | --------- |
| `checked`  | `boolean` |
| `disabled` | `boolean` |

**Messages:** `toggle`, `setChecked`, `setDisabled`

**Init options:** `checked?: boolean, disabled?: boolean`

**Parts:** `root`, `track`, `thumb`, `hiddenInput`

---

### Tabs

**State** (`TabsState`):

| Field           | Type             |
| --------------- | ---------------- |
| `value`         | `string`         |
| `items`         | `string[]`       |
| `disabledItems` | `string[]`       |
| `orientation`   | `Orientation`    |
| `activation`    | `Activation`     |
| `focused`       | `string \| null` |
| `loopFocus`     | `boolean`        |
| `deselectable`  | `boolean`        |

**Messages:** `setValue`, `setItems`, `focusTab`, `focusNext`, `focusPrev`, `focusFirst`, `focusLast`, `activateFocused`

**Init options:** `value?: string, items?: string[], disabledItems?: string[], orientation?: Orientation, activation?: Activation, loopFocus?: boolean, deselectable?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `list`, `indicator`, `item`

**Utilities:** `watchTabIndicator()`

---

### Tags Input

**State** (`TagsInputState`):

| Field          | Type             |
| -------------- | ---------------- |
| `value`        | `string[]`       |
| `inputValue`   | `string`         |
| `disabled`     | `boolean`        |
| `max`          | `number`         |
| `unique`       | `boolean`        |
| `focusedIndex` | `number \| null` |

**Messages:** `setInput`, `addTag`, `removeTag`, `removeLast`, `setValue`, `focusTag`, `focusTagNext`, `focusTagPrev`, `clearAll`

**Init options:** `value?: string[], inputValue?: string, disabled?: boolean, max?: number, unique?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `input`, `tag`, `clearTrigger`

---

### Time Picker

**State** (`TimePickerState`):

| Field         | Type         |
| ------------- | ------------ |
| `value`       | `TimeValue`  |
| `format`      | `TimeFormat` |
| `minuteStep`  | `number`     |
| `secondStep`  | `number`     |
| `showSeconds` | `boolean`    |
| `disabled`    | `boolean`    |

**Messages:** `setValue`, `setHours`, `setMinutes`, `setSeconds`, `incrementHours`, `decrementHours`, `incrementMinutes`, `decrementMinutes`, `toggleAmPm`

**Init options:** `value?: TimeValue, format?: TimeFormat, minuteStep?: number, secondStep?: number, showSeconds?: boolean, disabled?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `hoursInput`, `minutesInput`, `periodTrigger`

---

### Timer

**State** (`TimerState`):

| Field       | Type             |
| ----------- | ---------------- |
| `running`   | `boolean`        |
| `direction` | `Direction`      |
| `targetMs`  | `number`         |
| `elapsedMs` | `number`         |
| `startedAt` | `number \| null` |

**Messages:** `start`, `pause`, `reset`, `tick`, `setTarget`

**Init options:** `direction?: Direction, targetMs?: number, elapsedMs?: number`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `display`, `startTrigger`, `pauseTrigger`, `resetTrigger`

**Utilities:** `display()`, `isComplete()`, `parts()`, `formatMs()`

---

### Toast

**State** (`ToasterState`):

| Field       | Type             |
| ----------- | ---------------- |
| `toasts`    | `Toast[]`        |
| `max`       | `number`         |
| `placement` | `ToastPlacement` |

**Messages:** `create`, `dismiss`, `dismissAll`, `update`, `pause`, `resume`, `pauseAll`, `resumeAll`

**Init options:** `max?: number, placement?: ToastPlacement`

**Connect options:** `ConnectOptions`

**Parts:** `region`, `toast`

**Utilities:** `nextToastId()`

---

### Toc

**State** (`TocState`):

| Field      | Type             |
| ---------- | ---------------- |
| `items`    | `TocEntry[]`     |
| `activeId` | `string \| null` |
| `expanded` | `string[]`       |

**Messages:** `setItems`, `setActive`, `toggleExpanded`, `expandAll`, `collapseAll`

**Init options:** `items?: TocEntry[], activeId?: string | null, expanded?: string[]`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `list`, `item`

**Utilities:** `isActive()`, `isExpanded()`, `watchActiveHeading()`

---

### Toggle Group

**State** (`ToggleGroupState`):

| Field           | Type                     |
| --------------- | ------------------------ |
| `value`         | `string[]`               |
| `type`          | `'single' \| 'multiple'` |
| `items`         | `string[]`               |
| `disabledItems` | `string[]`               |
| `disabled`      | `boolean`                |
| `orientation`   | `Orientation`            |
| `deselectable`  | `boolean`                |

**Messages:** `toggle`, `setValue`, `setItems`, `focusNext`, `focusPrev`

**Init options:** `value?: string[], type?: 'single' | 'multiple', items?: string[], disabledItems?: string[], disabled?: boolean, orientation?: Orientation, deselectable?: boolean`

**Parts:** `root`, `item`

---

### Toggle

**State** (`ToggleState`):

| Field      | Type      |
| ---------- | --------- |
| `pressed`  | `boolean` |
| `disabled` | `boolean` |

**Messages:** `toggle`, `setPressed`, `setDisabled`

**Init options:** `pressed?: boolean, disabled?: boolean`

**Parts:** `root`

---

### Tooltip

**State** (`TooltipState`):

| Field  | Type      |
| ------ | --------- |
| `open` | `boolean` |

**Messages:** `show`, `hide`, `toggle`, `setOpen`

**Init options:** `open?: boolean`

**Connect options:** `ConnectOptions`

**Parts:** `trigger`, `positioner`, `content`, `arrow`

**Utilities:** `overlay()`

---

### Tour

**State** (`TourState`):

| Field     | Type         |
| --------- | ------------ |
| `steps`   | `TourStep[]` |
| `open`    | `boolean`    |
| `index`   | `number`     |
| `visited` | `string[]`   |

**Messages:** `start`, `stop`, `next`, `prev`, `goto`, `setSteps`

**Init options:** `steps?: TourStep[], open?: boolean, index?: number`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `backdrop`, `spotlight`, `title`, `description`, `progressText`, `prevTrigger`, `nextTrigger`, `closeTrigger`

**Utilities:** `currentStep()`, `isFirst()`, `isLast()`, `progress()`

---

### Tree View

**State** (`TreeViewState`):

| Field                | Type             |
| -------------------- | ---------------- |
| `expanded`           | `string[]`       |
| `selected`           | `string[]`       |
| `checked`            | `string[]`       |
| `indeterminate`      | `string[]`       |
| `focused`            | `string \| null` |
| `selectionMode`      | `SelectionMode`  |
| `visibleItems`       | `string[]`       |
| `visibleLabels`      | `string[]`       |
| `disabled`           | `boolean`        |
| `typeahead`          | `string`         |
| `typeaheadExpiresAt` | `number`         |
| `renaming`           | `string \| null` |
| `renameDraft`        | `string`         |
| `loading`            | `string[]`       |

**Messages:** `toggleBranch`, `expand`, `collapse`, `expandAll`, `collapseAll`, `select`, `setSelected`, `focus`, `focusNext`, `focusPrev`, `focusFirst`, `focusLast`, `setVisibleItems`, `typeahead`, `arrowLeftFrom`, `arrowRightFrom`, `toggleChecked`, `setChecked`, `setIndeterminate`, `renameStart`, `renameChange`, `renameCommit`, `renameCancel`, `loadingStart`, `loadingEnd`

**Init options:** `expanded?: string[], selected?: string[], checked?: string[], indeterminate?: string[], selectionMode?: SelectionMode, disabled?: boolean, visibleItems?: string[], visibleLabels?: string[]`

**Connect options:** `ConnectOptions`

**Parts:** `root`, `item`

---

<!-- auto-api:end -->
