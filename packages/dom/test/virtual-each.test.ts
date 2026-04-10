import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, component, div, virtualEach } from '../src/index'
import type { AppHandle, ComponentDef } from '../src/types'

function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

describe('virtualEach', () => {
  let root: HTMLElement
  let app: AppHandle | null = null

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    app?.dispose()
    root.remove()
  })

  it('renders only items visible in the viewport', async () => {
    type S = { items: { id: number; label: string }[] }

    const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `Item ${i}` }))

    type Item = { id: number; label: string }
    const def: ComponentDef<S, never, never> = {
      name: 'VList',
      init: () => [{ items }, []],
      update: (s) => [s, []],
      view: ({ text }) => [
        div({ class: 'list' }, [
          ...virtualEach<S, Item, never>({
            items: (s) => s.items,
            key: (it) => it.id,
            itemHeight: 40,
            containerHeight: 400,
            render: ({ item }) => [div({ class: 'row' }, [text(item((i) => i.label))])],
          }),
        ]),
      ],
    }
    app = mountApp(root, component(def))

    await flushAsync()

    const rows = root.querySelectorAll('.row')
    expect(rows.length).toBeGreaterThan(8)
    expect(rows.length).toBeLessThan(30)
  })

  it('sets total height on spacer', async () => {
    type S = { items: number[] }
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'VList',
        init: () => [{ items: Array.from({ length: 500 }, (_, i) => i) }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({}, [
            ...virtualEach<S, number, never>({
              items: (s) => s.items,
              key: (n) => n,
              itemHeight: 50,
              containerHeight: 300,
              render: ({ item }) => [div([text(item((x) => String(x)))])],
            }),
          ]),
        ],
      }),
    )

    await flushAsync()
    const spacer = root.querySelector('[data-virtual-spacer]') as HTMLElement | null
    expect(spacer).toBeTruthy()
    expect(spacer?.style.height).toBe('25000px')
  })

  it('positions items absolutely at index * itemHeight', async () => {
    type S = { items: number[] }
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'VList',
        init: () => [{ items: Array.from({ length: 100 }, (_, i) => i) }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          ...virtualEach<S, number, never>({
            items: (s) => s.items,
            key: (n) => n,
            itemHeight: 30,
            containerHeight: 300,
            render: ({ item }) => [div({ class: 'row' }, [text(item((x) => String(x)))])],
          }),
        ],
      }),
    )

    await flushAsync()
    const wrappers = root.querySelectorAll('[data-virtual-item]')
    expect(wrappers.length).toBeGreaterThan(0)
    const first = wrappers[0] as HTMLElement
    expect(first.style.position).toBe('absolute')
    expect(first.style.top).toBe('0px')
    expect(first.style.height).toBe('30px')
  })

  it('re-renders when items array changes', async () => {
    type S = { items: string[] }
    type M = { type: 'set'; items: string[] }
    let sendRef: ((m: M) => void) | null = null

    app = mountApp(
      root,
      component<S, M, never>({
        name: 'VList',
        init: () => [{ items: ['a', 'b', 'c'] }, []],
        update: (s, m) => {
          if (m.type === 'set') return [{ items: m.items }, []]
          return [s, []]
        },
        view: ({ send, text }) => {
          sendRef = send
          return [
            ...virtualEach<S, string, M>({
              items: (s) => s.items,
              key: (x) => x,
              itemHeight: 40,
              containerHeight: 400,
              render: ({ item }) => [div({ class: 'row' }, [text(item((x) => x))])],
            }),
          ]
        },
      }),
    )

    await flushAsync()
    expect(root.querySelectorAll('.row').length).toBe(3)

    sendRef!({ type: 'set', items: ['x', 'y', 'z', 'w'] })
    app.flush()
    await flushAsync()

    expect(root.querySelectorAll('.row').length).toBe(4)
  })

  it('renders all items when array is shorter than viewport', async () => {
    type S = { items: string[] }
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'VList',
        init: () => [{ items: ['one', 'two'] }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          ...virtualEach<S, string, never>({
            items: (s) => s.items,
            key: (x) => x,
            itemHeight: 40,
            containerHeight: 400,
            render: ({ item }) => [div({ class: 'row' }, [text(item((x) => x))])],
          }),
        ],
      }),
    )

    await flushAsync()
    expect(root.querySelectorAll('.row').length).toBe(2)
  })

  it('handles empty array', async () => {
    type S = { items: string[] }
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'VList',
        init: () => [{ items: [] as string[] }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          ...virtualEach<S, string, never>({
            items: (s) => s.items,
            key: (x) => x,
            itemHeight: 40,
            containerHeight: 400,
            render: ({ item }) => [div({ class: 'row' }, [text(item((x) => x))])],
          }),
        ],
      }),
    )

    await flushAsync()
    expect(root.querySelectorAll('.row').length).toBe(0)
    const spacer = root.querySelector('[data-virtual-spacer]') as HTMLElement | null
    expect(spacer?.style.height).toBe('0px')
  })

  it('removes item nodes when they are removed from the array', async () => {
    type S = { items: string[] }
    type M = { type: 'set'; items: string[] }
    let sendRef: ((m: M) => void) | null = null

    app = mountApp(
      root,
      component<S, M, never>({
        name: 'VList',
        init: () => [{ items: ['a', 'b', 'c'] }, []],
        update: (s, m) => {
          if (m.type === 'set') return [{ items: m.items }, []]
          return [s, []]
        },
        view: ({ send, text }) => {
          sendRef = send
          return [
            ...virtualEach<S, string, M>({
              items: (s) => s.items,
              key: (x) => x,
              itemHeight: 40,
              containerHeight: 400,
              render: ({ item }) => [div({ class: 'row' }, [text(item((x) => x))])],
            }),
          ]
        },
      }),
    )

    await flushAsync()
    expect(root.querySelectorAll('.row').length).toBe(3)

    sendRef!({ type: 'set', items: ['a'] })
    app.flush()
    await flushAsync()

    expect(root.querySelectorAll('.row').length).toBe(1)
    expect(root.querySelector('.row')?.textContent).toBe('a')
  })
})
