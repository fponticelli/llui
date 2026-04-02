import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

function t(source: string): string {
  const result = transformLlui(source, 'test.ts')
  return result ?? source
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

describe('Pass 1 — element helper → elSplit', () => {
  it('transforms div() with static props to elSplit', () => {
    const src = `
      import { div } from '@llui/core'
      const el = div({ class: 'foo', id: 'bar' })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    expect(out).toMatch(/["']div["']/)
    // Static props should be in a staticFn
    expect(out).toContain('class')
    expect(out).toContain('foo')
  })

  it('transforms event handlers into events array', () => {
    const src = `
      import { button } from '@llui/core'
      const el = button({ onClick: handler })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    expect(out).toMatch(/["']click["']/)
    expect(out).toContain('handler')
  })

  it('transforms reactive props into bindings array with masks', () => {
    const src = `
      import { component, div, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ title: '' }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
          div({ title: s => s.title }),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    // Should have a binding tuple with mask
    expect(out).toMatch(/\[\s*1\s*,/)  // mask = 1 (first path)
  })

  it('passes children through', () => {
    const src = `
      import { div, text } from '@llui/core'
      const el = div({}, [text('hi')])
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    expect(out).toContain('text')
  })

  it('bails out on non-literal props (variable)', () => {
    const src = `
      import { div } from '@llui/core'
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
      import { component, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [text(s => String(s.count))],
      })
    `
    const out = t(src)
    // text(s => String(s.count)) should get a mask as second arg
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('synthesizes __dirty function', () => {
    const src = `
      import { component, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0, label: '' }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
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
      import { component, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [text(s => String(s.count))],
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
      import { div, span, text, component } from '@llui/core'
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
    // elSplit should be added
    expect(out).toMatch(/import\s*\{[^}]*\belSplit\b/)
  })

  it('keeps element helpers that bailed out (non-literal props)', () => {
    const src = `
      import { div } from '@llui/core'
      const props = { class: 'foo' }
      const el = div(props)
    `
    const out = t(src)
    // div should remain in imports since it wasn't compiled
    expect(out).toMatch(/import\s*\{[^}]*\bdiv\b/)
    expect(out).not.toMatch(/elSplit/)
  })
})

describe('returns null for non-llui files', () => {
  it('returns null when no @llui/core import', () => {
    const src = `export const x = 42`
    expect(transformLlui(src, 'test.ts')).toBeNull()
  })
})
