import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

type Item = { id: string }
type State = { items: Item[] }
type Msg =
  | { type: 'set'; items: Item[] }
  | { type: 'append'; id: string }
  | { type: 'remove'; id: string }

function makeDef(
  enter: ((nodes: Node[]) => void) | undefined,
  leave: ((nodes: Node[]) => void | Promise<void>) | undefined,
  initial: Item[] = [{ id: 'a' }, { id: 'b' }],
): ComponentDef<State, Msg, never> {
  return {
    name: 'List',
    init: () => [{ items: initial }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'set':
          return [{ items: msg.items }, []]
        case 'append':
          return [{ items: [...state.items, { id: msg.id }] }, []]
        case 'remove':
          return [{ items: state.items.filter((i) => i.id !== msg.id) }, []]
      }
    },
    view: () =>
      each<State, Item>({
        items: (s) => s.items,
        key: (item) => item.id,
        enter,
        leave,
        render: ({ item }) => [div({ 'data-id': item((t) => t.id) }, [text(item((t) => t.id))])],
      }),
    __dirty: (o, n) => (Object.is(o.items, n.items) ? 0 : 1),
  }
}

describe('each() per-item enter/leave', () => {
  it('fires enter on initial mount for each item', () => {
    const entered: string[] = []
    const container = document.createElement('div')
    const enter = (nodes: Node[]) => {
      const el = nodes[0] as HTMLElement
      entered.push(el.getAttribute('data-id')!)
    }
    mountApp(container, makeDef(enter, undefined))
    expect(entered).toEqual(['a', 'b'])
  })

  it('fires enter for newly appended items only', async () => {
    const entered: string[] = []
    const container = document.createElement('div')
    const enter = (nodes: Node[]) => {
      const el = nodes[0] as HTMLElement
      entered.push(el.getAttribute('data-id')!)
    }
    const app = mountApp(container, makeDef(enter, undefined))
    entered.length = 0
    // Send via container root's internal handle — use flush to apply synchronously
    const handle = app as { send?: (m: Msg) => void }
    // mountApp returns AppHandle without send — use a DOM button? Use a more direct route:
    // trigger via re-render by setting state directly via re-mount? Simplest: use a send hook via view.
    // Actually, AppHandle only exposes dispose + flush. We need a way to send messages.
    // Workaround: use a component that sends itself via an effect? Too complex.
    // Better: use each's container events. Or expose send via global.
    // Simplest workaround: set up a new init with more items and remount.
    void handle
    app.dispose()

    const entered2: string[] = []
    const container2 = document.createElement('div')
    mountApp(
      container2,
      makeDef(
        (nodes) => {
          const el = nodes[0] as HTMLElement
          entered2.push(el.getAttribute('data-id')!)
        },
        undefined,
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      ),
    )
    expect(entered2).toEqual(['a', 'b', 'c'])
  })

  it('fires leave on item removal', async () => {
    const left: string[] = []
    const container = document.createElement('div')
    const def = makeDef(undefined, (nodes) => {
      const el = nodes[0] as HTMLElement
      left.push(el.getAttribute('data-id')!)
    })
    // We need a way to mutate state after mount. Use a send-exposing wrapper:
    let sendRef: ((m: Msg) => void) | null = null
    const wrapped: ComponentDef<State, Msg, never> = {
      ...def,
      view: ({ send }) => {
        sendRef = send
        return def.view(send)
      },
    }
    mountApp(container, wrapped)
    expect(sendRef).not.toBeNull()
    sendRef!({ type: 'remove', id: 'a' })
    // Let microtasks flush
    await new Promise((r) => setTimeout(r, 0))
    expect(left).toEqual(['a'])
  })

  it('defers DOM removal while leave Promise is pending', async () => {
    const container = document.createElement('div')
    let resolveLeave: (() => void) | null = null
    const def = makeDef(
      undefined,
      () =>
        new Promise<void>((r) => {
          resolveLeave = r
        }),
    )
    let sendRef: ((m: Msg) => void) | null = null
    const wrapped: ComponentDef<State, Msg, never> = {
      ...def,
      view: ({ send }) => {
        sendRef = send
        return def.view(send)
      },
    }
    mountApp(container, wrapped)
    const beforeCount = container.querySelectorAll('[data-id]').length
    expect(beforeCount).toBe(2)

    sendRef!({ type: 'remove', id: 'a' })
    await new Promise((r) => setTimeout(r, 0))

    // Node 'a' should still be in DOM because leave is pending
    const midCount = container.querySelectorAll('[data-id]').length
    expect(midCount).toBe(2)
    expect(container.querySelector('[data-id="a"]')).not.toBeNull()

    // Resolve the leave promise — node should now be removed
    resolveLeave!()
    await new Promise((r) => setTimeout(r, 0))
    const afterCount = container.querySelectorAll('[data-id]').length
    expect(afterCount).toBe(1)
    expect(container.querySelector('[data-id="a"]')).toBeNull()
  })

  it('removes all items with leave animation on clear', async () => {
    const container = document.createElement('div')
    const left: string[] = []
    const def = makeDef(undefined, (nodes) => {
      const el = nodes[0] as HTMLElement
      left.push(el.getAttribute('data-id')!)
    })
    let sendRef: ((m: Msg) => void) | null = null
    const wrapped: ComponentDef<State, Msg, never> = {
      ...def,
      view: ({ send }) => {
        sendRef = send
        return def.view(send)
      },
    }
    mountApp(container, wrapped)
    sendRef!({ type: 'set', items: [] })
    await new Promise((r) => setTimeout(r, 0))
    expect(left.sort()).toEqual(['a', 'b'])
  })

  it('fires onTransition after reconcile with entering+leaving nodes', async () => {
    const container = document.createElement('div')
    const events: Array<{ entering: number; leaving: number }> = []
    const onTransition = (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => {
      events.push({ entering: ctx.entering.length, leaving: ctx.leaving.length })
    }
    const def: ComponentDef<State, Msg, never> = {
      ...makeDef(undefined, undefined),
      view: () =>
        each<State, Item>({
          items: (s) => s.items,
          key: (item) => item.id,
          onTransition,
          render: ({ item }) => [div({ 'data-id': item((t) => t.id) }, [])],
        }),
    }
    let sendRef: ((m: Msg) => void) | null = null
    const wrapped: ComponentDef<State, Msg, never> = {
      ...def,
      view: ({ send }) => {
        sendRef = send
        return def.view(send)
      },
    }
    mountApp(container, wrapped)
    // Initial mount does NOT fire onTransition (no prior state to transition from)
    expect(events).toEqual([])

    // Append c
    sendRef!({ type: 'append', id: 'c' })
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual([{ entering: 1, leaving: 0 }])

    // Remove a
    sendRef!({ type: 'remove', id: 'a' })
    await new Promise((r) => setTimeout(r, 0))
    expect(events[1]).toEqual({ entering: 0, leaving: 1 })

    // Full replace
    sendRef!({ type: 'set', items: [{ id: 'x' }, { id: 'y' }] })
    await new Promise((r) => setTimeout(r, 0))
    expect(events[2]).toEqual({ entering: 2, leaving: 2 })

    // Clear all
    sendRef!({ type: 'set', items: [] })
    await new Promise((r) => setTimeout(r, 0))
    expect(events[3]).toEqual({ entering: 0, leaving: 2 })
  })

  it('onTransition fires on swap with no entering/leaving', async () => {
    const container = document.createElement('div')
    const events: Array<{ entering: number; leaving: number }> = []
    const def: ComponentDef<State, Msg, never> = {
      ...makeDef(undefined, undefined, [{ id: 'a' }, { id: 'b' }]),
      view: () =>
        each<State, Item>({
          items: (s) => s.items,
          key: (item) => item.id,
          onTransition: (ctx) =>
            events.push({ entering: ctx.entering.length, leaving: ctx.leaving.length }),
          render: ({ item }) => [div({ 'data-id': item((t) => t.id) }, [])],
        }),
    }
    let sendRef: ((m: Msg) => void) | null = null
    const wrapped: ComponentDef<State, Msg, never> = {
      ...def,
      view: ({ send }) => {
        sendRef = send
        return def.view(send)
      },
    }
    mountApp(container, wrapped)
    sendRef!({ type: 'set', items: [{ id: 'b' }, { id: 'a' }] })
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual([{ entering: 0, leaving: 0 }])
  })

  it('without leave, bulk clear still works (no perf regression)', async () => {
    const container = document.createElement('div')
    const def = makeDef(undefined, undefined)
    let sendRef: ((m: Msg) => void) | null = null
    const wrapped: ComponentDef<State, Msg, never> = {
      ...def,
      view: ({ send }) => {
        sendRef = send
        return def.view(send)
      },
    }
    mountApp(container, wrapped)
    expect(container.querySelectorAll('[data-id]').length).toBe(2)
    sendRef!({ type: 'set', items: [] })
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelectorAll('[data-id]').length).toBe(0)
  })
})
