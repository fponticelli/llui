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
import { hasOwn, safeCssValue } from './security.js'
import type { A2uiMsg, A2uiState, Surface } from './state.js'

// ── Per-node structural identity ───────────────────────────────────
// Tag each distinct ComponentNode object with a stable key. A node's `each`
// (see `renderNode`) is keyed on this, so it rebuilds ONLY when THAT node's
// object is replaced by `updateComponents` — unchanged nodes (kept by reference
// across the merge in `applyEnvelope`) keep their key and their live DOM, focus,
// scroll and component machines. This makes a streaming component update
// O(changed nodes), not a whole-surface teardown.
const nodeIds = new WeakMap<object, string>()
let nodeSeq = 0
function nodeKey(node: ComponentNode): string {
  let id = nodeIds.get(node)
  if (id === undefined) {
    id = `n${nodeSeq++}`
    nodeIds.set(node, id)
  }
  return id
}

const ROOT_ID: ComponentId = 'root'

// ── Pointer joining for template write-back ────────────────────────
function joinPointer(base: string, ...segments: string[]): string {
  const head = base === '/' ? '' : base
  const tail = segments.filter((s) => s.length > 0).join('/')
  return tail.length === 0 ? base : `${head}/${tail}`
}

// ── Template rows ──────────────────────────────────────────────────
interface RowBase {
  readonly item: JsonValue
  /** Path segment for this row: array index or object key. */
  readonly segment: string
}
// Threads the (correctly-scoped) data root and UI state into each row so both
// stay valid inside the `each`'s re-scoping — an outer-scope handle would
// re-scope to the row item.
interface TemplateRow extends RowBase {
  readonly uiState: JsonObject
  readonly components: Readonly<Record<ComponentId, ComponentNode>>
  /** The row component's node identity — folded into the row key so a template's
   * component DEFINITION change rebuilds every row. */
  readonly structKey: string
}

// Expand a template collection: A2UI iterates arrays (by index) and objects (by
// key). The segment becomes both the write-back path segment and the fallback
// row key.
function templateRows(source: JsonValue | undefined): RowBase[] {
  if (Array.isArray(source)) {
    return source.map((item, index) => ({ item, segment: String(index) }))
  }
  if (source !== null && typeof source === 'object') {
    return Object.entries(source).map(([key, item]) => ({ item, segment: key }))
  }
  return []
}

// Prefer an explicit id/key (stable across reorder + edits); otherwise key by
// the path segment, which keeps rows stable while an input inside them is being
// edited (a content hash would rebuild the row on every keystroke).
function rowKey(item: JsonValue, segment: string): string {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const id = (item as Record<string, JsonValue>).id ?? (item as Record<string, JsonValue>).key
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  }
  return segment
}

// ── Theme → CSS custom properties ──────────────────────────────────
function themeStyle(theme: Theme): string {
  const parts: string[] = []
  // Theme values are server-controlled: validate before interpolating into the
  // inline style string, so a `primaryColor` like `red; background: url(evil)`
  // can't inject extra declarations.
  if (typeof theme.primaryColor === 'string') {
    const color = safeCssValue('color', theme.primaryColor)
    if (color !== null) parts.push(`--a2ui-primary: ${color}`)
    else warnOnce(`Ignoring unsafe theme primaryColor "${theme.primaryColor}"`)
  }
  if (typeof theme.font === 'string') {
    const font = safeCssValue('font-family', `${theme.font}, system-ui, sans-serif`)
    if (font !== null) parts.push(`font-family: ${font}`)
    else warnOnce(`Ignoring unsafe theme font "${theme.font}"`)
  }
  return parts.join('; ')
}

// ── Render context construction ────────────────────────────────────
function makeContext(
  surfaceId: string,
  theme: Signal<Theme>,
  rootData: Signal<JsonValue>,
  components: Signal<Readonly<Record<ComponentId, ComponentNode>>>,
  send: (msg: A2uiMsg) => void,
  catalog: Catalog,
): RenderContext {
  const ctx: RenderContext = {
    surfaceId,
    theme,
    rootData,
    send,
    catalog,
    setUi: (componentId, value) => send({ type: 'setUi', surfaceId, componentId, value }),
    getComponent: (id) => {
      const c = components.peek()
      return hasOwn(c, id) ? c[id] : undefined
    },
    renderById: (id, scope) => renderNode(ctx, id, scope),
    renderChildren: (children, scope) => renderChildren(ctx, children, scope),
  }
  return ctx
}

