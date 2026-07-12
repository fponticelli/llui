import { describe, it, expect, afterEach } from 'vitest'
import { getFocusables, isFocusable } from '../../src/utils/focusables'

/** A non-empty DOMRect list, as a laid-out browser box reports. */
function rectList(): DOMRectList {
  const rect = { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }
  return [rect] as unknown as DOMRectList
}
const emptyRectList = [] as unknown as DOMRectList

/** Force a specific geometry on one element (jsdom does no layout). */
function stubGeometry(el: HTMLElement, visible: boolean): void {
  Object.defineProperty(el, 'offsetParent', {
    configurable: true,
    get: () => (visible ? document.body : null),
  })
  Object.defineProperty(el, 'getClientRects', {
    configurable: true,
    value: () => (visible ? rectList() : emptyRectList),
  })
}

/** Make the environment look laid-out so isVisible's geometry test engages. */
function simulateBrowserLayout(): void {
  Object.defineProperty(document.body, 'getClientRects', {
    configurable: true,
    value: () => rectList(),
  })
}

describe('focusables isVisible', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    // Drop the body stub so other tests see the real (layoutless) jsdom env.
    delete (document.body as unknown as Record<string, unknown>).getClientRects
  })

  it('jsdom (layoutless) escape hatch: focusable elements are kept', () => {
    const root = document.createElement('div')
    root.innerHTML = '<button id="b">x</button>'
    document.body.appendChild(root)
    // No browser-layout stub → isLayoutlessEnv is true → geometry check skipped.
    expect(getFocusables(root).map((n) => n.id)).toEqual(['b'])
  })

  it('with layout: display:none (null offsetParent, no rects) is excluded', () => {
    simulateBrowserLayout()
    const root = document.createElement('div')
    root.innerHTML = '<button id="hidden">x</button><button id="shown">y</button>'
    document.body.appendChild(root)
    const [hidden, shown] = Array.from(root.querySelectorAll('button')) as HTMLElement[]
    stubGeometry(hidden!, false)
    stubGeometry(shown!, true)

    expect(getFocusables(root).map((n) => n.id)).toEqual(['shown'])
  })

  it('with layout: position:fixed root (null offsetParent but has rects) is kept', () => {
    simulateBrowserLayout()
    const root = document.createElement('div')
    root.innerHTML = '<button id="fixed">x</button>'
    document.body.appendChild(root)
    const fixed = root.querySelector('button') as HTMLElement
    Object.defineProperty(fixed, 'offsetParent', { configurable: true, get: () => null })
    Object.defineProperty(fixed, 'getClientRects', { configurable: true, value: () => rectList() })

    expect(getFocusables(root).map((n) => n.id)).toEqual(['fixed'])
  })

  it('isFocusable rejects hidden / aria-hidden / disabled / tabindex=-1', () => {
    const mk = (html: string): HTMLElement => {
      const d = document.createElement('div')
      d.innerHTML = html
      return d.firstElementChild as HTMLElement
    }
    expect(isFocusable(mk('<button>x</button>'))).toBe(true)
    expect(isFocusable(mk('<button disabled>x</button>'))).toBe(false)
    expect(isFocusable(mk('<button aria-hidden="true">x</button>'))).toBe(false)
    expect(isFocusable(mk('<button hidden>x</button>'))).toBe(false)
    expect(isFocusable(mk('<div tabindex="-1">x</div>'))).toBe(false)
    expect(isFocusable(mk('<div tabindex="0">x</div>'))).toBe(true)
  })
})
