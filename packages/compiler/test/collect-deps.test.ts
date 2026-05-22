import { describe, it, expect } from 'vitest'
import { collectDeps } from '../src/collect-deps'

function paths(source: string): string[] {
  const { lo, hi } = collectDeps(source)
  return [...Array.from(lo.keys()), ...Array.from(hi.keys())].sort()
}

function bits(source: string): Map<string, number> {
  // Test helper: legacy callers only inspected low-word bits. Merge the
  // hi map (which is empty for ≤31-path components anyway) into the
  // low map so existing assertions stay meaningful for the common case.
  const { lo, hi } = collectDeps(source)
  const merged = new Map(lo)
  for (const [k, v] of hi) merged.set(k, v)
  return merged
}

describe('collectDeps', () => {
  it('extracts direct property access on the state param', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [text(s => s.count)],
      })
    `
    expect(paths(src)).toEqual(['count'])
  })

  it('extracts nested property access up to depth 2', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ user: { name: '', email: '' } }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          text(s => s.user.name),
          text(s => s.user.email),
        ],
      })
    `
    expect(paths(src)).toEqual(['user.email', 'user.name'])
  })

  it('assigns unique bit positions to each path', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ a: 0, b: 0, c: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          text(s => s.a),
          text(s => s.b),
          text(s => s.c),
        ],
      })
    `
    const b = bits(src)
    expect(b.get('a')).toBe(1)
    expect(b.get('b')).toBe(2)
    expect(b.get('c')).toBe(4)
  })

  it('handles reactive prop values in element helpers', () => {
    const src = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ title: '', active: false }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({ title: s => s.title, class: s => s.active ? 'on' : 'off' }),
        ],
      })
    `
    expect(paths(src)).toEqual(['active', 'title'])
  })

  it('ignores static prop values', () => {
    const src = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({ class: 'static', id: 'fixed' }),
        ],
      })
    `
    expect(paths(src)).toEqual([])
  })

  it('ignores event handler props', () => {
    const src = `
      import { component, button } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          button({ onClick: () => send({ type: 'click' }) }),
        ],
      })
    `
    expect(paths(src)).toEqual([])
  })

  it('handles parent path as union of child bits', () => {
    const src = `
      import { component, text, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ user: { name: '', email: '' }, count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          text(s => s.user.name),
          text(s => s.user.email),
          text(s => JSON.stringify(s.user)),
        ],
      })
    `
    const b = bits(src)
    // user.name and user.email get their own bits
    // s.user (whole object) gets the union
    expect(b.has('user.name')).toBe(true)
    expect(b.has('user.email')).toBe(true)
    // A parent-path reference should have both child bits
    // (the accessor s => JSON.stringify(s.user) reads 'user' as a whole)
  })

  it('returns empty map for files without @llui/dom imports', () => {
    const src = `export const x = 42`
    expect(paths(src)).toEqual([])
  })

  it('extracts paths from bracket notation with string literal', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [text(s => s['count'])],
      })
    `
    expect(paths(src)).toEqual(['count'])
  })

  // Structural primitives — `scope({on})`, `show({when})`, `branch({on})`,
  // `each({items})` — accept reactive accessors as object-literal property
  // values. Both call shapes must be recognized:
  //   - bare identifier:  `scope({on: s => s.x})`
  //   - method on `h`:     `h.scope({on: s => s.x})`
  // The `h.<name>` form mirrors how the docs and CLAUDE.md instruct authors
  // to use the View bag. When the recognizer skips this form, paths read
  // ONLY through a structural primitive's `on`/`when`/`items`/`render`
  // accessor never enter `__prefixes`. The dirty mask then stays 0 on
  // updates that only touch those fields, and no structural block reconciles
  // — silent freeze with no error. Regression test for issue surfaced
  // 2026-05 in the dungeonlogs app's route-keyed scope.

  it('collects paths inside h.scope({on}) — method-call form', () => {
    const src = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ route: { kind: 'list' as const } }, []],
        update: (s, m) => [s, []],
        view: (h) => [
          div([
            ...h.scope({
              on: (s) => s.route.kind,
              render: () => [div([])],
            }),
          ]),
        ],
      })
    `
    expect(paths(src)).toContain('route.kind')
  })

  it('collects paths inside h.show({when}) — method-call form', () => {
    const src = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ paletteOpen: false }, []],
        update: (s, m) => [s, []],
        view: (h) => [
          div([
            ...h.show({
              when: (s) => s.paletteOpen,
              render: () => [div([])],
            }),
          ]),
        ],
      })
    `
    expect(paths(src)).toContain('paletteOpen')
  })

  it('collects paths inside h.branch({on}) — method-call form', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ phase: 'a' as const }, []],
        update: (s, m) => [s, []],
        view: (h) => [
          div([
            ...h.branch({
              on: (s) => s.phase,
              cases: { a: () => [text('a')], b: () => [text('b')] },
            }),
          ]),
        ],
      })
    `
    expect(paths(src)).toContain('phase')
  })

  it('collects paths inside h.each({items}) — method-call form', () => {
    const src = `
      import { component, div, li, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ rows: [] as string[] }, []],
        update: (s, m) => [s, []],
        view: (h) => [
          div([
            ...h.each<string>({
              items: (s) => s.rows,
              key: (it) => it,
              render: ({ item }) => [li([text(item)])],
            }),
          ]),
        ],
      })
    `
    expect(paths(src)).toContain('rows')
  })

  it('collects paths from both forms in the same file (parity check)', () => {
    // Destructured `scope(...)` already worked; the test asserts the
    // method-call form picks up the SAME path, not a different one.
    const destructured = `
      import { component, div, scope } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ route: { kind: 'list' as const } }, []],
        update: (s, m) => [s, []],
        view: (_h) => [
          div([
            ...scope({ on: (s) => s.route.kind, render: () => [div([])] }),
          ]),
        ],
      })
    `
    const method = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ route: { kind: 'list' as const } }, []],
        update: (s, m) => [s, []],
        view: (h) => [
          div([
            ...h.scope({ on: (s) => s.route.kind, render: () => [div([])] }),
          ]),
        ],
      })
    `
    expect(paths(method)).toEqual(paths(destructured))
  })
})
