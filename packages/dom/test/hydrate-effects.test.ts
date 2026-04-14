import { describe, it, expect } from 'vitest'
import { hydrateApp, div, text } from '../src'
import type { ComponentDef } from '../src/types'

// REPRO: Bug 3 — hydrateApp should NOT silently drop init-time effects.
// Previously mount.ts:180 replaced `init` with a stub returning
// `[serverState, []]`, discarding whatever effects the original init
// returned. Components that "load data on mount" or attach global
// listeners via the TEA effect system silently failed after SSR.
describe('hydrateApp — init-time effects', () => {
  it('dispatches effects returned by the original init', () => {
    type State = { value: number }
    type Msg = { type: 'noop' }
    type Effect = { type: 'loadSession' } | { type: 'subscribe' }

    const seen: Effect[] = []

    const def: ComponentDef<State, Msg, Effect> = {
      name: 'App',
      init: () => [{ value: 0 }, [{ type: 'loadSession' }, { type: 'subscribe' }]],
      update: (s, _m) => [s, []],
      view: ({ text: t }) => [div([t((s: State) => String(s.value))])],
      onEffect: ({ effect }) => {
        seen.push(effect)
      },
    }

    const container = document.createElement('div')
    const handle = hydrateApp(container, def, { value: 42 })
    try {
      expect(seen).toEqual([{ type: 'loadSession' }, { type: 'subscribe' }])
    } finally {
      handle.dispose()
    }
  })

  it('uses serverState for rendering, not init state', () => {
    type State = { value: number }
    type Msg = { type: 'noop' }

    const def: ComponentDef<State, Msg, never> = {
      name: 'App',
      init: () => [{ value: 0 }, []], // init says 0
      update: (s) => [s, []],
      view: ({ text: t }) => [div([t((s: State) => String(s.value))])],
    }

    const container = document.createElement('div')
    const handle = hydrateApp(container, def, { value: 99 })
    try {
      expect(container.textContent).toBe('99') // hydrated with serverState, not init's 0
    } finally {
      handle.dispose()
    }
  })

  it('does not crash when the original init returns no effects', () => {
    type State = { n: number }
    type Msg = { type: 'noop' }

    const def: ComponentDef<State, Msg, never> = {
      name: 'Simple',
      init: () => [{ n: 1 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [text((s: State) => String(s.n))],
    }

    const container = document.createElement('div')
    expect(() => hydrateApp(container, def, { n: 7 }).dispose()).not.toThrow()
  })
})
