// The shared debug-telemetry collector + registry resolver.
//
// The serialization tests are the load-bearing ones: `@llui/mcp` evaluates
// `debugSnapshotExpression()` / `componentInfoExpression()` in a page it does
// not share a module graph with. If a collector function ever closes over a
// module-level binding that `debugCollectSource()` does not emit, the page copy
// throws (or silently returns less) while the in-process copy keeps working —
// exactly the drift this module exists to make impossible.
import { afterEach, describe, expect, it } from 'vitest'
import {
  callRegistryMethod,
  collectComponentInfo,
  collectDebugSnapshot,
  componentInfoExpression,
  debugCollectSource,
  debugSnapshotExpression,
  globalRegistryAccess,
  hostComponentEntries,
  isRegistryMethod,
  listComponents,
  selectComponent,
  DEVTOOLS_COMPONENT_PREFIX,
  type ComponentInfoSnapshot,
  type ComponentRegistryAccess,
  type DebugSnapshot,
  type TelemetrySource,
} from '../../src/signals/debug-collect.js'
import type { LluiDebugAPI } from '../../src/signals/devtools.js'

interface StubOpts {
  state?: unknown
  history?: Array<{ index: number; timestamp: number; msg: unknown }>
  pending?: Array<{ id: string; type?: string; dispatchedAt?: number; payload?: unknown }>
  timeline?: Array<{ effectId: string; type?: string; phase: string; timestamp: number }>
  info?: { name: string; file: string | null; line: number | null }
}

function stub(opts: StubOpts = {}): TelemetrySource {
  return {
    getState: () => opts.state ?? {},
    getMessageHistory: () => opts.history ?? [],
    getPendingEffects: () => opts.pending ?? [],
    getEffectTimeline: () => opts.timeline ?? [],
    getComponentInfo: () => opts.info ?? { name: 'Anon', file: null, line: null },
  }
}

/** The live registry holds full `LluiDebugAPI` entries, but the collector only
 *  ever probes the telemetry subset — so a partial stub is a faithful stand-in
 *  for what it reads. One widening here keeps every test body cast-free. */
function asRegistry(entries: Record<string, TelemetrySource>): Record<string, LluiDebugAPI> {
  return entries as Record<string, LluiDebugAPI>
}

/** Evaluate a page expression the way CDP would: fresh function scope, same
 *  global (so `globalThis.__lluiComponents` is visible), no module bindings. */
function evaluate<T>(expression: string): T {
  return new Function(`return ${expression}`)() as T
}

afterEach(() => {
  globalThis.__lluiComponents = undefined
  globalThis.__lluiDebug = undefined
})

describe('collectDebugSnapshot', () => {
  it('returns {} when no registry is present', () => {
    expect(collectDebugSnapshot()).toEqual({})
  })

  it('collects state, message log, pending + recent effects across components', () => {
    const snapshot = collectDebugSnapshot({
      components: {
        App: stub({
          state: { route: '/' },
          history: [{ index: 0, timestamp: 200, msg: { type: 'Nav' } }],
          pending: [{ id: 'e1', type: 'http', dispatchedAt: 100, payload: { url: '/x' } }],
          timeline: [{ effectId: 'e0', type: 'http', phase: 'resolved', timestamp: 150 }],
        }),
        Card: stub({
          state: { user: 'Ada' },
          history: [{ index: 0, timestamp: 100, msg: { type: 'Load' } }],
        }),
      },
    })
    expect(snapshot.stateSnapshot).toEqual({ App: { route: '/' }, Card: { user: 'Ada' } })
    // sorted chronologically across components
    expect(snapshot.messageLog?.map((m) => m.component)).toEqual(['Card', 'App'])
    expect(snapshot.effects?.pending[0]).toMatchObject({ id: 'e1', component: 'App' })
    expect(snapshot.effects?.recent[0]).toMatchObject({ component: 'App', outcome: 'ok' })
  })

  it('never throws when a component method throws', () => {
    const broken: TelemetrySource = {
      getState: () => {
        throw new Error('boom')
      },
      getMessageHistory: () => {
        throw new Error('boom')
      },
    }
    const snapshot = collectDebugSnapshot({ components: { Broken: broken } })
    expect(snapshot.stateSnapshot).toEqual({ Broken: { __error: 'getState() threw' } })
    expect(snapshot.messageLog).toEqual([])
  })

  it('excludes dev-tooling components from telemetry', () => {
    const snapshot = collectDebugSnapshot({
      components: {
        App: stub({ state: { a: 1 } }),
        [`${DEVTOOLS_COMPONENT_PREFIX}hud`]: stub({ state: { hud: true } }),
      },
    })
    expect(snapshot.stateSnapshot).toEqual({ App: { a: 1 } })
  })

  it('honours messageLimit', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({
      index: i,
      timestamp: 1000 + i,
      msg: { type: `M${i}` },
    }))
    const snapshot = collectDebugSnapshot({
      components: { App: stub({ history }) },
      messageLimit: 2,
    })
    expect(snapshot.messageLog?.map((m) => m.msg)).toEqual([{ type: 'M3' }, { type: 'M4' }])
  })
})

describe('collectComponentInfo', () => {
  it('returns null with no registry and null with an empty one', () => {
    expect(collectComponentInfo()).toBe(null)
    expect(collectComponentInfo({ components: {} })).toBe(null)
  })

  it('anchors componentMeta on the first host component', () => {
    const info = collectComponentInfo({
      components: {
        App: stub({ info: { name: 'App', file: 'src/App.ts', line: 8 } }),
        Card: stub({ info: { name: 'Card', file: 'src/Card.ts', line: 2 } }),
      },
    })
    expect(info).toEqual({
      componentPath: ['App', 'Card'],
      componentMeta: { file: 'src/App.ts', line: 8, name: 'App' },
    })
  })
})

