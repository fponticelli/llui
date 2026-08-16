import { beforeEach, describe, expect, it } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  createCommitScheduler,
  type CommitHost,
  type CommitToken,
} from '../../src/signals/commit-scope'
import {
  el,
  onMount,
  signalBranch,
  signalEach,
  signalText,
  type RowCtx,
} from '../../src/signals/dom'
import { bindingMask, buildPathTable } from '../../src/signals/mask'
import { LluiFrameworkError, isFrameworkError } from '../../src/signals/framework-error'
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

  it('treats remove-and-readd of the same scope identity as fresh membership', () => {
    const parent = createSignalScope(buildPathTable([]), [], [])
    let targetUpdates = 0
    let replaced = false
    const target: SignalScope = {
      mount: () => {},
      update: () => {
        targetUpdates++
      },
      addChild: () => {},
      removeChild: () => {},
    }
    const replacingSibling: SignalScope = {
      mount: () => {},
      update: () => {
        if (replaced) return
        replaced = true
        parent.removeChild(target)
        parent.addChild(target)
      },
      addChild: () => {},
      removeChild: () => {},
    }
    parent.addChild(replacingSibling)
    parent.addChild(target)

    parent.update({}, {})
    expect(targetUpdates).toBe(0)

    parent.update({}, {})
    expect(targetUpdates).toBe(1)
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

  it('preserves an escaped CommitToken error while publishing the pending child', () => {
    const host: CommitHost<never, null> = {
      reduce: () => false,
      commit: () => true,
      beginEffects: () => null,
      dispatchEffects: () => {},
      endEffects: () => {},
      isDisposed: () => false,
    }
    const scheduler = createCommitScheduler(host, 'sync')
    let escapedSettle: (() => void) | undefined
    scheduler.withCommitScope('scheduled', (token: CommitToken) => {
      escapedSettle = () => token.settle()
    })
    let escapedError: unknown
    try {
      escapedSettle!()
    } catch (error) {
      escapedError = error
    }
    expect(escapedError).toBeInstanceOf(LluiFrameworkError)
    expect(isFrameworkError(escapedError)).toBe(true)

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
    const existing: SignalScope = {
      mount: () => {},
      update: () => {},
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
        throw escapedError
      },
    }
    parent = createSignalScope(table, [binding], [bindingMask(['version'], table)])
    parent.addChild(existing)
    const initial: Versioned = { version: 0 }
    const failed: Versioned = { version: 1 }
    parent.mount(initial)

    let thrown: unknown
    try {
      parent.update(initial, failed)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(escapedError)
    expect(thrown).toBeInstanceOf(LluiFrameworkError)
    expect(isFrameworkError(thrown)).toBe(true)
    expect((thrown as Error).message).toBe(
      '[llui] CommitToken.settle() was called outside its commit scope. A token ' +
        'is valid only for the body it was handed to; commit through the ' +
        'CommitScheduler surface instead.',
    )
    expect(childUpdates).toBe(0)

    parent.update(failed, { version: 2 })
    expect(childUpdates).toBe(1)
  })
})
