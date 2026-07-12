/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import {
  collectDebugSnapshot,
  collectVerboseSnapshot,
  createConsoleCapture,
} from '../src/debug-collector.js'

interface MsgRec {
  index: number
  timestamp: number
  msg: unknown
  effects?: unknown[]
}
interface PendEff {
  id: string
  type?: string
  dispatchedAt?: number
  status?: string
  payload?: unknown
}
interface TLEntry {
  effectId: string
  type?: string
  phase: string
  timestamp: number
  durationMs?: number
}
function mockComponent(
  state: unknown,
  history: MsgRec[] = [],
  pending: PendEff[] = [],
  timeline: TLEntry[] = [],
) {
  return {
    getState: () => state,
    getMessageHistory: () => history,
    getPendingEffects: () => pending,
    getEffectTimeline: () => timeline,
  }
}

describe('collectDebugSnapshot', () => {
  it('returns {} when no components are present', () => {
    const body = collectDebugSnapshot({ components: {} })
    expect(body).toEqual({})
  })

  it('returns {} when components is undefined (no debug API mounted)', () => {
    const body = collectDebugSnapshot()
    // In a fresh jsdom there's no __lluiComponents — empty body.
    expect(body).toEqual({})
  })

  it('collects state from every mounted component, keyed by name', () => {
    const body = collectDebugSnapshot({
      components: {
        UserCard: mockComponent({ user: 'Ada' }),
        App: mockComponent({ route: '/' }),
      },
    })
    expect(body.stateSnapshot).toEqual({
      UserCard: { user: 'Ada' },
      App: { route: '/' },
    })
  })

  it('collects message history with component-tagged entries', () => {
    const body = collectDebugSnapshot({
      components: {
        UserCard: mockComponent({}, [
          { index: 0, timestamp: 1700000000000, msg: { type: 'Load' } },
          { index: 1, timestamp: 1700000001000, msg: { type: 'Loaded' } },
        ]),
      },
    })
    expect(body.messageLog).toHaveLength(2)
    expect(body.messageLog![0]!.component).toBe('UserCard')
    expect(body.messageLog![0]!.msg).toEqual({ type: 'Load' })
    expect(body.messageLog![0]!.ts).toBe(new Date(1700000000000).toISOString())
  })

  it('sorts messageLog chronologically across components', () => {
    const body = collectDebugSnapshot({
      components: {
        A: mockComponent({}, [{ index: 0, timestamp: 200, msg: { type: 'A1' } }]),
        B: mockComponent({}, [{ index: 0, timestamp: 100, msg: { type: 'B1' } }]),
      },
    })
    expect(body.messageLog).toHaveLength(2)
    // earlier timestamp first
    expect(body.messageLog![0]!.msg).toEqual({ type: 'B1' })
    expect(body.messageLog![1]!.msg).toEqual({ type: 'A1' })
  })

  it('respects messageLimit by trimming the oldest entries', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      index: i,
      timestamp: 1000 + i,
      msg: { type: 'X', i },
    }))
    const body = collectDebugSnapshot({
      components: { Comp: mockComponent({}, history) },
      messageLimit: 5,
    })
    expect(body.messageLog).toHaveLength(5)
    expect((body.messageLog![0]!.msg as { i: number }).i).toBe(95)
  })

  it('collects pending effects with component tagging and sinceMs', () => {
    const body = collectDebugSnapshot({
      components: {
        UserCard: mockComponent(
          {},
          [],
          [{ id: 'eff-1', type: 'http', dispatchedAt: Date.now() - 500, payload: { url: '/x' } }],
        ),
      },
    })
    expect(body.effects?.pending).toHaveLength(1)
    const p = body.effects!.pending[0]!
    expect(p.component).toBe('UserCard')
    expect(p.id).toBe('eff-1')
    expect(p.sinceMs).toBeGreaterThanOrEqual(0)
  })

  it('maps recent effect timeline phases to outcomes', () => {
    const body = collectDebugSnapshot({
      components: {
        Comp: mockComponent(
          {},
          [],
          [],
          [
            { effectId: 'a', type: 'http', phase: 'resolved', timestamp: 1000 },
            { effectId: 'b', type: 'http', phase: 'cancelled', timestamp: 2000 },
            { effectId: 'c', type: 'http', phase: 'errored', timestamp: 3000 },
            { effectId: 'd', type: 'http', phase: 'dispatched', timestamp: 4000 }, // not terminal — skipped
          ],
        ),
      },
    })
    expect(body.effects?.recent.map((r) => r.outcome)).toEqual(['ok', 'cancelled', 'error'])
  })

  it('survives an api whose getState() throws', () => {
    const broken = {
      getState: () => {
        throw new Error('boom')
      },
    }
    const body = collectDebugSnapshot({ components: { Comp: broken } })
    expect(body.stateSnapshot).toEqual({ Comp: { __error: 'getState() threw' } })
  })

  it('survives an api that lacks optional methods', () => {
    const minimal = { getState: () => ({ count: 1 }) }
    const body = collectDebugSnapshot({ components: { C: minimal } })
    expect(body.stateSnapshot).toEqual({ C: { count: 1 } })
    expect(body.messageLog).toEqual([])
    expect(body.effects).toBeUndefined()
  })

  it('omits effects field when nothing is pending or recent', () => {
    const body = collectDebugSnapshot({
      components: { C: mockComponent({}) },
    })
    expect(body.effects).toBeUndefined()
  })
})

