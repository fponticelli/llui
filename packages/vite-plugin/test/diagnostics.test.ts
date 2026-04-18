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

  it('silent on spread of a locally-bounded array-literal binding', () => {
    // Scope-aware: `children` resolves to a `const = [...]` array
    // literal — bounded, each() is not a usable fix. The warning
    // previously fired here; the scope-aware path demotes it.
    const src = `
      import { div, text } from '@llui/dom'
      const children = [text('a'), text('b')]
      export const el = div({}, [text('start'), ...children])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children'))).toBe(false)
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

  it('silent on spread of a named array-literal binding', () => {
    // Same scope-aware relaxation as above — `items` binds to a `const =
    // [...]` array literal, so the spread is bounded.
    const src = `
      import { div, text } from '@llui/dom'
      const items = [text('a'), text('b')]
      const el = div({}, [...items])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children'))).toBe(false)
  })

  it('silent on .map() over a named bounded receiver', () => {
    // `names` resolves to `const = ['a', 'b']` — a known-length array
    // literal. `.map` over it produces a bounded Node[]; each() adds no
    // value. Inline `[...].map(...)` still fires — see "warns on inline
    // array-method spread" below.
    const src = `
      import { div, text } from '@llui/dom'
      const names = ['a', 'b']
      const el = div({}, [...names.map((n) => text(n))])
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('Spread in children'))).toBe(false)
  })

  it('warns on inline array-method spread', () => {
    // `...[1,2,3].map(...)` — inline literal receiver. The scope-aware
    // relaxation only silences NAMED bounded receivers; inline shapes
    // stay suspect so authors see the warning on the canonical dynamic
    // mapping shape.
    const src = `
      import { div, text } from '@llui/dom'
      const el = div({}, [...[1, 2, 3].map((n) => text(String(n)))])
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

describe('bitmask overflow (>31 state paths)', () => {
  function manyPaths(prefix: string, count: number): string {
    return Array.from({ length: count }, (_, i) => `text((s) => s.${prefix}.f${i})`).join(
      ',\n          ',
    )
  }

  it('does not warn under the 31-path limit', () => {
    // 20 paths under `a` — the compiler also tracks the parent `a` itself,
    // so the effective count is ~21, well under the limit.
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ a: { f0: 0 } }, []],
        update: (s, m) => [s, []],
        view: (h) => [
          div({}, [
            ${manyPaths('a', 20)}
          ]),
        ],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('31-path limit'))).toBe(false)
  })

  it('warns when paths exceed 31 and names the largest top-level fields', () => {
    // Many paths under `huge`, fewer under `medium` and `small`
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ huge: {}, medium: {}, small: {} }, []],
        update: (s, m) => [s, []],
        view: (h) => [
          div({}, [
            ${manyPaths('huge', 20)},
            ${manyPaths('medium', 8)},
            ${manyPaths('small', 8)}
          ]),
        ],
      })
    `
    const w = warnings(src)
    const overflow = w.find((m) => m.includes('31-path limit'))
    expect(overflow).toBeDefined()
    // Reports total path count
    expect(overflow).toMatch(/\d+ unique state access paths/)
    // Reports overflow amount
    expect(overflow).toMatch(/\d+ past the 31-path limit/)
    // Reports breakdown sorted by count: huge first, then medium/small
    expect(overflow).toMatch(/huge \(\d+\).*medium \(\d+\).*small \(\d+\)/)
    // Recommends extracting the largest field
    expect(overflow).toContain('`huge`')
    // Mentions child() as the recommended fix
    expect(overflow).toContain('child()')
    // Mentions sliceHandler as alternative
    expect(overflow).toContain('sliceHandler')
  })

  it('does not fire on false-positive paths (each key / item / array callbacks / user helpers)', () => {
    // Drive the legitimate path count right up to the 31-path ceiling:
    // 29 fields under `a` (depth-truncated to `a.fN`) + top-level `items`
    // + top-level `msgs` = 31. Then sprinkle the four false-positive
    // shapes from the external repro (each({ key: it => it.id }),
    // item(t => t.label), `.some((m) => m.type === …)`, sliceHandler's
    // `narrow: (m) => m.type`). A naïve scanner counts those extra
    // properties and pushes the total past 31, firing the overflow
    // warning; the shared scanner ignores them and the warning must NOT
    // fire.
    const legitPaths = Array.from({ length: 29 }, (_, i) => `text((s) => s.a.f${i})`).join(
      ',\n            ',
    )
    const src = `
      import { component, div, text, each, show } from '@llui/dom'
      declare const item: unknown
      declare const sliceHandler: unknown
      export const C = component({
        name: 'C',
        init: () => [{ a: {}, items: [], msgs: [] }, []],
        update: (s, m) => [s, []],
        view: ({ text, each, show }) => [
          div({}, [
            ${legitPaths}
          ]),
          ...each({
            items: (s) => s.items,
            key: (it) => it.id,
            render: () => [div([text(item((t) => t.label))])],
          }),
          ...show(
            (s) => s.msgs.some((m) => m.type === 'warn'),
            () => [],
          ),
          ...sliceHandler({ narrow: (m) => m.type === 'k' }),
        ],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('31-path limit'))).toBe(false)
  })

  it('extracting one field is enough when it covers most paths', () => {
    // 22 paths under `huge` plus a few under others — extracting `huge`
    // alone should bring the count under 31
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ huge: {}, medium: {} }, []],
        update: (s, m) => [s, []],
        view: (h) => [
          div({}, [
            ${manyPaths('huge', 22)},
            ${manyPaths('medium', 12)}
          ]),
        ],
      })
    `
    const w = warnings(src)
    const overflow = w.find((m) => m.includes('31-path limit'))
    expect(overflow).toBeDefined()
    // Should recommend extracting `huge`
    expect(overflow).toContain('`huge`')
  })
})

