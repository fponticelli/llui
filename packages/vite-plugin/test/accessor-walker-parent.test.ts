import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

// Regression for a walker crash in computeAccessorMask.
//
// Before the fix, the walker assumed `node.parent` was always defined
// when visiting PropertyAccessExpression nodes — true for the original
// parsed AST (where `setParentNodes: true` populates parent pointers
// on parse), but NOT for synthetic nodes produced by earlier transform
// passes (the row-factory rewrite and the per-item heuristic both
// build new sub-trees whose inner nodes have no parent pointers).
//
// When a reactive accessor body contained a chained method call inside
// a template literal — e.g. `text((_s) => \`$${item.x.toLocaleString()}\`)`
// inside an each() row — the walker hit a PropertyAccessExpression
// whose .parent was undefined, called `ts.isPropertyAccessExpression(undefined)`,
// which crashed with "Cannot read properties of undefined (reading 'kind')".
//
// The fix guards every `node.parent` access in the walker. Mask accounting
// stays correct because resolving a chain from an inner PAE produces a
// prefix of the outer chain, which maps to the same fieldBits entry via
// the prefix-match loop.

describe('computeAccessorMask — synthetic node parent pointers', () => {
  it('does not crash on chained method calls inside template literals inside each() rows', () => {
    const source = `
      import { component, div, each, text } from '@llui/dom'

      interface Row { value: number; label: string }
      type State = { rows: readonly Row[] }

      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ rows: [] }, []],
        update: (s) => [s, []],
        view: ({ text, each }) => [
          div({}, [
            ...each({
              items: (s) => s.rows,
              key: (r) => r.label,
              render: ({ item }) => [
                div({}, [
                  // Chained method call inside a template literal.
                  // Pre-fix: walker crashed because the inner PAE's
                  // parent pointer is undefined after the row-factory
                  // rewrite synthesizes a new accessor sub-tree.
                  text((_s) => \`value=\${item.value().toLocaleString()}\`),
                ]),
              ],
            }),
          ]),
        ],
      })
    `

    expect(() => transformLlui(source, 'test.ts')).not.toThrow()
    const out = transformLlui(source, 'test.ts')
    expect(out).not.toBeNull()
    expect(out!.output).toContain('elSplit')
  })

  it('does not crash on deeply chained property access inside a template literal', () => {
    const source = `
      import { component, div, each, text } from '@llui/dom'

      interface Row { a: { b: { c: string } } }
      type State = { rows: readonly Row[] }

      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ rows: [] }, []],
        update: (s) => [s, []],
        view: ({ text, each }) => [
          div({}, [
            ...each({
              items: (s) => s.rows,
              key: (r) => r.a.b.c,
              render: ({ item }) => [
                div({}, [text((_s) => \`x=\${item.a().b.c}\`)]),
              ],
            }),
          ]),
        ],
      })
    `

    expect(() => transformLlui(source, 'test.ts')).not.toThrow()
  })

  it('handles chained calls outside each() rows (sanity check)', () => {
    // Control — outside a row context, the accessor is a plain state
    // reader and parent pointers come from the original parse. This
    // should have always worked; we just assert it still does.
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = { count: number }

      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({}, [text((s) => \`total: \${s.count.toLocaleString()}\`)]),
        ],
      })
    `

    expect(() => transformLlui(source, 'test.ts')).not.toThrow()
  })
})
