import { describe, it, expect, vi, afterEach } from 'vitest'
import { replayTrace, type LluiTrace, type ReplayableTrace } from '../src/replay-trace'
import { component } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ count: state.count + 1 }, []]
      case 'dec':
        return [{ count: Math.max(0, state.count - 1) }, []]
    }
  },
  view: () => [],
})

describe('replayTrace', () => {
  it('replays a trace successfully when states match', () => {
    const trace: LluiTrace<State, Msg, never> = {
      lluiTrace: 1,
      component: 'Counter',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        { msg: { type: 'inc' }, expectedState: { count: 1 }, expectedEffects: [] },
        { msg: { type: 'inc' }, expectedState: { count: 2 }, expectedEffects: [] },
        { msg: { type: 'dec' }, expectedState: { count: 1 }, expectedEffects: [] },
      ],
    }

    // Should not throw
    replayTrace(Counter, trace)
  })

  it('throws when state diverges', () => {
    const trace: LluiTrace<State, Msg, never> = {
      lluiTrace: 1,
      component: 'Counter',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        { msg: { type: 'inc' }, expectedState: { count: 1 }, expectedEffects: [] },
        { msg: { type: 'inc' }, expectedState: { count: 999 }, expectedEffects: [] }, // wrong!
      ],
    }

    expect(() => replayTrace(Counter, trace)).toThrow(/step 1/)
  })

  it('throws when effects diverge', () => {
    type Eff = { type: 'log'; message: string }
    const WithEffects = component<State, Msg, Eff>({
      name: 'WithEffects',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ count: state.count + 1 }, [{ type: 'log', message: 'incremented' }]]
          case 'dec':
            return [{ count: state.count - 1 }, []]
        }
      },
      view: () => [],
    })

    const trace: LluiTrace<State, Msg, Eff> = {
      lluiTrace: 1,
      component: 'WithEffects',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        {
          msg: { type: 'inc' },
          expectedState: { count: 1 },
          expectedEffects: [{ type: 'log', message: 'wrong message' }],
        },
      ],
    }

    expect(() => replayTrace(WithEffects, trace)).toThrow(/step 0/)
  })

  it('matches an http-shaped effect whose onSuccess/onError callbacks differ by identity', () => {
    // Effects commonly carry function fields (http onSuccess/onError, storage
    // onLoad, websocket onMessage). Those functions can never be recorded in a
    // trace and are fresh instances each `update()`, so the comparison must skip
    // them and match on the JSON-serializable data (type, url, …).
    type Eff = {
      type: 'http'
      url: string
      onSuccess: (data: unknown) => Msg
      onError: (err: unknown) => Msg
    }
    const Loader = component<State, Msg, Eff>({
      name: 'Loader',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [
              { count: state.count + 1 },
              [
                {
                  type: 'http',
                  url: '/api/data',
                  onSuccess: () => ({ type: 'inc' }),
                  onError: () => ({ type: 'dec' }),
                },
              ],
            ]
          case 'dec':
            return [{ count: state.count - 1 }, []]
        }
      },
      view: () => [],
    })

    const trace: LluiTrace<State, Msg, Eff> = {
      lluiTrace: 1,
      component: 'Loader',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        {
          msg: { type: 'inc' },
          expectedState: { count: 1 },
          // Distinct callback instances — must not cause a false divergence.
          expectedEffects: [
            {
              type: 'http',
              url: '/api/data',
              onSuccess: () => ({ type: 'inc' }),
              onError: () => ({ type: 'dec' }),
            },
          ],
        },
      ],
    }

    expect(() => replayTrace(Loader, trace)).not.toThrow()
  })

  it('still flags a real divergence in an effect carrying callbacks (data differs)', () => {
    type Eff = { type: 'http'; url: string; onSuccess: (data: unknown) => Msg }
    const Loader = component<State, Msg, Eff>({
      name: 'Loader2',
      init: () => [{ count: 0 }, []],
      update: (state, msg) =>
        msg.type === 'inc'
          ? [
              { count: state.count + 1 },
              [{ type: 'http', url: '/api/data', onSuccess: () => ({ type: 'inc' }) }],
            ]
          : [{ count: state.count - 1 }, []],
      view: () => [],
    })

    const trace: LluiTrace<State, Msg, Eff> = {
      lluiTrace: 1,
      component: 'Loader2',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries: [
        {
          msg: { type: 'inc' },
          expectedState: { count: 1 },
          expectedEffects: [
            { type: 'http', url: '/DIFFERENT', onSuccess: () => ({ type: 'inc' }) },
          ],
        },
      ],
    }

    expect(() => replayTrace(Loader, trace)).toThrow(/step 0/)
  })
})

