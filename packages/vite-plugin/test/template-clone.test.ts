import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

describe('template clone output', () => {
  it('returns firstChild (Element), not the DocumentFragment', () => {
    const src = `
      import { component, div, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'static' }, [text('hello')]),
        ],
      })
    `
    const out = transformLlui(src, 'test.ts')!
    expect(out).toContain('cloneNode')
    // Must extract firstChild from the fragment to get the actual element
    expect(out).toContain('firstChild')
  })
})
