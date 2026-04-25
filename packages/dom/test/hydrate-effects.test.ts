import { describe, it, expect, vi } from 'vitest'
import { hydrateApp, div, text } from '../src'
import type { ComponentDef } from '../src/types'

describe('hydrateApp — init-time effects', () => {
  // Default behavior: hydration does NOT re-run init's effects. The
  // SSR pass already ran init() on the server (where `init()` was
  // expected to gate effects with a `loaded` flag); re-firing on the
  // client typically produces duplicate work. Opt back in via
  // `MountOptions.runInitEffectsOnHydrate: true`.
  it('skips init effects by default on hydrate', () => {
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
      expect(seen).toEqual([])
    } finally {
      handle.dispose()
    }
  })

  it('dispatches init effects on hydrate when runInitEffectsOnHydrate=true', () => {
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
    const handle = hydrateApp(container, def, { value: 42 }, { runInitEffectsOnHydrate: true })
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

  it('warns in dev when non-empty init effects are silently dropped', () => {
    type State = { value: number }
    type Msg = { type: 'noop' }
    type Effect = { type: 'loadSession' }

    const def: ComponentDef<State, Msg, Effect> = {
      name: 'WarnsOnDrop',
      init: () => [{ value: 0 }, [{ type: 'loadSession' }]],
      update: (s) => [s, []],
      view: ({ text: t }) => [div([t((s: State) => String(s.value))])],
      onEffect: () => {},
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const container = document.createElement('div')
      const handle = hydrateApp(container, def, { value: 1 })
      try {
        expect(warn).toHaveBeenCalledTimes(1)
        const msg = warn.mock.calls[0]?.[0] as string
        expect(msg).toMatch(/hydrateApp: skipped 1 init effect/)
        expect(msg).toMatch(/WarnsOnDrop/)
        expect(msg).toMatch(/runInitEffectsOnHydrate: true/)
      } finally {
        handle.dispose()
      }
    } finally {
      warn.mockRestore()
    }
  })

  it('does not warn when runInitEffectsOnHydrate=true', () => {
    type State = { value: number }
    type Msg = { type: 'noop' }
    type Effect = { type: 'loadSession' }

    const def: ComponentDef<State, Msg, Effect> = {
      name: 'NoWarnOnOptIn',
      init: () => [{ value: 0 }, [{ type: 'loadSession' }]],
      update: (s) => [s, []],
      view: ({ text: t }) => [div([t((s: State) => String(s.value))])],
      onEffect: () => {},
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const container = document.createElement('div')
      const handle = hydrateApp(container, def, { value: 1 }, { runInitEffectsOnHydrate: true })
      try {
        expect(warn).not.toHaveBeenCalled()
      } finally {
        handle.dispose()
      }
    } finally {
      warn.mockRestore()
    }
  })

  it('does not warn when init returns no effects', () => {
    type State = { value: number }
    type Msg = { type: 'noop' }

    const def: ComponentDef<State, Msg, never> = {
      name: 'NoEffectsNoWarn',
      init: () => [{ value: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div([t((s: State) => String(s.value))])],
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const container = document.createElement('div')
      const handle = hydrateApp(container, def, { value: 1 })
      try {
        expect(warn).not.toHaveBeenCalled()
      } finally {
        handle.dispose()
      }
    } finally {
      warn.mockRestore()
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
