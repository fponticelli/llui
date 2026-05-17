/**
 * Reproduction for the user-reported bug:
 *   "mountApp invoked inside another app's view tick (via foreign() +
 *    deferred onMount) leaves the child's reactive bindings dead."
 *
 * Strategy: parent app uses foreign({ mount }) to mount a CHILD app via
 * mountApp(container, ChildDef). Click a button in the child to dispatch
 * a child message. Assert the child's text node reflects the new state.
 */
import { describe, it, expect } from 'vitest'
import { mountApp, flush, type AppHandle } from '../src'
import { foreign } from '../src/primitives/foreign'
import { onMount } from '../src/primitives/on-mount'
import { component, div, button } from '../src'

interface ChildState {
  open: boolean
}
type ChildMsg = { type: 'toggle' }

const ChildDef = component<ChildState, ChildMsg, never>({
  name: 'Child',
  init: () => [{ open: false }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'toggle':
        return [{ ...state, open: !state.open }, []]
    }
  },
  view: ({ send, text: t }) => [
    div({}, [
      button(
        {
          'data-testid': 'toggle',
          'aria-expanded': (s: ChildState) => (s.open ? 'true' : 'false'),
          onClick: () => send({ type: 'toggle' }),
        },
        [t((s: ChildState) => (s.open ? 'OPEN' : 'CLOSED'))],
      ),
    ]),
  ],
})

interface ParentState {
  x: number
}
type ParentMsg = { type: 'noop' }

describe('nested mountApp via foreign + onMount', () => {
  it('child bindings react to child messages', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const ParentDef = component<ParentState, ParentMsg, never>({
      name: 'Parent',
      init: () => [{ x: 0 }, []],
      update: (s, _msg) => [s, []],
      view: () => [
        div({}, [
          foreign<ParentState, ParentMsg, Record<string, never>, AppHandle>({
            mount: ({ container: fc }) => {
              let resolve!: (h: AppHandle) => void
              const p = new Promise<AppHandle>((r) => (resolve = r))
              onMount(() => {
                const h = mountApp(fc, ChildDef)
                resolve(h)
              })
              return p
            },
            props: () => ({}),
            sync: () => {
              /* no-op */
            },
            destroy: (handle) => handle.dispose(),
          }),
        ]),
      ],
    })

    mountApp(container, ParentDef)
    await Promise.resolve() // settle foreign's async mount

    const btn = container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')
    expect(btn).not.toBeNull()
    expect(btn!.getAttribute('aria-expanded')).toBe('false')
    expect(btn!.textContent).toBe('CLOSED')

    btn!.click()
    flush()

    expect(btn!.getAttribute('aria-expanded')).toBe('true')
    expect(btn!.textContent).toBe('OPEN')
  })

  it('child bindings react after parent dispatches a sync-driven message', async () => {
    // Mirrors dicerun2's shim shape more closely: sync sends a
    // `props/set` message to the child every time parent props change.
    interface ChildShimState {
      open: boolean
      label: string
    }
    type ChildShimMsg = { type: 'toggle' } | { type: 'props/set'; label: string }

    const ChildShimDef = component<ChildShimState, ChildShimMsg, never>({
      name: 'ChildShim',
      init: () => [{ open: false, label: 'initial' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'toggle':
            return [{ ...state, open: !state.open }, []]
          case 'props/set':
            return [{ ...state, label: msg.label }, []]
        }
      },
      view: ({ send, text: t }) => [
        button(
          {
            'data-testid': 'shim-toggle',
            'aria-expanded': (s: ChildShimState) => (s.open ? 'true' : 'false'),
            onClick: () => send({ type: 'toggle' }),
          },
          [t((s: ChildShimState) => `${s.label}/${s.open ? 'OPEN' : 'CLOSED'}`)],
        ),
      ],
    })

    interface ParentShimState {
      tick: number
    }
    type ParentShimMsg = { type: 'tick' }

    const container = document.createElement('div')
    document.body.appendChild(container)

    const ParentShimDef = component<ParentShimState, ParentShimMsg, never>({
      name: 'ParentShim',
      init: () => [{ tick: 0 }, []],
      update: (s, msg) => {
        if (msg.type === 'tick') return [{ ...s, tick: s.tick + 1 }, []]
        return [s, []]
      },
      view: ({ send }) => [
        div({}, [
          button({ 'data-testid': 'parent-tick', onClick: () => send({ type: 'tick' }) }, []),
          foreign<ParentShimState, ParentShimMsg, { label: string }, AppHandle>({
            mount: ({ container: fc }) => {
              let resolve!: (h: AppHandle) => void
              const p = new Promise<AppHandle>((r) => (resolve = r))
              onMount(() => {
                const h = mountApp(fc, ChildShimDef)
                resolve(h)
              })
              return p
            },
            props: (s) => ({ label: `tick-${s.tick}` }),
            sync: ({ instance, props }) => instance.send({ type: 'props/set', label: props.label }),
            destroy: (handle) => handle.dispose(),
          }),
        ]),
      ],
    })

    mountApp(container, ParentShimDef)
    await Promise.resolve()
    flush()

    const shimBtn = container.querySelector<HTMLButtonElement>('[data-testid="shim-toggle"]')
    expect(shimBtn).not.toBeNull()
    expect(shimBtn!.textContent).toBe('tick-0/CLOSED')
    expect(shimBtn!.getAttribute('aria-expanded')).toBe('false')

    // Click the parent button to bump tick; sync should forward to child.
    const parentBtn = container.querySelector<HTMLButtonElement>('[data-testid="parent-tick"]')
    parentBtn!.click()
    flush()
    // give the child's microtask a chance to drain
    await Promise.resolve()
    flush()

    expect(shimBtn!.textContent).toBe('tick-1/CLOSED')

    // Now click the child trigger and verify its OWN binding reacts.
    shimBtn!.click()
    flush()
    expect(shimBtn!.getAttribute('aria-expanded')).toBe('true')
    expect(shimBtn!.textContent).toBe('tick-1/OPEN')
  })
})
