/**
 * Defense-in-depth: when a compiler-emitted handler bakes a specialized
 * method (1=reconcileItems / 2=reconcileClear / 3=reconcileRemove /
 * 10+=reconcileChanged) and a non-each block (show/branch/scope) is
 * selected by mask gating, `_handleMsg` must fall back to the general
 * `reconcile` so the block's `when`/`on` accessor re-evaluates.
 *
 * The compiler's detectArrayOp now only emits non-general methods for
 * single-field cases, but this runtime fallback catches the edge case
 * where an each() and a show() share a mask bit (e.g. each.items reads
 * `s.todos`, show.when reads `s.todos.length === 0`). Without the
 * fallback, the show would no-op on `block.reconcileClear?.()`.
 */
import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { _handleMsg } from '../src/update-loop'
import { show } from '../src/primitives/show'
import { each } from '../src/primitives/each'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type State = { open: boolean; todos: { id: string; label: string }[] }
type Msg = { type: 'open-with-clear' } | { type: 'close' }

describe('_handleMsg specialized-method fallback for non-each blocks', () => {
  it('show()-on-flag re-evaluates when its handler emits method=2 (clear)', () => {
    let whenCalls = 0
    const def: ComponentDef<State, Msg, never> = {
      name: 'D',
      init: () => [{ open: false, todos: [] }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'open-with-clear':
            // Multi-field case that — under the OLD compiler — would
            // have been routed to method=2 via detectArrayOp on the
            // `todos: []`. We hand-bake the same buggy routing here to
            // exercise the runtime fallback.
            return [{ ...state, open: true, todos: [] }, []]
          case 'close':
            return [{ ...state, open: false }, []]
        }
      },
      view: ({ text: t }) => [
        ...show({
          when: (s: State) => {
            whenCalls++
            return s.open
          },
          render: () => [div([t((s: State) => `count=${s.todos.length}`)])],
        }),
      ],
      // Hand-baked compiler output: handler emits method=2 (clear) for
      // open-with-clear. Before the fallback, this no-ops the show
      // block's reconcile and the dialog stays hidden.
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.open, n.open)) m |= 1
        if (!Object.is(o.todos, n.todos)) m |= 2
        return m
      },
      __handlers: {
        // (inst, msg) => _handleMsg(inst, msg, dirty=bit(open)|bit(todos), method=2)
        'open-with-clear': ((inst: unknown, msg: unknown) =>
          _handleMsg(inst as never, msg, 0b11, 2)) as never,
      },
    }

    const container = document.createElement('div')
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(whenCalls).toBe(1) // initial mount
    expect(container.textContent).toBe('') // open=false → show renders nothing

    sendFn({ type: 'open-with-clear' })
    handle.flush()

    expect(whenCalls).toBeGreaterThan(1) // show.when re-evaluated despite method=2
    expect(container.textContent).toContain('count=0') // show now renders content
  })

  it('each() block still gets reconcileClear fast path when method=2', () => {
    type S = { items: { id: string; label: string }[] }
    type M = { type: 'clearAll' } | { type: 'add'; item: { id: string; label: string } }
    const def: ComponentDef<S, M, never> = {
      name: 'L',
      init: () => [{ items: [{ id: '1', label: 'one' }] }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'clearAll':
            return [{ ...s, items: [] }, []]
          case 'add':
            return [{ ...s, items: [...s.items, m.item] }, []]
        }
      },
      view: () =>
        each<S, { id: string; label: string }>({
          items: (s) => s.items,
          key: (it) => it.id,
          render: ({ item }) => [div([text(item((t) => t.label))])],
        }),
      __dirty: (o, n) => (Object.is(o.items, n.items) ? 0 : 1),
      __handlers: {
        clearAll: ((inst: unknown, msg: unknown) => _handleMsg(inst as never, msg, 1, 2)) as never,
      },
    }

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(container.querySelectorAll('div').length).toBe(1)

    sendFn({ type: 'clearAll' })
    handle.flush()

    expect(container.querySelectorAll('div').length).toBe(0)
  })
})
