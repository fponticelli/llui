import { afterEach, describe, expect, it } from 'vitest'
import { getFocusables, isFocusable } from '../src/index'

/** Stub the only getClientRects signal that focusability observes. */
function stubClientRectCount(element: HTMLElement, length: number): void {
  Object.defineProperty(element, 'getClientRects', {
    configurable: true,
    value: () => ({ length }),
  })
}

function elementFrom(html: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  return wrapper.firstElementChild as HTMLElement
}

describe('focusability', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    Reflect.deleteProperty(document.body, 'getClientRects')
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
    stubClientRectCount(document.body, 1)
    for (const candidate of container.querySelectorAll<HTMLElement>('*')) {
      Object.defineProperty(candidate, 'offsetParent', {
        configurable: true,
        get: () => (candidate.id === 'invisible' ? null : document.body),
      })
      stubClientRectCount(candidate, candidate.id === 'invisible' ? 0 : 1)
    }

    const focusables = getFocusables(container)

    expect(focusables.map((element) => element.id)).toEqual(['button', 'link', 'tabindex'])
    expect(focusables.every(isFocusable)).toBe(true)
  })
})
