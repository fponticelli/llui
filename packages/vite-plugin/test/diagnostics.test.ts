import { describe, it, expect } from 'vitest'
import { diagnose } from '../src/diagnostics'

function warnings(source: string): string[] {
  return diagnose(source).map((d) => d.message)
}

describe('.map() on state arrays', () => {
  it('warns on .map() inside view function body', () => {
    const src = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({}, state.items.map(item => div({}, [text(item.name)]))),
        ],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('.map()') && m.includes('each()'))).toBe(true)
  })
})

describe('exhaustive update()', () => {
  it('warns when switch is missing a case from Msg union', () => {
    const src = `
      import { component } from '@llui/dom'
      type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }
      export const C = component<{ count: number }, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc': return [{ count: state.count + 1 }, []]
            case 'dec': return [{ count: state.count - 1 }, []]
          }
        },
        view: () => [],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('reset') && m.includes('update()'))).toBe(true)
  })

  it('does not warn when all cases are handled', () => {
    const src = `
      import { component } from '@llui/dom'
      type Msg = { type: 'inc' } | { type: 'dec' }
      export const C = component<{ count: number }, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc': return [{ count: state.count + 1 }, []]
            case 'dec': return [{ count: state.count - 1 }, []]
          }
        },
        view: () => [],
      })
    `
    const w = warnings(src)
    expect(w.filter((m) => m.includes('update()'))).toHaveLength(0)
  })

  it('does not warn when default case exists', () => {
    const src = `
      import { component } from '@llui/dom'
      type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }
      export const C = component<{ count: number }, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc': return [{ count: state.count + 1 }, []]
            default: return [state, []]
          }
        },
        view: () => [],
      })
    `
    const w = warnings(src)
    expect(w.filter((m) => m.includes('update()'))).toHaveLength(0)
  })
})

describe('accessibility', () => {
  it('warns on img without alt', () => {
    const src = `
      import { img } from '@llui/dom'
      const el = img({ src: 'photo.jpg' })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('<img>') && m.includes('alt'))).toBe(true)
  })

  it('does not warn on img with alt', () => {
    const src = `
      import { img } from '@llui/dom'
      const el = img({ src: 'photo.jpg', alt: 'A photo' })
    `
    const w = warnings(src)
    expect(w.filter((m) => m.includes('<img>'))).toHaveLength(0)
  })

  it('warns on onClick on non-interactive element without role', () => {
    const src = `
      import { div } from '@llui/dom'
      const el = div({ onClick: handler })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('onClick') && m.includes('role'))).toBe(true)
  })

  it('does not warn on onClick on button', () => {
    const src = `
      import { button } from '@llui/dom'
      const el = button({ onClick: handler })
    `
    const w = warnings(src)
    expect(w.filter((m) => m.includes('onClick'))).toHaveLength(0)
  })
})

describe('controlled input without handler', () => {
  it('warns on input with reactive value but no onInput', () => {
    const src = `
      import { input } from '@llui/dom'
      const el = input({ value: s => s.name })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('value') && m.includes('onInput'))).toBe(true)
  })

  it('does not warn when onInput is present', () => {
    const src = `
      import { input } from '@llui/dom'
      const el = input({ value: s => s.name, onInput: handler })
    `
    const w = warnings(src)
    expect(w.filter((m) => m.includes('onInput'))).toHaveLength(0)
  })
})

describe('no warnings for clean code', () => {
  it('warns on namespace import from @llui/dom', () => {
    const src = `
      import * as L from '@llui/dom'
      export const foo = L.div({}, [L.text('hi')])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Namespace import') && m.includes("'L'"))).toBe(true)
  })

  it('does not warn on named imports', () => {
    const src = `import { div, text } from '@llui/dom'; div({}, [text('hi')])`
    const w = warnings(src)
    expect(w.some((m) => m.includes('Namespace import'))).toBe(false)
  })

  it('warns on spread in children array', () => {
    const src = `
      import { div, text } from '@llui/dom'
      const children = [text('a'), text('b')]
      export const el = div({}, [text('start'), ...children])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children') && m.includes('div'))).toBe(true)
  })

  it('does not warn on spread of structural primitive calls', () => {
    const src = `
      import { div, text, each, show, branch, portal } from '@llui/dom'
      const a = div({}, [...each({ items: (s) => s.items, key: (x) => x, render: () => [] })])
      const b = div({}, [...show({ when: (s) => s.flag, render: () => [] })])
      const c = div({}, [...branch({ on: (s) => s.x, cases: {} })])
      const d = div({}, [...portal({ target: 'body', render: () => [] })])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children'))).toBe(false)
  })

  it('does not warn on spread of method calls named like structural primitives', () => {
    const src = `
      import { div } from '@llui/dom'
      const myComponent = { overlay: () => [] }
      const el = div({}, [...myComponent.overlay()])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children'))).toBe(false)
  })

  it('still warns on spread of plain arrays', () => {
    const src = `
      import { div, text } from '@llui/dom'
      const items = [text('a'), text('b')]
      const el = div({}, [...items])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children'))).toBe(true)
  })

  it('warns on spread of array .map() result', () => {
    const src = `
      import { div, text } from '@llui/dom'
      const names = ['a', 'b']
      const el = div({}, [...names.map((n) => text(n))])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children'))).toBe(true)
  })

  it('does not warn on spread of user helper function', () => {
    const src = `
      import { div } from '@llui/dom'
      const renderItems = () => []
      const el = div({}, [...renderItems()])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children'))).toBe(false)
  })

  it('returns empty array for well-formed component', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      type Msg = { type: 'inc' }
      export const C = component<{ count: number }, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc': return [{ count: state.count + 1 }, []]
          }
        },
        view: (send) => [
          div([text(s => String(s.count))]),
        ],
      })
    `
    expect(warnings(src)).toHaveLength(0)
  })

  it('warns on empty props object passed to element helper', () => {
    const src = `
      import { h1, text } from '@llui/dom'
      export const el = h1({}, [text('todos')])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Empty props') && m.includes('h1'))).toBe(true)
  })

  it('does not warn when props object has entries', () => {
    const src = `
      import { h1, text } from '@llui/dom'
      export const el = h1({ class: 'title' }, [text('todos')])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Empty props'))).toBe(false)
  })

  it('does not warn when attrs argument is omitted', () => {
    const src = `
      import { h1, text } from '@llui/dom'
      export const el = h1([text('todos')])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Empty props'))).toBe(false)
  })
})
