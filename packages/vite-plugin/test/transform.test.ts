import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

function t(source: string): string {
  const result = transformLlui(source, 'test.ts')
  return result?.output ?? source
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

describe('Pass 1 — element helper → elSplit', () => {
  it('transforms fully static div() to template clone', () => {
    const src = `
      import { div } from '@llui/dom'
      const el = div({ class: 'foo', id: 'bar' })
    `
    const out = t(src)
    // Fully static — should emit template clone
    expect(out).toContain('cloneNode')
    expect(out).toContain('foo')
  })

  it('transforms div() with reactive props to elSplit', () => {
    const src = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ title: '' }, []],
        update: (s, m) => [s, []],
        view: () => [div({ title: s => s.title, class: 'static' })],
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
  })

  it('transforms event handlers into events array', () => {
    const src = `
      import { button } from '@llui/dom'
      const el = button({ onClick: handler })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    expect(out).toMatch(/["']click["']/)
    expect(out).toContain('handler')
  })

  it('transforms reactive props into bindings array with masks', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ title: '' }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({ title: s => s.title }),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    // Should have a binding tuple with mask
    expect(out).toMatch(/\[\s*1\s*,/) // mask = 1 (first path)
  })

  it('passes children through', () => {
    const src = `
      import { div, text } from '@llui/dom'
      const el = div({ class: 'box' }, [text(s => s.label)])
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    expect(out).toContain('text')
  })

  it('bails out on non-literal props (variable)', () => {
    const src = `
      import { div } from '@llui/dom'
      const props = { class: 'foo' }
      const el = div(props)
    `
    const out = t(src)
    // Should NOT transform to elSplit — bail out
    expect(out).toContain('div(props)')
  })
})

describe('Pass 2 — mask injection + __dirty', () => {
  it('injects mask into text() calls', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [text(s => String(s.count))],
      })
    `
    const out = t(src)
    // text(s => String(s.count)) should get a mask as second arg
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask into h.text() calls via view-helpers binding', () => {
    const src = `
      import { component } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send, h) => [h.text(s => String(s.count))],
      })
    `
    const out = t(src)
    expect(out).toMatch(/h\.text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask into destructured text() calls from view helpers', () => {
    const src = `
      import { component } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (_, { text }) => [text(s => String(s.count))],
      })
    `
    const out = t(src)
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask in extracted helper with View<S,M> parameter', () => {
    const src = `
      import { component } from '@llui/dom'
      import type { View } from '@llui/dom'
      type S = { count: number }
      function row(h: View<S, never>) { return [h.text(s => String(s.count))] }
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (_, h) => row(h),
      })
    `
    const out = t(src)
    expect(out).toMatch(/h\.text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask through `const { text } = h` destructuring', () => {
    const src = `
      import { component } from '@llui/dom'
      import type { View } from '@llui/dom'
      type S = { count: number }
      function row(h: View<S, never>) {
        const { text } = h
        return [text(s => String(s.count))]
      }
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (_, h) => row(h),
      })
    `
    const out = t(src)
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask into renamed destructured text alias', () => {
    const src = `
      import { component } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (_, { text: t }) => [t(s => String(s.count))],
      })
    `
    const out = t(src)
    expect(out).toMatch(/t\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('synthesizes __dirty function', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0, label: '' }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          text(s => String(s.count)),
          text(s => s.label),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('__dirty')
    expect(out).toContain('Object.is')
    // Should compare count and label
    expect(out).toMatch(/o\.count.*n\.count/)
    expect(out).toMatch(/o\.label.*n\.label/)
  })

  it('does not overwrite existing __dirty', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [text(s => String(s.count))],
        __dirty: (o, n) => o.count !== n.count ? 1 : 0,
      })
    `
    const out = t(src)
    // Should preserve the hand-written __dirty
    expect(out).toContain('o.count !== n.count')
  })
})

