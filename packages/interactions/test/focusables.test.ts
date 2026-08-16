import { afterEach, describe, expect, it } from 'vitest'
import { getFocusables, isFocusable } from '../src/index'

/** A non-empty DOMRect list, as a laid-out browser box reports. */
function rectList(): DOMRectList {
  const rect = { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }
  return [rect] as unknown as DOMRectList
}

const emptyRectList = [] as unknown as DOMRectList

function elementFrom(html: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  return wrapper.firstElementChild as HTMLElement
}

describe('focusability', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    delete (document.body as unknown as Record<string, unknown>).getClientRects
  })

  it('excludes natively focusable elements with a negative tabindex', () => {
    const container = elementFrom(`
      <div>
        <button id="button" tabindex="-1">Button item</button>
        <a id="link" href="/item" tabindex="-1">Link item</a>
      </div>
    `)

    expect(getFocusables(container)).toEqual([])
  })

  it('enumerates only tab-reachable, visible, non-inert descendants', () => {
    const container = elementFrom(`
      <div>
        <button id="button">Button</button>
        <a id="link" href="/item">Link</a>
        <div id="tabindex" tabindex="0">Custom control</div>
        <button id="negative-button" tabindex="-1">Programmatic button</button>
        <a id="negative-link" href="/item" tabindex="-2">Programmatic link</a>
        <button id="aria-hidden-button" aria-hidden="true">ARIA-hidden button</button>
        <a id="aria-hidden-link" href="/item" aria-hidden="true">ARIA-hidden link</a>
        <div id="aria-hidden-tabindex" tabindex="0" aria-hidden="true">ARIA-hidden custom control</div>
        <button id="disabled" disabled>Disabled</button>
        <button id="hidden" hidden>Hidden</button>
        <button id="invisible">Invisible</button>
        <div inert><button id="inert">Inert</button></div>
      </div>
    `)
    document.body.append(container)
    Object.defineProperty(document.body, 'getClientRects', {
      configurable: true,
      value: () => rectList(),
    })
    for (const candidate of container.querySelectorAll<HTMLElement>('*')) {
      Object.defineProperty(candidate, 'offsetParent', {
        configurable: true,
        get: () => (candidate.id === 'invisible' ? null : document.body),
      })
      Object.defineProperty(candidate, 'getClientRects', {
        configurable: true,
        value: () => (candidate.id === 'invisible' ? emptyRectList : rectList()),
      })
    }

    const focusables = getFocusables(container)

    expect(focusables.map((element) => element.id)).toEqual(['button', 'link', 'tabindex'])
    expect(focusables.every(isFocusable)).toBe(true)
  })
})
