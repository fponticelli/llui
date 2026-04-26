import type { ComponentDef, AppHandle } from './types.js'
import type { ComponentInstance } from './update-loop.js'
import { flushInstance } from './update-loop.js'
import { createLifetime, disposeLifetime } from './lifetime.js'
import { setRenderContext, clearRenderContext } from './render-context.js'
import { setFlatBindings } from './binding.js'
import { getBindingDescriptors } from './binding-descriptors.js'
import { unregisterInstance } from './runtime.js'
import { _setHmrModule } from './mount.js'
import { createView } from './view-helpers.js'

/**
 * Enable HMR state preservation. Called by compiler-generated dev code.
 * Importing this module registers it with mountApp for hot-swapping.
 */
export function enableHmr(): void {
  _setHmrModule({
    enableHmr,
    registerForHmr,
    registerForAnchor,
    unregisterForHmr,
    replaceComponent,
  })
}

// ── HMR Registry ─────────────────────────────────────────────────

type HmrEntry =
  | {
      kind: 'container'
      inst: ComponentInstance
      container: HTMLElement
    }
  | {
      kind: 'anchor'
      inst: ComponentInstance
      anchor: Comment
      endSentinel: Comment
    }

const hmrRegistry = new Map<string, HmrEntry[]>()

export function registerForHmr(name: string, inst: object, container: HTMLElement): void {
  const entries = hmrRegistry.get(name) ?? []
  entries.push({ kind: 'container', inst: inst as ComponentInstance, container })
  hmrRegistry.set(name, entries)
}

export function registerForAnchor(
  name: string,
  inst: object,
  anchor: Comment,
  endSentinel: Comment,
): void {
  const entries = hmrRegistry.get(name) ?? []
  entries.push({ kind: 'anchor', inst: inst as ComponentInstance, anchor, endSentinel })
  hmrRegistry.set(name, entries)
}

export function unregisterForHmr(name: string, inst: object): void {
  const entries = hmrRegistry.get(name)
  if (!entries) return
  const idx = entries.findIndex((e) => e.inst === inst)
  if (idx !== -1) entries.splice(idx, 1)
  if (entries.length === 0) hmrRegistry.delete(name)
}

/**
 * Hot-swap a component definition on all live instances.
 *
 * Preserves the current state. Replaces update, view, onEffect, and __dirty.
 * Disposes the old scope tree (removing old DOM and bindings),
 * re-runs view(currentState, send) to rebuild fresh DOM.
 *
 * Returns an AppHandle for the first instance (for mountApp compatibility),
 * or null if no instances are registered (first mount).
 */
export function replaceComponent<S, M, E, D = void>(
  name: string,
  newDef: ComponentDef<S, M, E, D>,
): AppHandle | null {
  const entries = hmrRegistry.get(name)
  if (!entries || entries.length === 0) return null

  let handle: AppHandle | null = null

  for (const entry of entries) {
    const typedInst = entry.inst as ComponentInstance<S, M, E>

    typedInst.def = {
      ...typedInst.def,
      update: newDef.update,
      view: newDef.view,
      onEffect: newDef.onEffect,
      __dirty: newDef.__dirty,
      __update: newDef.__update,
      __handlers: newDef.__handlers,
    }

    // Snapshot focus + selection + scroll BEFORE disposal — once the
    // root lifetime tears down its DOM, the activeElement and any
    // scrollable subtree are detached and can't be queried. We
    // restore best-effort after the new view renders. The cost of
    // skipping this step is the every-edit experience: the user
    // types in an input, saves, the input rebuilds and loses focus
    // and cursor position. That kills incremental editing flow.
    const ownerRoot: ParentNode | null =
      entry.kind === 'container' ? entry.container : (entry.anchor.parentElement ?? null)
    const focusSnapshot = ownerRoot ? captureFocus(ownerRoot) : null
    const scrollSnapshot = ownerRoot ? captureScroll(ownerRoot) : null

    disposeLifetime(typedInst.rootLifetime)

    // Clear the owned region per-kind.
    if (entry.kind === 'container') {
      entry.container.textContent = ''
    } else {
      // anchor kind — wipe siblings between anchor and endSentinel, keep the
      // anchor AND the end sentinel (they bracket the fresh render).
      let sib = entry.anchor.nextSibling
      while (sib !== null && sib !== entry.endSentinel) {
        const next = sib.nextSibling
        sib.parentNode!.removeChild(sib)
        sib = next
      }
    }

    typedInst.rootLifetime = createLifetime(null)
    typedInst.rootLifetime._kind = 'root'
    typedInst.allBindings = []
    typedInst.structuralBlocks = []

    setFlatBindings(typedInst.allBindings)
    setRenderContext({
      rootLifetime: typedInst.rootLifetime,
      state: typedInst.state,
      allBindings: typedInst.allBindings,
      structuralBlocks: typedInst.structuralBlocks,
      dom: typedInst.dom,
      container:
        entry.kind === 'container' ? entry.container : (entry.anchor.parentElement ?? undefined),
      send: typedInst.send as (msg: unknown) => void,
      instance: typedInst as ComponentInstance,
    })
    const nodes = typedInst.def.view(createView<S, M>(typedInst.send))
    clearRenderContext()
    setFlatBindings(null)

    if (entry.kind === 'container') {
      for (const node of nodes) {
        entry.container.appendChild(node)
      }
    } else {
      for (const node of nodes) {
        entry.anchor.parentNode!.insertBefore(node, entry.endSentinel)
      }
    }

    // Restore focus, selection, and scroll positions in the freshly
    // rendered DOM. Best-effort: when the new view's DOM has diverged
    // structurally (different IDs, different element ordering, the
    // input that was focused no longer exists), the restorers no-op
    // silently. This is the right tradeoff — failing loudly on
    // structural divergence would just mean every meaningful view
    // edit prints an error.
    if (ownerRoot) {
      if (focusSnapshot) restoreFocus(ownerRoot, focusSnapshot)
      if (scrollSnapshot) restoreScroll(ownerRoot, scrollSnapshot)
    }

    if (!handle) {
      handle = makeReplacementHandle(name, entry, typedInst)
    }
  }

  console.log(`[LLui HMR] ${name} updated — state preserved`)

  return handle
}

