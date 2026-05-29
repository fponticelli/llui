import type { SignalComponentDef } from '@llui/dom/signals'

/** Signal `init`/`update` may return a bare `S` or a `[S, E[]]` tuple; collapse
 * to the tuple form using the same heuristic as the signal runtime. */
function normalize<S, E>(r: [S, E[]] | S): [S, E[]] {
  if (Array.isArray(r) && r.length === 2 && Array.isArray((r as [S, E[]])[1])) {
    return r as [S, E[]]
  }
  return [r as S, []]
}

export interface TestHarness<S, M, E> {
  state: S
  effects: E[]
  allEffects: E[]
  history: Array<{ prevState: S; msg: M; nextState: S; effects: E[] }>
  send: (msg: M) => void
  sendAll: (msgs: M[]) => S
}

export function testComponent<S, M, E>(def: SignalComponentDef<S, M, E>): TestHarness<S, M, E> {
  const [initState, initEffects] = normalize(def.init())

  const harness: TestHarness<S, M, E> = {
    state: initState,
    effects: initEffects,
    allEffects: [...initEffects],
    history: [],

    send(msg: M) {
      const prevState = harness.state
      const [nextState, effects] = normalize(def.update(prevState, msg))
      harness.history.push({ prevState, msg, nextState, effects })
      harness.state = nextState
      harness.effects = effects
      harness.allEffects.push(...effects)
    },

    sendAll(msgs: M[]) {
      for (const msg of msgs) {
        harness.send(msg)
      }
      return harness.state
    },
  }

  return harness
}