describe('replayTrace validation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** A reducer that must never run: any of these traces is rejected up front. */
  const Exploding = component<State, Msg, never>({
    name: 'Counter',
    init: () => [{ count: 0 }, []],
    update: () => {
      throw new Error('reducer ran — validation did not happen first')
    },
    view: () => [],
  })

  const entries: ReplayableTrace<State, Msg, never>['entries'] = [
    { msg: { type: 'inc' }, expectedState: { count: 1 }, expectedEffects: [] },
  ]

  it('rejects an unsupported trace version before the first reducer call', () => {
    const trace: ReplayableTrace<State, Msg, never> = {
      lluiTrace: 2,
      component: 'Counter',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries,
    }

    // Names both the version found and the one supported — never a state diff.
    expect(() => replayTrace(Exploding, trace)).toThrow(/unsupported trace version/)
    expect(() => replayTrace(Exploding, trace)).toThrow(/\b2\b/)
    expect(() => replayTrace(Exploding, trace)).toThrow(/supports version 1/)
    expect(() => replayTrace(Exploding, trace)).not.toThrow(/diverged/)
  })

  it('rejects a trace with a missing version field', () => {
    // A hand-edited or foreign JSON blob: `lluiTrace` never survived the edit.
    const trace: ReplayableTrace<State, Msg, never> = {
      component: 'Counter',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries,
    }

    expect(() => replayTrace(Exploding, trace)).toThrow(/unsupported trace version/)
    expect(() => replayTrace(Exploding, trace)).toThrow(/none/)
  })

  it('rejects a trace recorded from a different component, naming both', () => {
    const trace: ReplayableTrace<State, Msg, never> = {
      lluiTrace: 1,
      component: 'SomeOtherComponent',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries,
    }

    expect(() => replayTrace(Exploding, trace)).toThrow(
      /recorded from component "SomeOtherComponent"/,
    )
    expect(() => replayTrace(Exploding, trace)).toThrow(/"Counter"/)
    expect(() => replayTrace(Exploding, trace)).not.toThrow(/diverged/)
  })

  it('accepts a trace with no component field, but warns that identity is unverified', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const trace: ReplayableTrace<State, Msg, never> = {
      lluiTrace: 1,
      generatedBy: 'pre-identity tool',
      timestamp: '2026-04-01',
      entries,
    }

    replayTrace(Counter, trace)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/no `component` field/)
  })

  it('warns instead of throwing when the definition itself is unnamed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Anonymous = component<State, Msg, never>({
      init: () => [{ count: 0 }, []],
      update: (state) => [{ count: state.count + 1 }, []],
      view: () => [],
    })
    const trace: ReplayableTrace<State, Msg, never> = {
      lluiTrace: 1,
      component: 'Counter',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries,
    }

    // `name` is optional on a component def, so an unnamed def can't be an
    // identity mismatch — there is nothing to mismatch against.
    replayTrace(Anonymous, trace)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/has no `name`/)
  })

  it('replays a matching well-formed trace without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const trace: LluiTrace<State, Msg, never> = {
      lluiTrace: 1,
      component: 'Counter',
      generatedBy: 'test',
      timestamp: '2026-04-01',
      entries,
    }

    replayTrace(Counter, trace)

    expect(warn).not.toHaveBeenCalled()
  })
})
