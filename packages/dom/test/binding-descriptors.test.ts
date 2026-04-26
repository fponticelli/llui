import { describe, it, expect } from 'vitest'
import { component, mountApp, button, div, text, tagSend } from '../src/index.js'
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

describe('tagSend — library helper for *.connect implementations', () => {
  it('tags fn with libraryVariants when send is untagged (raw component send)', () => {
    // Path 1: user passed their raw component send. The library's
    // internal Msg is what update() receives directly, so the
    // library's hand-listed variants ARE the user variants.
    const send = (() => {}) as unknown as (m: { type: string }) => void
    const handler = () => send({ type: 'open' })
    const tagged = tagSend(send, ['open'], handler) as typeof handler & {
      __lluiVariants?: readonly string[]
    }
    expect(tagged.__lluiVariants).toEqual(['open'])
    // Identity-stable: the helper mutates fn, returns the same reference.
    expect(tagged).toBe(handler)
  })

  it('prefers send.__lluiVariants when send is a tagged translator', () => {
    // Path 2/3: user wrote `const sendMenu = (m) => dispatch({type:'X'})`.
    // The compiler (Pass 3) tagged sendMenu. When the library calls
    // `tagSend(sendMenu, ['open'], () => sendMenu(...))`, the agent
    // should see 'X' (what update receives) — not 'open' (the
    // library's internal Msg shape).
    const sendMenu = Object.assign((_m: { type: string }) => {}, {
      __lluiVariants: ['Auth/UserMenu', 'Auth/SignOut'] as const,
    })
    const handler = () => sendMenu({ type: 'open' })
    const tagged = tagSend(sendMenu, ['open'], handler) as typeof handler & {
      __lluiVariants?: readonly string[]
    }
    expect(tagged.__lluiVariants).toEqual(['Auth/UserMenu', 'Auth/SignOut'])
  })

  it('falls back to libraryVariants when send.__lluiVariants is empty', () => {
    // An empty translator tag is treated as untagged. Defensive: a
    // user that wrote `Object.assign(send, {__lluiVariants: []})`
    // shouldn't accidentally suppress the library's own variants.
    const send = Object.assign((_m: { type: string }) => {}, {
      __lluiVariants: [] as readonly string[],
    })
    const handler = () => send({ type: 'open' })
    const tagged = tagSend(send, ['open'], handler) as typeof handler & {
      __lluiVariants?: readonly string[]
    }
    expect(tagged.__lluiVariants).toEqual(['open'])
  })

  it('skips tagging when both libraryVariants and send tag are empty', () => {
    const send = (() => {}) as unknown as (m: { type: string }) => void
    const handler = () => send({ type: 'open' })
    const tagged = tagSend(send, [], handler) as typeof handler & {
      __lluiVariants?: readonly string[]
    }
    expect(tagged.__lluiVariants).toBeUndefined()
  })

  it('tolerates null/undefined send arguments', () => {
    // Some test harnesses pass null/undefined; the helper should
    // degrade to libraryVariants rather than throw.
    const handler = () => {}
    const taggedNull = tagSend(null, ['X'], handler) as typeof handler & {
      __lluiVariants?: readonly string[]
    }
    expect(taggedNull.__lluiVariants).toEqual(['X'])
    const handler2 = () => {}
    const taggedUndef = tagSend(undefined, ['Y'], handler2) as typeof handler2 & {
      __lluiVariants?: readonly string[]
    }
    expect(taggedUndef.__lluiVariants).toEqual(['Y'])
  })

  it('end-to-end: tagged handler registers variants when bound to an element', () => {
    // Simulates the full library pattern: user's translator passed to
    // a library connect that wraps onClick with tagSend, then user
    // spreads the bag onto a button. The variant should surface in
    // getBindingDescriptors.
    type State = { n: number }
    type Msg = { type: 'Auth/UserMenu' }
    const App: ComponentDef<State, Msg, never> = component<State, Msg, never>({
      name: 'TagSendE2E',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ send }) => {
        // The user-written translator (Pass 3 would tag this in
        // production; here we tag manually since this test file
        // bypasses the compiler).
        const sendMenu = Object.assign((_m: { type: string }) => send({ type: 'Auth/UserMenu' }), {
          __lluiVariants: ['Auth/UserMenu'] as const,
        })
        // Simulate what `menu.connect(...)` would return:
        const trigger = {
          onClick: tagSend(sendMenu, ['open'], () => sendMenu({ type: 'open' })),
        }
        return [button(trigger, [text('menu')])]
      },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    try {
      const descriptors = handle.getBindingDescriptors()
      // Should be 'Auth/UserMenu' (translator's tag), NOT 'open'
      // (library's internal variant). Translator tag wins.
      expect(descriptors.map((d) => d.variant)).toEqual(['Auth/UserMenu'])
    } finally {
      handle.dispose()
      root.remove()
    }
  })
})
