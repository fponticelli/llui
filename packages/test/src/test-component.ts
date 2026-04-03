import type { ComponentDef } from '@llui/dom'

export interface TestHarness<S, M, E> {
  state: S
  effects: E[]
  allEffects: E[]
  history: Array<{ prevState: S; msg: M; nextState: S; effects: E[] }>
  send: (msg: M) => void
  sendAll: (msgs: M[]) => S
}

export function testComponent<S, M, E>(
  def: ComponentDef<S, M, E>,
  initialData?: unknown,
): TestHarness<S, M, E> {
  const [initState, initEffects] = def.init(initialData)

  const harness: TestHarness<S, M, E> = {
    state: initState,
    effects: initEffects,
    allEffects: [...initEffects],
    history: [],

    send(msg: M) {
      const prevState = harness.state
      const [nextState, effects] = def.update(prevState, msg)
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