describe('Pass 3 — import cleanup', () => {
  it('removes compiled element helpers from imports', () => {
    const src = `
      import { div, span, text, component } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [div({}, [span({}, [text('hi')])])],
      })
    `
    const out = t(src)
    // div and span should be removed from import
    expect(out).not.toMatch(/import\s*\{[^}]*\bdiv\b/)
    expect(out).not.toMatch(/import\s*\{[^}]*\bspan\b/)
    // text and component should remain
    expect(out).toMatch(/import\s*\{[^}]*\btext\b/)
    expect(out).toMatch(/import\s*\{[^}]*\bcomponent\b/)
    // elTemplate or elSplit should be added
    expect(out).toMatch(/import\s*\{[^}]*\b(elSplit|elTemplate)\b/)
  })

  it('keeps element helpers that bailed out (non-literal props)', () => {
    const src = `
      import { div } from '@llui/dom'
      const props = { class: 'foo' }
      const el = div(props)
    `
    const out = t(src)
    // div should remain in imports since it wasn't compiled
    expect(out).toMatch(/import\s*\{[^}]*\bdiv\b/)
    expect(out).not.toMatch(/elSplit/)
  })
})

describe('per-item accessor calls', () => {
  it('compiles item() calls as perItem bindings instead of bailing out', () => {
    const src = `
      import { component, input, each } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            input({ checked: item(t => t.done), class: item(t => t.active ? 'on' : '') }),
          ],
        }),
      })
    `
    const out = t(src)
    // Should compile to elSplit, not bail out to uncompiled input()
    expect(out).toContain('elSplit')
    // input should be removed from imports (fully compiled)
    expect(out).not.toMatch(/import\s*\{[^}]*\binput\b/)
  })

  it('emits item() call expression in the binding tuple', () => {
    const src = `
      import { component, div, each } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            div({ class: item(t => t.active ? 'on' : '') }),
          ],
        }),
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    // The binding should contain the item() call
    expect(out).toContain('item(')
  })

  it('compiles item.field property access as a perItem binding', () => {
    const src = `
      import { component, div, each, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            div({ 'data-id': item.id }, [text(item.label)]),
          ],
        }),
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    // item.id gets hoisted to __a0 = acc(t => t.id) — Proxy-free compiled code
    expect(out).toMatch(/__a\d+/)
    expect(out).toContain('acc(')
    expect(out).toMatch(/"attr",\s*"data-id"/)
  })

  it('auto-wraps each.items in memo() when accessor allocates (filter/map/etc.)', () => {
    const src = `
      import { component, each, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ todos: [], filter: 'all' }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.todos.filter(t => !t.done),
          key: t => t.id,
          render: ({ item }) => [div([text(item.text)])],
        }),
      })
    `
    const out = t(src)
    // Should wrap items with memo(...)
    expect(out).toMatch(/items:\s*memo\(/)
    // And add memo to imports
    expect(out).toMatch(/import\s*\{[^}]*\bmemo\b/)
  })

  it('does NOT wrap each.items when accessor is a plain state read', () => {
    const src = `
      import { component, each, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [div([text(item.text)])],
        }),
      })
    `
    const out = t(src)
    // Plain accessor — each's same-ref fast path handles it; memo not needed
    expect(out).not.toMatch(/items:\s*memo\(/)
  })

  it('dedups repeated item.field across call and property access forms', () => {
    const src = `
      import { component, div, each, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: (send) => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            div({
              class: item.label,
              onClick: () => send({ type: 'click', id: item(t => t.id)() }),
              'data-label': item(t => t.label),
              'data-id': item.id,
            }, [text(item.label)]),
          ],
        }),
      })
    `
    const out = t(src)
    // item.label and item(t=>t.label) should share a hoisted __a* var
    expect(out).toMatch(/__a\d+/)
    // item.id and item(t=>t.id) should also dedup together
    const matches = out.match(/const __a(\d+)/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('static subtree prerendering', () => {
  it('emits template clone for fully static subtree', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'header' }, [
            span({}, [text('Hello')]),
          ]),
        ],
      })
    `
    const out = t(src)
    // Fully static subtree with nested elements → elTemplate
    expect(out).toContain('elTemplate')
    expect(out).toContain('header')
    expect(out).toContain('Hello')
  })

  it('does not use template for subtrees with reactive bindings', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ label: '' }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'header' }, [
            text(s => s.label),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).not.toContain('cloneNode')
  })

  it('does not use template for subtrees with event handlers', () => {
    const src = `
      import { component, button, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          button({ onClick: () => send({ type: 'click' }) }, [text('Go')]),
        ],
      })
    `
    const out = t(src)
    expect(out).not.toContain('cloneNode')
  })
})

describe('zero-mask constant folding', () => {
  it('folds accessor that does not read state into staticFn', () => {
    const src = `
      import { component, div } from '@llui/dom'
      const THEME = 'dark'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: s => THEME }),
        ],
      })
    `
    const out = t(src)
    // The accessor reads no state — should be folded to static
    // Should NOT have a binding tuple for this prop
    expect(out).not.toMatch(/\[\s*-?\d+.*class.*THEME/)
    expect(out).not.toContain('__bind')
  })
})

describe('subtree collapse — nested elements → elTemplate', () => {
  it('collapses nested static elements into a single elTemplate call', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'container' }, [
            span({ class: 'label' }, [text('Hello')]),
            span({ class: 'value' }),
          ]),
        ],
      })
    `
    const out = t(src)
    // Should collapse into elTemplate, not nested elSplit calls
    expect(out).toContain('elTemplate')
    // HTML should include both spans
    expect(out).toContain('container')
    expect(out).toContain('label')
    expect(out).toContain('Hello')
    expect(out).toContain('<span')
    // Should NOT have elSplit (everything is in the template)
    expect(out).not.toContain('elSplit')
  })

  it('collapses elements with events into elTemplate with patch function', () => {
    const src = `
      import { component, div, button, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({ class: 'row' }, [
            button({ onClick: () => send({ type: 'click' }) }, [text('Go')]),
          ]),
        ],
      })
    `
    const out = t(src)
    // Should use elTemplate since there are nested elements
    expect(out).toContain('elTemplate')
    expect(out).toMatch(/<div[^>]*row[^>]*><button>Go<\/button><\/div>/)
    // Patch function should set up click event
    expect(out).toContain('addEventListener')
    expect(out).toContain('"click"')
  })

  it('collapses elements with reactive bindings into elTemplate with bind calls', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ label: 'hi', active: false }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'wrapper' }, [
            span({ class: s => s.active ? 'on' : 'off' }, [text('x')]),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // HTML should have the static structure
    expect(out).toMatch(/<div[^>]*wrapper[^>]*><span>x<\/span><\/div>/)
    // Patch function should call __bind for the reactive class
    expect(out).toContain('__bind')
    expect(out).toContain('"class"')
  })

  it('collapses elements with reactive text children', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ label: 'hi' }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            span({}, [text(s => s.label)]),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // HTML should have a comment placeholder for reactive text
    expect(out).toContain('<div><span><!--$--></span></div>')
    // createTextNode replaces the comment at clone time, restoring stable childIdx
    // even with interleaved static + reactive text
    expect(out).toContain('firstChild')
    expect(out).toContain('__bind')
    expect(out).toContain('"text"')
  })

  it('handles per-item accessors in collapsed templates', () => {
    const src = `
      import { component, tr, td, text, each } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            tr({}, [
              td({ class: 'id' }, [text(item(t => String(t.id)))]),
              td({ class: 'label' }, [text(item(t => t.label))]),
            ]),
          ],
        }),
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // Template has comment placeholders for reactive text
    expect(out).toMatch(
      /<tr><td[^>]*id[^>]*><!--\$--><\/td><td[^>]*label[^>]*><!--\$--><\/td><\/tr>/,
    )
    expect(out).toContain('__bind')
  })

  it('supports interleaved static + reactive text in same parent', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ name: 'world' }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            text('Hello, '),
            text((s: { name: string }) => s.name),
            text('!'),
            span({ class: 'dot' }, []),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // Template: static "Hello, ", comment placeholder, static "!"
    expect(out).toContain('>Hello, <!--$-->!<')
    // Should replace comment with text node at clone time
    expect(out).toContain('createTextNode')
    expect(out).toContain('replaceChild')
  })

  it('does not collapse when children include structural primitives', () => {
    const src = `
      import { component, div, each, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, each({
            items: s => s.items,
            key: t => t.id,
            render: ({ item }) => [text('x')],
          })),
        ],
      })
    `
    const out = t(src)
    // Should NOT collapse — each() is a structural primitive, not an element
    expect(out).toContain('elSplit')
    expect(out).not.toContain('elTemplate')
  })

  it('does not collapse single elements without nested children', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'single' }, [text('hi')]),
        ],
      })
    `
    const out = t(src)
    // Single element with only text children — no benefit from template collapse
    // Should use the existing static subtree template or elSplit
    expect(out).not.toContain('__bind')
  })

  it('adds elTemplate to imports when used', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'c' }, [
            span({}, [text('a')]),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toMatch(/import\s*\{[^}]*\belTemplate\b/)
  })

  it('handles void elements (br, hr, img, input) in templates', () => {
    const src = `
      import { component, div, br, hr } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            br({}),
            hr({ class: 'sep' }),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    expect(out).toContain('<br>')
    expect(out).toMatch(/<hr[^>]*sep[^>]*>/)
  })

  it('marks all descendant helpers as compiled for import cleanup', () => {
    const src = `
      import { component, div, span, p, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            span({}, [text('a')]),
            p({}, [text('b')]),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // div, span, p should all be removed from imports
    expect(out).not.toMatch(/import\s*\{[^}]*\bdiv\b/)
    expect(out).not.toMatch(/import\s*\{[^}]*\bspan\b/)
    expect(out).not.toMatch(/import\s*\{[^}]*\bp\b/)
  })
})

