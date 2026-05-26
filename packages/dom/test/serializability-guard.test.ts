import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountApp, text } from '../src/index'
import { defineTestComponent } from './helpers/defineTestComponent.js'

describe('dev-mode state serializability guard', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  function mount<S>(initial: S): ReturnType<typeof defineTestComponent<S, never, never>> {
    return defineTestComponent<S, never, never>({
      name: 'Guard',
      init: () => [initial, []],
      update: (s) => [s, []],
      view: () => [text('ok')],
    })
  }

  function firstWarnMessage(): string {
    return String(warnSpy.mock.calls[0]![0])
  }

  it('does not warn on plain JSON state', () => {
    mountApp(
      document.createElement('div'),
      mount({ count: 0, items: [{ id: 'a' }, { id: 'b' }], meta: { x: 1 } }),
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns on Date in state', () => {
    mountApp(document.createElement('div'), mount({ created: new Date() }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('state.created (Date)')
  })

  it('warns on Map in state', () => {
    mountApp(document.createElement('div'), mount({ lookup: new Map() }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('Map')
  })

  it('warns on Set in state', () => {
    mountApp(document.createElement('div'), mount({ tags: new Set() }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('Set')
  })

  it('warns on class instance in state', () => {
    class Counter {
      n = 0
    }
    mountApp(document.createElement('div'), mount({ c: new Counter() }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('Counter')
  })

  it('warns on function value in state', () => {
    mountApp(document.createElement('div'), mount({ onSelect: () => {} }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('state.onSelect')
  })

  it('finds the deepest first offender', () => {
    mountApp(document.createElement('div'), mount({ items: [{ id: 'a', when: new Date() }] }))
    expect(warnSpy).toHaveBeenCalled()
    expect(firstWarnMessage()).toContain('state.items[0].when (Date)')
  })

  it('allows nested arrays and plain objects', () => {
    mountApp(
      document.createElement('div'),
      mount({
        matrix: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        users: [{ name: 'alice', tags: ['admin'] }],
      }),
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // Reducer-output check — regression: the mount-time check used to be
  // the only signal, so a reducer that introduced a Map AFTER init slid
  // through silently and broke HMR / devtools snapshots later. The
  // update-loop now also walks the post-reducer state (once per
  // instance, dev-only) and emits a warning that identifies the
  // reducer-output phase explicitly.

  it('warns when a reducer returns a Map (not present in initial state)', () => {
    type S = { lookup: Record<string, number> | Map<string, number> }
    type M = { type: 'flip' }
    const def = defineTestComponent<S, M, never>({
      name: 'ReducerMap',
      init: () => [{ lookup: {} }, []],
      update: (s, m) => {
        if (m.type === 'flip') return [{ lookup: new Map([['a', 1]]) }, []]
        return [s, []]
      },
      view: () => [text('ok')],
    })
    const handle = mountApp(document.createElement('div'), def)
    expect(warnSpy).not.toHaveBeenCalled()
    handle.send({ type: 'flip' })
    handle.flush()
    expect(warnSpy).toHaveBeenCalled()
    const msg = String(warnSpy.mock.calls[0]![0])
    expect(msg).toContain('reducer returned')
    expect(msg).toContain('Map')
  })

  it('warns at most once per instance even when reducer returns multiple bad states', () => {
    type S = { v: Date | string }
    type M = { type: 'bad1' } | { type: 'bad2' }
    const def = defineTestComponent<S, M, never>({
      name: 'OnceOnly',
      init: () => [{ v: 'ok' }, []],
      update: (s, m) => {
        if (m.type === 'bad1') return [{ v: new Date() }, []]
        if (m.type === 'bad2') return [{ v: new Date(0) }, []]
        return [s, []]
      },
      view: () => [text('ok')],
    })
    const handle = mountApp(document.createElement('div'), def)
    handle.send({ type: 'bad1' })
    handle.flush()
    handle.send({ type: 'bad2' })
    handle.flush()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
