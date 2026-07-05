/**
 * @llui/a2ui — render Google's A2UI protocol on the LLui signal runtime.
 *
 * Feed server→client A2UI envelopes to {@link mountA2ui}; user actions surface
 * through `onAction` for you to forward over any transport (A2A, WebSocket,
 * AG-UI, MCP, …). The renderer reuses `@llui/components` headless primitives and
 * is extensible via {@link defineCatalog}.
 */

import { component, mountApp, type Renderable } from '@llui/dom'
import type { Catalog, CatalogResolver } from './catalog.js'
import { basicCatalog } from './catalog/index.js'
import type { JsonObject, ServerToClientEnvelope } from './protocol.js'
import { renderSurfaces } from './render.js'
import {
  a2uiUpdate,
  initialA2uiState,
  type A2uiEffect,
  type A2uiMsg,
  type A2uiState,
} from './state.js'

/** A user-triggered action, resolved and ready to send to your agent/server. */
export interface A2uiActionEvent {
  readonly surfaceId: string
  readonly sourceComponentId: string
  readonly name: string
  readonly context: JsonObject
  readonly timestamp: string
}

export interface A2uiOptions {
  /** Called when the user triggers a component action. */
  readonly onAction?: (event: A2uiActionEvent) => void
  /** Custom catalogs keyed by their A2UI `catalogId`. */
  readonly catalogs?: Readonly<Record<string, Catalog>>
  /** DOM commit scheduler — `'raf'` coalesces streaming updates to one paint/frame. */
  readonly scheduler?: 'sync' | 'raf'
}

export interface A2uiHandle {
  /** Apply one server→client envelope, or a batch, as a single reconcile. */
  apply(envelopes: ServerToClientEnvelope | readonly ServerToClientEnvelope[]): void
  /** Snapshot the current renderer state. */
  getState(): A2uiState
  /** Observe state after every update cycle. Returns an unsubscribe. */
  subscribe(listener: (state: A2uiState) => void): () => void
  /** Tear down the mounted renderer. */
  dispose(): void
}

/** Mount an A2UI renderer into `container`. */
export function mountA2ui(container: Element, options: A2uiOptions = {}): A2uiHandle {
  const catalogs = options.catalogs ?? {}
  const resolveCatalog: CatalogResolver = (id) => catalogs[id]

  const def = component<A2uiState, A2uiMsg, A2uiEffect>({
    name: 'a2ui',
    init: () => initialA2uiState(),
    update: a2uiUpdate,
    view: ({ state, send }): Renderable =>
      renderSurfaces(state, send, resolveCatalog, basicCatalog),
    onEffect: (effect) => {
      if (effect.type === 'a2ui/action') {
        options.onAction?.({
          surfaceId: effect.surfaceId,
          sourceComponentId: effect.sourceComponentId,
          name: effect.name,
          context: effect.context,
          timestamp: new Date().toISOString(),
        })
      }
    },
  })

  const app = mountApp(
    container,
    def,
    options.scheduler ? { scheduler: options.scheduler } : undefined,
  )

  return {
    apply(envelopes) {
      const list = Array.isArray(envelopes) ? envelopes : [envelopes]
      app.batch(() => {
        for (const envelope of list) app.send({ type: 'apply', envelope })
      })
    },
    getState: () => app.getState(),
    subscribe: (listener) => app.subscribe(listener),
    dispose: () => app.dispose(),
  }
}

// ── Public re-exports ──────────────────────────────────────────────
export * from './protocol.js'
export {
  defineCatalog,
  type Catalog,
  type CatalogSpec,
  type CatalogResolver,
  type ComponentBuilder,
  type CatalogFunction,
  type RenderContext,
  type RenderScope,
  type BuildArgs,
} from './catalog.js'
export { basicCatalog, BASIC_CATALOG_ID } from './catalog/index.js'
export {
  initialA2uiState,
  a2uiUpdate,
  applyEnvelope,
  type A2uiState,
  type A2uiMsg,
  type A2uiEffect,
  type A2uiActionEffect,
  type Surface,
} from './state.js'
export { resolvePointer, applyPointer, pointerTokens } from './pointer.js'
export {
  bindString,
  bindNumber,
  bindBoolean,
  bindStringList,
  resolveDynamic,
  displayString,
} from './binding.js'
export { renderSurfaces } from './render.js'
