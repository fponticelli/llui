import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

// REPRO: Bug 1 — renderToString should evaluate function-valued attr
// accessors, not serialize their source code into the attribute value.
describe('compiler — function-valued class attribute', () => {
  it('emits the arrow as an accessor callback, not a literal string', () => {
    const src = `
      import { component, div } from '@llui/dom'
      type State = { active: boolean }
      type Msg = { type: 'noop' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ active: true }, []],
        update: (s, m) => [s, []],
        view: () => [div({ class: (s) => s.active ? 'on' : 'off' })],
      })
    `
    const out = transformLlui(src, 'test.ts')?.output ?? ''
    expect(out).toContain('elSplit')
    expect(out).toMatch(/s\.active/)
    expect(out).not.toMatch(/['"]\(s\)\s*=>\s*s\.active['"]/)
  })
})

// REPRO: Bug 8 — the compiler's per-item heuristic fires on ANY parameter
// named `item`, not just inside each() render callbacks. A plain
// `arr.map((item) => item.field)` outside each() triggers the rewrite
// and emits a binding whose "accessor" is a property access expression
// (string-like) instead of a real function — runtime crashes with
// "accessor is not a function".
describe('compiler — item heuristic scope', () => {
  it('does not treat item.field as a per-item binding in plain .map()', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      type State = { items: { name: string }[] }
      type Msg = { type: 'noop' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => {
          // PLAIN .map outside each() — item.name should be a static value
          // assigned at construction time, NOT a per-item binding accessor.
          const arr = [{ name: 'a' }, { name: 'b' }]
          return [
            div({}, arr.map((item) => div({ class: item.name, id: item.name }, [text(item.name)]))),
          ]
        },
      })
    `
    const out = transformLlui(src, 'test.ts')?.output ?? ''
    // The compiler must NOT emit a binding tuple referencing item.name.
    // A per-item binding tuple looks like [mask, kind, key, item.name]
    // — if that appears, elSplit will crash with "accessor is not a function".
    const hasBindingTupleForItemName =
      /\[\s*\d+(\s*\|\s*\d+)?\s*,\s*['"][\w-]+['"]\s*,\s*['"][\w-]+['"]\s*,\s*item\.name\s*\]/.test(
        out,
      )
    expect(hasBindingTupleForItemName).toBe(false)
  })

  it('STILL treats item.field as per-item inside an each() render callback', () => {
    const src = `
      import { component, div, text, each } from '@llui/dom'
      type State = { items: { name: string }[] }
      type Msg = { type: 'noop' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: ({ each }) => [
          div({}, [
            ...each({
              items: (s) => s.items,
              key: (i) => i.name,
              render: ({ item }) => [
                div({ class: item.name, id: item.name }, [text(item.name)]),
              ],
            }),
          ]),
        ],
      })
    `
    const out = transformLlui(src, 'test.ts')?.output ?? ''
    // Inside each render, the compiler's deduplication pass hoists
    // `item.name` into a per-item accessor `__a0` and references it in
    // the binding tuple. So we expect either `item.name` OR a hoisted
    // `__aN` identifier in a binding tuple position.
    const hasPerItemBinding =
      /\[\s*\d+(\s*\|\s*\d+)?\s*,\s*['"][\w-]+['"]\s*,\s*['"][\w-]+['"]\s*,\s*(item\.name|__a\d+)\s*\]/.test(
        out,
      )
    expect(hasPerItemBinding).toBe(true)
  })

  it('does not match item.field when a nested .map shadows the each item', () => {
    const src = `
      import { component, div, text, each } from '@llui/dom'
      type State = { items: { tags: { text: string }[] }[] }
      type Msg = { type: 'noop' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: ({ each }) => [
          div({}, [
            ...each({
              items: (s) => s.items,
              key: (i, idx) => idx,
              render: ({ item }) => {
                // Nested .map shadows item with a DIFFERENT item.
                // The inner item.text should NOT be a per-item each binding.
                const tags = [{ text: 'a' }]
                return [div({}, tags.map((item) => div({ class: item.text })))]
              },
            }),
          ]),
        ],
      })
    `
    // Shouldn't crash the compiler — behavior is that the inner item.text
    // is treated as a plain static expression (the nearest fn binding `item`
    // is the .map callback, which is not an each render).
    expect(() => transformLlui(src, 'test.ts')).not.toThrow()
  })
})
