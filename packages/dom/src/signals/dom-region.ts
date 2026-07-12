// Small anchor-bracketed DOM region helpers shared by the structural primitives
// (show/branch/unsafeHtml): clearing the nodes between a pair of anchor comments,
// and cross-env HTML-string parsing.

import type { SignalDoc } from './build-context.js'

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
  const doomed: Node[] = []
  for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) doomed.push(n)
  for (const n of doomed) n.parentNode?.removeChild(n)
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
