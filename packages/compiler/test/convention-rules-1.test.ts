// Convention/hint rules — batch 1: empty-props, forgotten-spread,
// accessibility, view-bag-import, controlled-input.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagnosticsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('empty-props', () => {
  it('errors on div({}, …)', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const x = div({}, [])
      `,
      'llui/empty-props',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on div([…]) (no props at all)', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const x = div([])
      `,
      'llui/empty-props',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('forgotten-spread', () => {
  it('errors on each() inside array literal without spread', () => {
    const diags = diagnosticsFor(
      `
        import { div, each } from '@llui/dom'
        const x = div([each({ items: () => [], key: (i) => i.id, render: () => [] })])
      `,
      'llui/forgotten-spread',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error when spread', () => {
    const diags = diagnosticsFor(
      `
        import { div, each } from '@llui/dom'
        const x = div([...each({ items: () => [], key: (i) => i.id, render: () => [] })])
      `,
      'llui/forgotten-spread',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('accessibility', () => {
  it('errors on <img> without alt', () => {
    const diags = diagnosticsFor(
      `
        import { img } from '@llui/dom'
        const x = img({ src: 'x.png' })
      `,
      'llui/accessibility',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('alt')
  })

  it('errors on onClick on non-interactive without role', () => {
    const diags = diagnosticsFor(
      `
        import { div } from '@llui/dom'
        const x = div({ onClick: () => {} }, [])
      `,
      'llui/accessibility',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error on <img alt="">', () => {
    const diags = diagnosticsFor(
      `
        import { img } from '@llui/dom'
        const x = img({ src: 'x.png', alt: '' })
      `,
      'llui/accessibility',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on button with onClick', () => {
    const diags = diagnosticsFor(
      `
        import { button } from '@llui/dom'
        const x = button({ onClick: () => {} }, [])
      `,
      'llui/accessibility',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('view-bag-import', () => {
  it('errors when importing `text` in a file that defines a component', () => {
    const diags = diagnosticsFor(
      `
        import { component, div, text } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([])],
        })
      `,
      'llui/view-bag-import',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toContain('text')
  })

  it('does NOT error when text is only imported in a non-component file', () => {
    const diags = diagnosticsFor(
      `
        import { div, text } from '@llui/dom'
        export const helper = () => text(() => 'hello')
      `,
      'llui/view-bag-import',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('controlled-input', () => {
  it('errors on input with reactive value but no commit handler', () => {
    const diags = diagnosticsFor(
      `
        import { component, input } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ v: '' }, []],
          update: (s) => [s, []],
          view: () => [input({ value: (s) => s.v })],
        })
      `,
      'llui/controlled-input',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT error when onInput is present', () => {
    const diags = diagnosticsFor(
      `
        import { component, input } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ v: '' }, []],
          update: (s) => [s, []],
          view: ({ send }) => [
            input({ value: (s) => s.v, onInput: (e) => send({ type: 'x', v: e.target.value }) })
          ],
        })
      `,
      'llui/controlled-input',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT error on constant value', () => {
    const diags = diagnosticsFor(
      `
        import { component, input } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [input({ value: 'foo' })],
        })
      `,
      'llui/controlled-input',
    )
    expect(diags).toHaveLength(0)
  })
})
