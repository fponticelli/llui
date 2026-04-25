import { describe, it, expect } from 'vitest'
import { component, mountApp, button, div, text } from '../src/index.js'
import type { ComponentDef } from '../src/types.js'

/**
 * The compiler tags arrow-function event handlers that contain a
 * literal `send({type: 'X'})` call with `__lluiVariants: ['X', …]`.
 * These tests bypass the compiler — we attach the property by hand on
 * the arrow function — to exercise the runtime registration path in
 * isolation. The compiler emission is tested in `@llui/vite-plugin`.
 */

type Tagged<F extends (...a: never[]) => unknown> = F & { __lluiVariants: readonly string[] }

function tag<F extends (...a: never[]) => unknown>(fn: F, variants: readonly string[]): Tagged<F> {
  return Object.assign(fn, { __lluiVariants: variants }) as Tagged<F>
}

describe('binding-descriptors — runtime registry', () => {
  it('registers tagged event-handler variants when the binding mounts', () => {
    type State = { n: number }
    type Msg = { type: 'inc' }
    const App: ComponentDef<State, Msg, never> = component<State, Msg, never>({
      name: 'TaggedSimple',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ send }) => [
        button({ onClick: tag(() => send({ type: 'inc' }), ['inc']) }, [text('+')]),
      ],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    try {
      expect(handle.getBindingDescriptors()).toEqual([{ variant: 'inc' }])
    } finally {
      handle.dispose()
      root.remove()
    }
  })

  it('returns an empty list when no handlers are tagged', () => {
    type State = { n: number }
    type Msg = { type: 'noop' }
    const App: ComponentDef<State, Msg, never> = component<State, Msg, never>({
      name: 'Untagged',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ send }) => [button({ onClick: () => send({ type: 'noop' }) }, [text('x')])],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    try {
      expect(handle.getBindingDescriptors()).toEqual([])
    } finally {
      handle.dispose()
      root.remove()
    }
  })

  it('refcounts duplicate variants — N bindings of the same variant stay live until all unmount', () => {
    type State = { n: number }
    type Msg = { type: 'click' }
    const App: ComponentDef<State, Msg, never> = component<State, Msg, never>({
      name: 'Repeated',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ send }) => [
        div([
          button({ onClick: tag(() => send({ type: 'click' }), ['click']) }, [text('a')]),
          button({ onClick: tag(() => send({ type: 'click' }), ['click']) }, [text('b')]),
          button({ onClick: tag(() => send({ type: 'click' }), ['click']) }, [text('c')]),
        ]),
      ],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    try {
      // Three buttons, one entry — refcount internal but presence is what we expose.
      expect(handle.getBindingDescriptors()).toEqual([{ variant: 'click' }])
    } finally {
      handle.dispose()
      root.remove()
    }
  })

  it('drops the descriptor on app dispose', () => {
    type State = { n: number }
    type Msg = { type: 'inc' }
    const App: ComponentDef<State, Msg, never> = component<State, Msg, never>({
      name: 'DisposeDrop',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ send }) => [
        button({ onClick: tag(() => send({ type: 'inc' }), ['inc']) }, [text('+')]),
      ],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    expect(handle.getBindingDescriptors()).toEqual([{ variant: 'inc' }])
    handle.dispose()
    // After dispose the handle returns []. The handle stays addressable
    // for late callers — they just see an empty affordance set, which
    // matches "the app is gone, nothing to click."
    expect(handle.getBindingDescriptors()).toEqual([])
    root.remove()
  })

  it('records multiple distinct variants from one handler', () => {
    type State = { n: number }
    type Msg = { type: 'a' } | { type: 'b' }
    const App: ComponentDef<State, Msg, never> = component<State, Msg, never>({
      name: 'TernarySend',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      // Realistic shape: one handler that branches between two
      // variants. The compiler will eventually emit ['a', 'b'] for
      // this; here we tag by hand.
      view: ({ send }) => [
        button(
          {
            onClick: tag(() => {
              if (Math.random() > 0.5) send({ type: 'a' })
              else send({ type: 'b' })
            }, ['a', 'b']),
          },
          [text('?')],
        ),
      ],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    try {
      const descriptors = handle.getBindingDescriptors()
      expect(descriptors.map((d) => d.variant).sort()).toEqual(['a', 'b'])
    } finally {
      handle.dispose()
      root.remove()
    }
  })
})
