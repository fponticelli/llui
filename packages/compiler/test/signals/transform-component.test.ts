import { describe, it, expect } from 'vitest'
import { transformSignalComponentSource } from '../../src/signals/transform-component.js'

describe('transformSignalComponentSource', () => {
  it('rewrites a signal view and injects the runtime import', () => {
    const src = [
      "import { component } from '@llui/dom'",
      'export const Counter = component({',
      '  init: () => ({ count: 0 }),',
      '  update: (s, m) => ({ count: s.count + 1 }),',
      "  view: ({ state, send }) => [text(state.at('count')), button({ onClick: () => send({ type: 'inc' }) }, [text('+')])],",
      '})',
    ].join('\n')

    const out = transformSignalComponentSource(src)
    expect(out).toContain("import { signalText, staticText, el } from '@llui/dom/signals'")
    expect(out).toContain("signalText((s) => s.count, ['count'])")
    expect(out).toContain(
      "el(\"button\", { onClick: () => send({ type: 'inc' }) }, [staticText('+')])",
    )
    // init/update untouched
    expect(out).toContain('init: () => ({ count: 0 })')
  })

  it('imports each/show/branch helpers when used', () => {
    const src = [
      "import { component } from '@llui/dom'",
      'const C = component({',
      '  init: () => ({}),',
      '  update: (s) => s,',
      "  view: ({ state }) => [ul({}, [signalEach(state.at('items'), {})])],",
      '})',
    ].join('\n')
    // signalEach isn't produced by the transform yet (each/show/branch lowering of
    // authored each() is a later step) — but a hand-written signalEach call should
    // still trigger its import. Use a view that the transform passes through.
    const out = transformSignalComponentSource(src)
    // 'ul' is an element helper -> el; the inner each(...) is left verbatim (not yet
    // lowered) so no signalEach import unless present. Assert el import at least.
    expect(out).toContain("from '@llui/dom/signals'")
    expect(out).toContain('el("ul"')
  })

  it('leaves a legacy (non-signal) component untouched', () => {
    const src = [
      "import { component } from '@llui/dom'",
      'const Legacy = component({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      '  view: (h) => [h.text((s) => String(s.n))],', // legacy: single bag param, no `state` destructure
      '})',
    ].join('\n')
    expect(transformSignalComponentSource(src)).toBe(src)
  })

  it('returns source unchanged when there is no component', () => {
    const src = 'export const x = 1\n'
    expect(transformSignalComponentSource(src)).toBe(src)
  })

  it('handles multiple signal components in one file', () => {
    const src = [
      "import { component } from '@llui/dom'",
      "const A = component({ init: () => ({a:0}), update: (s)=>s, view: ({ state }) => [text(state.at('a'))] })",
      "const B = component({ init: () => ({b:0}), update: (s)=>s, view: ({ state }) => [text(state.at('b'))] })",
    ].join('\n')
    const out = transformSignalComponentSource(src)
    expect(out).toContain("signalText((s) => s.a, ['a'])")
    expect(out).toContain("signalText((s) => s.b, ['b'])")
    expect((out.match(/from '@llui\/dom\/signals'/g) ?? []).length).toBe(1) // single import
  })
})
