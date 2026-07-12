import { describe, it, expect } from 'vitest'
import { mountSignalComponent, type SignalComponentDef } from '../../src/signals/component'
import { signalText, el, signalLazy, type Renderable } from '../../src/signals/dom'
import { lazy, div, span, text } from '../../src/signals/authoring'

// A microtask tick — lets a resolved/rejected loader promise settle.
const tick = (): Promise<void> => Promise.resolve().then(() => {})

describe('signalLazy — async component loading', () => {
  interface HostS {
    n: number
  }
  type HostM = { type: 'noop' }

  // A loaded component that is itself reactive (its own count increments).
  interface LoadedS {
    count: number
  }
  type LoadedM = { type: 'inc' }
  const loaded: SignalComponentDef<LoadedS, LoadedM> = {
    init: () => ({ count: 7 }),
    update: (s, m) => (m.type === 'inc' ? { count: s.count + 1 } : s),
    view: () => [
      el('p', { class: 'loaded' }, [signalText((s) => (s as LoadedS).count, ['count'])]),
    ],
  }

  function host(
    loader: () => Promise<SignalComponentDef<unknown, unknown, unknown>>,
    opts: {
      error?: (err: Error) => Renderable
    } = {},
  ) {
    const container = document.createElement('div')
    const h = mountSignalComponent<HostS, HostM>(container, {
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        el('div', { class: 'wrap' }, [
          signalLazy({
            loader,
            fallback: () => [el('span', { class: 'fallback' }, [signalText(() => 'loading', [])])],
            error: opts.error,
          }),
        ]),
      ],
    })
    return { container, h }
  }

  it('renders the fallback immediately', () => {
    const { container } = host(() => new Promise(() => {}) as Promise<never>)
    expect(container.querySelector('.fallback')?.textContent).toBe('loading')
    expect(container.querySelector('.loaded')).toBeNull()
  })

  it('swaps in the loaded component after the loader resolves', async () => {
    const { container } = host(() =>
      Promise.resolve(loaded as unknown as SignalComponentDef<unknown, unknown, unknown>),
    )
    expect(container.querySelector('.fallback')).not.toBeNull()
    await tick()
    expect(container.querySelector('.fallback')).toBeNull()
    expect(container.querySelector('.loaded')!.textContent).toBe('7')
  })

  it('the loaded component is reactive (drives its own update loop)', async () => {
    // A loaded component whose init dispatches an effect that re-sends — proves it
    // runs a live loop. Simpler: a clicked button increments and the text updates.
    const clicker: SignalComponentDef<LoadedS, LoadedM> = {
      init: () => ({ count: 0 }),
      update: (s, m) => (m.type === 'inc' ? { count: s.count + 1 } : s),
      view: ({ send }) => [
        el('button', { class: 'loaded', onClick: () => send({ type: 'inc' }) }, [
          signalText((s) => (s as LoadedS).count, ['count']),
        ]),
      ],
    }
    const { container } = host(() =>
      Promise.resolve(clicker as unknown as SignalComponentDef<unknown, unknown, unknown>),
    )
    await tick()
    const btn = container.querySelector('.loaded') as HTMLButtonElement
    expect(btn.textContent).toBe('0')
    btn.click()
    expect(btn.textContent).toBe('1')
  })

  it('renders the error arm when the loader rejects', async () => {
    const { container } = host(() => Promise.reject(new Error('boom')), {
      error: (err) => [el('span', { class: 'err' }, [signalText(() => err.message, [])])],
    })
    await tick()
    await tick()
    expect(container.querySelector('.fallback')).toBeNull()
    expect(container.querySelector('.err')?.textContent).toBe('boom')
  })

  it('renders nothing extra when the loader rejects and no error arm is given', async () => {
    const { container } = host(() => Promise.reject(new Error('boom')))
    await tick()
    await tick()
    expect(container.querySelector('.fallback')).toBeNull()
    expect(container.querySelector('.loaded')).toBeNull()
    expect(container.querySelector('.err')).toBeNull()
  })

  it('cancels the deferred mount when disposed before the loader resolves', async () => {
    let resolveLoader!: (def: SignalComponentDef<unknown, unknown, unknown>) => void
    const { container, h } = host(
      () =>
        new Promise<SignalComponentDef<unknown, unknown, unknown>>((res) => {
          resolveLoader = res
        }),
    )
    expect(container.querySelector('.fallback')).not.toBeNull()
    h.dispose()
    resolveLoader(loaded as unknown as SignalComponentDef<unknown, unknown, unknown>)
    await tick()
    await tick()
    // never mounted the loaded component after dispose
    expect(container.querySelector('.loaded')).toBeNull()
  })
})

describe('signalLazy — error arm reading component state', () => {
  interface S {
    label: string
  }
  type M = { type: 'set'; label: string }

  it('mounts the error arm against live component state and keeps it reactive', async () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ label: 'v1' }),
      update: (s, m) => (m.type === 'set' ? { ...s, label: m.label } : s),
      view: ({ state }) => [
        div([
          lazy({
            loader: () => Promise.reject(new Error('boom')),
            fallback: () => [span([text('loading')])],
            // The error arm reads COMPONENT state — it must mount against the live
            // state (not `null`) and update when that state changes.
            error: () => [span({ class: 'err' }, [text(state.at('label'))])],
          }),
        ]),
      ],
    })

    await tick()
    await tick()
    expect(container.querySelector('.err')?.textContent).toBe('v1')

    h.send({ type: 'set', label: 'v2' })
    expect(container.querySelector('.err')?.textContent).toBe('v2')
    h.dispose()
  })
})
