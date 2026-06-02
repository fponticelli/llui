/**
 * Browser-faithful blur emulation for jsdom.
 *
 * The HTML standard's node-removing steps run a "focus fixup": when the
 * currently-focused element (or an ancestor of it) is removed from the
 * document, the user agent resets focus to the viewport and fires `blur` then
 * `focusout` on the old focus target — SYNCHRONOUSLY, as part of the mutation.
 * Real apps depend on this: an inline-edit `<input>` whose `onBlur` commits,
 * sitting in a structural arm that the commit itself swaps out, fires that blur
 * mid-reconcile and re-enters the reducer.
 *
 * jsdom resets `document.activeElement` to `<body>` on removal but fires NO
 * events, so that reentrancy is invisible in tests — the single most important
 * inline-edit interaction can't be exercised. `emulateBlurOnRemoval` closes the
 * gap by patching the removal-causing mutation methods to dispatch the missing
 * events synchronously, in browser order (`blur`, then the bubbling `focusout`).
 *
 * Opt-in and reversible: returns an uninstall function (call it in `afterEach`),
 * or use {@link withBlurOnRemoval} for automatic scoping.
 *
 * @param doc - document whose `activeElement` is consulted (defaults to the
 *   ambient `document`). The patch is applied to the shared `Node`/`Element`
 *   prototypes, matching the single jsdom document under test.
 * @returns an idempotent uninstall function restoring the native methods.
 */
export function emulateBlurOnRemoval(doc: Document = document): () => void {
  const nodeProto = Node.prototype
  const elementProto = Element.prototype
  const origRemoveChild = nodeProto.removeChild
  const origReplaceChild = nodeProto.replaceChild
  const origRemove = elementProto.remove

  // The focused element must be captured BEFORE the native detach: afterwards
  // jsdom has already reset `activeElement` to <body> and the removed subtree no
  // longer contains it, so containment can only be decided up front.
  const focusedInside = (removed: Node): Element | null => {
    const active = doc.activeElement
    if (active == null || active === doc.body) return null
    return removed === active || removed.contains(active) ? active : null
  }

  const dispatchBlur = (el: Element): void => {
    el.dispatchEvent(new FocusEvent('blur'))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  }

  nodeProto.removeChild = function <T extends Node>(this: Node, child: T): T {
    const blurred = focusedInside(child)
    const removed = origRemoveChild.call(this, child) as T
    if (blurred) dispatchBlur(blurred)
    return removed
  }

  elementProto.remove = function (this: Element): void {
    const blurred = focusedInside(this)
    origRemove.call(this)
    if (blurred) dispatchBlur(blurred)
  }

  nodeProto.replaceChild = function <T extends Node>(this: Node, node: Node, child: T): T {
    const blurred = focusedInside(child)
    const removed = origReplaceChild.call(this, node, child) as T
    if (blurred) dispatchBlur(blurred)
    return removed
  }

  return () => {
    nodeProto.removeChild = origRemoveChild
    nodeProto.replaceChild = origReplaceChild
    elementProto.remove = origRemove
  }
}

/**
 * Run `fn` with {@link emulateBlurOnRemoval} installed, uninstalling afterwards
 * even if `fn` throws. Returns whatever `fn` returns.
 */
export function withBlurOnRemoval<T>(fn: () => T, doc: Document = document): T {
  const uninstall = emulateBlurOnRemoval(doc)
  try {
    return fn()
  } finally {
    uninstall()
  }
}
