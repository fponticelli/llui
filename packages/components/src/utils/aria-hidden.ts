/**
 * Hide sibling subtrees from assistive tech while an overlay is open.
 *
 * Walks from `target` up to the document root, applying `aria-hidden="true"`
 * and `inert` to every sibling at each level. Previous attribute values are
 * recorded and restored on cleanup.
 *
 * Two kinds of element are EXEMPT: registered nested layers (see
 * `registerNestedLayer`) and live regions — `aria-live`, `role="alert"`,
 * `role="status"`, `role="log"`. A live region under `aria-hidden` is simply
 * never read out, so a modal that sweeps one silences the app's announcement
 * channel for exactly as long as it is open (#123). Live regions are matched by
 * selector rather than registration because they are plain part bags with no
 * mount hook of their own, and because that also covers consumer-authored ones.
 *
 * An exempt element does NOT spare its whole ancestor subtree: the sweep
 * descends through any element that merely CONTAINS one and hides everything
 * hanging off the path down to it. (Skipping the ancestor wholesale would leave
 * the entire app interactive behind the modal the moment a form somewhere held
 * an `aria-live` error message.) `inert` and `aria-hidden` both inherit, so
 * leaving the path clear is the only way an exempt element stays reachable.
 *
 * Nested calls are supported — each layer only touches elements that haven't
 * been claimed by a higher layer (tracked via a WeakMap reference count).
 *
 * TWO KNOWN LIMITS of the live-region exemption, both deliberate:
 *
 *  1. `inert` cannot be split from `aria-hidden` — sparing a region spares its
 *     WHOLE SUBTREE from both, so an interactive live region (a `role="log"`
 *     transcript containing links) stays Tab-reachable behind a modal. Keep
 *     live regions to announcement text; put controls outside them, or register
 *     the modal's own layer for the interactive part.
 *  2. `document.querySelectorAll` does not pierce shadow roots, so a live region
 *     inside one is not exempt. The sweep itself only ever walks light-DOM
 *     ancestors of `target`, so this only bites when the region and the modal
 *     live in different trees.
 */

import { getNestedLayers } from './nested-layer.js'

interface Snapshot {
  ariaHidden: string | null
  inert: string | null
}

/**
 * Elements whose whole purpose is to be announced while something else has
 * focus. `aria-live="off"` is explicitly not one.
 *
 * `<output>` is included because it carries an IMPLICIT `role="status"` /
 * `aria-live="polite"` — the one live region the platform gives you without
 * writing a single ARIA attribute, so a selector over explicit attributes alone
 * misses it. `:not([role])` respects the override: an explicit `role` replaces
 * the implicit one, and an `<output role="presentation">` is not a channel.
 */
const LIVE_REGION_SELECTOR =
  '[aria-live="polite"],[aria-live="assertive"],[role="alert"],[role="status"],[role="log"],output:not([role])'

const ownership = new WeakMap<Element, number>()
const snapshots = new WeakMap<Element, Snapshot>()

export function setAriaHiddenOutside(target: Element): () => void {
  if (typeof document === 'undefined') return () => {}
  const claimed: Element[] = []
  // Only layers nested inside `target` are exempt. A layer that merely happens
  // to be open elsewhere on the page is what this sweep exists to hide (#171).
  const exempt = [
    ...getNestedLayers('hide', target),
    ...document.querySelectorAll(LIVE_REGION_SELECTOR),
  ]

  const claim = (el: Element): void => {
    const count = ownership.get(el) ?? 0
    if (count === 0) {
      snapshots.set(el, {
        ariaHidden: el.getAttribute('aria-hidden'),
        inert: el.getAttribute('inert'),
      })
      el.setAttribute('aria-hidden', 'true')
      el.setAttribute('inert', '')
    }
    ownership.set(el, count + 1)
    claimed.push(el)
  }

  /** Hide `el`, or — when it holds an exempt element — hide AROUND it. */
  const hide = (el: Element): void => {
    if (isOrContainsExempt(el, exempt)) {
      if (isExemptItself(el, exempt)) return
      for (const child of Array.from(el.children)) {
        if (!shouldSkip(child)) hide(child)
      }
      return
    }
    claim(el)
  }

  walkSiblings(target, hide)

  return () => {
    for (const el of claimed) {
      const count = (ownership.get(el) ?? 1) - 1
      if (count <= 0) {
        ownership.delete(el)
        const snap = snapshots.get(el)
        snapshots.delete(el)
        if (snap) {
          if (snap.ariaHidden === null) el.removeAttribute('aria-hidden')
          else el.setAttribute('aria-hidden', snap.ariaHidden)
          if (snap.inert === null) el.removeAttribute('inert')
          else el.setAttribute('inert', snap.inert)
        }
      } else {
        ownership.set(el, count)
      }
    }
  }
}

function walkSiblings(target: Element, visit: (sibling: Element) => void): void {
  let node: Element | null = target
  while (node && node !== document.body && node !== document.documentElement) {
    const parent: HTMLElement | null = node.parentElement
    if (!parent) break
    const siblings = Array.from(parent.children)
    for (const child of siblings) {
      if (child !== node && !shouldSkip(child)) {
        visit(child)
      }
    }
    node = parent
  }
}

function shouldSkip(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  return tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'title'
}

/** Whether `el` is, or is an ancestor of, any exempt element. */
function isOrContainsExempt(el: Element, exempt: Element[]): boolean {
  for (const other of exempt) {
    if (el === other || el.contains(other)) return true
  }
  return false
}

/** Whether `el` is an exempt element itself (descending into it is pointless —
 * the whole subtree must stay reachable). */
function isExemptItself(el: Element, exempt: Element[]): boolean {
  return exempt.includes(el)
}
