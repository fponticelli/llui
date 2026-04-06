import { describe, it, expect } from 'vitest'
import { lintIdiomatic } from '../src/index'

describe('lintIdiomatic', () => {
  it('detects state mutation via assignment', () => {
    const source = `
      import { component } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          state.count = state.count + 1
          return [state, []]
        },
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
    expect(result.score).toBeLessThan(15)
  })

  it('detects state mutation via push', () => {
    const source = `
      import { component } from '@llui/dom'
      type State = { items: string[] }
      type Msg = { type: 'add'; item: string }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (state, msg) => {
          state.items.push(msg.item)
          return [state, []]
        },
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
  })

  it('detects state mutation via compound assignment', () => {
    const source = `
      import { component } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          state.count += 1
          return [state, []]
        },
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
    expect(
      result.violations.some((v) => v.rule === 'state-mutation' && v.message.includes('Compound')),
    ).toBe(true)
  })

  it('detects state mutation via increment', () => {
    const source = `
      import { component } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          state.count++
          return [state, []]
        },
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
    expect(
      result.violations.some((v) => v.rule === 'state-mutation' && v.message.includes('Increment')),
    ).toBe(true)
  })

  it('detects .map() on state arrays in view', () => {
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = { items: string[] }
      type Msg = never
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({}, state.items.map(item => text(item)))
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'map-on-state-array')).toBe(true)
  })

  it('detects form boilerplate', () => {
    const source = `
      type Msg =
        | { type: 'setName'; value: string }
        | { type: 'setEmail'; value: string }
        | { type: 'setPhone'; value: string }
        | { type: 'submit' }
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'form-boilerplate')).toBe(true)
  })

  it('does not flag form boilerplate with fewer than 3 similar variants', () => {
    const source = `
      type Msg =
        | { type: 'setName'; value: string }
        | { type: 'setEmail'; value: string }
        | { type: 'submit' }
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'form-boilerplate')).toBe(false)
  })

  it('reports perfect score for clean code', () => {
    const source = `
      import { component, div, button, text, each, memo } from '@llui/dom'
      type State = { count: number; items: { id: number; text: string }[] }
      type Msg = { type: 'inc' } | { type: 'dec' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0, items: [] }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc': return [{ ...state, count: state.count + 1 }, []]
            case 'dec': return [{ ...state, count: state.count - 1 }, []]
          }
        },
        view: (send) => [
          div({}, [
            text(s => String(s.count)),
            button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.score).toBe(15)
  })

  it('score decreases by unique violated rule categories', () => {
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = { items: string[]; count: number }
      type Msg =
        | { type: 'setA'; value: string }
        | { type: 'setB'; value: string }
        | { type: 'setC'; value: string }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [], count: 0 }, []],
        update: (state, msg) => {
          state.count = 0
          return [state, []]
        },
        view: (send) => [
          div({}, state.items.map(item => text(item)))
        ],
      })
    `
    const result = lintIdiomatic(source)
    // Should have at least state-mutation, map-on-state-array, and form-boilerplate
    const violatedRules = new Set(result.violations.map((v) => v.rule))
    expect(violatedRules.size).toBeGreaterThanOrEqual(3)
    expect(result.score).toBe(15 - violatedRules.size)
  })

  it('includes correct file and position info', () => {
    const source = `const C = component({
  update: (state, msg) => {
    state.x = 1
    return [state, []]
  },
  view: () => [],
})`
    const result = lintIdiomatic(source, 'myfile.ts')
    const violation = result.violations.find((v) => v.rule === 'state-mutation')
    expect(violation).toBeDefined()
    expect(violation!.file).toBe('myfile.ts')
    expect(violation!.line).toBe(3)
    expect(violation!.column).toBeGreaterThan(0)
  })

  // ── Rule 7: async-update ──────────────────────────────────────────

  it('detects async update function', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: async (state, msg) => {
          const data = await fetch('/api')
          return [{ ...state, data }, []]
        },
        view: ({ send }) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'async-update')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('synchronous and pure')),
    ).toBe(true)
  })

  it('does not flag synchronous update', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          return [{ ...state, count: state.count + 1 }, []]
        },
        view: ({ send }) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'async-update')).toBe(false)
  })

  // ── Rule 8: direct-state-in-view ──────────────────────────────────

  it('detects stale state capture in event handler', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, msg) => [s, []],
        view: ({ send }) => [
          button({ onClick: () => send({ type: 'set', value: state.count }) }, [
            text('click'),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'direct-state-in-view')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('stale state capture')),
    ).toBe(true)
  })

  it('does not flag accessor-based state reads in view', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, msg) => [s, []],
        view: ({ send }) => [
          button({ onClick: () => send({ type: 'inc' }) }, [
            text(s => String(s.count)),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'direct-state-in-view')).toBe(false)
  })

  // ── Rule 9: exhaustive-effect-handling ────────────────────────────

  it('detects empty .else() handler', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, msg) => [s, []],
        view: ({ send }) => [],
        onEffect: handleEffects()
          .on('http', (ctx) => { /* handle */ })
          .else(() => {}),
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'exhaustive-effect-handling')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('silently drops')),
    ).toBe(true)
  })

  it('detects empty .else() handler with param', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, msg) => [s, []],
        view: ({ send }) => [],
        onEffect: handleEffects()
          .else((_ctx) => {}),
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'exhaustive-effect-handling')).toBe(true)
  })

  it('does not flag non-empty .else() handler', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, msg) => [s, []],
        view: ({ send }) => [],
        onEffect: handleEffects()
          .else((ctx) => { console.warn('unhandled', ctx.effect) }),
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'exhaustive-effect-handling')).toBe(false)
  })

  // ── Rule 10: effect-without-handler ──────────────────────────────

  it('detects effects returned without onEffect handler', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ data: null }, []],
        update: (s, msg) => [s, [{ type: 'http', url: '/api' }]],
        view: ({ send }) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'effect-without-handler')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('no onEffect handler')),
    ).toBe(true)
  })

  it('does not flag component with onEffect handler', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ data: null }, []],
        update: (s, msg) => [s, [{ type: 'http', url: '/api' }]],
        view: ({ send }) => [],
        onEffect: (ctx) => {},
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'effect-without-handler')).toBe(false)
  })

  // ── Rule 11: forgotten-spread ────────────────────────────────────

  it('detects show/each/branch without spread in array', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ flag: true }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          div({}, [show({ when: s => s.flag, then: () => [text('yes')] })]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'forgotten-spread')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('spread it')),
    ).toBe(true)
  })

  it('does not flag spread show/each/branch', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ flag: true }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          div({}, [...show({ when: s => s.flag, then: () => [text('yes')] })]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'forgotten-spread')).toBe(false)
  })

  // ── Rule 12: string-effect-callback ──────────────────────────────

  it('detects string-based effect callbacks', () => {
    const source = `
      const effects = [
        http({ url: '/api', onSuccess: 'loaded', onError: 'failed' })
      ]
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'string-effect-callback')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('deprecated')),
    ).toBe(true)
  })

  it('does not flag function-based effect callbacks', () => {
    const source = `
      const effects = [
        http({ url: '/api', onSuccess: (data) => ({ type: 'loaded', payload: data }) })
      ]
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'string-effect-callback')).toBe(false)
  })

  // ── Rule 13: nested-send-in-update ───────────────────────────────

  it('detects send() inside update()', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          send({ type: 'oops' })
          return [state, []]
        },
        view: ({ send }) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'nested-send-in-update')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('recursive dispatch')),
    ).toBe(true)
  })

  it('does not flag send() outside update()', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          return [{ ...state, count: state.count + 1 }, []]
        },
        view: ({ send }) => [
          button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'nested-send-in-update')).toBe(false)
  })

  // ── Rule 14: imperative-dom-in-view ──────────────────────────────

  it('detects document.querySelector in view()', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => {
          const el = document.querySelector('.foo')
          return []
        },
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'imperative-dom-in-view')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('Imperative DOM access')),
    ).toBe(true)
  })

  it('does not flag document.querySelector inside onMount()', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => {
          onMount(() => {
            const el = document.querySelector('.foo')
          })
          return []
        },
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'imperative-dom-in-view')).toBe(false)
  })

  // ── Rule 15: accessor-side-effect ────────────────────────────────

  it('detects console.log in accessor', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          text(s => { console.log(s.count); return String(s.count) }),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'accessor-side-effect')).toBe(true)
    expect(
      result.violations.some((v) => v.message.includes('Side effect in accessor')),
    ).toBe(true)
  })

  it('does not flag accessor without side effects', () => {
    const source = `
      const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ send }) => [
          text(s => String(s.count)),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'accessor-side-effect')).toBe(false)
  })
})
