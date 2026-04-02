import { flushInstance, type ComponentInstance } from './update-loop'

export interface MessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
  dirtyMask: number
}

export interface LluiDebugAPI {
  getState(): unknown
  send(msg: unknown): void
  flush(): void
  getMessageHistory(): MessageRecord[]
  evalUpdate(msg: unknown): { state: unknown; effects: unknown[] }
  exportTrace(): {
    lluiTrace: 1
    component: string
    generatedBy: string
    timestamp: string
    entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
  }
  clearLog(): void
}

const MAX_HISTORY = 1000

export function installDevTools(inst: object): void {
  const ci = inst as ComponentInstance
  const history: MessageRecord[] = []
  let idx = 0

  const api: LluiDebugAPI = {
    getState: () => ci.state,
    send: (msg) => ci.send(msg as never),
    flush: () => flushInstance(ci),
    getMessageHistory: () => history.slice(),

    evalUpdate(msg) {
      const [state, effects] = ci.def.update(ci.state, msg as never)
      return { state, effects }
    },

    exportTrace() {
      return {
        lluiTrace: 1 as const,
        component: ci.def.name,
        generatedBy: 'devtools',
        timestamp: new Date().toISOString(),
        entries: history.map((h) => ({
          msg: h.msg,
          expectedState: h.stateAfter,
          expectedEffects: h.effects,
        })),
      }
    },

    clearLog() {
      history.length = 0
      idx = 0
    },
  }

  // Intercept update to record transitions
  const originalUpdate = ci.def.update
  ci.def.update = ((state: unknown, msg: unknown) => {
    const [newState, effects] = (originalUpdate as (s: unknown, m: unknown) => [unknown, unknown[]])(
      state,
      msg,
    )
    const dirty = ci.def.__dirty
      ? (ci.def.__dirty as (o: unknown, n: unknown) => number)(state, newState)
      : -1

    const record: MessageRecord = {
      index: idx++,
      timestamp: Date.now(),
      msg,
      stateBefore: state,
      stateAfter: newState,
      effects,
      dirtyMask: typeof dirty === 'number' ? dirty : -1,
    }

    if (history.length >= MAX_HISTORY) history.shift()
    history.push(record)

    return [newState, effects]
  }) as typeof ci.def.update

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__lluiDebug = api
}
