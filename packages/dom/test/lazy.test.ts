import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, component, div, text, lazy } from '../src/index'
import type { AppHandle, ComponentDef } from '../src/types'

// Helper: wait for microtasks + one macrotask so promise chains settle
function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

describe('lazy', () => {
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

  it('renders fallback while loading', async () => {
    type S = Record<string, never>
    const never = new Promise<ComponentDef<unknown, never, never>>(() => {})

    app = mountApp(
      root,
      component<S, never, never>({
        name: 'Host',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({ class: 'host' }, [
            ...lazy({
              loader: () => never,
              fallback: () => [div({ class: 'loading' }, [text('Loading...')])],
            }),
          ]),
        ],
      }),
    )

    expect(root.querySelector('.loading')).toBeTruthy()
    expect(root.querySelector('.loading')?.textContent).toBe('Loading...')
  })

  it('replaces fallback with loaded component', async () => {
    type S = Record<string, never>

    const Loaded = component<Record<string, never>, never, never>({
      name: 'Loaded',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: ({ text }) => [div({ class: 'loaded' }, [text('Hello from lazy')])],
    })

    app = mountApp(
      root,
      component<S, never, never>({
        name: 'Host',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({ class: 'host' }, [
            ...lazy({
              loader: () =>
                Promise.resolve(Loaded) as Promise<
                  import('../src/types').ComponentDef<unknown, never, never>
                >,
              fallback: () => [div({ class: 'loading' }, [text('Loading...')])],
            }),
          ]),
        ],
      }),
    )

    expect(root.querySelector('.loading')).toBeTruthy()

    await flushAsync()

    expect(root.querySelector('.loading')).toBeNull()
    expect(root.querySelector('.loaded')).toBeTruthy()
    expect(root.querySelector('.loaded')?.textContent).toBe('Hello from lazy')
  })

  it('renders error UI on loader rejection', async () => {
    type S = Record<string, never>

    app = mountApp(
      root,
      component<S, never, never>({
        name: 'Host',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({ class: 'host' }, [
            ...lazy({
              loader: () => Promise.reject(new Error('boom')),
              fallback: () => [div({ class: 'loading' }, [text('Loading...')])],
              error: (err) => [div({ class: 'err' }, [text(err.message)])],
            }),
          ]),
        ],
      }),
    )

    expect(root.querySelector('.loading')).toBeTruthy()

    await flushAsync()

    expect(root.querySelector('.loading')).toBeNull()
    expect(root.querySelector('.err')).toBeTruthy()
    expect(root.querySelector('.err')?.textContent).toBe('boom')
  })

  it('passes props to the loaded component via data', async () => {
    type S = { name: string }

    const Loaded: ComponentDef<{ greeting: string }, never, never, { greeting: string }> = {
      name: 'Greeting',
      init: (data) => [{ greeting: data?.greeting ?? 'Hi' }, []],
      update: (s) => [s, []],
      view: ({ text }) => [
        div({ class: 'greet' }, [text((s: { greeting: string }) => s.greeting)]),
      ],
    }

    app = mountApp(
      root,
      component<S, never, never>({
        name: 'Host',
        init: () => [{ name: 'World' }, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({ class: 'host' }, [
            ...lazy({
              loader: () =>
                Promise.resolve(Loaded) as unknown as Promise<
                  ComponentDef<unknown, never, never, { greeting: string }>
                >,
              fallback: () => [div({ class: 'loading' }, [text('...')])],
              data: (s: S) => ({ greeting: `Hello, ${s.name}!` }),
            }),
          ]),
        ],
      }),
    )

    await flushAsync()

    expect(root.querySelector('.greet')?.textContent).toBe('Hello, World!')
  })

  it('cancels load if parent scope disposes before loader resolves', async () => {
    type S = Record<string, never>
    let resolveLoader: ((def: ComponentDef<unknown, never, never>) => void) | undefined
    let mountCount = 0

    const Loaded = component<Record<string, never>, never, never>({
      name: 'Loaded',
      init: () => {
        mountCount++
        return [{}, []]
      },
      update: (s) => [s, []],
      view: ({ text }) => [div({ class: 'loaded' }, [text('loaded')])],
    })

    app = mountApp(
      root,
      component<S, never, never>({
        name: 'Host',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({ class: 'host' }, [
            ...lazy({
              loader: () =>
                new Promise<ComponentDef<unknown, never, never>>((r) => {
                  resolveLoader = r
                }),
              fallback: () => [div({ class: 'loading' }, [text('...')])],
            }),
          ]),
        ],
      }),
    )

    expect(root.querySelector('.loading')).toBeTruthy()

    // Dispose before loader resolves
    app.dispose()
    app = null

    // Now resolve — should NOT mount the loaded component
    resolveLoader?.(Loaded as ComponentDef<unknown, never, never>)
    await flushAsync()

    expect(mountCount).toBe(0)
  })

  it('caches loader result — calling loader once per lazy() instance', async () => {
    type S = Record<string, never>
    let loadCount = 0

    const Loaded = component<Record<string, never>, never, never>({
      name: 'Loaded',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: ({ text }) => [div({ class: 'loaded' }, [text('loaded')])],
    })

    const loader = (): Promise<ComponentDef<unknown, never, never>> => {
      loadCount++
      return Promise.resolve(Loaded) as unknown as Promise<ComponentDef<unknown, never, never>>
    }

    app = mountApp(
      root,
      component<S, never, never>({
        name: 'Host',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ text }) => [
          div({ class: 'host' }, [
            ...lazy({
              loader,
              fallback: () => [div({ class: 'loading' }, [text('...')])],
            }),
          ]),
        ],
      }),
    )

    await flushAsync()
    expect(loadCount).toBe(1)
    expect(root.querySelector('.loaded')).toBeTruthy()
  })
})
