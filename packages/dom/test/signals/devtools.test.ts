import { describe, it, expect, beforeEach } from 'vitest'
import { installSignalDebug } from '../../src/signals/devtools'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el } from '../../src/signals/dom'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any
beforeEach(() => {
  delete g.__lluiComponents
  delete g.__lluiDebug
})

describe('installSignalDebug', () => {
  it('registers a signal-native debug api and unregisters on teardown', () => {
    let state: { count: number } = { count: 1 }
    const history = [
      {
        index: 0,
        timestamp: 0,
        msg: { type: 'inc' },
        stateBefore: { count: 0 },
        stateAfter: { count: 1 },
        effects: [],
      },
    ]
    const uninstall = installSignalDebug({
      name: 'Counter',
      getState: () => state,
      setState: (s) => {
        state = s as { count: number }
      },
      send: () => {},
      pureUpdate: (s) => [{ count: (s as { count: number }).count + 1 }, []],
      history,
      clearHistory: () => {
        history.length = 0
      },
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: { fields: { count: 'number' } },
      componentMeta: { file: 'a.ts', line: 3 },
    })

    expect(Object.keys(g.__lluiComponents)).toEqual(['Counter'])
    const api = g.__lluiDebug
    expect(api.getState()).toEqual({ count: 1 })
    expect(api.getMessageSchema()).toEqual({ discriminant: 'type', variants: { inc: {} } })
    expect(api.getStateSchema()).toEqual({ fields: { count: 'number' } })
    expect(api.getComponentInfo()).toMatchObject({
      name: 'Counter',
      file: 'a.ts',
      line: 3,
      runtime: 'signal',
    })
    expect(api.getMessageHistory()).toHaveLength(1)
    expect(api.searchState('count')).toBe(1)
    expect(api.snapshotState()).toEqual({ count: 1 })

    // evalUpdate is a pure dry-run — does not mutate live state
    expect(api.evalUpdate({ type: 'inc' })).toEqual({ state: { count: 2 }, effects: [] })
    expect(api.getState()).toEqual({ count: 1 })

    // validateMessage against the schema
    expect(api.validateMessage({ type: 'inc' })).toEqual([])
    expect(api.validateMessage({ type: 'nope' })?.[0].path).toBe('type')

    // restoreState writes through setState
    api.restoreState({ count: 9 })
    expect(api.getState()).toEqual({ count: 9 })

    uninstall()
    expect(g.__lluiComponents.Counter).toBeUndefined()
    expect(g.__lluiDebug).toBeUndefined()
  })

  it('uniquifies duplicate component names', () => {
    const base = {
      getState: () => ({}),
      setState: () => {},
      send: () => {},
      pureUpdate: () => [{}, []] as [unknown, unknown[]],
      history: [],
      clearHistory: () => {},
    }
    installSignalDebug({ name: 'X', ...base })
    installSignalDebug({ name: 'X', ...base })
    expect(Object.keys(g.__lluiComponents).sort()).toEqual(['X', 'X#2'])
  })
})

describe('mountSignalComponent — debug registration (dev)', () => {
  interface S {
    count: number
  }
  type M = { type: 'inc' }

  it('registers the component and reflects live state + message history', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      name: 'Counter',
      init: () => ({ count: 0 }),
      update: (s) => ({ count: s.count + 1 }),
      view: () => [el('p', {}, [signalText((s) => String((s as S).count), ['count'])])],
      __msgSchema: { discriminant: 'type', variants: { inc: {} } },
    })

    const api = g.__lluiDebug
    expect(api).toBeDefined()
    expect(api.getState()).toEqual({ count: 0 })
    expect(api.getMessageSchema()).toEqual({ discriminant: 'type', variants: { inc: {} } })

    h.send({ type: 'inc' })
    expect(api.getState()).toEqual({ count: 1 })
    expect(api.getMessageHistory()).toHaveLength(1)
    expect(container.querySelector('p')?.textContent).toBe('1')

    // the debug api can drive the live component
    api.send({ type: 'inc' })
    expect(container.querySelector('p')?.textContent).toBe('2')

    h.dispose()
    expect(g.__lluiDebug).toBeUndefined()
  })
})
