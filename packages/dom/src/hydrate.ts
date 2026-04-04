/**
 * Hydration mode: patches document.createElement/createTextNode/createComment
 * to return existing server-rendered DOM nodes instead of creating new ones.
 *
 * During hydration, view() runs normally but DOM creation calls return
 * pre-existing nodes from the server HTML. Bindings and event listeners
 * are attached to the reused nodes.
 */

interface HydrationCursor {
  parent: Node
  index: number
}

const cursorStack: HydrationCursor[] = []
let hydrating = false

export function isHydrating(): boolean {
  return hydrating
}

export function startHydration(container: HTMLElement): void {
  hydrating = true
  cursorStack.length = 0
  cursorStack.push({ parent: container, index: 0 })
}

export function endHydration(): void {
  hydrating = false
  cursorStack.length = 0
}

/**
 * Claim the next child node from the server HTML.
 * Falls back to creating a new node if none found (mismatch).
 */
export function claimElement(tag: string): HTMLElement {
  if (!hydrating) return document.createElement(tag)

  const cursor = cursorStack[cursorStack.length - 1]!
  const child = cursor.parent.childNodes[cursor.index]

  if (child && child.nodeType === 1 && (child as Element).tagName.toLowerCase() === tag) {
    cursor.index++
    return child as HTMLElement
  }

  // Mismatch — create a new element (hydration mismatch warning)
  if (typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.warn(`[LLui hydration] expected <${tag}> at index ${cursor.index}, got ${child ? `<${(child as Element).tagName?.toLowerCase?.() ?? child.nodeType}>` : 'nothing'}`)
  }
  const el = document.createElement(tag)
  cursor.parent.insertBefore(el, child ?? null)
  cursor.index++
  return el
}

export function claimText(content: string): Text {
  if (!hydrating) return document.createTextNode(content)

  const cursor = cursorStack[cursorStack.length - 1]!
  const child = cursor.parent.childNodes[cursor.index]

  if (child && child.nodeType === 3) {
    cursor.index++
    // Update content in case it differs (reactive initial value)
    if (child.textContent !== content) {
      child.textContent = content
    }
    return child as Text
  }

  // No text node — create one
  const text = document.createTextNode(content)
  cursor.parent.insertBefore(text, child ?? null)
  cursor.index++
  return text
}

export function claimComment(content: string): Comment {
  if (!hydrating) return document.createComment(content)

  const cursor = cursorStack[cursorStack.length - 1]!
  const child = cursor.parent.childNodes[cursor.index]

  if (child && child.nodeType === 8) {
    cursor.index++
    return child as Comment
  }

  const comment = document.createComment(content)
  cursor.parent.insertBefore(comment, child ?? null)
  cursor.index++
  return comment
}

/**
 * Push cursor into an element's children.
 * Called when view() starts appending children to an element.
 */
export function pushCursor(parent: Node): void {
  if (hydrating) {
    cursorStack.push({ parent, index: 0 })
  }
}

/**
 * Pop cursor back to parent.
 * Called when view() finishes appending children to an element.
 */
export function popCursor(): void {
  if (hydrating) {
    cursorStack.pop()
  }
}