/** The reactive slice a single node's `each` row carries. Everything the row
 * reads is threaded through here (never reached for via an outer-scope handle,
 * which would re-scope to the row item), so bindings and nested `renderNode`
 * calls stay correctly scoped inside the row. */
interface NodeUnit {
  readonly node: ComponentNode
  readonly components: Readonly<Record<ComponentId, ComponentNode>>
  readonly data: JsonValue
  readonly root: JsonValue
  readonly ui: JsonObject
}

/** Look up and invoke the catalog builder for a resolved node (no reactivity of
 * its own — the caller owns the structural boundary). */
function invokeBuilder(ctx: RenderContext, node: ComponentNode, scope: RenderScope): Renderable {
  const builder = hasOwn(ctx.catalog.components, node.component)
    ? ctx.catalog.components[node.component]
    : undefined
  if (typeof builder !== 'function') {
    warnOnce(`No builder for A2UI component "${node.component}"`)
    return []
  }
  return builder({ node, ctx, scope })
}

/**
 * Build a component by id ONCE against the current snapshot (no per-id `each`).
 * Used where a structural primitive can't be the top-level node — the body of a
 * template row, which must be a stable element the keyed reconcile can move and
 * remove. The row's key carries the node identity (see {@link renderChildren}),
 * so a definition change still rebuilds the row.
 */
function buildNode(ctx: RenderContext, id: ComponentId, scope: RenderScope): Renderable {
  if (scope.ancestors.has(id)) {
    warnOnce(`Cyclic A2UI component reference at "${id}" — skipping`)
    return []
  }
  const components = scope.components.peek()
  if (!hasOwn(components, id)) return []
  const node = components[id]
  if (!node) return []
  const childScope: RenderScope = { ...scope, ancestors: new Set(scope.ancestors).add(id) }
  return invokeBuilder(ctx, node, childScope)
}

/**
 * Render one component by id as a self-contained reactive unit: an `each` over a
 * single-element list, keyed by the node's object identity. The node's DATA
 * bindings update in place when the data model changes (same key → row kept);
 * the node's whole subtree rebuilds ONLY when its definition object is replaced
 * (new key → row swapped). Because each child is itself a `renderNode`, changing
 * one node rebuilds just that node — siblings, ancestors and their DOM/focus/
 * scroll/component machines are untouched.
 *
 * Returns a structural primitive, so place it where a fragment is legal (element
 * children, a build's returned array) — NOT as the bare top-level of an `each`
 * row (use {@link buildNode} there).
 */
function renderNode(ctx: RenderContext, id: ComponentId, scope: RenderScope): Renderable {
  // Cycle guard: refuse to re-enter a component already on the ancestor path
  // (a cyclic adjacency list would otherwise recurse to a stack overflow).
  if (scope.ancestors.has(id)) {
    warnOnce(`Cyclic A2UI component reference at "${id}" — skipping`)
    return []
  }

  const units: Signal<readonly NodeUnit[]> = derived(
    scope.components,
    scope.data,
    scope.root,
    scope.uiState,
    (components, data, root, ui): NodeUnit[] => {
      // Own-property guard: a server-supplied id like "__proto__"/"toString"
      // must not resolve to a prototype member of the adjacency map.
      if (!hasOwn(components, id)) return [] // referenced-before-defined: fills in when it arrives
      const node = components[id]
      return node ? [{ node, components, data, root, ui }] : []
    },
  )

  return [
    each(units, {
      key: (u) => nodeKey(u.node),
      render: (uSig) => {
        const node = uSig.peek().node
        // Derive every scope signal from THIS row's unit so reads stay scoped.
        const childScope: RenderScope = {
          data: uSig.map((u) => u.data),
          root: uSig.map((u) => u.root),
          uiState: uSig.map((u) => u.ui),
          components: uSig.map((u) => u.components),
          absPath: scope.absPath,
          keyPrefix: scope.keyPrefix,
          ancestors: new Set(scope.ancestors).add(id),
        }
        return invokeBuilder(ctx, node, childScope)
      },
    }),
  ]
}

