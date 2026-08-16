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

  it('excludes descendants whose ancestor or container is aria-hidden', () => {
    const container = elementFrom(`
      <div>
        <div aria-hidden="true"><button id="nested">Nested</button></div>
        <button id="direct">Direct</button>
      </div>
    `)
    const nested = container.querySelector<HTMLElement>('#nested')!
    const direct = container.querySelector<HTMLElement>('#direct')!

    expect(isFocusable(nested)).toBe(false)
    expect(getFocusables(container).map((element) => element.id)).toEqual(['direct'])

    container.setAttribute('aria-hidden', 'true')
    expect(isFocusable(direct)).toBe(false)
    expect(getFocusables(container)).toEqual([])
  })

  it('excludes descendants whose ancestor or container is inert', () => {
    const container = elementFrom(`
      <div>
        <div inert><button id="nested">Nested</button></div>
        <button id="direct">Direct</button>
      </div>
    `)
    const nested = container.querySelector<HTMLElement>('#nested')!
    const direct = container.querySelector<HTMLElement>('#direct')!

    expect(isFocusable(nested)).toBe(false)
    expect(getFocusables(container).map((element) => element.id)).toEqual(['direct'])

    container.setAttribute('inert', '')
    expect(isFocusable(direct)).toBe(false)
    expect(getFocusables(container)).toEqual([])
  })

  it('excludes descendants of hidden ancestors in a layoutless environment', () => {
    const container = elementFrom(`
      <div>
        <div hidden><button id="nested">Nested</button></div>
        <button id="direct">Direct</button>
      </div>
    `)
    document.body.append(container)

    expect(getFocusables(container).map((element) => element.id)).toEqual(['direct'])

    container.hidden = true
    expect(getFocusables(container)).toEqual([])
  })

  it('excludes candidates hidden by computed CSS visibility before the layoutless fallback', () => {
    const style = document.createElement('style')
    style.textContent = '.concealed { visibility: hidden }'
    const container = elementFrom(`
      <div>
        <button id="concealed" class="concealed">Concealed</button>
        <button id="visible">Visible</button>
      </div>
    `)
    document.body.append(style, container)

    expect(getFocusables(container).map((element) => element.id)).toEqual(['visible'])
  })

  it('honors disabled fieldset inheritance and its first-legend exception', () => {
    const container = elementFrom(`
      <div>
        <fieldset disabled>
          <legend><button id="first-legend">First legend</button></legend>
          <legend><button id="second-legend">Second legend</button></legend>
          <button id="fieldset-control">Fieldset control</button>
        </fieldset>
      </div>
    `)
    const firstLegend = container.querySelector<HTMLElement>('#first-legend')!
    const secondLegend = container.querySelector<HTMLElement>('#second-legend')!
    const fieldsetControl = container.querySelector<HTMLElement>('#fieldset-control')!

    expect(isFocusable(firstLegend)).toBe(true)
    expect(isFocusable(secondLegend)).toBe(false)
    expect(isFocusable(fieldsetControl)).toBe(false)
    expect(getFocusables(container).map((element) => element.id)).toEqual(['first-legend'])
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
