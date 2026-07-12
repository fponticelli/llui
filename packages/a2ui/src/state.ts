/**
 * A2UI surface state and the pure reducer that applies the protocol's four
 * server→client messages, plus the two client-originated messages (two-way
 * input writes and user actions).
 *
 * LLui is TEA: this state is the component `State` and {@link a2uiUpdate} is the
 * component `update`. All mutation flows through `send(msg)`.
 */

import type {
  ComponentId,
  ComponentNode,
  JsonObject,
  JsonValue,
  ServerToClientEnvelope,
  Theme,
} from './protocol.js'
import { applyPointer } from './pointer.js'
import { warnOnce } from './catalog.js'

/** A single live A2UI surface. */
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

/** Root renderer state: all live surfaces plus their creation order. */
export interface A2uiState {
  readonly surfaces: Readonly<Record<string, Surface>>
  readonly order: readonly string[]
}

export function initialA2uiState(): A2uiState {
  return { surfaces: {}, order: [] }
}

/** An action the user triggered, with its context already resolved to values. */
export interface A2uiActionEffect {
  readonly type: 'a2ui/action'
  readonly surfaceId: string
  readonly sourceComponentId: ComponentId
  readonly name: string
  readonly context: JsonObject
}

export type A2uiEffect = A2uiActionEffect

/** Messages driving the renderer. */
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

const ROOT_ID = 'root'

function withSurface(state: A2uiState, surfaceId: string, next: Surface): A2uiState {
  return { ...state, surfaces: { ...state.surfaces, [surfaceId]: next } }
}

/** Apply a single server→client envelope to the state (pure). */
export function applyEnvelope(state: A2uiState, envelope: ServerToClientEnvelope): A2uiState {
  if (envelope.createSurface) {
    const { surfaceId, catalogId, theme, sendDataModel } = envelope.createSurface
    const surface: Surface = {
      surfaceId,
      catalogId,
      theme: theme ?? {},
      components: {},
      rootId: null,
      dataModel: {},
      uiState: {},
      sendDataModel: sendDataModel ?? false,
    }
    const order = state.order.includes(surfaceId) ? state.order : [...state.order, surfaceId]
    return { surfaces: { ...state.surfaces, [surfaceId]: surface }, order }
  }

  if (envelope.updateComponents) {
    const { surfaceId, components } = envelope.updateComponents
    const surface = state.surfaces[surfaceId]
    if (!surface) {
      warnOnce(`updateComponents for unknown surface "${surfaceId}" — dropped`)
      return state
    }
    // Null-prototype adjacency map: a server-supplied component id can never
    // resolve to a prototype member on lookup.
    const merged: Record<ComponentId, ComponentNode> = Object.assign(
      Object.create(null),
      surface.components,
    )
    for (const node of components) merged[node.id] = node
    const rootId = ROOT_ID in merged ? ROOT_ID : surface.rootId
    return withSurface(state, surfaceId, { ...surface, components: merged, rootId })
  }

  if (envelope.updateDataModel) {
    const { surfaceId, path, value } = envelope.updateDataModel
    const surface = state.surfaces[surfaceId]
    if (!surface) {
      warnOnce(`updateDataModel for unknown surface "${surfaceId}" — dropped`)
      return state
    }
    const dataModel = applyPointer(surface.dataModel, path ?? '/', value)
    return withSurface(state, surfaceId, { ...surface, dataModel })
  }

  if (envelope.deleteSurface) {
    const { surfaceId } = envelope.deleteSurface
    if (!state.surfaces[surfaceId]) {
      warnOnce(`deleteSurface for unknown surface "${surfaceId}" — dropped`)
      return state
    }
    const surfaces = { ...state.surfaces }
    delete surfaces[surfaceId]
    return { surfaces, order: state.order.filter((id) => id !== surfaceId) }
  }

  warnOnce('Envelope matched no known A2UI message — dropped')
  return state
}

/** The component `update`: returns the next state and any effects to emit. */
export function a2uiUpdate(state: A2uiState, msg: A2uiMsg): [A2uiState, A2uiEffect[]] {
  switch (msg.type) {
    case 'apply':
      return [applyEnvelope(state, msg.envelope), []]

    case 'setData': {
      const surface = state.surfaces[msg.surfaceId]
      if (!surface) return [state, []]
      const dataModel = applyPointer(surface.dataModel, msg.path, msg.value)
      return [withSurface(state, msg.surfaceId, { ...surface, dataModel }), []]
    }

    case 'setUi': {
      const surface = state.surfaces[msg.surfaceId]
      if (!surface) return [state, []]
      const uiState = { ...surface.uiState, [msg.componentId]: msg.value }
      return [withSurface(state, msg.surfaceId, { ...surface, uiState }), []]
    }

    case 'action':
      return [
        state,
        [
          {
            type: 'a2ui/action',
            surfaceId: msg.surfaceId,
            sourceComponentId: msg.sourceComponentId,
            name: msg.name,
            context: msg.context,
          },
        ],
      ]
  }
}
