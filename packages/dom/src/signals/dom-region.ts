// Small anchor-bracketed DOM region helpers shared by the structural primitives
// (show/branch/unsafeHtml): clearing the nodes between a pair of anchor comments,
// and cross-env HTML-string parsing.

import type { SignalDoc } from './build-context.js'

/** Snapshot every node strictly between the `start` and `end` anchors (the anchors
 * themselves excluded). A plain array copy — safe to retain and detach later even
 * as the live sibling chain changes underneath it (see {@link removeBetween} for
 * why the snapshot matters). Used by the deferred-leave transition seam to capture
 * exactly a leaving show/branch arm's DOM footprint (its own nodes PLUS any content
 * a nested structural primitive mounted between the anchors) before a new arm is
 * inserted, so the leaving region can be detached precisely when its `leave`
 * promise resolves — without sweeping the incoming arm's nodes. */
export function nodesBetween(start: Node, end: Node): Node[] {
  const out: Node[] = []
  for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) out.push(n)
  return out
}

/** Detach a specific, pre-collected set of nodes (each guarded by its own current
 * parent). The deferred-leave counterpart to {@link removeBetween}: it removes
 * exactly the captured leaving region rather than everything between two anchors,
 * so a leaving arm can be torn down after its animation without disturbing the
 * arm that replaced it. */
export function detachNodes(nodes: readonly Node[]): void {
  for (const n of nodes) n.parentNode?.removeChild(n)
}

/** Remove every node strictly between the `start` and `end` anchors. Used to tear
 * down a show/branch arm: it clears the arm's nodes AND any content a NESTED
 * structural primitive mounted between its own anchors (which is a sibling here,
 * not captured in the arm's `built.nodes`), so swapping/disposing an arm never
 * leaks inner content. The anchors themselves are left in place. */
export function removeBetween(start: Node, end: Node): void {
  // Snapshot the doomed nodes BEFORE removing any. Removing a node that holds
  // focus (e.g. an input in a swapped-out branch arm) dispatches `blur`
  // SYNCHRONOUSLY, which can re-enter the update/reconcile cycle and mutate the
  // sibling chain mid-walk — a live `nextSibling` walk then steps onto a node
  // whose parent has already changed and `removeChild` throws NotFoundError.
  // Collecting first makes the iteration immune to that reentrancy; each removal
  // is still guarded by the node's own current parent (a reentrant teardown may
  // have already detached it).
  detachNodes(nodesBetween(start, end))
}

/** Parse an HTML string to a fragment, cross-env: a server `DomEnv` (and
 * `browserEnv`) exposes `parseHtmlFragment`; a raw client `Document` does not, so
 * fall back to the standard `<template>.innerHTML` parse there. */
export function parseFragment(doc: SignalDoc, html: string): DocumentFragment {
  if (typeof doc.parseHtmlFragment === 'function') return doc.parseHtmlFragment(html)
  const template = doc.createElement('template') as HTMLTemplateElement
  template.innerHTML = html
  return template.content
}
