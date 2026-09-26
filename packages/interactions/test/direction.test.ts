import { afterEach, describe, expect, it } from 'vitest'
import { resolveDir } from '../src/direction'

const cleanup: Element[] = []
afterEach(() => {
  for (const el of cleanup.splice(0)) el.remove()
})

function attach<T extends Element>(el: T): T {
  document.body.append(el)
  cleanup.push(el)
  return el
}

describe('resolveDir', () => {
  it('defaults to ltr with no dir attribute anywhere', () => {
    const el = attach(document.createElement('div'))
    expect(resolveDir(el)).toBe('ltr')
  })

  it('resolves from the nearest ancestor dir attribute', () => {
    const root = attach(document.createElement('div'))
    root.dir = 'rtl'
    const child = document.createElement('span')
    root.append(child)
    expect(resolveDir(child)).toBe('rtl')
  })

  it('falls back to the document root direction when no ancestor sets dir', () => {
    document.documentElement.dir = 'rtl'
    try {
      const el = attach(document.createElement('div'))
      expect(resolveDir(el)).toBe('rtl')
    } finally {
      document.documentElement.dir = ''
    }
  })

  it("falls back to the element's OWN document, not the global document (multi-document/iframe safety)", () => {
    const iframe = attach(document.createElement('iframe'))
    const otherDoc = iframe.contentDocument
    if (otherDoc === null) return // jsdom iframe content document unavailable in this environment
    otherDoc.documentElement.dir = 'rtl'
    const el = otherDoc.createElement('div')
    otherDoc.body.append(el)
    // The outer (global) document stays 'ltr' throughout; only the iframe's
    // OWN document is rtl. A resolver reading the global `document` for this
    // fallback would answer 'ltr' here, which is wrong for this element.
    expect(document.documentElement.dir).not.toBe('rtl')
    expect(resolveDir(el)).toBe('rtl')
  })

  it("crosses a shadow boundary to find the host tree's dir attribute", () => {
    const host = attach(document.createElement('div'))
    host.dir = 'rtl'
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    shadow.append(inner)
    expect(resolveDir(inner)).toBe('rtl')
  })

  it('stops at the nearest dir even when it is inside the shadow tree', () => {
    const host = attach(document.createElement('div'))
    host.dir = 'rtl'
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    inner.dir = 'ltr'
    shadow.append(inner)
    expect(resolveDir(inner)).toBe('ltr')
  })

  it('crosses NESTED shadow boundaries', () => {
    const outerHost = attach(document.createElement('div'))
    outerHost.dir = 'rtl'
    const outerShadow = outerHost.attachShadow({ mode: 'open' })
    const innerHost = document.createElement('div')
    outerShadow.append(innerHost)
    const innerShadow = innerHost.attachShadow({ mode: 'open' })
    const deepest = document.createElement('span')
    innerShadow.append(deepest)
    expect(resolveDir(deepest)).toBe('rtl')
  })
})
