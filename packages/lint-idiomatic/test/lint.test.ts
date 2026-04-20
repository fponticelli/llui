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
    expect(result.score).toBeLessThan(20)
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

  it('does NOT flag logical not / bitwise not / unary plus/minus on state', () => {
    // Prefix unary operators other than ++/-- are pure reads, not
    // mutations. This is the canonical pattern for a toggle reducer:
    //   return [{ ...state, flag: !state.flag }, []]
    // Regression: before the fix, the state-mutation rule matched all
    // prefix unary operators and flagged this as an increment.
    const source = `
      import { component } from '@llui/dom'
      type State = { on: boolean; count: number }
      type Msg = { type: 'toggle' } | { type: 'negate' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ on: false, count: 5 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'toggle':
              return [{ ...state, on: !state.on }, []]
            case 'negate':
              return [{ ...state, count: -state.count }, []]
          }
        },
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    const mutations = result.violations.filter((v) => v.rule === 'state-mutation')
    expect(mutations).toEqual([])
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
      import { component, div, button } from '@llui/dom'
      type State = { count: number }
      /**
       * @intent("Increment the counter")
       */
      type Msg =
        /** @intent("Increment") */
        | { type: 'inc' }
        /** @intent("Decrement") */
        | { type: 'dec' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc': return [{ ...state, count: state.count + 1 }, []]
            case 'dec': return [{ ...state, count: state.count - 1 }, []]
          }
        },
        view: ({ send, text }) => [
          div({}, [
            text(s => String(s.count)),
            button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.score).toBe(20)
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
    expect(result.score).toBe(20 - violatedRules.size)
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

  // ── Rule: spread-in-children ──────────────────────────────────────

  it('does NOT flag spread of provide() inside element children', () => {
    // `provide()` returns Node[] — spreading is the idiomatic and
    // ONLY way to use it as a child. Regression: before the fix,
    // spread-in-children had no `provide` exemption and flagged every
    // context-provider use inside a layout's view tree.
    const source = `
      import { component, div, main, provide, createContext } from '@llui/dom'
      const Ctx = createContext<string>('default')
      const C = component<{}, never, never>({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          div({ class: 'root' }, [
            ...provide(Ctx, () => 'hello', () => [
              main({ class: 'main' }, []),
            ]),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    const spreads = result.violations.filter((v) => v.rule === 'spread-in-children')
    expect(spreads).toEqual([])
  })

  it('does NOT flag spread of pageSlot() inside element children', () => {
    // pageSlot() (from @llui/vike/client) also returns Node[].
    // Not imported from @llui/dom in practice, but the rule should
    // still exempt it by name since it composes the same way.
    const source = `
      import { component, main } from '@llui/dom'
      import { pageSlot } from '@llui/vike/client'
      const C = component<{}, never, never>({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ send }) => [main({}, [...pageSlot()])],
      })
    `
    const result = lintIdiomatic(source)
    const spreads = result.violations.filter((v) => v.rule === 'spread-in-children')
    expect(spreads).toEqual([])
  })

  it('still flags spread of a plain .map() call in element children', () => {
    const source = `
      import { component, ul, li, text } from '@llui/dom'
      const items = ['a', 'b', 'c']
      const C = component<{}, never, never>({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          ul({}, [...items.map((x) => li({}, [text(x)]))]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'spread-in-children')).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('synchronous and pure'))).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('stale state capture'))).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('silently drops'))).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('no onEffect handler'))).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('spread it'))).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('deprecated'))).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('recursive dispatch'))).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('Imperative DOM access'))).toBe(true)
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
    expect(result.violations.some((v) => v.message.includes('Side effect in accessor'))).toBe(true)
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

// ── Regression: false positives from real examples ────────────────────

describe('each-closure-violation — only flags mutable captures', () => {
  it('does NOT flag captures of imported pure functions', () => {
    const source = `
      import { component, div, each, text } from '@llui/dom'
      import { formatRelativeTime } from '@llui/components'
      type State = { items: { id: string; ts: number }[] }
      type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: ({ each, text }) => [
          div({}, [
            ...each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => [
                text((s: State) => formatRelativeTime(item.ts())),
              ],
            }),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'each-closure-violation')).toBe(false)
  })

  it('does NOT flag captures of module-level const declarations', () => {
    const source = `
      import { component, div, each, text } from '@llui/dom'
      const PREFIX = 'item:'
      type State = { items: { id: string }[] }
      type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: ({ each, text }) => [
          div({}, [
            ...each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => [text(() => PREFIX + item.id())],
            }),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'each-closure-violation')).toBe(false)
  })

  it('does NOT flag captures of module-level function declarations', () => {
    const source = `
      import { component, div, each, text } from '@llui/dom'
      function formatId(id: string): string { return '#' + id }
      type State = { items: { id: string }[] }
      type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: ({ each, text }) => [
          div({}, [
            ...each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => [text(() => formatId(item.id()))],
            }),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'each-closure-violation')).toBe(false)
  })

  it('STILL flags captures of enclosing-function let variables', () => {
    const source = `
      import { component, div, each, text } from '@llui/dom'
      type State = { items: { id: string }[]; counter: number }
      type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [], counter: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ each, text }) => {
          let localCounter = 0
          return [
            div({}, [
              ...each({
                items: (s) => s.items,
                key: (i) => i.id,
                render: ({ item }) => [text(() => String(localCounter))],
              }),
            ]),
          ]
        },
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'each-closure-violation')).toBe(true)
  })
})

describe('view-bag-import — only flags inside component()', () => {
  it('does NOT flag Level-1 view function modules (no component() in file)', () => {
    const source = `
      import { div, text, each } from '@llui/dom'
      import type { State, Msg } from '../types'
      import type { Send } from '@llui/dom'

      export function todoList(send: Send<Msg>): HTMLElement {
        return div({}, [text((s: State) => s.title)])
      }
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'view-bag-import')).toBe(false)
  })

  it('STILL flags direct imports used inside a component view body', () => {
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [div({}, [text((s: State) => String(s.count))])],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'view-bag-import')).toBe(true)
  })

  it('does NOT flag shared helper imports (no component, no view bag)', () => {
    const source = `
      import { div, span, text } from '@llui/dom'
      import type { Send } from '@llui/dom'
      export function card<M>(title: string, body: string, send: Send<M>) {
        return div({ class: 'card' }, [
          span({}, [text(title)]),
          span({}, [text(body)]),
        ])
      }
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'view-bag-import')).toBe(false)
  })
})

describe('imperative-dom-in-view — skips event handlers and deferred callbacks', () => {
  it('does NOT flag document.querySelector inside onClick handler', () => {
    const source = `
      import { component, div, button } from '@llui/dom'
      type State = {}; type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{}, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            button({
              onClick: () => {
                const el = document.querySelector('.target')
                el?.focus()
              },
            }, []),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'imperative-dom-in-view')).toBe(false)
  })

  it('does NOT flag document.querySelector inside queueMicrotask', () => {
    const source = `
      import { component, div, button } from '@llui/dom'
      type State = {}; type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{}, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            button({
              onClick: () => {
                queueMicrotask(() => {
                  const el = document.querySelector('.target')
                })
              },
            }, []),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'imperative-dom-in-view')).toBe(false)
  })

  it('STILL flags document.querySelector in the view body itself', () => {
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = {}; type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{}, []],
        update: (s, m) => [s, []],
        view: () => {
          const el = document.querySelector('.target')
          return [div({}, [text(() => String(el))])]
        },
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'imperative-dom-in-view')).toBe(true)
  })
})

describe('missing-memo — only flags reactive-binding accessors', () => {
  it('does NOT flag duplicate zero-arg arrows in utility calls like child()', () => {
    const source = `
      import { component, div, child } from '@llui/dom'
      declare const A: any; declare const B: any; declare const C: any
      type State = {}; type Msg = { type: 'noop' }
      const Root = component<State, Msg, never>({
        name: 'Root',
        init: () => [{}, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            div(child({ def: A, key: 'a', props: () => ({}) })),
            div(child({ def: B, key: 'b', props: () => ({}) })),
            div(child({ def: C, key: 'c', props: () => ({}) })),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'missing-memo')).toBe(false)
  })

  it('does NOT flag trivial zero-arg arrows anywhere', () => {
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = {}; type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{}, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [text(() => 'static')]),
          div({}, [text(() => 'static')]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'missing-memo')).toBe(false)
  })

  it('STILL flags duplicate state-reading accessors across bindings', () => {
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = { first: string; last: string }
      type Msg = { type: 'noop' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ first: '', last: '' }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            text((s: State) => s.first + ' ' + s.last),
            text((s: State) => s.first + ' ' + s.last),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'missing-memo')).toBe(true)
  })
})