// Finding 9 — verbose telemetry is now real (scope tree + binding totals).
describe('collectVerboseSnapshot', () => {
  it('returns null when no debug API is present', () => {
    expect(collectVerboseSnapshot({ components: {} })).toBeNull()
  })

  it('flattens the scope tree and totals live bindings', () => {
    const scope = {
      scopeId: 'root',
      kind: 'root',
      active: true,
      children: [{ scopeId: 'each#0', kind: 'each', active: true, children: [] }],
    }
    const verbose = collectVerboseSnapshot({
      components: {
        App: {
          getState: () => ({}),
          getScopeTree: () => scope,
          getBindings: () => [
            { index: 0, kind: 'text', dead: false },
            { index: 1, kind: 'attr', dead: true },
            { index: 2, kind: 'text', dead: false },
          ],
        },
      },
    })
    expect(verbose).not.toBeNull()
    expect(verbose!.scopeTree).toEqual([
      { id: 'root', parent: null, component: 'App' },
      { id: 'each#0', parent: 'root', component: 'App' },
    ])
    // Dead bindings are excluded from the total.
    expect(verbose!.bindings).toEqual({ total: 2, hottest: [], lastCycleMs: 0 })
  })

  it('skips HUD-internal components', () => {
    const verbose = collectVerboseSnapshot({
      components: {
        'llui-devmode-annotate:hud': {
          getState: () => ({}),
          getScopeTree: () => ({ scopeId: 'x', kind: 'root', active: true, children: [] }),
        },
      },
    })
    expect(verbose).toBeNull()
  })
})

describe('createConsoleCapture', () => {
  it('mirrors console calls into a ring buffer and chains to the original', () => {
    const seen: string[] = []
    const fake = {
      log: (...a: unknown[]) => seen.push(`log:${a.join(' ')}`),
      warn: (...a: unknown[]) => seen.push(`warn:${a.join(' ')}`),
      error: () => {},
      info: () => {},
      debug: () => {},
    }
    const cap = createConsoleCapture({ target: fake })
    fake.log('hello', 'world')
    fake.warn('careful')
    const snap = cap.snapshot()
    expect(snap.map((e) => `${e.level}:${e.text}`)).toEqual(['log:hello world', 'warn:careful'])
    // Chained to the original method — the developer still sees the output.
    expect(seen).toEqual(['log:hello world', 'warn:careful'])
    // dispose() restores the originals.
    cap.dispose()
    fake.log('after')
    expect(cap.snapshot()).toHaveLength(2)
    expect(seen).toContain('log:after')
  })

  it('honors the ring-buffer limit', () => {
    const noop = (..._a: unknown[]): void => {}
    const fake = { log: noop, warn: noop, error: noop, info: noop, debug: noop }
    const cap = createConsoleCapture({ target: fake, limit: 2 })
    fake.log('a')
    fake.log('b')
    fake.log('c')
    expect(cap.snapshot().map((e) => e.text)).toEqual(['b', 'c'])
    cap.dispose()
  })
})

describe('integration with submit() / handleCaptureRequest', () => {
  it('submit() includes debug snapshot in the POST body when __lluiComponents is set', async () => {
    ;(globalThis as { __lluiComponents?: Record<string, unknown> }).__lluiComponents = {
      MyComp: mockComponent({ value: 42 }),
    }
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const { mountAnnotateHud } = await import('../src/index.js')
    document.body.innerHTML = ''
    const handle = mountAnnotateHud({ origin: 'http://localhost:5173', subscribeEvents: false })
    await handle.submit('hi')
    const body = JSON.parse(calls[0]![1].body as string) as {
      noteBody: { stateSnapshot?: Record<string, unknown> }
    }
    expect(body.noteBody.stateSnapshot).toEqual({ MyComp: { value: 42 } })

    // Cleanup
    delete (globalThis as { __lluiComponents?: unknown }).__lluiComponents
    document.body.innerHTML = ''
  })

  // Finding 9 — the verbose capture level must actually collect more than the
  // standard one (previously the checkbox was a no-op on the body).
  it('verbose captureLevel adds a verbose body that standard omits', async () => {
    ;(globalThis as { __lluiComponents?: Record<string, unknown> }).__lluiComponents = {
      MyComp: {
        getState: () => ({ value: 1 }),
        getScopeTree: () => ({ scopeId: 'root', kind: 'root', active: true, children: [] }),
        getBindings: () => [{ index: 0, kind: 'text', dead: false }],
      },
    }
    const bodies: Array<{ verbose?: unknown }> = []
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push((JSON.parse(init.body as string) as { noteBody: { verbose?: unknown } }).noteBody)
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const { mountAnnotateHud } = await import('../src/index.js')
    document.body.innerHTML = ''
    const handle = mountAnnotateHud({ origin: 'http://localhost:5173', subscribeEvents: false })
    await handle.submit('standard note', { captureLevel: 'standard' })
    await handle.submit('verbose note', { captureLevel: 'verbose' })

    expect(bodies[0]!.verbose).toBeUndefined()
    expect(bodies[1]!.verbose).toBeDefined()

    handle.destroy()
    delete (globalThis as { __lluiComponents?: unknown }).__lluiComponents
    document.body.innerHTML = ''
  })
})
