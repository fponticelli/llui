import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, text } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'
import type { BindingError } from '../../src/signals/runtime'

// Issue #57 — the commit path notified subscribers in a bare loop, so a throw
// from ONE observer (devtools, the agent bridge, a test harness — exactly the
// listeners an app does not control) escaped the commit, escaped the drain, and
// escaped `send()` into the DOM event handler that dispatched the message. Worse
// than the visible throw: `drain` runs a message's collected effects AFTER the
// commit, so the escape also STRANDED those effects — the reducer ran, state
// advanced, the DOM updated, and `onEffect` never fired, silently.

interface S {
  n: number
}
type M = { type: 'inc' }
type E = { type: 'ping' }

function makeDef(effects: E[]) {
  return {
    name: 'subscriber-isolation',
    init: (): [S, E[]] => [{ n: 0 }, []],
    update: (s: S, m: M): [S, E[]] =>
      m.type === 'inc' ? [{ n: s.n + 1 }, [{ type: 'ping' } as E]] : [s, []],
    view: ({ state }: { state: Signal<S> }) => [div([text(state.at('n').map(String))])],
    onEffect: (e: E): void => {
      effects.push(e)
    },
  }
}

function fakeRaf() {
  const frames: Array<() => void> = []
  vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', (): void => {})
  return {
    runFrame: (): void => {
      for (const f of frames.splice(0)) f()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('commit — subscriber isolation', () => {
  it('isolates a throwing subscriber from send() and from effect dispatch', () => {
    const container = document.createElement('div')
    const effects: E[] = []

    const handle = mountSignalComponent<S, M, E>(container, makeDef(effects))

    handle.subscribe(() => {
      throw new Error('observer blew up')
    })

    // Capture BOTH facts before asserting, so the failure reports the blast
    // radius: did the throw escape, and did it strand this message's effects?
    let threw = false
    try {
      handle.send({ type: 'inc' })
    } catch {
      threw = true
    }
    expect({ threw, effects: [...effects] }).toEqual({ threw: false, effects: [{ type: 'ping' }] })

    handle.dispose()
  })

  it('notifies the subscribers AFTER a throwing one, all with the same state', () => {
    const container = document.createElement('div')
    const effects: E[] = []
    const handle = mountSignalComponent<S, M, E>(container, makeDef(effects))

    const seen: Array<[string, S]> = []
    handle.subscribe((s) => {
      seen.push(['first', s])
      throw new Error('observer blew up')
    })
    handle.subscribe((s) => {
      seen.push(['second', s])
    })
    handle.subscribe((s) => {
      seen.push(['third', s])
    })

    handle.send({ type: 'inc' })

    expect(seen).toEqual([
      ['first', { n: 1 }],
      ['second', { n: 1 }],
      ['third', { n: 1 }],
    ])
    // The DOM still committed, and the effect still went out exactly once.
    expect(container.textContent).toBe('1')
    expect(effects).toEqual([{ type: 'ping' }])

    handle.dispose()
  })

  it('reports a throwing subscriber to an installed binding-error hook and the dev console', () => {
    const container = document.createElement('div')
    const effects: E[] = []
    const handle = mountSignalComponent<S, M, E>(container, makeDef(effects))
    const errors: BindingError[] = []
    handle.setOnBindingError((e) => {
      errors.push(e)
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    handle.subscribe(() => {
      throw new Error('observer blew up')
    })

    handle.send({ type: 'inc' })

    expect(errors.length).toBe(1)
    expect(errors[0]?.kind).toBe('subscriber')
    expect(errors[0]?.message).toBe('observer blew up')
    expect(typeof errors[0]?.stack).toBe('string')
    // Not silently swallowed: dev also gets it on the console.
    expect(consoleError).toHaveBeenCalledTimes(1)

    handle.dispose()
  })

  it("isolates the same way under scheduler: 'raf'", () => {
    const raf = fakeRaf()
    const container = document.createElement('div')
    const effects: E[] = []
    const handle = mountSignalComponent<S, M, E>(container, makeDef(effects), { scheduler: 'raf' })

    const seen: string[] = []
    handle.subscribe(() => {
      seen.push('first')
      throw new Error('observer blew up')
    })
    handle.subscribe(() => {
      seen.push('second')
    })

    // Effects are synchronous even in raf mode; the commit (and so the notify)
    // is deferred to the frame — where the throw must not escape either.
    handle.send({ type: 'inc' })
    expect(effects).toEqual([{ type: 'ping' }])
    expect(seen).toEqual([])

    let threw = false
    try {
      raf.runFrame()
    } catch {
      threw = true
    }
    expect({ threw, seen }).toEqual({ threw: false, seen: ['first', 'second'] })
    expect(container.textContent).toBe('1')

    handle.dispose()
  })

  it('reports a throwing subscriber in a production build with no hook installed', () => {
    // The escape used to be loud (it blew up the DOM handler); isolating it must
    // not trade that for silence. A binding throw with no hook still propagates
    // in a prod build, so a subscriber throw that reached NOBODY — no dev
    // console, no hook — would be strictly less visible than what it replaced.
    vi.stubEnv('DEV', false)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = document.createElement('div')
    const effects: E[] = []
    // `dev` is captured at mount, so the stub has to be in place first.
    const handle = mountSignalComponent<S, M, E>(container, makeDef(effects))

    handle.subscribe(() => {
      throw new Error('observer blew up')
    })

    handle.send({ type: 'inc' })

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(effects).toEqual([{ type: 'ping' }])

    handle.dispose()
  })

  it('contains a setOnBindingError hook that itself throws', () => {
    // Reporting must not reopen the hole it closes: the hook is tooling too (the
    // agent bridge installs one), and a throw from it lands on the same commit
    // path — so it would escape `send` and strand the effects exactly as the
    // subscriber throw did.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const container = document.createElement('div')
    const effects: E[] = []
    const handle = mountSignalComponent<S, M, E>(container, makeDef(effects))

    handle.setOnBindingError(() => {
      throw new Error('hook blew up')
    })
    handle.subscribe(() => {
      throw new Error('observer blew up')
    })

    let threw = false
    try {
      handle.send({ type: 'inc' })
    } catch {
      threw = true
    }
    expect({ threw, effects: [...effects] }).toEqual({ threw: false, effects: [{ type: 'ping' }] })
    // Both throws are reported: the subscriber's, then the hook's own.
    expect(consoleError).toHaveBeenCalledTimes(2)
    expect(container.textContent).toBe('1')

    handle.dispose()
  })

  it('a subscriber that throws does not stop a LATER send from committing', () => {
    const container = document.createElement('div')
    const effects: E[] = []
    const handle = mountSignalComponent<S, M, E>(container, makeDef(effects))

    handle.subscribe(() => {
      throw new Error('observer blew up')
    })

    handle.send({ type: 'inc' })
    handle.send({ type: 'inc' })

    expect(container.textContent).toBe('2')
    expect(effects).toEqual([{ type: 'ping' }, { type: 'ping' }])

    handle.dispose()
  })
})
