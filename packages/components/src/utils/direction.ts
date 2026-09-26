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
 * Observe the exact component root and its live ancestor chain after mount.
 * Child-list observation covers relocation between differently directed
 * ancestors; the Mountable cleanup disconnects all observation.
 */
export function directionSyncMount(rootId: string, sync: (dir: 'ltr' | 'rtl') => void): Mountable {
  return onMount((container) => {
    let currentRoot: Element | null = getElementByIdInScope(container, rootId)
    let lastDirection: 'ltr' | 'rtl' | undefined
    let observer: MutationObserver | null = null
    let observing = false
    const observeCurrentChain = (): void => {
      if (observing) observer?.disconnect()
      observing = false
      if (observer === null || currentRoot === null) return
      const observation = directionObservation(currentRoot)
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
    if (typeof MutationObserver === 'undefined') return
    observer = new MutationObserver((records) => {
      if (
        !records.some(
          (record) => record.type === 'attributes' || mutationRemovedRoot(record, currentRoot!),
        )
      )
        return
      synchronize()
      observeCurrentChain()
    })
    observeCurrentChain()
    return () => observer.disconnect()
  })
}