describe('scope()/branch() with static on', () => {
  it('warns when scope.on reads no state paths', () => {
    const src = `
      import { component, div, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: () => 'static',
            render: () => [div()],
          }),
        ],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('reads no state') && m.includes('scope'))).toBe(true)
  })

  it('warns when branch.on reads no state paths', () => {
    const src = `
      import { component, div, branch } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ branch }) => [
          ...branch({
            on: () => 'a',
            cases: { a: () => [div()] },
          }),
        ],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('reads no state') && m.includes('branch'))).toBe(true)
  })

  it('does not warn when on reads state', () => {
    const src = `
      import { component, div, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ epoch: 0 }, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: (s) => String(s.epoch),
            render: () => [div()],
          }),
        ],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('reads no state'))).toBe(false)
  })
})

describe('child() props accessor footguns', () => {
  // The child-prop watch binding diffs props by Object.is per key. When the
  // accessor returns an object literal whose values are themselves fresh
  // object/array literals, that diff fires every parent update, spamming
  // propsMsg and giving users a silent performance footgun (and worse, a
  // loop vector through a naive onMsg forwarder). Catch it at compile time.

  it('warns when props accessor returns a fresh nested object literal', () => {
    const src = `
      import { component, child, div } from '@llui/dom'
      export const P = component({
        name: 'P',
        init: () => [{ open: false }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            ...child({
              def: SomeChild,
              key: 'c',
              props: (s) => ({ open: s.open, settings: { foo: 'bar' } }),
            }),
          ]),
        ],
      })
    `
    const w = warnings(src)
    expect(
      w.some(
        (m) =>
          m.includes('child()') &&
          m.includes('settings') &&
          /fresh|stable|Object\.is|reference/i.test(m),
      ),
    ).toBe(true)
  })

  it('warns when props accessor returns a fresh array literal', () => {
    const src = `
      import { component, child, div } from '@llui/dom'
      export const P = component({
        name: 'P',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            ...child({
              def: SomeChild,
              key: 'c',
              props: (s) => ({ tags: ['a', 'b'], count: s.items.length }),
            }),
          ]),
        ],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('child()') && m.includes('tags'))).toBe(true)
  })

  it('does not warn when props accessor returns only primitives and stable refs', () => {
    const src = `
      import { component, child, div } from '@llui/dom'
      const STABLE = { closed: true }
      export const P = component({
        name: 'P',
        init: () => [{ n: 0, settings: { a: 1 } }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            ...child({
              def: SomeChild,
              key: 'c',
              props: (s) => ({ n: s.n, settings: s.settings, closed: STABLE }),
            }),
          ]),
        ],
      })
    `
    const w = warnings(src)
    expect(w.filter((m) => m.includes('child()') && /fresh|stable/i.test(m))).toHaveLength(0)
  })
})
