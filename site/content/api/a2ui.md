---
title: '@llui/a2ui'
description: "Renderer for Google's A2UI (Agent-to-UI) protocol on the LLui signal runtime — apply server→client envelopes to a reactive TEA surface, with {path} bindings, templates, two-way inputs, and an open catalog registry."
---

# @llui/a2ui

Renders Google's [**A2UI**](https://a2ui.org) (Agent-to-UI) protocol on the LLui signal runtime. A2UI is a transport-agnostic JSON protocol: a local or remote agent streams declarative UI messages that reference components from a **catalog the client already trusts** — the agent never ships code. `@llui/a2ui` is a renderer for that stream, built on LLui's chunked-mask reconciler, and it reuses [`@llui/components`](/api/components) headless primitives for the interactive parts.

```bash
pnpm add @llui/a2ui
```

`@llui/dom` is a peer dependency; [`@llui/components`](/api/components) comes along for the ride.

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

The stream can arrive incrementally — components may be referenced before they are defined, and data may arrive after the components that bind to it. The renderer fills subtrees in as they resolve.

## How it maps onto LLui

LLui is [The Elm Architecture](/architecture): state is immutable and only changes through a reducer. A2UI fits it cleanly:

| A2UI concept                           | LLui                                                          |
| -------------------------------------- | ------------------------------------------------------------- |
| The four server→client messages        | `Msg` variants applied by a pure reducer (`a2uiUpdate`)       |
| Data model + JSON-Pointer paths        | Surface `dataModel` + reactive `{ path }` bindings            |
| `updateDataModel` (streaming)          | Reconciler re-commits only bound values — **no tree rebuild** |
| Flat component adjacency list          | Registry-dispatch tree walk (`renderSurfaces`)                |
| Template children `{componentId,path}` | `each` over the collection, relative paths scoped per row     |
| Two-way inputs                         | `onInput` → `setData` reducer message                         |
| Component actions                      | Resolved and delivered to your `onAction`                     |

Structure reacts to the component map; data reacts to the data model. Because a data update never changes the component map's identity, a high-frequency `updateDataModel` stream only re-commits changed values and never rebuilds the tree. Pass `scheduler: 'raf'` to coalesce a streaming burst of updates to one paint per frame.

## Basic catalog

All 18 A2UI Basic components are implemented. Display and layout render as semantic HTML; the richer interactive controls reuse [`@llui/components`](/api/components):

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

Interactive components with client-local view state (a tab's active index, a modal's open flag — state A2UI does not put in the data model) keep that state in a per-surface `uiState` store, driven by the component's own `@llui/components` reducer, so keyboard navigation and focus behaviour are preserved.

## Custom catalogs

Bring your own design system or component set with `defineCatalog`, optionally extending the Basic catalog:

```ts
import { defineCatalog, basicCatalog, mountA2ui } from '@llui/a2ui'
import { el } from '@llui/dom'

const myCatalog = defineCatalog({
  id: 'https://example.com/catalogs/my/catalog.json',
  extends: basicCatalog,
  components: {
    Gauge: ({ node, ctx, scope }) => [el('my-gauge', { value: ctx /* … */ })],
  },
})

mountA2ui(container, { catalogs: { [myCatalog.id!]: myCatalog } })
```

The client's `createSurface.catalogId` selects the catalog; unknown ids fall back to the Basic catalog.

## Transport is yours

`@llui/a2ui` is transport-agnostic, exactly as A2UI intends. It consumes envelopes via `handle.apply(...)` and emits actions via `onAction` — wire those to A2A, WebSockets, AG-UI, MCP, SSE, or plain HTTP however you like.

A WebSocket adapter ships built-in via the shared `A2uiTransport` seam:

```ts
import { connectA2ui, webSocketTransport } from '@llui/a2ui'

const handle = connectA2ui(container, webSocketTransport(new WebSocket(url)))
// inbound envelope frames render; user actions are sent as `{ action }` frames.
```

Other transports (A2A, AG-UI, MCP) implement the same `A2uiTransport` interface (`onEnvelope` / `sendAction`).

## Status

