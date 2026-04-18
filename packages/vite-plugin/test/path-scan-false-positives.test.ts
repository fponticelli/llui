import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { collectStatePathsFromSource } from '../src/collect-deps'

// Regression for the diagnostics-side path scanner. Before this fix, a
// second (naïve) scanner lived in `diagnostics.ts` and produced false
// positives that inflated the bitmask overflow count. Cases A–D come
// from the external repro in apps/web/repros/llui-path-scan-false-positives.mjs.

function pathsOf(source: string): string[] {
  const sf = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)
  return [...collectStatePathsFromSource(sf)].sort()
}

describe('path scanner — baseline', () => {
  it('counts only state reads rooted at the view accessor', () => {
    const src = `
      import { component, div, text } from "@llui/dom"
      component({
        name: "C",
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ text }) => [div([text((s) => String(s.count))])],
      })
    `
    expect(pathsOf(src)).toEqual(['count'])
  })
})

describe('path scanner — false-positive regressions', () => {
  it('Case A: does not count each({ key: (it) => it.id }) as a state path', () => {
    const src = `
      import { component, div, text, each } from "@llui/dom"
      component({
        name: "C",
        init: () => [{ count: 0, items: [{ id: "a" }] }, []],
        update: (s) => [s, []],
        view: ({ text, each }) => [
          div([text((s) => String(s.count))]),
          ...each({
            items: (s) => s.items,
            key: (it) => it.id,
            render: () => [],
          }),
        ],
      })
    `
    const paths = pathsOf(src)
    expect(paths).toContain('count')
    expect(paths).toContain('items')
    expect(paths).not.toContain('id')
  })

  it('Case B: does not count item((t) => t.field) as a state path', () => {
    const src = `
      import { component, div, text, each } from "@llui/dom"
      declare const item: unknown
      component({
        name: "C",
        init: () => [{ count: 0, items: [{ label: "a" }] }, []],
        update: (s) => [s, []],
        view: ({ text, each }) => [
          div([text((s) => String(s.count))]),
          ...each({
            items: (s) => s.items,
            key: (_, i) => String(i),
            render: () => [
              div([text(item((t) => t.label))]),
            ],
          }),
        ],
      })
    `
    const paths = pathsOf(src)
    expect(paths).toContain('count')
    expect(paths).toContain('items')
    expect(paths).not.toContain('label')
  })

  it('Case C: does not count .some/.filter/.map callbacks inside an accessor', () => {
    const src = `
      import { component, div, text, show } from "@llui/dom"
      component({
        name: "C",
        init: () => [{ count: 0, msgs: [{ type: "a" }] }, []],
        update: (s) => [s, []],
        view: ({ text, show }) => [
          div([text((s) => String(s.count))]),
          ...show(
            (s) => s.msgs.some((m) => m.type === "warn"),
            () => [],
          ),
        ],
      })
    `
    const paths = pathsOf(src)
    expect(paths).toContain('count')
    expect(paths).toContain('msgs')
    expect(paths).not.toContain('type')
  })

  it('Case D: does not count user-land helpers (sliceHandler({ narrow }))', () => {
    const src = `
      import { component, div, text } from "@llui/dom"
      declare const sliceHandler: unknown
      component({
        name: "C",
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div([
            text((s) => String(s.count)),
            ...sliceHandler({ narrow: (m) => m.type === "k" }),
          ]),
        ],
      })
    `
    const paths = pathsOf(src)
    expect(paths).toContain('count')
    expect(paths).not.toContain('type')
  })
})