function makeReplacementHandle<S, M, E>(
  name: string,
  entry: HmrEntry,
  typedInst: ComponentInstance<S, M, E>,
): AppHandle {
  const listeners = new Set<(s: unknown) => void>()
  typedInst._onCommit = (state: unknown) => {
    for (const l of Array.from(listeners)) {
      try {
        l(state)
      } catch (err) {
        console.error('[llui] listener threw:', err)
      }
    }
  }
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      typedInst._onCommit = undefined
      unregisterForHmr(name, entry.inst)
      entry.inst.abortController.abort()
      unregisterInstance(entry.inst)
      disposeLifetime(typedInst.rootLifetime)
      if (entry.kind === 'container') {
        entry.container.textContent = ''
      } else {
        let sib = entry.anchor.nextSibling
        while (sib !== null && sib !== entry.endSentinel) {
          const next = sib.nextSibling
          sib.parentNode!.removeChild(sib)
          sib = next
        }
        entry.endSentinel.parentNode?.removeChild(entry.endSentinel)
      }
    },
    flush() {
      flushInstance(entry.inst)
    },
    send(msg: unknown) {
      ;(typedInst.send as (m: unknown) => void)(msg)
    },
    getState() {
      return typedInst.state
    },
    subscribe(listener: (state: unknown) => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getBindingDescriptors() {
      if (disposed) return []
      return getBindingDescriptors(typedInst as ComponentInstance)
    },
    swapUpdate(newUpdate, newOnEffect) {
      if (disposed) return
      flushInstance(entry.inst)
      ;(typedInst.def as { update: typeof newUpdate }).update = newUpdate
      if (newOnEffect !== undefined) {
        ;(typedInst.def as { onEffect?: typeof newOnEffect }).onEffect = newOnEffect
      }
    },
    runReducer(msg) {
      if (disposed) return null
      const [state, effects] = (
        typedInst.def.update as (s: unknown, m: unknown) => [unknown, unknown[]]
      )(typedInst.state, msg)
      return { state, effects: effects as unknown[] }
    },
  }
}

// ── Focus / selection / scroll preservation across HMR ──────────

/**
 * What we record before disposing the root DOM. The locator is a
 * structural pointer: prefer `id` (resilient to view restructuring),
 * fall back to a child-index path through the rendered subtree. If
 * the new DOM doesn't match either, the restore call no-ops.
 */
type FocusSnapshot = {
  /** The element's `id` if it had one, else `null`. */
  id: string | null
  /** Sibling-index path from `ownerRoot` down to the focused element. */
  path: number[]
  /** Selection range if the focused element is a text input/textarea. */
  selection: { start: number; end: number; direction: 'forward' | 'backward' | 'none' } | null
}

