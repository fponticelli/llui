# @llui/a2ui

Render Google's [**A2UI**](https://a2ui.org) (Agent-to-UI) protocol on the
[LLui](https://github.com/fponticelli/llui) signal runtime.

A2UI is a transport-agnostic JSON protocol: a local or remote agent streams
declarative UI messages that reference components from a **catalog the client
already trusts** — the agent never ships code. `@llui/a2ui` is a renderer for
that stream, built on LLui's chunked-mask reconciler, and it reuses
[`@llui/components`](../components) headless primitives for the interactive
parts.

```bash
pnpm add @llui/a2ui
```

`@llui/dom` is a peer dependency; `@llui/components` comes along for the ride.

## Usage

```ts
import { mountA2ui } from '@llui/a2ui'
import '@llui/a2ui/styles/theme.css'

const ui = mountA2ui(document.getElementById('app')!, {
  // User interactions surface here — forward them over any transport.
  onAction: (event) => socket.send(JSON.stringify(event)),
})

// Feed server→client A2UI envelopes (from A2A, WebSocket, AG-UI, MCP, …).
ui.apply([
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'card',
      catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      theme: { primaryColor: '#2563eb' },
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'card',
      components: [
        { id: 'root', component: 'Column', children: ['title', 'agree'] },
        { id: 'title', component: 'Text', variant: 'h2', text: { path: '/title' } },
        { id: 'agree', component: 'CheckBox', label: 'I agree', value: { path: '/agree' } },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: { surfaceId: 'card', path: '/', value: { title: 'Welcome', agree: false } },
  },
])
```

The stream can arrive incrementally — components may be referenced before they
are defined, and data may arrive after the components that bind to it. The
renderer fills subtrees in as they resolve.

## How it maps onto LLui

LLui is [The Elm Architecture](../../docs/designs/01%20Architecture.md): state is
immutable and only changes through a reducer. A2UI fits it cleanly:

| A2UI concept                           | LLui                                                          |
| -------------------------------------- | ------------------------------------------------------------- |
| The four server→client messages        | `Msg` variants applied by a pure reducer (`a2uiUpdate`)       |
| Data model + JSON-Pointer paths        | Surface `dataModel` + reactive `{ path }` bindings            |
| `updateDataModel` (streaming)          | Reconciler re-commits only bound values — **no tree rebuild** |
| Flat component adjacency list          | Registry-dispatch tree walk (`render`/`renderChildren`)       |
| Template children `{componentId,path}` | `each` over the collection, relative paths scoped per row     |
| Two-way inputs                         | `onInput` → `setData` reducer message                         |
| Component actions                      | Resolved and delivered to your `onAction`                     |

Structure reacts to the component map; data reacts to the data model. Because a
data update never changes the component map's identity, a high-frequency
`updateDataModel` stream only re-commits changed values and never rebuilds the
tree.

## Basic catalog

All 18 A2UI Basic components are implemented. Display and layout render as
semantic HTML; the richer interactive controls reuse `@llui/components`:

| Component                                                                                             | Backed by                                                                        |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `CheckBox`                                                                                            | `@llui/components/checkbox`                                                      |
| `Tabs`                                                                                                | `@llui/components/tabs` (roving focus, ARIA)                                     |
| `Modal`                                                                                               | `@llui/components/dialog` (focus-trap + scroll-lock)                             |
| `Slider`                                                                                              | `@llui/components/slider` (pointer-drag + keyboard)                              |
| `ChoicePicker`                                                                                        | `@llui/components/combobox` (typeahead filter + chips)                           |
| `DateTimeInput`                                                                                       | `@llui/components/date-picker` (inline calendar); native input for time/datetime |
| `TextField`                                                                                           | native accessible input                                                          |
| `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`, `Row`, `Column`, `List`, `Card`, `Divider`, `Button` | semantic HTML                                                                    |

Interactive components with client-local view state (a tab's active index, a
modal's open flag — state A2UI does not put in the data model) keep that state
in a per-surface `uiState` store, driven by the component's own
`@llui/components` reducer, so keyboard navigation and focus behaviour are
preserved.

## Custom catalogs

Bring your own design system or component set with `defineCatalog`, optionally
extending the Basic catalog:

```ts
import { defineCatalog, basicCatalog, mountA2ui } from '@llui/a2ui'
import { el, text } from '@llui/dom'

const myCatalog = defineCatalog({
  id: 'https://example.com/catalogs/my/catalog.json',
  extends: basicCatalog,
  components: {
    Gauge: ({ node, ctx, scope }) => [el('my-gauge', { value: ctx /* … */ })],
  },
})

mountA2ui(container, { catalogs: { [myCatalog.id!]: myCatalog } })
```

The client's `createSurface.catalogId` selects the catalog; unknown ids fall
back to the Basic catalog.

## Transport is yours

`@llui/a2ui` is transport-agnostic, exactly as A2UI intends. It consumes
envelopes via `handle.apply(...)` and emits actions via `onAction` — wire those
to A2A, WebSockets, AG-UI, MCP, SSE, or plain HTTP however you like.

## Status

Implements the full A2UI v0.9 server→client message set (`createSurface`,
`updateComponents`, `updateDataModel`, `deleteSurface`), plus:

- literal, `{ path }`, and nested `{ call }` bindings;
- client-defined **functions** — `formatString`, `formatNumber/Currency/Date`,
  `pluralize`, `required`/`regex`/`length`/`numeric`/`email`, `and`/`or`/`not`;
- validation **`checks`** (error messages on inputs, disabled buttons);
- **templates** over arrays and objects, with spec-correct item-scoped paths;
- two-way binding and actions;
- `sendDataModel` client→server sync, best-effort version negotiation, and
  `handle.capabilities()`.

Conformance-tested against the real `google/A2UI` v0.9 sample payloads. Custom
components (e.g. inline-catalog `OrgChart`) render once the consumer registers a
catalog via `defineCatalog`.
