import { describe, it, expect } from 'vitest'
import { diagnose } from '../src/diagnostics'

function warnings(source: string): string[] {
  return diagnose(source).map((d) => d.message)
}

describe('each() scoped accessor misuse', () => {
  it('warns on direct property access: item.text', () => {
    const src = `
      import { each } from '@llui/dom'
      each({ items: s => s.items, key: t => t.id, render: ({ item, index }) => {
        return [text(item.text)]
      }})
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('item.text') && m.includes('item(t => t.text)'))).toBe(true)
  })
})

describe('.map() on state arrays', () => {
  it('warns on .map() inside view function body', () => {
    const src = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: (state, send) => [
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
        view: (s, send) => [
          div({}, [text(s => String(s.count))]),
        ],
      })
    `
    expect(warnings(src)).toHaveLength(0)
  })
})
