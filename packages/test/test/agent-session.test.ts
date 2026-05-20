import { describe, it, expect } from 'vitest'
import { mountApp } from '@llui/dom'
import { defineTestComponent } from '../src/defineTestComponent.js'
import { recordAgentSession, replayAgentSession } from '../src/agent-session.js'

type State = { count: number; lastDelete: string | null }
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'delete'; id: string }

function makeApp() {
  return defineTestComponent<State, Msg, never>({
    name: 'AgentSessionFixture',
    init: () => [{ count: 0, lastDelete: null }, []],
    update: (s, m) => {
      switch (m.type) {
        case 'inc':
          return [{ ...s, count: s.count + 1 }, []]
        case 'dec':
          return [{ ...s, count: s.count - 1 }, []]
        case 'delete':
          return [{ ...s, lastDelete: m.id }, []]
      }
    },
    view: () => [],
  })
}

describe('recordAgentSession + replayAgentSession', () => {
  it('captures dispatched messages and final state', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())

    const r = recordAgentSession(handle)
    r.send({ type: 'inc' })
    r.send({ type: 'inc' })
    r.send({ type: 'delete', id: 'x' })
    const fixture = r.stop()

    expect(fixture.initialState).toEqual({ count: 0, lastDelete: null })
    expect(fixture.msgs).toEqual([{ type: 'inc' }, { type: 'inc' }, { type: 'delete', id: 'x' }])
    expect(fixture.finalState).toEqual({ count: 2, lastDelete: 'x' })

    handle.dispose()
    root.remove()
  })

  it('replay against fresh handle reproduces the same final state', () => {
    // The motivating use case: persist a fixture in source control,
    // replay in CI, assert end state matches. If a refactor of
    // update() drifts, the diff pinpoints the divergence.
    const recordRoot = document.createElement('div')
    document.body.appendChild(recordRoot)
    const recordHandle = mountApp(recordRoot, makeApp())

    const r = recordAgentSession(recordHandle)
    r.send({ type: 'inc' })
    r.send({ type: 'inc' })
    r.send({ type: 'inc' })
    r.send({ type: 'dec' })
    const fixture = r.stop()
    recordHandle.dispose()
    recordRoot.remove()

    // Fresh handle, identical app — replay should match.
    const replayRoot = document.createElement('div')
    document.body.appendChild(replayRoot)
    const replayHandle = mountApp(replayRoot, makeApp())

    const result = replayAgentSession(replayHandle, fixture)
    expect(result.matches).toBe(true)
    expect(result.diff).toEqual([])
    replayHandle.dispose()
    replayRoot.remove()
  })

  it('replay against drifted reducer reports the divergent paths', () => {
    // Capture against the original reducer; replay against a
    // modified one. The diff should pinpoint exactly what changed.
    const recordRoot = document.createElement('div')
    document.body.appendChild(recordRoot)
    const recordHandle = mountApp(recordRoot, makeApp())
    const r = recordAgentSession(recordHandle)
    r.send({ type: 'inc' })
    r.send({ type: 'inc' })
    const fixture = r.stop()
    recordHandle.dispose()
    recordRoot.remove()

    // Drifted reducer: increments by 10 instead of 1. Final state
    // diverges at /count.
    const driftedApp = defineTestComponent<State, Msg, never>({
      name: 'AgentSessionFixture',
      init: () => [{ count: 0, lastDelete: null }, []],
      update: (s, m) => {
        if (m.type === 'inc') return [{ ...s, count: s.count + 10 }, []]
        return [s, []]
      },
      view: () => [],
    })
    const replayRoot = document.createElement('div')
    document.body.appendChild(replayRoot)
    const replayHandle = mountApp(replayRoot, driftedApp)
    const result = replayAgentSession(replayHandle, fixture)
    expect(result.matches).toBe(false)
    expect(result.diff).toEqual([{ op: 'replace', path: '/count', value: 20 }])
    replayHandle.dispose()
    replayRoot.remove()
  })

  it('throws on send() after stop()', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())
    const r = recordAgentSession(handle)
    r.stop()
    expect(() => r.send({ type: 'inc' })).toThrow('after stop()')
    handle.dispose()
    root.remove()
  })

  it('throws on stop() called twice', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())
    const r = recordAgentSession(handle)
    r.stop()
    expect(() => r.stop()).toThrow('twice')
    handle.dispose()
    root.remove()
  })

  it('assertInitial flag catches init drift before replay starts', () => {
    // Same fixture, but the replay app has different init —
    // assertInitial: true catches this.
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())
    const r = recordAgentSession(handle)
    r.send({ type: 'inc' })
    const fixture = r.stop()
    handle.dispose()
    root.remove()

    const driftedInit = defineTestComponent<State, Msg, never>({
      name: 'AgentSessionFixture',
      init: () => [{ count: 100, lastDelete: null }, []], // drifted!
      update: (s) => [s, []],
      view: () => [],
    })
    const replayRoot = document.createElement('div')
    document.body.appendChild(replayRoot)
    const replayHandle = mountApp(replayRoot, driftedInit)
    const result = replayAgentSession(replayHandle, fixture, { assertInitial: true })
    expect(result.matches).toBe(false)
    // The diff is on the initial state, not the final.
    expect(result.diff).toEqual([{ op: 'replace', path: '/count', value: 100 }])
    replayHandle.dispose()
    replayRoot.remove()
  })

  it('fixture round-trips through JSON', () => {
    // The serializability promise: fixtures are plain JSON, so apps
    // can persist them as `__fixtures__/*.json` and load them in CI.
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())
    const r = recordAgentSession(handle)
    r.send({ type: 'inc' })
    r.send({ type: 'delete', id: 'abc' })
    const fixture = r.stop()
    const roundTripped = JSON.parse(JSON.stringify(fixture))
    expect(roundTripped).toEqual(fixture)
    handle.dispose()
    root.remove()
  })
})