type ScrollSnapshot = Array<{
  id: string | null
  path: number[]
  scrollTop: number
  scrollLeft: number
}>

function captureFocus(root: ParentNode): FocusSnapshot | null {
  const doc = (root as Element).ownerDocument ?? globalThis.document
  if (!doc) return null
  const active = doc.activeElement
  if (!active || active === doc.body) return null
  // Only capture focus for elements inside our owned subtree —
  // anything outside is not ours to restore.
  if (!(root as ParentNode & Node).contains(active)) return null

  const path = pathFromAncestor(root as Node, active)
  if (path === null) return null

  let selection: FocusSnapshot['selection'] = null
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    // Some input types (number, email, etc.) reject selectionStart access.
    // Wrapper try/catch keeps the snapshot resilient to those cases.
    try {
      if (active.selectionStart !== null && active.selectionEnd !== null) {
        selection = {
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: (active.selectionDirection ?? 'none') as 'forward' | 'backward' | 'none',
        }
      }
    } catch {
      selection = null
    }
  }

  return {
    id: active.id || null,
    path,
    selection,
  }
}

function restoreFocus(root: ParentNode, snap: FocusSnapshot): void {
  const target = locate(root, snap.id, snap.path)
  if (!target || !(target instanceof HTMLElement)) return
  try {
    target.focus({ preventScroll: true })
  } catch {
    return
  }
  if (
    snap.selection &&
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  ) {
    try {
      target.setSelectionRange(snap.selection.start, snap.selection.end, snap.selection.direction)
    } catch {
      // Some input types throw on setSelectionRange; ignore.
    }
  }
}

function captureScroll(root: ParentNode): ScrollSnapshot {
  // Walk the subtree and snapshot every element with non-zero
  // scroll. Most subtrees have at most a handful, so the per-edit
  // cost is small. Capturing all-zeroes wastes the restore work for
  // no benefit; the filter keeps things tight.
  const out: ScrollSnapshot = []
  const walk = (node: Node): void => {
    if (node instanceof HTMLElement) {
      if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
        const path = pathFromAncestor(root as Node, node)
        if (path !== null) {
          out.push({
            id: node.id || null,
            path,
            scrollTop: node.scrollTop,
            scrollLeft: node.scrollLeft,
          })
        }
      }
    }
    for (let c = node.firstChild; c !== null; c = c.nextSibling) {
      walk(c)
    }
  }
  walk(root as Node)
  return out
}

function restoreScroll(root: ParentNode, snap: ScrollSnapshot): void {
  for (const s of snap) {
    const target = locate(root, s.id, s.path)
    if (!target || !(target instanceof HTMLElement)) continue
    target.scrollTop = s.scrollTop
    target.scrollLeft = s.scrollLeft
  }
}

/**
 * Compute the child-index path from `ancestor` down to `target`, or
 * `null` if `target` isn't in the subtree. The path is what gets
 * walked on restore — no document-wide selectors, no string-encoded
 * selectors that can break on punctuation in IDs.
 */
function pathFromAncestor(ancestor: Node, target: Node): number[] | null {
  const path: number[] = []
  let cur: Node | null = target
  while (cur !== null && cur !== ancestor) {
    const parent: Node | null = cur.parentNode
    if (parent === null) return null
    let idx = 0
    let sib: Node | null = parent.firstChild
    while (sib !== null && sib !== cur) {
      idx++
      sib = sib.nextSibling
    }
    if (sib === null) return null
    path.push(idx)
    cur = parent
  }
  if (cur !== ancestor) return null
  return path.reverse()
}

/**
 * Restore lookup: try `id` first (cheap and resilient to structural
 * change), then walk the captured child-index path. Returns `null`
 * if neither lookup succeeds — the restore caller silently no-ops.
 */
function locate(root: ParentNode, id: string | null, path: number[]): Element | null {
  if (id) {
    const doc = (root as Element).ownerDocument ?? globalThis.document
    if (doc) {
      const byId = doc.getElementById(id)
      if (byId && (root as ParentNode & Node).contains(byId)) return byId
    }
  }
  let cur: Node = root as Node
  for (const idx of path) {
    let child = cur.firstChild
    let i = 0
    while (child && i < idx) {
      child = child.nextSibling
      i++
    }
    if (!child) return null
    cur = child
  }
  return cur instanceof Element ? cur : null
}
