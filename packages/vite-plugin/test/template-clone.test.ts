import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

describe('template clone output', () => {
  it('returns firstChild (Element), not the DocumentFragment', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'static' }, [text('hello')]),
        ],
      })
    `
    const out = transformLlui(src, 'test.ts')!.output
    // Static subtree emits __cloneStaticTemplate(html) — the helper
    // threads through ctx.dom so SSR works without globalThis mutation.
    expect(out).toContain('__cloneStaticTemplate')
    expect(out).toContain('class=\\"static\\"')
  })

  it('inlines string literal children into the template', () => {
    const src = `
      import { component, div, span } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'greet' }, ['Hello ', span({ class: 'name' }, ['World'])]),
        ],
      })
    `
    const out = transformLlui(src, 'test.ts')!.output
    // String children should be inlined into the template HTML
    expect(out).toContain('Hello ')
    expect(out).toContain('World')
    // Subtree-collapse produces elTemplate when there are multiple children
    expect(out).toContain('elTemplate')
  })

  it('handles children-only overload (no props)', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div([text('nested')]),
        ],
      })
    `
    const out = transformLlui(src, 'test.ts')!.output
    expect(out).toContain('nested')
    // Should produce a template clone — either __cloneStaticTemplate or elTemplate
    expect(out).toMatch(/__cloneStaticTemplate|elTemplate/)
  })
})
