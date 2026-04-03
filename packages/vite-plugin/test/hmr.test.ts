import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

describe('HMR', () => {
  it('injects HMR accept code in dev mode', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const Counter = component({
        name: 'Counter',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [div({}, [text('hi')])],
      })
    `
    const out = transformLlui(src, 'counter.ts', true)!
    expect(out).toContain('import.meta.hot')
    expect(out).toContain('accept')
  })

  it('does not inject HMR code in production mode', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const Counter = component({
        name: 'Counter',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [div({}, [text('hi')])],
      })
    `
    const out = transformLlui(src, 'counter.ts', false)!
    expect(out).not.toContain('import.meta.hot')
  })
})