describe('hostComponentEntries', () => {
  it('drops dev-tooling entries and keeps registry order', () => {
    const entries = hostComponentEntries({
      App: 1,
      [`${DEVTOOLS_COMPONENT_PREFIX}browse`]: 2,
      Card: 3,
    })
    expect(entries).toEqual([
      ['App', 1],
      ['Card', 3],
    ])
  })
})

describe('serialized collector graph', () => {
  it('evaluates in a bare function scope and matches the in-process result', () => {
    globalThis.__lluiComponents = asRegistry({
      App: stub({
        state: { route: '/' },
        history: [{ index: 0, timestamp: 100, msg: { type: 'Nav' } }],
        pending: [{ id: 'e1', type: 'http', dispatchedAt: 0, payload: null }],
        timeline: [{ effectId: 'e0', type: 'http', phase: 'cancelled', timestamp: 10 }],
        info: { name: 'App', file: 'src/App.ts', line: 3 },
      }),
    })

    // `sinceMs` is a live `Date.now()` delta, so compare everything else and
    // assert the shape of that one field separately.
    const serialized = evaluate<DebugSnapshot>(debugSnapshotExpression())
    const direct = collectDebugSnapshot()
    expect(serialized.stateSnapshot).toEqual(direct.stateSnapshot)
    expect(serialized.messageLog).toEqual(direct.messageLog)
    expect(serialized.effects?.recent).toEqual(direct.effects?.recent)
    expect(serialized.effects?.pending[0]?.id).toBe('e1')
    expect(typeof serialized.effects?.pending[0]?.sinceMs).toBe('number')

    expect(evaluate<ComponentInfoSnapshot | null>(componentInfoExpression())).toEqual(
      collectComponentInfo(),
    )
  })

  it('carries the collector options across the boundary', () => {
    globalThis.__lluiComponents = asRegistry({
      App: stub({
        history: Array.from({ length: 4 }, (_, i) => ({
          index: i,
          timestamp: 1000 + i,
          msg: { type: `M${i}` },
        })),
      }),
    })
    const snapshot = evaluate<DebugSnapshot>(debugSnapshotExpression({ messageLimit: 1 }))
    expect(snapshot.messageLog).toHaveLength(1)
  })

  it('excludes dev-tooling components on the page path too', () => {
    globalThis.__lluiComponents = asRegistry({
      [`${DEVTOOLS_COMPONENT_PREFIX}hud`]: stub({ state: { hud: true } }),
    })
    expect(evaluate<DebugSnapshot>(debugSnapshotExpression())).toEqual({})
  })

  it('emits the module constants the graph reads, and no module syntax', () => {
    // A free identifier that is neither declared in the emitted source nor a
    // browser global would throw on evaluation; assert the emitted preamble
    // actually carries the constants rather than relying on luck.
    const source = debugCollectSource()
    expect(source).toContain(
      `const DEVTOOLS_COMPONENT_PREFIX = ${JSON.stringify(DEVTOOLS_COMPONENT_PREFIX)}`,
    )
    expect(source).not.toContain('export ')
  })
})

describe('component registry resolver', () => {
  interface TestAccess extends ComponentRegistryAccess {
    readonly current: LluiDebugAPI | undefined
  }

  function access(
    registry: Record<string, LluiDebugAPI> | undefined,
    initial?: LluiDebugAPI,
  ): TestAccess {
    let current = initial
    return {
      registry: () => registry,
      active: () => current,
      setActive: (api) => {
        current = api
      },
      get current() {
        return current
      },
    }
  }

  const a = { getState: () => 'a' } as LluiDebugAPI
  const b = { getState: () => 'b' } as LluiDebugAPI

  it('recognizes exactly the two registry pseudo-methods', () => {
    expect(isRegistryMethod('__listComponents')).toBe(true)
    expect(isRegistryMethod('__selectComponent')).toBe(true)
    expect(isRegistryMethod('getState')).toBe(false)
  })

  it('lists component keys and resolves the active one by identity', () => {
    expect(listComponents(access({ A: a, B: b }, b))).toEqual({
      components: ['A', 'B'],
      active: 'B',
    })
  })

  it('reports no components and no active pointer when nothing is mounted', () => {
    expect(listComponents(access(undefined))).toEqual({ components: [], active: null })
  })

  it('reports active: null when the pointer is not in the registry', () => {
    expect(listComponents(access({ A: a }, b))).toEqual({ components: ['A'], active: null })
  })

  it('selects a component and moves the active pointer', () => {
    const acc = access({ A: a, B: b }, a)
    expect(selectComponent(acc, 'B')).toEqual({ active: 'B' })
    expect(acc.current).toBe(b)
  })

  it('throws on an unknown component key', () => {
    expect(() => selectComponent(access({ A: a }), 'nope')).toThrow('unknown component: nope')
  })

  it('dispatches both pseudo-methods through one entry point', () => {
    const acc = access({ A: a, B: b }, a)
    expect(callRegistryMethod(acc, '__listComponents', [])).toEqual({
      components: ['A', 'B'],
      active: 'A',
    })
    expect(callRegistryMethod(acc, '__selectComponent', ['B'])).toEqual({ active: 'B' })
  })

  it('globalRegistryAccess reads and writes the runtime globals', () => {
    globalThis.__lluiComponents = { A: a, B: b }
    globalThis.__lluiDebug = a
    const acc = globalRegistryAccess()
    expect(listComponents(acc)).toEqual({ components: ['A', 'B'], active: 'A' })
    expect(selectComponent(acc, 'B')).toEqual({ active: 'B' })
    expect(globalThis.__lluiDebug).toBe(b)
  })
})