describe('spread props bail to runtime', () => {
  it('preserves spread props on div instead of stripping them', () => {
    const src = `
      import { div } from '@llui/dom'
      const parts = { root: { 'data-scope': 'x', role: 'button' } }
      const el = div({ ...parts.root, class: 'foo' })
    `
    const out = t(src)
    // Must NOT transform to elSplit — that would drop the spread silently.
    // The runtime div() helper handles spreads natively.
    expect(clean(out)).toContain('div({ ...parts.root')
    expect(clean(out)).not.toContain('elSplit("div"')
  })

  it('preserves spread props with reactive accessors in the spread source', () => {
    const src = `
      import { button } from '@llui/dom'
      const parts = { trigger: { 'aria-expanded': (s) => s.open } }
      const el = button({ ...parts.trigger, class: 'btn' })
    `
    const out = t(src)
    expect(clean(out)).toContain('button({ ...parts.trigger')
    expect(clean(out)).not.toContain('elSplit("button"')
  })

  it('still compiles other elements in the same file', () => {
    const src = `
      import { div, span } from '@llui/dom'
      const parts = { root: { 'data-x': '1' } }
      const a = div({ ...parts.root })
      const b = span({ class: 'plain' })
    `
    const out = t(src)
    // span() is fully static — should still be template-cloned
    expect(clean(out)).toContain('cloneNode')
    // div() with spread stays at runtime
    expect(clean(out)).toContain('div({ ...parts.root')
  })
})

describe('returns null for non-llui files', () => {
  it('returns null when no @llui/dom import', () => {
    const src = `export const x = 42`
    expect(transformLlui(src, 'test.ts')).toBeNull()
  })
})
