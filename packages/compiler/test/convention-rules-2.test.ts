// Convention rules — batch 2: missing-memo, namespace-import,
// no-barrel-import-when-subpath-exists, form-boilerplate,
// spread-in-children, static-items, static-on,
// no-list-render-in-sample, no-sample-in-accessor,
// no-sample-in-reactive-position.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('namespace-import', () => {
  it('errors on import * as L from @llui/dom', () => {
    const diags = diagnosticsFor(
      `
        import * as L from '@llui/dom'
        const x = L.div([])
      `,
      'llui/namespace-import',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('div')
  })

  it('does NOT error on named imports', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const x = div([])
      `,
      'llui/namespace-import',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('form-boilerplate', () => {
  it('errors on 3+ set* variants with identical shape', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        type Msg =
          | { type: 'setName', value: string }
          | { type: 'setEmail', value: string }
          | { type: 'setPhone', value: string }
      `,
      'llui/form-boilerplate',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT error on 2 variants', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        type Msg =
          | { type: 'setName', value: string }
          | { type: 'setEmail', value: string }
      `,
      'llui/form-boilerplate',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('spread-in-children', () => {
  it('errors on spread of .map() over an unbounded receiver', () => {
    // props.items.map(...) — receiver isn't a top-level const array,
    // so the spread source is "dynamic" per the rule's boundedness
    // heuristic. (Bare `someFn()` is considered bounded — the rule
    // treats a returned array from a function call as known-shape.)
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        function build(props) {
          return div([...props.items.map((i) => i)])
        }
      `,
      'llui/spread-in-children',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT error on spread of bounded const array', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const xs = [1, 2, 3]
        const x = div([...xs])
      `,
      'llui/spread-in-children',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('static-items', () => {
  it('errors on each({ items: () => [literal] })', () => {
    const diags = diagnosticsFor(
      `
        import { each } from '@llui/dom'
        const x = each({ items: () => [1, 2, 3], key: (i) => i, render: () => [] })
      `,
      'llui/static-items',
    )
    expect(diags).toHaveLength(1)
  })

  it('errors on each({ items: (s) => CONSTANT })', () => {
    const diags = diagnosticsFor(
      `
        import { each } from '@llui/dom'
        const CONSTANT = [1, 2, 3]
        const x = each({ items: (_s) => CONSTANT, key: (i) => i, render: () => [] })
      `,
      'llui/static-items',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on each({ items: (s) => s.list })', () => {
    const diags = diagnosticsFor(
      `
        import { each } from '@llui/dom'
        const x = each({ items: (s) => s.list, key: (i) => i.id, render: () => [] })
      `,
      'llui/static-items',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('static-on', () => {
  it('errors on branch({ on: () => "literal" })', () => {
    const diags = diagnosticsFor(
      `
        import { branch } from '@llui/dom'
        const x = branch({ on: () => 'tabA', cases: {} })
      `,
      'llui/static-on',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on branch({ on: (s) => s.tab })', () => {
    const diags = diagnosticsFor(
      `
        import { branch } from '@llui/dom'
        const x = branch({ on: (s) => s.tab, cases: {} })
      `,
      'llui/static-on',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('no-list-render-in-sample', () => {
  it('errors on sample(s => s.items.map(...))', () => {
    const diags = diagnosticsFor(
      `
        import { text } from '@llui/dom'
        const x = text(() => sample((s) => s.items.map((r) => r.name).join(',')))
      `,
      'llui/no-list-render-in-sample',
    )
    expect(diags).toHaveLength(1)
  })
})

describe('no-sample-in-accessor', () => {
  it('errors on each({ key: (it) => sample(...) })', () => {
    const diags = diagnosticsFor(
      `
        import { each } from '@llui/dom'
        const x = each({
          items: (s) => s.rows,
          key: (it) => \`\${it.id}|\${sample((s) => s.rev)}\`,
          render: () => [],
        })
      `,
      'llui/no-sample-in-accessor',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })
})

describe('no-sample-in-reactive-position', () => {
  it('errors on text(sample(...))', () => {
    const diags = diagnosticsFor(
      `
        import { text } from '@llui/dom'
        const x = text(sample((s) => s.title))
      `,
      'llui/no-sample-in-reactive-position',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on text((s) => sample(...)) — outer is reactive', () => {
    const diags = diagnosticsFor(
      `
        import { text } from '@llui/dom'
        const x = text((s) => sample((s2) => s2.title))
      `,
      'llui/no-sample-in-reactive-position',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('missing-memo', () => {
  it('errors when duplicate accessor appears at 2+ binding sites', () => {
    const diags = diagnosticsFor(
      `
        import { component, div, text } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div([
              text((s) => s.a + 1),
              text((s) => s.a + 1),
            ])
          ],
        })
      `,
      'llui/missing-memo',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
  })
})
