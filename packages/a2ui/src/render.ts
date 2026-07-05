/**
 * The renderer: turn a reactive {@link A2uiState} into live LLui DOM.
 *
 * Structure (which components exist, how they wire together) reacts to the
 * surface's component map; DATA (bound text/values) reacts to the data model.
 * Because {@link applyPointer} leaves the component map's identity untouched, a
 * high-frequency `updateDataModel` stream re-commits only bound values and never
 * rebuilds the tree — the structural `each` key is stable across data updates.
 */

import { derived, div, each, type Renderable, type Signal } from '@llui/dom'
import type { Catalog, CatalogResolver, RenderContext, RenderScope } from './catalog.js'
import { warnOnce } from './catalog.js'
import type {
  ChildList,
  ComponentId,
  ComponentNode,
  JsonObject,
  JsonValue,
  Theme,
} from './protocol.js'
import { isChildTemplate } from './protocol.js'
import { resolvePointer } from './pointer.js'
import type { A2uiMsg, A2uiState, Surface } from './state.js'

// ── Structural identity ────────────────────────────────────────────
// Tag each distinct component-map object with a stable key so the structural
// `each` rebuilds only when `updateComponents` produces a new map.
const structureIds = new WeakMap<object, string>()
let structureSeq = 0
function structureKey(components: object): string {
  let id = structureIds.get(components)
  if (id === undefined) {
    id = `s${structureSeq++}`
    structureIds.set(components, id)
  }
  return id
}

// ── Pointer joining for template write-back ────────────────────────
function joinPointer(base: string, ...segments: string[]): string {
  const head = base === '/' ? '' : base
  const tail = segments.filter((s) => s.length > 0).join('/')
  return tail.length === 0 ? base : `${head}/${tail}`
}

// ── Template rows ──────────────────────────────────────────────────
interface TemplateRow {
  readonly item: JsonValue
  readonly index: number
  readonly root: JsonValue
}

// Prefer an explicit id/key (stable across reorder + edits); otherwise key by
// position, which keeps rows stable while an input inside them is being edited
// (a content hash would rebuild the row on every keystroke).
function itemKey(item: JsonValue, index: number): string {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const id = (item as Record<string, JsonValue>).id ?? (item as Record<string, JsonValue>).key
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  }
  return String(index)
}

// ── Theme → CSS custom properties ──────────────────────────────────
function themeStyle(theme: Theme): string {
  const parts: string[] = []
  if (theme.primaryColor) parts.push(`--a2ui-primary: ${theme.primaryColor}`)
  if (theme.font) parts.push(`font-family: ${theme.font}, system-ui, sans-serif`)
  return parts.join('; ')
}

// ── Render context construction ────────────────────────────────────
function makeContext(
  surfaceId: string,
  theme: Signal<Theme>,
  rootData: Signal<JsonValue>,
  uiState: Signal<JsonObject>,
  send: (msg: A2uiMsg) => void,
  catalog: Catalog,
  components: Readonly<Record<ComponentId, ComponentNode>>,
): RenderContext {
  const ctx: RenderContext = {
    surfaceId,
    theme,
    rootData,
    uiState,
    send,
    catalog,
    setUi: (componentId, value) => send({ type: 'setUi', surfaceId, componentId, value }),
    getComponent: (id) => components[id],
    renderById: (id, scope) => {
      const node = components[id]
      if (!node) return [] // referenced-before-defined: fills in on the next structural build
      const builder = catalog.components[node.component]
      if (!builder) {
        warnOnce(`No builder for A2UI component "${node.component}"`)
        return []
      }
      return builder({ node, ctx, scope })
    },
    renderChildren: (children, scope) => renderChildren(ctx, children, scope),
  }
  return ctx
}

