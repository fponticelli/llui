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

  it('also registers via the compiled elSplit path', async () => {
    // The compiler rewrites `button({onClick: …}, [...])` into
    // `elSplit('button', staticFn, events, bindings, children)`. The
    // raw and compiled paths must both honor the `__lluiVariants`
    // tag so live agent affordances work in built apps too.
    const { elSplit } = await import('../src/el-split.js')

    type State = { n: number }
    type Msg = { type: 'inc' }
    const App: ComponentDef<State, Msg, never> = component<State, Msg, never>({
      name: 'ElSplitPath',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ send }) => [
        elSplit('button', null, [['click', tag(() => send({ type: 'inc' }), ['inc'])]], null, [
          '+',
        ]),
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

  it('__registerScopeVariants registers against the active render scope', async () => {
    // The compiler emits `__registerScopeVariants(['…'])` adjacent to
    // every `<bag>.connect(get, sendFn, …)` call site, with the
    // variants statically extracted from `sendFn`'s body. This test
    // exercises the helper directly (compiler emission is tested in
    // @llui/vite-plugin) and verifies the scope plumbing.
    const { __registerScopeVariants } = await import('../src/binding-descriptors.js')

    type State = { n: number }
    type Msg = { type: 'noop' }
    const App: ComponentDef<State, Msg, never> = component<State, Msg, never>({
      name: 'ScopeRegister',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: () => {
        // Calling the helper at view-eval time mirrors what the
        // compiler does — runs inside the render context, registers
        // on the component's root scope.
        __registerScopeVariants(['Editor/OpenCell', 'Editor/Close'])
        return [div([text('view')])]
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    try {
      const variants = handle
        .getBindingDescriptors()
        .map((d) => d.variant)
        .sort()
      expect(variants).toEqual(['Editor/Close', 'Editor/OpenCell'])
    } finally {
      handle.dispose()
      root.remove()
    }
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