Implements the full A2UI v0.9 server→client message set (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`), plus:

- literal, `{ path }`, and nested `{ call }` bindings;
- client-defined **functions** — `formatString`, `formatNumber/Currency/Date`, `pluralize`, `required`/`regex`/`length`/`numeric`/`email`, `and`/`or`/`not`;
- validation **`checks`** (error messages on inputs, disabled buttons);
- **templates** over arrays and objects, with spec-correct item-scoped paths;
- two-way binding and actions;
- `sendDataModel` client→server sync, best-effort version negotiation, and `handle.capabilities()`.

Conformance-tested against the real `google/A2UI` v0.9 sample payloads. Custom components (e.g. inline-catalog `OrgChart`) render once the consumer registers a catalog via `defineCatalog`.

## API

<!-- auto-api:start -->

## Functions

### `a2uiUpdate()`

The component `update`: returns the next state and any effects to emit.

```typescript
function a2uiUpdate(state: A2uiState, msg: A2uiMsg): [A2uiState, A2uiEffect[]]
```

### `applyEnvelope()`

Apply a single server→client envelope to the state (pure).

```typescript
function applyEnvelope(state: A2uiState, envelope: ServerToClientEnvelope): A2uiState
```

### `applyPointer()`

Return a new data model with `value` written at `pointer` (upsert semantics).
Missing intermediate containers are created; `undefined` removes the key.
Untouched siblings keep their identity (structural sharing).

```typescript
function applyPointer(root: JsonValue, pointer: string, value: JsonValue | undefined): JsonValue
```

### `bindBoolean()`

Reactive boolean binding (CheckBox value).

```typescript
function bindBoolean(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: DynamicBoolean | undefined,
): Reactive<boolean>
```

### `bindNumber()`

Reactive number binding (Slider value/min/max).

```typescript
function bindNumber(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: DynamicNumber | undefined,
): Reactive<number>
```

### `bindString()`

Reactive string binding for text/attrs.

```typescript
function bindString(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: DynamicString | undefined,
): Reactive<string>
```

### `bindStringList()`

Reactive string-list binding (ChoicePicker value).

```typescript
function bindStringList(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: DynamicStringList | undefined,
): Reactive<readonly string[]>
```

### `connectA2ui()`

Mount an A2UI renderer wired to a transport: inbound envelopes flow into the
renderer, user actions flow out to the transport (plus any `onAction` you
pass). Disposing the returned handle also unsubscribes from the transport.

```typescript
function connectA2ui(
  container: Element,
  transport: A2uiTransport,
  options: A2uiOptions = {},
): A2uiHandle
```

### `defineCatalog()`

Build a catalog, optionally layering over a base. Registry records use a
null prototype so a server-supplied component/function name like
"**proto**"/"toString"/"constructor" can't resolve to a prototype member.

```typescript
function defineCatalog(spec: CatalogSpec): Catalog
```

### `displayString()`

Coerce any JSON value to a display string.

```typescript
function displayString(value: JsonValue | undefined): string
```

### `initialA2uiState()`

```typescript
function initialA2uiState(): A2uiState
```

### `isChildTemplate()`

```typescript
function isChildTemplate(value: ChildList | undefined): value is ChildTemplate
```

### `isFunctionCall()`

```typescript
function isFunctionCall(value: unknown): value is FunctionCall
```

### `isPathBinding()`

```typescript
function isPathBinding(value: unknown): value is PathBinding
```

### `mountA2ui()`

Mount an A2UI renderer into `container`.

```typescript
function mountA2ui(container: Element, options: A2uiOptions = {}): A2uiHandle
```

### `pointerTokens()`

Split a pointer into its path tokens. `''` and `'/'` both mean the root.

```typescript
function pointerTokens(pointer: string): string[]
```

### `renderSurfaces()`

Render every live surface, in creation order.

```typescript
function renderSurfaces(
  state: Signal<A2uiState>,
  send: (msg: A2uiMsg) => void,
  resolveCatalog: CatalogResolver,
  fallbackCatalog: Catalog,
): Renderable
```

### `resolveDynamic()`

One-shot, non-reactive resolution — for action context + input write-back reads.

```typescript
function resolveDynamic(ctx: RenderContext, scope: RenderScope, dyn: unknown): JsonValue | undefined
```

### `resolvePointer()`

Resolve a pointer against a data model, or `undefined` if any segment is missing.

```typescript
function resolvePointer(root: JsonValue, pointer: string): JsonValue | undefined
```

### `webSocketTransport()`

A WebSocket A2UI transport. Inbound frames are parsed as an envelope or an
array of envelopes; outbound actions are sent as `{ action }` JSON frames.
Unparseable or non-envelope frames are reported via `options.onError`
(default: `console.warn`) rather than dropped silently.

```typescript
function webSocketTransport(
  socket: WebSocketLike,
  options: WebSocketTransportOptions = {},
): A2uiTransport
```

## Types

### `A2uiEffect`

```typescript
export type A2uiEffect = A2uiActionEffect
```

### `A2uiMsg`

Messages driving the renderer.

```typescript
export type A2uiMsg =
  /** Feed one server→client protocol envelope. */
  | { readonly type: 'apply'; readonly envelope: ServerToClientEnvelope }
  /** Two-way input write-back at an absolute data-model path. */
  | {
      readonly type: 'setData'
      readonly surfaceId: string
      readonly path: string
      readonly value: JsonValue
    }
  /** Client-local UI-state write for a stateful component (Tabs, Modal, …). */
  | {
      readonly type: 'setUi'
      readonly surfaceId: string
      readonly componentId: ComponentId
      readonly value: JsonValue
    }
  /** A user-triggered action with its context resolved at the interaction site. */
  | {
      readonly type: 'action'
      readonly surfaceId: string
      readonly sourceComponentId: ComponentId
      readonly name: string
      readonly context: JsonObject
    }
```

### `CatalogFunction`

A client-defined function (formatting, validation, local actions). Pure: given
a call and its evaluation environment, return a value. Reactivity is handled
once at the binding site, so functions need not deal with signals.

```typescript
export type CatalogFunction = (call: FunctionCall, env: EvalEnv) => JsonValue
```

### `CatalogResolver`

A resolver from an A2UI `catalogId` to a concrete catalog.

```typescript
export type CatalogResolver = (catalogId: string) => Catalog | undefined
```

### `ChildList`

```typescript
export type ChildList = readonly ComponentId[] | ChildTemplate
```

### `ComponentBuilder`

Builds the live DOM for one A2UI component type.

```typescript
export type ComponentBuilder = (args: BuildArgs) => Renderable
```

### `ComponentId`

```typescript
export type ComponentId = string
```

### `DynamicBoolean`

```typescript
export type DynamicBoolean = boolean | PathBinding | FunctionCall
```

### `DynamicNumber`

```typescript
export type DynamicNumber = number | PathBinding | FunctionCall
```

### `DynamicString`

A value that may be a literal, a data-model path, or a function result.

```typescript
export type DynamicString = string | PathBinding | FunctionCall
```

### `DynamicStringList`

```typescript
export type DynamicStringList = readonly string[] | PathBinding | FunctionCall
```

### `JsonObject`

```typescript
export type JsonObject = { readonly [key: string]: JsonValue }
```

### `JsonValue`

A JSON-serializable value — the shape of an A2UI surface data model.

```typescript
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }
```

## Interfaces

### `A2uiActionEffect`

An action the user triggered, with its context already resolved to values.

```typescript
export interface A2uiActionEffect {
  readonly type: 'a2ui/action'
  readonly surfaceId: string
  readonly sourceComponentId: ComponentId
  readonly name: string
  readonly context: JsonObject
}
```

### `A2uiActionEvent`

A user-triggered action, resolved and ready to send to your agent/server.

```typescript
export interface A2uiActionEvent {
  readonly surfaceId: string
  readonly sourceComponentId: string
  readonly name: string
  readonly context: JsonObject
  readonly timestamp: string
  /**
   * The surface's full data model, present only when the surface was created
   * with `sendDataModel: true` (A2UI's client→server data sync — the data model
   * rides along with the client-bound action for collaborative editing).
   */
  readonly dataModel?: JsonValue
}
```

### `A2uiHandle`

```typescript
export interface A2uiHandle {
  /** Apply one server→client envelope, or a batch, as a single reconcile. */
  apply(envelopes: ServerToClientEnvelope | readonly ServerToClientEnvelope[]): void
  /** Snapshot the current renderer state. */
  getState(): A2uiState
  /** The client capabilities to send to the server (catalogs the client supports). */
  capabilities(): ClientCapabilities
  /** Observe state after every update cycle. Returns an unsubscribe. */
  subscribe(listener: (state: A2uiState) => void): () => void
  /** Tear down the mounted renderer. */
  dispose(): void
}
```

### `A2uiOptions`

```typescript
export interface A2uiOptions {
  /** Called when the user triggers a component action. */
  readonly onAction?: (event: A2uiActionEvent) => void
  /** Custom catalogs keyed by their A2UI `catalogId`. */
  readonly catalogs?: Readonly<Record<string, Catalog>>
  /** DOM commit scheduler — `'raf'` coalesces streaming updates to one paint/frame. */
  readonly scheduler?: 'sync' | 'raf'
}
```

### `A2uiState`

Root renderer state: all live surfaces plus their creation order.

```typescript
export interface A2uiState {
  readonly surfaces: Readonly<Record<string, Surface>>
  readonly order: readonly string[]
}
```

### `A2uiTransport`

A bidirectional A2UI channel: deliver server→client envelopes, accept actions.

```typescript
export interface A2uiTransport {
  /** Subscribe to inbound server→client envelopes. Returns an unsubscribe. */
  onEnvelope(handler: (envelope: ServerToClientEnvelope) => void): () => void
  /** Send a client→server action to the channel. */
  sendAction(event: A2uiActionEvent): void
}
```

### `Action`

A component action: dispatch an event to the server and/or run a local function.

```typescript
export interface Action {
  readonly event?: ActionEvent
  readonly functionCall?: FunctionCall
}
```

### `ActionEvent`

A server-bound event dispatched when the user triggers an action.

```typescript
export interface ActionEvent {
  readonly name: string
  readonly context?: Readonly<Record<string, unknown>>
}
```

### `BuildArgs`

```typescript
export interface BuildArgs {
  readonly node: ComponentNode
  readonly ctx: RenderContext
  readonly scope: RenderScope
}
```

### `Catalog`

```typescript
export interface Catalog {
  readonly id?: string
  readonly components: Readonly<Record<string, ComponentBuilder>>
  readonly functions: Readonly<Record<string, CatalogFunction>>
}
```

### `CatalogSpec`

```typescript
export interface CatalogSpec {
  readonly id?: string
  readonly components: Readonly<Record<string, ComponentBuilder>>
  readonly functions?: Readonly<Record<string, CatalogFunction>>
  /** A base catalog to inherit builders/functions from (this spec wins on conflict). */
  readonly extends?: Catalog
}
```

### `ChildTemplate`

Container children: a static id list, or a template repeated over a collection.

```typescript
export interface ChildTemplate {
  readonly componentId: ComponentId
  readonly path: string
}
```

### `ClientCapabilities`

Client capabilities to advertise to the server (A2UI `client_capabilities`).

```typescript
export interface ClientCapabilities {
  /** Catalog ids the client can render (the Basic catalog plus any custom ones). */
  readonly supportedCatalogIds: readonly string[]
}
```

### `ComponentNode`

A single component in the flat adjacency-list tree. Component-type-specific
properties are open (custom catalogs), so this is an open record keyed by the
two guaranteed fields.

```typescript
export interface ComponentNode {
  readonly id: ComponentId
  readonly component: string
  readonly [prop: string]: unknown
}
```

### `CreateSurface`

```typescript
export interface CreateSurface {
  readonly surfaceId: string
  readonly catalogId: string
  readonly theme?: Theme
  readonly sendDataModel?: boolean
}
```

### `DeleteSurface`

```typescript
export interface DeleteSurface {
  readonly surfaceId: string
}
```

### `FunctionCall`

A catalog-registered function invocation (validation, formatting, actions).

```typescript
export interface FunctionCall {
  readonly call: string
  readonly args?: Readonly<Record<string, unknown>>
  readonly returnType?: string
}
```

### `PathBinding`

A reference into the surface data model via a JSON-Pointer-ish path.

```typescript
export interface PathBinding {
  readonly path: string
}
```

### `RenderContext`

Everything a builder needs to render one component and recurse into children.

```typescript
export interface RenderContext {
  readonly surfaceId: string
  readonly theme: Signal<Theme>
  /** The surface data model root (absolute `/…` bindings resolve against this). */
  readonly rootData: Signal<JsonValue>
  readonly send: (msg: A2uiMsg) => void
  readonly catalog: Catalog
  /** Write a stateful component's local UI state (Tabs active tab, Modal open). */
  setUi(componentId: ComponentId, value: JsonValue): void
  /** Look up a component definition by id in the current structural snapshot. */
  getComponent(id: ComponentId): ComponentNode | undefined
  /** Render a component (and its subtree) by id within a scope. */
  renderById(id: ComponentId, scope: RenderScope): Renderable
  /** Render a static id list or a repeated template within a scope. */
  renderChildren(children: ChildList | undefined, scope: RenderScope): Renderable
}
```

### `RenderScope`

The reactive data context a component renders against. At the surface root
this wraps the whole data model; inside a template it wraps the current item.

```typescript
export interface RenderScope {
  /** Reactive data for this scope (root data model, or a template item). */
  readonly data: Signal<JsonValue>
  /**
   * The local data-model root for THIS scope: the surface data model at the top
   * level, or the current item inside a template. Per the A2UI spec, template
   * paths are item-scoped, so both relative (`name`) and leading-slash (`/name`)
   * bindings resolve against this. Correctly scoped for the current depth.
   */
  readonly root: Signal<JsonValue>
  /**
   * Client-local UI state for stateful components, correctly scoped for THIS
   * depth (threaded through template rows like {@link root}). Read via this;
   * write via {@link RenderContext.setUi}.
   */
  readonly uiState: Signal<JsonObject>
  /**
   * Resolve a component-relative pointer to an ABSOLUTE data-model pointer,
   * used for two-way write-back. Absolute pointers pass through unchanged.
   */
  absPath(pointer: string): string
  /**
   * Stable prefix identifying THIS scope instance (`''` at the surface root,
   * `/rows/0` in a template row). Namespaces client-local UI state so a stateful
   * component repeated across template rows gets independent state per row.
   */
  readonly keyPrefix: string
  /**
   * Ids of the components currently being rendered on the path from the surface
   * root down to (but not including) this scope's component. Threaded so
   * {@link RenderContext.renderById} can detect a cyclic adjacency list
   * (`root → children:['root']`, or A → B → A) and refuse to recurse instead of
   * overflowing the stack on one malformed envelope.
   */
  readonly ancestors: ReadonlySet<ComponentId>
}
```

### `ServerToClientEnvelope`

One server→client message. Exactly one of the four payload fields is set.

```typescript
export interface ServerToClientEnvelope {
  readonly version?: string
  readonly createSurface?: CreateSurface
  readonly updateComponents?: UpdateComponents
  readonly updateDataModel?: UpdateDataModel
  readonly deleteSurface?: DeleteSurface
}
```

### `Surface`

A single live A2UI surface.

```typescript
export interface Surface {
  readonly surfaceId: string
  readonly catalogId: string
  readonly theme: Theme
  /** Flat adjacency-list component map, keyed by component id. */
  readonly components: Readonly<Record<ComponentId, ComponentNode>>
  /** Id of the tree root (`"root"` per spec), or null until it arrives. */
  readonly rootId: ComponentId | null
  /** The surface data model that bindings resolve against. */
  readonly dataModel: JsonValue
  /**
   * Client-local UI state the A2UI protocol does not model in the data model —
   * e.g. a Tabs component's active tab or a Modal's open flag. Keyed by
   * component id; each value is that component's own (JSON-serializable) state.
   */
  readonly uiState: JsonObject
  /** Whether the client echoes the full data model back to the server. */
  readonly sendDataModel: boolean
}
```

### `Theme`

```typescript
export interface Theme {
  readonly primaryColor?: string
  readonly iconUrl?: string
  readonly agentDisplayName?: string
  readonly font?: string
  readonly [key: string]: JsonValue | undefined
}
```

### `UpdateComponents`

```typescript
export interface UpdateComponents {
  readonly surfaceId: string
  readonly components: readonly ComponentNode[]
}
```

### `UpdateDataModel`

```typescript
export interface UpdateDataModel {
  readonly surfaceId: string
  /** JSON-Pointer location; defaults to `/` (whole model) when omitted. */
  readonly path?: string
  /** New value; omission removes the key at `path`. */
  readonly value?: JsonValue
}
```

### `WebSocketLike`

The minimal WebSocket surface `webSocketTransport` needs (mockable in tests).

```typescript
export interface WebSocketLike {
  send(data: string): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}
```

### `WebSocketTransportOptions`

Options for `webSocketTransport`.

```typescript
export interface WebSocketTransportOptions {
  /**
   * Called when an inbound frame can't be used — unparseable JSON, or a value
   * that isn't an envelope object. Defaults to `console.warn`; pass your own to
   * route these somewhere else (or a no-op to intentionally ignore them).
   * Frames are never dropped *silently*.
   */
  onError?: (error: Error, rawData: unknown) => void
}
```

## Constants

### `A2UI_VERSION`

A2UI protocol v0.9 — type definitions for the server→client message stream
and the value/binding primitives shared across catalogs.
Reference: https://a2ui.org/specification/v0.9-a2ui/

```typescript
const A2UI_VERSION
```

### `BASIC_CATALOG_ID`

Canonical id of the A2UI v0.9 Basic catalog.

```typescript
const BASIC_CATALOG_ID
```

### `basicCatalog`

```typescript
const basicCatalog: Catalog
```

### `SUPPORTED_VERSIONS`

A2UI protocol versions this renderer accepts (others render best-effort).

```typescript
const SUPPORTED_VERSIONS: readonly string[]
```

<!-- auto-api:end -->
