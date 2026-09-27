import { onMount, type Mountable } from '@llui/dom'
import { resolveDir, flipArrow, resolveTextDirection } from '@llui/interactions'
import { getElementByIdInScope } from './root-scope.js'

export { resolveDir, flipArrow, resolveTextDirection }
export type { TextDirection } from '@llui/interactions'

export type DirectionSource = 'dom' | 'explicit'

export interface DirectionState {
  readonly dir: 'ltr' | 'rtl'
  readonly dirSource: DirectionSource
}

/** Deterministic on the server; omitted direction is resolved only after mount. */
export function initDirection(dir: 'ltr' | 'rtl' | undefined): DirectionState {
  return dir === undefined ? { dir: 'ltr', dirSource: 'dom' } : { dir, dirSource: 'explicit' }
}

/** Public configuration becomes authoritative over future ancestor observation. */
export function setDirection<T extends DirectionState>(state: T, dir: 'ltr' | 'rtl'): T {
  if (state.dir === dir && state.dirSource === 'explicit') return state
  return { ...state, dir, dirSource: 'explicit' }
}

/** Apply an internal DOM observation only while direction remains automatic. */
export function syncDomDirection<T extends DirectionState>(state: T, dir: 'ltr' | 'rtl'): T {
  if (state.dirSource === 'explicit' || state.dir === dir) return state
  return { ...state, dir }
}

/**
 * The EXPLICIT direction to hand an overlay's `floating.dir`, or `undefined`
 * while direction is still automatic (`dirSource === 'dom'`). `undefined` is
 * not "unknown": the overlay engine then resolves the direction from the
 * overlay's placement ANCHOR — the trigger, in the app's own container — and
 * writes it on the portaled floating element, so geometry, CSS and key
 * handlers inside the portal all agree with the trigger (#265 finding 6).
 * Passing the state's `dir` unconditionally (#265 A1) mirrored every floating
 * surface on an RTL page as LTR: the untouched state default said `'ltr'`
 * while the DOM said `'rtl'`. Once a consumer calls `setDir`/passes `dir`,
 * `dirSource` is `'explicit'` and that value wins over the DOM.
 */
export function floatingDir(state: DirectionState): 'ltr' | 'rtl' | undefined {
  return state.dirSource === 'explicit' ? state.dir : undefined
}

/** Resolve direction at event time so same-tick ancestor changes are correct.
 * Routes through `@llui/interactions`' `resolveDir` — the package's documented
 * single source of truth for DOM-derived direction — rather than a second,
 * independently-maintained ancestor walk. */
export function eventDirection(state: DirectionState, origin: Element | null): 'ltr' | 'rtl' {
  return state.dirSource === 'explicit' || origin === null ? state.dir : resolveDir(origin)
}

interface DirectionObservation {
  readonly attributes: Element[]
  readonly childLists: Node[]
}

function directionObservation(root: Element): DirectionObservation {
  const attributes: Element[] = []
  const childLists: Node[] = []
  let current: Node = root
  while (current instanceof Element) {
    attributes.push(current)
    const parent = current.parentNode
    if (parent instanceof Element) {
      childLists.push(parent)
      current = parent
      continue
    }
    if (parent instanceof ShadowRoot) {
      childLists.push(parent)
      current = parent.host
      continue
    }
    break
  }
  return { attributes, childLists }
}

function mutationRemovedRoot(record: MutationRecord, root: Element): boolean {
  if (record.type !== 'childList') return false
  return [...record.removedNodes].some(
    (node) => node === root || (node instanceof Element && node.contains(root)),
  )
}

/**
 * Watch every `dir` that can decide `target()`'s resolved direction: `dir`
 * attributes on the element and its live ancestor chain (across shadow
 * roots), and child-list changes that relocate it between differently
 * directed ancestors. Calls `onChange` after any such mutation — the caller
 * re-resolves — then re-observes the chain `target()` names NOW, so a
 * relocated or replaced element keeps being watched. Returns a disconnect.
 * A no-op where `MutationObserver` does not exist (SSR).
 */
export function watchDirection(target: () => Element | null, onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  let observed: Element | null = null
  let observing = false
  const observer = new MutationObserver((records) => {
    const watched = observed
    if (
      !records.some(
        (record) =>
          record.type === 'attributes' ||
          (watched !== null && mutationRemovedRoot(record, watched)),
      )
    )
      return
    onChange()
    observe()
  })
  const observe = (): void => {
    if (observing) observer.disconnect()
    observing = false
    observed = target()
    if (observed === null) return
    const observation = directionObservation(observed)
    const options = new Map<Node, MutationObserverInit>()
    for (const element of observation.attributes) {
      options.set(element, { attributes: true, attributeFilter: ['dir'] })
    }
    for (const node of observation.childLists) {
      options.set(node, { ...options.get(node), childList: true })
    }
    for (const [node, option] of options) observer.observe(node, option)
    observing = options.size > 0
  }
  observe()
  return () => observer.disconnect()
}

/**
 * Observe the exact component root and its live ancestor chain after mount.
 * Child-list observation covers relocation between differently directed
 * ancestors; the Mountable cleanup disconnects all observation.
 */
export function directionSyncMount(rootId: string, sync: (dir: 'ltr' | 'rtl') => void): Mountable {
  return onMount((container) => {
    let currentRoot: Element | null = getElementByIdInScope(container, rootId)
    let lastDirection: 'ltr' | 'rtl' | undefined
    const synchronize = (): void => {
      const scopedRoot = getElementByIdInScope(container, rootId)
      if (scopedRoot !== null) currentRoot = scopedRoot
      if (currentRoot === null || !currentRoot.isConnected) return
      const direction = resolveDir(currentRoot)
      if (direction === lastDirection) return
      lastDirection = direction
      sync(direction)
    }
    synchronize()
    return watchDirection(() => currentRoot, synchronize)
  })
}