function renderChildren(
  ctx: RenderContext,
  children: ChildList | undefined,
  scope: RenderScope,
): Renderable {
  if (children === undefined) return []

  if (!isChildTemplate(children)) {
    return children.flatMap((id) => renderNode(ctx, id, scope))
  }

  // Template: repeat `componentId` over the collection at `path`.
  const tpl = children
  const path = tpl.path
  const collectionBase = path.startsWith('/') ? path : scope.absPath(path)

  // Thread the data root, UI state and component map into each row so all flow
  // through the `each`'s re-scoping and stay valid inside the row. `structKey`
  // is the row component's node identity: folding it into the row key rebuilds
  // every row when the template's component DEFINITION changes (rows can't use a
  // per-id `each` — see `buildNode`), while `rowKey` handles data reorder/edits.
  const rows: Signal<readonly TemplateRow[]> = derived(
    scope.root,
    scope.data,
    scope.uiState,
    scope.components,
    (root, dataHere, uiState, components) => {
      const source = path.startsWith('/') ? root : dataHere
      const compNode = hasOwn(components, tpl.componentId) ? components[tpl.componentId] : undefined
      const structKey = compNode ? nodeKey(compNode) : 'none'
      return templateRows(resolvePointer(source, path)).map((r) => ({
        ...r,
        uiState,
        components,
        structKey,
      }))
    },
  )

  const list = each(rows, {
    key: (row) => `${row.structKey}:${rowKey(row.item, row.segment)}`,
    render: (rowSig) => {
      // Inside a template the item is the local root: per the A2UI spec, both
      // relative (`name`) and leading-slash (`/name`) paths resolve to the item
      // (`/products/N/name`). So data === root === the item here. The component
      // map stays surface-global (templates don't re-root component definitions).
      const item = rowSig.map((r) => r.item)
      const segment = rowSig.peek().segment
      const itemScope: RenderScope = {
        data: item,
        root: item,
        uiState: rowSig.map((r) => r.uiState),
        components: rowSig.map((r) => r.components),
        absPath: (p) => joinPointer(collectionBase, segment, p.startsWith('/') ? p.slice(1) : p),
        keyPrefix: joinPointer(collectionBase, segment),
        ancestors: scope.ancestors,
      }
      // A template row must be a stable ELEMENT (not a bare `each`), so build the
      // component directly; nested children inside it still use `renderNode`.
      return buildNode(ctx, tpl.componentId, itemScope)
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

  // Derive every reactive surface slice from the (correctly-scoped) `surface`
  // row signal handed to us by the outer surfaces `each`. There is NO structural
  // `each` here anymore: the root is rendered via `renderNode`, whose per-id
  // `each` reacts to the component map arriving/changing — so `updateComponents`
  // rebuilds only the nodes that changed, never the whole surface.
  const rootData: Signal<JsonValue> = surface.map((su) => su.dataModel)
  const theme: Signal<Theme> = surface.map((su) => su.theme)
  const uiState: Signal<JsonObject> = surface.map((su) => su.uiState)
  const components: Signal<Readonly<Record<ComponentId, ComponentNode>>> = surface.map(
    (su) => su.components,
  )

  const ctx = makeContext(surfaceId, theme, rootData, components, send, catalog)
  const rootScope: RenderScope = {
    data: rootData,
    root: rootData,
    uiState,
    components,
    absPath: (p) => (p.startsWith('/') ? p : `/${p}`),
    keyPrefix: '',
    ancestors: new Set<string>(),
  }

  // The tree root is always `ROOT_ID` once it arrives (see `applyEnvelope`);
  // `renderNode` renders nothing until the component map contains it, so a
  // surface created before its components stream in fills in reactively.
  return [
    div(
      {
        class: 'a2ui-surface',
        'data-surface-id': surfaceId,
        style: surface.map((su) => themeStyle(su.theme)),
      },
      renderNode(ctx, ROOT_ID, rootScope),
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
