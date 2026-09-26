import { afterEach, describe, expect, it } from 'vitest'
import { focusRovingItem } from '../src/index'

function mountTwoInstances(scope: string): { first: HTMLElement; second: HTMLElement } {
  document.body.innerHTML = `
    <div data-scope="${scope}" data-part="root" id="first">
      <button data-scope="${scope}" data-part="item" data-value="a" tabindex="-1">A1</button>
      <button data-scope="${scope}" data-part="item" data-value="b" tabindex="-1">B1</button>
    </div>
    <div data-scope="${scope}" data-part="root" id="second">
      <button data-scope="${scope}" data-part="item" data-value="a" tabindex="-1">A2</button>
      <button data-scope="${scope}" data-part="item" data-value="b" tabindex="-1">B2</button>
    </div>
  `
  return {
    first: document.getElementById('first')!,
    second: document.getElementById('second')!,
  }
}

describe('focusRovingItem', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it("focuses the matching item WITHIN the origin's own root, never a sibling instance of the same scope", () => {
    // Two same-scope roots on one page (#264 review, previous-finding
    // partial): a document-wide `querySelector` fallback would resolve
    // "value=b" against whichever root's item happens to come first in DOM
    // order, regardless of which instance the origin belongs to — silently
    // moving focus into a completely different widget.
    const { first, second } = mountTwoInstances('carousel-roving-test')
    const originInFirst = first.querySelector('[data-value="a"]') as HTMLElement

    focusRovingItem(originInFirst, 'carousel-roving-test', 'b')

    expect(document.activeElement).toBe(first.querySelector('[data-value="b"]'))
    expect(document.activeElement).not.toBe(second.querySelector('[data-value="b"]'))
  })

  it('does not fall back to a document-wide search when the origin has no scoped root', () => {
    mountTwoInstances('carousel-roving-test-2')
    const orphan = document.createElement('button')
    document.body.appendChild(orphan)

    focusRovingItem(orphan, 'carousel-roving-test-2', 'a')

    // No-op: focus must stay wherever it was (nothing focused anything),
    // never land on some OTHER instance's item merely because the scope
    // name matched somewhere on the page.
    expect(document.activeElement).not.toBe(
      document.querySelector('[data-scope="carousel-roving-test-2"][data-value="a"]'),
    )
  })

  it('no-ops on a null origin', () => {
    mountTwoInstances('carousel-roving-test-3')
    expect(() => focusRovingItem(null, 'carousel-roving-test-3', 'a')).not.toThrow()
  })
})
