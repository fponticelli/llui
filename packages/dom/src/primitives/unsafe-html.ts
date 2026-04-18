import type { StructuralBlock } from '../structural.js'
import { getRenderContext } from '../render-context.js'
import { FULL_MASK } from '../update-loop.js'

/**
 * Insert raw HTML into the DOM tree.
 *
 * **Security.** The caller is responsible for sanitizing `html`. Never
 * interpolate unsanitized user input — this is the XSS escape hatch and
 * the name carries the warning deliberately.
 *
 * **Opaque to the framework.** The parsed subtree is treated as a black
 * box by LLui — no bindings, events, `each`, `show`, or `child` inside
 * it will be discovered or driven by the framework. Use element helpers
 * for anything that needs to react to state or dispatch messages.
 *
 * **Static form.** `unsafeHtml('<b>hi</b>')` parses once at view time
 * and returns the parsed nodes. Zero reactive overhead.
 *
 * **Reactive form.** `unsafeHtml((s) => s.markdownHtml)` registers a
 * structural block that re-parses when the returned string differs
 * (strict `===`) from the previous value. Unchanged strings short-
 * circuit — existing DOM identity (focus, selection, listeners
 * attached outside LLui) is preserved.
 *
 * **Mask hint.** The second parameter mirrors `text()`: the compiler
 * passes a precise mask derived from which state fields the accessor
 * reads. Phase 2 / Phase 1 skip the reconcile when no interesting bit
 * is set. Defaults to FULL_MASK for hand-written components.
 */
export function unsafeHtml<S>(accessor: ((s: S) => string) | string, mask?: number): Node[] {
  if (typeof accessor === 'string') {
    return parseHtmlToNodes(accessor)
  }

  const ctx = getRenderContext('unsafeHtml')
  const blocks = ctx.structuralBlocks
  const blockMask = mask ?? FULL_MASK

  const anchor = document.createComment('unsafeHtml')
  let currentHtml = accessor(ctx.state as S)
  let currentNodes: Node[] = parseHtmlToNodes(currentHtml)

  const block: StructuralBlock = {
    mask: blockMask,
    reconcile(state: unknown) {
      const newHtml = accessor(state as S)
      // Identity short-circuit — don't rebuild the subtree when the
      // author handed us the same string. Preserves focus, selection,
      // and any listeners outside LLui's view of the world.
      if (newHtml === currentHtml) return

      const parent = anchor.parentNode
      if (!parent) return

      const oldNodes = currentNodes
      currentNodes = parseHtmlToNodes(newHtml)
      currentHtml = newHtml

      // The anchor sits immediately before the current node range, so
      // `anchor.nextSibling` is the first old node (or whatever follows
      // when the old list is empty). Insert new nodes there, then
      // remove the old ones — matches `branch()`'s enter/leave order so
      // transitions can inspect both sets.
      const ref = anchor.nextSibling
      for (const node of currentNodes) {
        parent.insertBefore(node, ref)
      }
      for (const node of oldNodes) {
        if (node.parentNode) node.parentNode.removeChild(node)
      }
    },
  }
  blocks.push(block)

  return [anchor, ...currentNodes]
}

function parseHtmlToNodes(html: string): Node[] {
  // `<template>` parses into an inert DocumentFragment without running
  // scripts, resolving images, or firing connection callbacks. The
  // childNodes live reference is stable until we move the nodes out.
  const template = document.createElement('template')
  template.innerHTML = html
  // Snapshot — moving nodes to a parent drains template.content, but
  // callers hold this array and we iterate it on reconcile.
  return Array.from(template.content.childNodes)
}
