import { describe, it, expect } from 'vitest'
import { mountApp, div, button, onMount } from '../src'
import type { ComponentDef } from '../src/types'

// REPRO: Bug 6 — onMount should run synchronously after the rendered
// nodes are inserted into the DOM, so callers can dispatch events
// in the same task without racing the microtask queue.
describe('onMount — synchronous flush after DOM insertion', () => {
  it('fires before the mountApp call returns', () => {
    type State = { n: number }
    type Msg = { type: 'noop' }
    let ran = false
    const def: ComponentDef<State, Msg, never> = {
      name: 'OnMountSync',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: () => {
        onMount(() => {
          ran = true
        })
        return [div([])]
      },
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    try {
      expect(ran).toBe(true) // synchronous: ran before returning from mountApp
    } finally {
      handle.dispose()
    }
  })

  it('listeners attached via onMount are ready for a sync dispatchEvent after mount', () => {
    type State = unknown
    type Msg = { type: 'noop' }
    let handled = 0
    const def: ComponentDef<State, Msg, never> = {
      name: 'OnMountListener',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => {
        onMount(() => {
          const listener = (): void => {
            handled++
          }
          document.addEventListener('custom-event', listener)
          return () => document.removeEventListener('custom-event', listener)
        })
        return [div([])]
      },
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    try {
      // Sync-dispatch immediately after mountApp returns
      document.dispatchEvent(new Event('custom-event'))
      expect(handled).toBe(1) // listener was already attached
    } finally {
      handle.dispose()
    }
  })

  it('receives the container element as the callback argument', () => {
    type State = unknown
    type Msg = { type: 'noop' }
    let seen: Element | null = null
    const def: ComponentDef<State, Msg, never> = {
      name: 'OnMountContainer',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => {
        onMount((el) => {
          seen = el
        })
        return [div([])]
      },
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    try {
      expect(seen).toBe(container)
    } finally {
      handle.dispose()
    }
  })

  it('runs the cleanup on dispose', () => {
    type State = unknown
    type Msg = { type: 'noop' }
    let cleaned = false
    const def: ComponentDef<State, Msg, never> = {
      name: 'OnMountCleanup',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => {
        onMount(() => () => {
          cleaned = true
        })
        return [div([])]
      },
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.dispose()
    expect(cleaned).toBe(true)
  })
})
