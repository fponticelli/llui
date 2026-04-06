# @llui/components

54 headless UI components for [LLui](../../README.md). Pure state machines with no DOM opinions — you own the markup and styling via `data-scope` / `data-part` attributes.

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
    const t = tabs.connect<State>(s => s.tabs, m => send({ type: 'tabs', msg: m }), { id: 'demo' })
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
    get: s => s.tabs,
    set: (s, v) => ({ ...s, tabs: v }),
    narrow: m => m.type === 'tabs' ? m.msg : null,
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
`@llui/components/patterns/confirm-dialog` — pre-wired alert-dialog for destructive confirmations.

## Utilities

Shared helpers used internally and exported for advanced use:

| Utility | Purpose |
|---|---|
| `typeahead` | First-letter search across menu, select, listbox, tree-view |
| `TreeCollection` | Indexed tree traversal — visibleItems, labels, indeterminate computation |
| `floating` | `@floating-ui/dom` wrapper for popover/menu positioning |
| `focus-trap` | Stack-based focus containment for modals |
| `dismissable` | Esc / outside-click dismiss layer stack |
| `aria-hidden` | `aria-hidden` on siblings of a modal for screen readers |
| `remove-scroll` | Body scroll lock for modals/drawers |

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
    return null  // valid
  },
})
```

Supported on: editable, number-input, tags-input, pin-input, file-upload.

## License

MIT
