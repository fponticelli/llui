import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

function t(source: string): string {
  return transformLlui(source, 'test.ts') ?? source
}

describe('cross-file mask safety', () => {
  it('uses FULL_MASK for bindings in files without component()', () => {
    // A view function file — no component() call, just element helpers
    const src = `
      import { div, text } from '@llui/dom'
      export function myView(s, send) {
        return [
          div({ class: s => s.active ? 'on' : 'off' }, [
            text(s => s.label),
          ]),
        ]
      }
    `
    const out = t(src)
    // All bindings should use FULL_MASK (4294967295 | 0)
    // because there's no component() to generate a matching __dirty
    expect(out).toContain('4294967295 | 0')
    // Should NOT have any precise small masks like [1, or [2,
    expect(out).not.toMatch(/\[\s*[1-9]\d?\s*,\s*"/)
  })

  it('uses precise masks in files WITH component()', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const App = component({
        name: 'App',
        init: () => [{ label: '', active: false }, []],
        update: (s, m) => [s, []],
        view: (s, send) => [
          div({ class: s => s.active ? 'on' : 'off' }, [
            text(s => s.label),
          ]),
        ],
      })
    `
    const out = t(src)
    // Should have precise masks (1 for label, 2 for active or vice versa)
    expect(out).toContain('__dirty')
    // Should NOT use FULL_MASK for these bindings
    expect(out).not.toMatch(/4294967295.*"class"/)
  })

  it('injects __dirty only in component files', () => {
    const viewSrc = `
      import { div, text } from '@llui/dom'
      export const view = (s) => [text(s => s.name)]
    `
    const componentSrc = `
      import { component, text } from '@llui/dom'
      export const App = component({
        name: 'App',
        init: () => [{ name: '' }, []],
        update: (s, m) => [s, []],
        view: (s) => [text(s => s.name)],
      })
    `
    expect(t(viewSrc)).not.toContain('__dirty')
    expect(t(componentSrc)).toContain('__dirty')
  })
})
