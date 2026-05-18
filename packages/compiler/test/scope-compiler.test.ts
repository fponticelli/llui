import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { collectStatePathsFromSource } from '../src/collect-deps'

function pathsOf(source: string): string[] {
  const sf = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)
  return [...collectStatePathsFromSource(sf)].sort()
}

describe('scope() path scanning', () => {
  it('collects on-callback state reads', () => {
    const src = `
      import { component, div, text, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ epoch: 0, label: '' }, []],
        update: (s) => [s, []],
        view: ({ text, scope }) => [
          ...scope({
            on: (s) => String(s.epoch),
            render: ({ text }) => [div([text((s) => s.label)])],
          }),
        ],
      })
    `
    const paths = pathsOf(src)
    expect(paths).toContain('epoch')
    expect(paths).toContain('label')
  })

  it('does not pollute paths from render rooted at h', () => {
    const src = `
      import { component, div, text, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ epoch: 0 }, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: (s) => String(s.epoch),
            render: (h) => [div([])],
          }),
        ],
      })
    `
    expect(pathsOf(src)).toEqual(['epoch'])
  })
})

describe('sample() path scanning', () => {
  it('does not count sample(s => s.x) as a reactive path', () => {
    const src = `
      import { component, div, text, sample } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ count: 0, stats: {} }, []],
        update: (s) => [s, []],
        view: () => [
          div([
            text((s) => String(s.count)),
            ...[sample((s) => s.stats)],
          ]),
        ],
      })
    `
    expect(pathsOf(src)).toEqual(['count'])
  })

  it('does not count destructured-from-h sample', () => {
    const src = `
      import { component, div, text, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ count: 0, stats: {} }, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: (s) => String(s.count),
            render: ({ sample }) => {
              const snap = sample((s) => s.stats)
              return []
            },
          }),
        ],
      })
    `
    expect(pathsOf(src)).toEqual(['count'])
  })

  it('does not count h.sample(s => s.x)', () => {
    const src = `
      import { component, div, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ count: 0, stats: {} }, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: (s) => String(s.count),
            render: (h) => {
              const snap = h.sample((s) => s.stats)
              return []
            },
          }),
        ],
      })
    `
    expect(pathsOf(src)).toEqual(['count'])
  })
})
