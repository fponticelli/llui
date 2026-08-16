import { beforeEach, describe, expect, it } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  el,
  onMount,
  signalBranch,
  signalEach,
  signalText,
  type RowCtx,
} from '../../src/signals/dom'
import { bindingMask, buildPathTable } from '../../src/signals/mask'
import { createSignalScope, type SignalScope } from '../../src/signals/runtime'

interface State {
  phase: 'loading' | 'ready'
  tick: number
}

type Msg = { type: 'ready' } | { type: 'tick' }

function next(state: State, msg: Msg): State {
  return msg.type === 'ready'
    ? { phase: 'ready', tick: state.tick + 1 }
    : { ...state, tick: state.tick + 1 }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('child scopes mounted during an active update', () => {
  it('mounts a fresh branch arm without sweeping its structural bindings again', () => {
    const container = document.createElement('div')
    let armMounts = 0
    let innerReconciles = 0
    const handle = mountSignalComponent<State, Msg>(container, {
      init: () => ({ phase: 'loading', tick: 0 }),
      update: next,
      view: () => [
        signalBranch(
          { produce: (state) => (state as State).phase, deps: ['phase'] },
          {
            loading: () => [el('p', {}, ['loading'])],
            ready: () => [
              onMount(() => {
                armMounts++
              }),
              signalBranch(
                {
                  produce: (state) => {
                    innerReconciles++
                    return String((state as State).tick % 2)
                  },
                  deps: ['tick'],
                },
                {
                  '0': () => [el('span', {}, ['even'])],
                  '1': () => [el('span', {}, ['odd'])],
                },
              ),
            ],
          },
        ),
      ],
    })

    handle.send({ type: 'ready' })
    expect(armMounts).toBe(1)
    expect(innerReconciles).toBe(1)
    expect(container.textContent).toBe('odd')

    handle.send({ type: 'tick' })
    expect(armMounts).toBe(1)
    expect(innerReconciles).toBe(2)
    expect(container.textContent).toBe('even')
    handle.dispose()
  })

  it('mounts a fresh row once without reconciling its list again in the creating round', () => {
    const container = document.createElement('div')
    let rowMounts = 0
    let rowEvaluations = 0
    let listReconciles = 0
    interface Row {
      id: number
      revision: number
    }
    const handle = mountSignalComponent<State, Msg>(container, {
      init: () => ({ phase: 'loading', tick: 0 }),
      update: next,
      view: () => [
        signalBranch(
          { produce: (state) => (state as State).phase, deps: ['phase'] },
          {
            loading: () => [el('p', {}, ['loading'])],
            ready: () => [
              signalEach(
                {
                  items: () => {
                    listReconciles++
                    return [{ id: 1, revision: listReconciles }]
                  },
                  deps: ['tick'],
                },
                (item) => item.id,
                () => [
                  el('p', {}, [
                    signalText(
                      (ctx) => {
                        rowEvaluations++
                        return String((ctx as RowCtx<Row>).item.revision)
                      },
                      ['item.revision'],
                    ),
                    onMount(() => {
                      rowMounts++
                    }),
                  ]),
                ],
              ),
            ],
          },
        ),
      ],
    })

    handle.send({ type: 'ready' })
    expect(rowMounts).toBe(1)
    expect(rowEvaluations).toBe(1)
    expect(listReconciles).toBe(1)
    expect(container.textContent).toBe('1')

    handle.send({ type: 'tick' })
    expect(rowMounts).toBe(1)
    expect(rowEvaluations).toBe(2)
    expect(listReconciles).toBe(2)
    expect(container.textContent).toBe('2')
    handle.dispose()
  })

  it('updates older descendants once while a sibling arm is replaced with a nested subtree', () => {
    const container = document.createElement('div')
    let freshDescendantReconciles = 0
    let olderDescendantReconciles = 0
    const nestedCounter = (increment: () => void) =>
      signalBranch(
        {
          produce: (state) => {
            increment()
            return String((state as State).tick % 2)
          },
          deps: ['tick'],
        },
        {
          '0': () => [el('span', {}, ['even'])],
          '1': () => [el('span', {}, ['odd'])],
        },
      )
    const handle = mountSignalComponent<State, Msg>(container, {
      init: () => ({ phase: 'ready', tick: 0 }),
      update: next,
      view: () => [
        signalBranch(
          { produce: () => 'ready', deps: [] },
          {
            ready: () => [
              signalBranch(
                {
                  produce: (state) => ((state as State).tick === 0 ? 'old' : 'fresh'),
                  deps: ['tick'],
                },
                {
                  old: () => [el('span', {}, ['old'])],
                  fresh: () => [
                    nestedCounter(() => {
                      freshDescendantReconciles++
                    }),
                  ],
                },
              ),
              signalBranch(
                { produce: () => 'stable', deps: [] },
                {
                  stable: () => [
                    nestedCounter(() => {
                      olderDescendantReconciles++
                    }),
                  ],
                },
              ),
            ],
          },
        ),
      ],
    })
    olderDescendantReconciles = 0

    handle.send({ type: 'tick' })
    expect(freshDescendantReconciles).toBe(1)
    expect(olderDescendantReconciles).toBe(1)

    handle.send({ type: 'tick' })
    expect(freshDescendantReconciles).toBe(2)
    expect(olderDescendantReconciles).toBe(2)
    handle.dispose()
  })

  it('does not skip an older sibling when another child is removed and replaced', () => {
    const parent = createSignalScope(buildPathTable([]), [], [])
    const updates: string[] = []
    let replaced = false
    const child = (name: string, update?: () => void): SignalScope => ({
      mount: () => {},
      update: () => {
        updates.push(name)
        update?.()
      },
      addChild: () => {},
      removeChild: () => {},
    })
    const removed = child('removed')
    const fresh = child('fresh')
    const first = child('first', () => {
      if (replaced) return
      replaced = true
      parent.removeChild(removed)
      parent.addChild(fresh)
    })
    const olderSibling = child('older-sibling')
    parent.addChild(first)
    parent.addChild(removed)
    parent.addChild(olderSibling)

    parent.update({}, {})
    expect(updates).toEqual(['first', 'older-sibling'])

    updates.length = 0
    parent.update({}, {})
    expect(updates).toEqual(['first', 'older-sibling', 'fresh'])
  })

  it('keeps a mounted child for the next update when the creating round throws', () => {
    interface Versioned {
      version: number
    }
    const table = buildPathTable(['version'])
    let childUpdates = 0
    const fresh: SignalScope = {
      mount: () => {},
      update: () => {
        childUpdates++
      },
      addChild: () => {},
      removeChild: () => {},
    }
    let parent: SignalScope
    const binding = {
      structural: true as const,
      produce: (state: unknown) => state,
      commit: (state: unknown) => {
        if ((state as Versioned).version !== 1) return
        parent.addChild(fresh)
        throw new Error('creating round failed')
      },
    }
    parent = createSignalScope(table, [binding], [bindingMask(['version'], table)])
    const initial: Versioned = { version: 0 }
    const failed: Versioned = { version: 1 }
    parent.mount(initial)

    expect(() => parent.update(initial, failed)).toThrow('creating round failed')
    expect(childUpdates).toBe(0)

    parent.update(failed, { version: 2 })
    expect(childUpdates).toBe(1)
  })
})
