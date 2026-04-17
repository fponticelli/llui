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
        view: (h) => [h.text(s => String(s.count))],
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
        view: ({ text }) => [text(s => String(s.count))],
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
        view: (h) => row(h),
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
        view: (h) => row(h),
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
        view: ({ text: t }) => [t(s => String(s.count))],
      })
    `
    const out = t(src)
    expect(out).toMatch(/t\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('does NOT rewrite a user-defined text() that shadows the primitive', () => {
    // User has their own `text` function in scope and is NOT importing text
    // from @llui/dom. The compiler must not inject a mask into these calls.
    const src = `
      import { component } from '@llui/dom'
      function text(x: string): string { return x.toUpperCase() }
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => {
          const label = text('hello')
          return [label as unknown as Node]
        },
      })
    `
    const out = t(src)
    // The call site 'text(...)' should remain as-is — no ,1 appended.
    expect(out).not.toMatch(/text\('hello'\s*,\s*1\)/)
    expect(out).toMatch(/text\('hello'\)/)
  })

  it('single-param view (no h) still works unchanged', () => {
    // Backwards compat: omitting the second parameter to `view` still
    // compiles and mask injection still fires for bare imports.
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
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
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
    // Sole-child reactive text uses inline text placeholder (space)
    // instead of comment — no createTextNode + replaceChild needed.
    expect(out).toContain('<div><span> </span></div>')
    expect(out).toContain('firstChild')
    expect(out).toContain('__bind')
    expect(out).toContain('"text"')
    // Inline path should NOT create a text node — reuses the cloned one
    expect(out).not.toContain('createTextNode')
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
    // Each td has a sole reactive text child — uses inline text placeholder
    expect(out).toMatch(/<tr><td[^>]*id[^>]*> <\/td><td[^>]*label[^>]*> <\/td><\/tr>/)
    expect(out).toContain('__bind')
    // Inline path reuses cloned text node — no createTextNode needed
    expect(out).not.toContain('createTextNode')
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

describe('__handlers per-message optimization', () => {
  it('unions modified fields across multiple return paths in a single case', () => {
    // Regression: the compiler used to only analyze the first return
    // statement in a case, missing conditional returns inside if-blocks.
    // This caused drag-and-drop in the dashboard example to silently fail
    // because the 'sort' handler's dirty mask only included 'sort' (16)
    // but not 'priorities' (8) which is set in the drop branch.
    const src = `
      import { component, div } from '@llui/dom'
      type State = { a: string; b: string; c: string }
      type Msg = { type: 'multi' } | { type: 'single' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ a: '', b: '', c: '' }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'multi': {
              if (state.a === 'x') {
                return [{ ...state, a: 'y', b: 'z', c: 'w' }, []]
              }
              return [{ ...state, a: 'fallback' }, []]
            }
            case 'single':
              return [{ ...state, b: 'only' }, []]
          }
        },
        view: ({ text }) => [div([text((s) => s.a + s.b + s.c)])],
      })
    `
    const out = t(src)
    // The 'multi' handler must have a mask covering a|b|c, not just a.
    // Masks: a=1, b=2, c=4, so multi = 1|2|4 = 7
    const multiHandlerMatch = out.match(/"multi"[\s\S]*?__handleMsg\([^,]+,\s*[^,]+,\s*(\d+)/)
    expect(multiHandlerMatch).not.toBeNull()
    const multiMask = Number(multiHandlerMatch![1])
    // Must include bits for a, b, and c (at least 3 bits set)
    expect(multiMask.toString(2).split('1').length - 1).toBeGreaterThanOrEqual(3)
  })

  it('handles a case with only a single return path correctly', () => {
    const src = `
      import { component, div } from '@llui/dom'
      type State = { a: string; b: string }
      type Msg = { type: 'x' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ a: '', b: '' }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'x':
              return [{ ...state, a: 'new' }, []]
          }
        },
        view: ({ text }) => [div([text((s) => s.a + s.b)])],
      })
    `
    const out = t(src)
    // Only 'a' modified — mask should be 1
    const handlerMatch = out.match(/"x"[\s\S]*?__handleMsg\([^,]+,\s*[^,]+,\s*(\d+)/)
    expect(handlerMatch).not.toBeNull()
    expect(Number(handlerMatch![1])).toBe(1)
  })

  it('ignores returns inside nested functions', () => {
    const src = `
      import { component, div } from '@llui/dom'
      type State = { a: number; b: number }
      type Msg = { type: 'go' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ a: 0, b: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'go': {
              // A nested function with its own return — must NOT be counted
              const helper = () => [{ ...state, b: 999 }, []] as [State, never[]]
              helper() // swallowed
              return [{ ...state, a: state.a + 1 }, []]
            }
          }
        },
        view: ({ text }) => [div([text((s) => String(s.a + s.b))])],
      })
    `
    const out = t(src)
    const handlerMatch = out.match(/"go"[\s\S]*?__handleMsg\([^,]+,\s*[^,]+,\s*(\d+)/)
    expect(handlerMatch).not.toBeNull()
    // Only 'a' should be modified — nested function's return is ignored
    expect(Number(handlerMatch![1])).toBe(1)
  })

  it('does not emit a narrow per-case handler when the return spreads a non-state value', () => {
    // Regression: `return [{ ...state, ...msg.props, extra: x }, []]` was
    // analyzed as modifying ONLY `extra` — the `...msg.props` spread was
    // silently ignored as if it were `...state`. That produced a narrow
    // `caseDirty` that excluded every field coming in through the props
    // spread, so text()/attr() bindings reading those fields in Phase 2
    // were skipped and the DOM retained stale values after a props/set.
    //
    // Correct behaviour: when a spread's source is anything other than
    // the state parameter, bail out of the per-case optimization so the
    // generic Phase 2 path runs and `__dirty` computes an honest mask.
    const src = `
      import { component, div, span, text } from '@llui/dom'
      type Props = { name: string | null; other: number }
      type State = Props & { tgState: number }
      type Msg = { type: 'props/set'; props: Props }
      export const C = component<State, Msg, never, Props>({
        name: 'C',
        init: (p) => [{ ...(p ?? { name: null, other: 0 }), tgState: 0 }, []],
        propsMsg: (p) => ({ type: 'props/set', props: p }),
        update: (state, msg) => {
          switch (msg.type) {
            case 'props/set': {
              const tgNext = state.tgState + 1
              return [{ ...state, ...msg.props, tgState: tgNext }, []]
            }
          }
        },
        view: ({ text }) => [
          div([
            span([text((s) => s.name === null ? 'NULL' : s.name)]),
            span([text((s) => String(s.tgState))]),
          ]),
        ],
      })
    `
    const out = t(src)
    // Two acceptable outcomes: (a) no per-case handler for 'props/set'
    // (bail-out, preferred — generic __dirty path runs), or (b) the handler
    // emits with caseDirty === FULL_MASK (-1 as a 32-bit signed int).
    const handlerMatch = out.match(/"props\/set"[\s\S]*?__handleMsg\([^,]+,\s*[^,]+,\s*(-?\d+)/)
    if (handlerMatch) {
      const mask = Number(handlerMatch[1]) | 0
      expect(mask).toBe(-1)
    } else {
      expect(out).not.toMatch(/"props\/set"/)
    }
  })
})

describe('returns null for non-llui files', () => {
  it('returns null when no @llui/dom import', () => {
    const src = `export const x = 42`
    expect(transformLlui(src, 'test.ts')).toBeNull()
  })
})

describe('dev code injection — MCP HMR auto-connect', () => {
  const componentSource = `
    import { component } from '@llui/dom'
    type State = { count: number }
    type Msg = { type: 'inc' }
    export const C = component<State, Msg, never>({
      name: 'C',
      init: () => [{ count: 0 }, []],
      update: (s, m) => [s, []],
      view: () => [],
    })
  `

  it('emits __startRelay and the llui:mcp-ready HMR listener in dev mode', () => {
    const result = transformLlui(componentSource, 'app.ts', /* devMode */ true, 5200)
    const out = result?.output ?? ''

    // Imports the relay starter
    expect(out).toContain('startRelay as __startRelay')
    // Calls it on load with the configured port
    expect(out).toContain('__startRelay(5200)')
    // Wires the HMR custom event to __lluiConnect
    expect(out).toContain("import.meta.hot.on('llui:mcp-ready'")
    expect(out).toContain('__lluiConnect')
  })

  it('uses a custom port when provided', () => {
    const result = transformLlui(componentSource, 'app.ts', true, 5300)
    const out = result?.output ?? ''
    expect(out).toContain('__startRelay(5300)')
  })

  it('omits the relay and HMR listener when mcpPort is null', () => {
    const result = transformLlui(componentSource, 'app.ts', true, null)
    const out = result?.output ?? ''
    expect(out).not.toContain('startRelay')
    expect(out).not.toContain('llui:mcp-ready')
    expect(out).not.toContain('__lluiConnect')
  })

  it('omits all dev injection in production mode', () => {
    const result = transformLlui(componentSource, 'app.ts', /* devMode */ false, 5200)
    const out = result?.output ?? ''
    expect(out).not.toContain('startRelay')
    expect(out).not.toContain('enableDevTools')
    expect(out).not.toContain('llui:mcp-ready')
  })
})
