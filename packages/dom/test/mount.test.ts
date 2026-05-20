import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import type { ComponentDef } from '../src/types'
import type { View } from '../src/view-helpers'

type State = { count: number }
type Msg = { type: 'inc' }

function counterDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'Counter',
    init: () => [{ count: 0 }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'inc':
          return [{ ...state, count: state.count + 1 }, []]
      }
    },
    view: ({ send }) => {
      const btn = document.createElement('button')
      btn.addEventListener('click', () => send({ type: 'inc' }))
      btn.textContent = '+'
      return [btn]
    },
    __compilerVersion: '__test__',
    __prefixes: [(s) => s.count],
  }
}

describe('mountApp', () => {
  it('mounts component into a container', () => {
    const container = document.createElement('div')
    mountApp(container, counterDef())
    expect(container.children.length).toBe(1)
    expect(container.querySelector('button')).not.toBeNull()
  })

  it('returns an AppHandle with dispose() and flush()', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, counterDef())
    expect(handle.dispose).toBeTypeOf('function')
    expect(handle.flush).toBeTypeOf('function')
  })

  it('dispose() removes all children from the container', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, counterDef())
    expect(container.children.length).toBe(1)
    handle.dispose()
    expect(container.children.length).toBe(0)
  })

  it('processes messages via flush()', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, counterDef())
    const btn = container.querySelector('button')!
    btn.click()
    handle.flush()
    // No error — state updated from 0 to 1
  })

  it('passes initial data to init()', () => {
    const def: ComponentDef<{ value: number }, never, never, { v: number }> = {
      name: 'WithData',
      init: (data) => [{ value: data.v }, []],
      update: (s) => [s, []],
      view: () => {
        const span = document.createElement('span')
        return [span]
      },
    }
    const container = document.createElement('div')
    mountApp(container, def, { v: 42 })
    expect(container.querySelector('span')).not.toBeNull()
  })

  it('disposes idempotently', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, counterDef())
    handle.dispose()
    handle.dispose() // should not throw
    expect(container.children.length).toBe(0)
  })

  it('provides full View bag with all helpers', () => {
    let captured: View<{ n: number }, never> | null = null
    const def: ComponentDef<{ n: number }, never, never> = {
      name: 'ViewBag',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: (h) => {
        captured = h
        return [document.createTextNode('ok')]
      },
    }
    const container = document.createElement('div')
    mountApp(container, def)
    expect(captured).not.toBeNull()
    expect(captured!.send).toBeTypeOf('function')
    expect(captured!.each).toBeTypeOf('function')
    expect(captured!.show).toBeTypeOf('function')
    expect(captured!.branch).toBeTypeOf('function')
    expect(captured!.text).toBeTypeOf('function')
    expect(captured!.memo).toBeTypeOf('function')
    expect(captured!.selector).toBeTypeOf('function')
    expect(captured!.ctx).toBeTypeOf('function')
  })

  describe('swapUpdate', () => {
    // The lightweight HMR escape hatch: replace the reducer without
    // rebuilding the DOM. Useful when only `update.ts` changed and
    // `view`/`__dirty`/event listeners can stay live. The full
    // `replaceComponent` HMR path disposes the root lifetime and
    // re-runs the view, which loses focus/scroll/etc. — overkill
    // for pure reducer changes.

    it('next dispatch goes through the new update', () => {
      const container = document.createElement('div')
      const handle = mountApp(container, counterDef())

      handle.send({ type: 'inc' })
      handle.flush()
      expect((handle.getState() as State).count).toBe(1)

      // New update fn: increments by 10 instead of 1. Same Msg shape;
      // same State shape — only the transition changes.
      const newUpdate = (state: State, msg: Msg): [State, never[]] => {
        if (msg.type === 'inc') return [{ ...state, count: state.count + 10 }, []]
        return [state, []]
      }
      handle.swapUpdate(newUpdate as (s: unknown, m: unknown) => [unknown, unknown[]])

      handle.send({ type: 'inc' })
      handle.flush()
      expect((handle.getState() as State).count).toBe(11)
    })

    it('drains pending messages with the OLD update before swapping', () => {
      // Messages already in the queue were authored against the old
      // contract; running them under the new reducer mid-flight could
      // mix half of one transition with half of another. swapUpdate
      // flushes first.
      const container = document.createElement('div')
      const handle = mountApp(container, counterDef())

      // Queue a message synchronously. The dispatch is microtask-
      // batched, so it hasn't been applied yet.
      handle.send({ type: 'inc' })

      // Swap before the microtask drains. Implementation flushes first,
      // so the queued inc runs against the old (+1) reducer.
      let newUpdateCalls = 0
      const newUpdate = (state: State, msg: Msg): [State, never[]] => {
        newUpdateCalls++
        if (msg.type === 'inc') return [{ ...state, count: state.count + 100 }, []]
        return [state, []]
      }
      handle.swapUpdate(newUpdate as (s: unknown, m: unknown) => [unknown, unknown[]])

      // Pending message was applied with old update (+1), not new (+100).
      expect((handle.getState() as State).count).toBe(1)
      expect(newUpdateCalls).toBe(0)
    })

    it('no-op after dispose', () => {
      const container = document.createElement('div')
      const handle = mountApp(container, counterDef())
      handle.dispose()
      // Should not throw or have any effect.
      handle.swapUpdate((s) => [s, []])
    })

    it('preserves the rendered DOM (no rebuild)', () => {
      // The motivating reason for this API over replaceComponent: the
      // root lifetime stays live, so the DOM nodes, event listeners,
      // focus, and any imperative state attached to elements survive
      // the swap.
      const container = document.createElement('div')
      const handle = mountApp(container, counterDef())
      const buttonBefore = container.querySelector('button')!
      // Stash a custom property on the DOM node — replaceComponent
      // would create a fresh button and lose this.
      ;(buttonBefore as unknown as { _testMarker: string })._testMarker = 'kept'

      handle.swapUpdate((s) => [s, []])

      const buttonAfter = container.querySelector('button')!
      expect(buttonAfter).toBe(buttonBefore)
      expect((buttonAfter as unknown as { _testMarker: string })._testMarker).toBe('kept')
    })
  })

  it('each() works when destructured from View bag', () => {
    type S = { items: string[] }
    const def: ComponentDef<S, never, never> = {
      name: 'EachFromBag',
      init: () => [{ items: ['a', 'b', 'c'] }, []],
      update: (s) => [s, []],
      view: ({ each }) => [
        ...each<string>({
          items: (s) => s.items,
          key: (v) => v,
          render: ({ item }) => {
            const el = document.createElement('span')
            el.textContent = item((v: string) => v)()
            return [el]
          },
        }),
      ],
    }
    const container = document.createElement('div')
    mountApp(container, def)
    const spans = container.querySelectorAll('span')
    expect(spans.length).toBe(3)
    expect(spans[0]!.textContent).toBe('a')
    expect(spans[1]!.textContent).toBe('b')
    expect(spans[2]!.textContent).toBe('c')
  })
})
