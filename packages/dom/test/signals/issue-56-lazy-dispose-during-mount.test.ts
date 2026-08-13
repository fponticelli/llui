// Issue #56 — `lazy()` must never orphan the child it mounts.
//
// The loaded component's `onMount` callbacks run SYNCHRONOUSLY inside the mount
// call, so one of them can tear the host down mid-load-callback. The host teardown
// then runs while `lazy`'s handle field is still null, and the mount's return value
// installs a live child nothing will ever dispose. Same shape for the error arm,
// whose controller records the mounted arm only after its onMount callbacks return.

import { describe, it, expect } from 'vitest'
import { mountSignalComponent, type SignalComponentDef } from '../../src/signals/component'
import { signalText, el, signalLazy } from '../../src/signals/dom'
import { onMount } from '../../src/signals/build-context'
import { div, span, text } from '../../src/signals/authoring'

// A microtask tick — lets a resolved/rejected loader promise settle.
const tick = (): Promise<void> => Promise.resolve().then(() => {})

interface HostS {
  n: number
}
type HostM = { type: 'noop' }

interface LoadedS {
  count: number
}
type LoadedM = { type: 'inc' }

describe('signalLazy — dispose during the child mount', () => {
  it('disposes a child that mounted after cancellation', async () => {
    const container = document.createElement('div')
    let childCleanupRan = false
    let disposeHost: (() => void) | null = null

    const loadedDef: SignalComponentDef<LoadedS, LoadedM> = {
      init: () => ({ count: 0 }),
      update: (s) => s,
      view: () => [
        el('p', { class: 'loaded' }, [signalText((s) => (s as LoadedS).count, ['count'])]),
        // Runs synchronously inside the child's mount, mid-load-callback.
        onMount(() => {
          disposeHost?.()
          return () => {
            childCleanupRan = true
          }
        }),
      ],
    }

    const handle = mountSignalComponent<HostS, HostM>(container, {
      name: 'lazy-orphan',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        div([
          signalLazy({
            loader: () => Promise.resolve(loadedDef),
            fallback: () => [span([text('loading')])],
          }),
        ]),
      ],
    })
    disposeHost = () => handle.dispose()

    await tick()
    await tick()

    expect(childCleanupRan).toBe(true)
  })

  it('runs the child onMount cleanup exactly once on a normal dispose', async () => {
    const container = document.createElement('div')
    let cleanups = 0

    const loadedDef: SignalComponentDef<LoadedS, LoadedM> = {
      init: () => ({ count: 3 }),
      update: (s) => s,
      view: () => [
        el('p', { class: 'loaded' }, [signalText((s) => (s as LoadedS).count, ['count'])]),
        onMount(() => () => {
          cleanups += 1
        }),
      ],
    }

    const handle = mountSignalComponent<HostS, HostM>(container, {
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        div([
          signalLazy({
            loader: () => Promise.resolve(loadedDef),
            fallback: () => [span([text('loading')])],
          }),
        ]),
      ],
    })

    await tick()
    await tick()
    expect(container.querySelector('.loaded')?.textContent).toBe('3')
    expect(cleanups).toBe(0)

    handle.dispose()
    expect(cleanups).toBe(1)
    // Disposing twice must not re-run the child's cleanups (nor throw).
    handle.dispose()
    expect(cleanups).toBe(1)
  })

  it('never mounts the child when the host is disposed before the loader settles', async () => {
    const container = document.createElement('div')
    let mountRan = false
    let resolveLoader!: (def: SignalComponentDef<LoadedS, LoadedM>) => void

    const loadedDef: SignalComponentDef<LoadedS, LoadedM> = {
      init: () => ({ count: 0 }),
      update: (s) => s,
      view: () => [
        el('p', { class: 'loaded' }, [signalText((s) => (s as LoadedS).count, ['count'])]),
        onMount(() => {
          mountRan = true
        }),
      ],
    }

    const handle = mountSignalComponent<HostS, HostM>(container, {
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        div([
          signalLazy({
            loader: () =>
              new Promise<SignalComponentDef<LoadedS, LoadedM>>((res) => {
                resolveLoader = res
              }),
            fallback: () => [span([text('loading')])],
          }),
        ]),
      ],
    })

    handle.dispose()
    resolveLoader(loadedDef)
    await tick()
    await tick()

    expect(mountRan).toBe(false)
    expect(container.querySelector('.loaded')).toBeNull()
  })

  it('leaves nothing live when the host is disposed during the error arm mount', async () => {
    const container = document.createElement('div')
    let armCleanupRan = false
    let disposeHost: (() => void) | null = null

    const handle = mountSignalComponent<HostS, HostM>(container, {
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        div([
          signalLazy<LoadedS, LoadedM>({
            loader: () => Promise.reject(new Error('boom')),
            fallback: () => [span([text('loading')])],
            error: (err) => [
              span({ class: 'err' }, [text(err.message)]),
              // Runs synchronously inside the arm's mount, mid-error-callback.
              onMount(() => {
                disposeHost?.()
                return () => {
                  armCleanupRan = true
                }
              }),
            ],
          }),
        ]),
      ],
    })
    disposeHost = () => handle.dispose()

    await tick()
    await tick()

    expect(armCleanupRan).toBe(true)
    expect(container.querySelector('.err')).toBeNull()
  })
})
