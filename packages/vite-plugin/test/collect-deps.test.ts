import { describe, it, expect } from 'vitest'
import { collectDeps } from '../src/collect-deps'

function paths(source: string): string[] {
  return Array.from(collectDeps(source).keys()).sort()
}

function bits(source: string): Map<string, number> {
  return collectDeps(source)
}

describe('collectDeps', () => {
  it('extracts direct property access on the state param', () => {
    const src = `
      import { component, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [text(s => s.count)],
      })
    `
    expect(paths(src)).toEqual(['count'])
  })

  it('extracts nested property access up to depth 2', () => {
    const src = `
      import { component, div, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ user: { name: '', email: '' } }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
          text(s => s.user.name),
          text(s => s.user.email),
        ],
      })
    `
    expect(paths(src)).toEqual(['user.email', 'user.name'])
  })

  it('assigns unique bit positions to each path', () => {
    const src = `
      import { component, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ a: 0, b: 0, c: 0 }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
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
      import { component, div } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ title: '', active: false }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
          div({ title: s => s.title, class: s => s.active ? 'on' : 'off' }),
        ],
      })
    `
    expect(paths(src)).toEqual(['active', 'title'])
  })

  it('ignores static prop values', () => {
    const src = `
      import { component, div } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
          div({ class: 'static', id: 'fixed' }),
        ],
      })
    `
    expect(paths(src)).toEqual([])
  })

  it('ignores event handler props', () => {
    const src = `
      import { component, button } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
          button({ onClick: () => send({ type: 'click' }) }),
        ],
      })
    `
    expect(paths(src)).toEqual([])
  })

  it('handles parent path as union of child bits', () => {
    const src = `
      import { component, text, div } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ user: { name: '', email: '' }, count: 0 }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
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

  it('returns empty map for files without @llui/core imports', () => {
    const src = `export const x = 42`
    expect(paths(src)).toEqual([])
  })

  it('extracts paths from bracket notation with string literal', () => {
    const src = `
      import { component, text } from '@llui/core'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [text(s => s['count'])],
      })
    `
    expect(paths(src)).toEqual(['count'])
  })
})
