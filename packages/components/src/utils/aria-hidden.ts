/**
 * Hide sibling subtrees from assistive tech while an overlay is open.
 *
 * Walks from `target` up to the document root, applying `aria-hidden="true"`
 * and `inert` to every sibling at each level. Previous attribute values are
 * recorded and restored on cleanup.
 *
 * Nested calls are supported — each layer only touches elements that haven't
 * been claimed by a higher layer (tracked via a WeakMap reference count).
 */

interface Snapshot {
  ariaHidden: string | null
  inert: string | null
}

const ownership = new WeakMap<Element, number>()
const snapshots = new WeakMap<Element, Snapshot>()

export function setAriaHiddenOutside(target: Element): () => void {
  if (typeof document === 'undefined') return () => {}
  const claimed: Element[] = []

  walkSiblings(target, (sibling) => {
    const count = ownership.get(sibling) ?? 0
    if (count === 0) {
      snapshots.set(sibling, {
        ariaHidden: sibling.getAttribute('aria-hidden'),
        inert: sibling.getAttribute('inert'),
      })
      sibling.setAttribute('aria-hidden', 'true')
      sibling.setAttribute('inert', '')
    }
    ownership.set(sibling, count + 1)
    claimed.push(sibling)
  })

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
