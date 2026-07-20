/**
 * Test-side helpers for building and reading child lists under the
 * fractional-index carrier schema.
 *
 * The production code never appends a child "at the end" — it reconciles a whole
 * desired list at once — so these positional helpers exist only so that tests
 * can express "a document with three paragraphs" without restating the
 * allocator. They deliberately go through the real `schema.ts` and `order.ts`
 * entry points rather than writing carrier keys by hand, so a test document is
 * always one a peer could actually have produced.
 */

import type { LoroText } from 'loro-crdt'

import { allocateAt } from '../src/order.js'
import {
  createElementChild,
  createTextChild,
  deleteChild,
  elementChildren,
  elementType,
  newUuid,
  orderedChildren,
  setChildPosition,
  type ChildContainer,
  type ElementContainer,
} from '../src/schema.js'

/** Every child container of `element`, in rendered order. */
export function childContainers(element: ElementContainer): ChildContainer[] {
  return orderedChildren(element).map((entry) => entry.container)
}

/** The child container at rendered index `index`. */
export function childAt(element: ElementContainer, index: number): ChildContainer | undefined {
  return orderedChildren(element)[index]?.container
}

/** The Lexical node types of an element's children, in rendered order. */
export function childTypes(element: ElementContainer): string[] {
  return orderedChildren(element).map((entry) =>
    entry.kind === 'element' ? elementType(entry.container as ElementContainer) : 'text',
  )
}

/** The rendered positions of an element's children — the allocator's input. */
function positionsOf(element: ElementContainer): string[] {
  return orderedChildren(element).map((entry) => entry.pos)
}

/** Append an element child of `type`, returning its attached container. */
export function appendElement(parent: ElementContainer, type: string): ElementContainer {
  const positions = positionsOf(parent)
  const [pos] = allocateAt(positions, positions.length, 1, null)
  return createElementChild(elementChildren(parent), newUuid(), pos!, type)
}

/** Append a text child, returning its attached `LoroText`. */
export function appendText(parent: ElementContainer): LoroText {
  const positions = positionsOf(parent)
  const [pos] = allocateAt(positions, positions.length, 1, null)
  return createTextChild(elementChildren(parent), newUuid(), pos!)
}

/**
 * Move the child at rendered index `from` to rendered index `to` — ONE `pos`
 * register write, which is the whole cost of a same-parent move.
 */
export function moveChild(element: ElementContainer, from: number, to: number): void {
  const current = orderedChildren(element)
  const entry = current[from]
  if (entry === undefined || from === to) return
  const without = current.filter((_, index) => index !== from)
  const [pos] = allocateAt(
    without.map((other) => other.pos),
    Math.max(0, Math.min(to, without.length)),
    1,
    null,
  )
  setChildPosition(entry.carrier, pos!)
}

/** Remove the child at rendered index `index`. */
export function removeChildAt(element: ElementContainer, index: number): void {
  const entry = orderedChildren(element)[index]
  if (entry === undefined) return
  deleteChild(elementChildren(element), entry.uuid)
}