function renderChildren(
  ctx: RenderContext,
  children: ChildList | undefined,
  scope: RenderScope,
): Renderable {
  if (children === undefined) return []

  if (!isChildTemplate(children)) {
    return children.flatMap((id) => ctx.renderById(id, scope))
  }

  // Template: repeat `componentId` over the collection at `path`.
  const tpl = children
  const path = tpl.path
  const collectionBase = path.startsWith('/') ? path : scope.absPath(path)

  // Wrap each item with its index and the (correctly-scoped) data-model root, so
  // both flow through the `each`'s re-scoping and stay valid inside the row —
  // an outer-scope root handle would re-scope to the row item.
  const rows: Signal<readonly TemplateRow[]> = derived(scope.root, scope.data, (root, dataHere) => {
    const source = path.startsWith('/') ? root : dataHere
    const value = resolvePointer(source, path)
    const items = Array.isArray(value) ? value : []
    return items.map((item, index) => ({ item, index, root }))
  })

  const list = each(rows, {
    key: (row) => itemKey(row.item, row.index),
    render: (rowSig) => {
      const itemScope: RenderScope = {
        data: rowSig.map((r) => r.item),
        root: rowSig.map((r) => r.root),
        absPath: (p) =>
          p.startsWith('/') ? p : joinPointer(collectionBase, String(rowSig.peek().index), p),
      }
      return ctx.renderById(tpl.componentId, itemScope)
    },
  })
  return [list]
}

// ── Per-surface render ─────────────────────────────────────────────
// `surface` is handed to us by the outer `each`, so its produce is correctly
// scoped to this surface's row. Every reactive read must derive from it (or from
// the inner structural unit) — a handle reaching for root state would be
// re-scoped to the row and read the wrong value.
function renderSurface(
  surface: Signal<Surface>,
  send: (msg: A2uiMsg) => void,
  resolveCatalog: CatalogResolver,
  fallbackCatalog: Catalog,
): Renderable {
  const snapshot = surface.peek()
  const surfaceId = snapshot.surfaceId
  const catalog = resolveCatalog(snapshot.catalogId) ?? fallbackCatalog

  // Rebuild the tree only when the component map's identity changes; carry the
  // whole surface in the unit so DATA still derives from a correctly-scoped
  // signal inside the structural row.
  const structureUnits = surface.map((su) => [{ key: structureKey(su.components), surface: su }])

  const tree = each(structureUnits, {
    key: (u) => u.key,
    render: (unit) => {
      const rootData: Signal<JsonValue> = unit.map((u) => u.surface.dataModel)
      const theme: Signal<Theme> = unit.map((u) => u.surface.theme)
      const uiState: Signal<JsonObject> = unit.map((u) => u.surface.uiState)
      const su = unit.peek().surface
      if (!su.rootId || !su.components[su.rootId]) return []
      const ctx = makeContext(surfaceId, theme, rootData, uiState, send, catalog, su.components)
      const rootScope: RenderScope = {
        data: rootData,
        root: rootData,
        absPath: (p) => (p.startsWith('/') ? p : `/${p}`),
      }
      return ctx.renderById(su.rootId, rootScope)
    },
  })

  return [
    div(
      {
        class: 'a2ui-surface',
        'data-surface-id': surfaceId,
        style: surface.map((su) => themeStyle(su.theme)),
      },
      [tree],
    ),
  ]
}

/** Render every live surface, in creation order. */
export function renderSurfaces(
  state: Signal<A2uiState>,
  send: (msg: A2uiMsg) => void,
  resolveCatalog: CatalogResolver,
  fallbackCatalog: Catalog,
): Renderable {
  const surfaces: Signal<readonly Surface[]> = state.map((s) => {
    const out: Surface[] = []
    for (const id of s.order) {
      const su = s.surfaces[id]
      if (su) out.push(su)
    }
    return out
  })
  const list = each(surfaces, {
    key: (su) => su.surfaceId,
    render: (surfaceSig) => renderSurface(surfaceSig, send, resolveCatalog, fallbackCatalog),
  })
  return [list]
}
