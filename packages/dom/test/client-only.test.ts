import { describe, it, expect } from 'vitest'
import { renderToString } from '../src/ssr'
import { browserEnv } from '../src/dom-env'
import { jsdomEnv } from '../src/ssr/jsdom'
import {
  component,
  div,
  span,
  text,
  clientOnly,
  __clientOnlyStub,
  child,
  mountApp,
  hydrateApp,
} from '../src/index'

type State = { label: string }

describe('clientOnly — SSR', () => {
  it('emits start/end comment anchors with fallback nodes between them', async () => {
    const Def = component<State, never, never>({
      name: 'WithFallback',
      init: () => [{ label: 'hi' }, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'wrap' }, [
          ...clientOnly<State, never>({
            render: () => [span({ class: 'real' }, [text('real widget')])],
            fallback: () => [span({ class: 'skeleton' }, [text('loading…')])],
          }),
        ]),
      ],
    })
    const env = await jsdomEnv()
    const html = renderToString(Def, undefined, env)
    expect(html).toContain('<!--llui-client-only-start-->')
    expect(html).toContain('<!--llui-client-only-end-->')
    expect(html).toContain('class="skeleton"')
    expect(html).toContain('loading…')
    expect(html).not.toContain('class="real"')
  })

  it('emits only anchor pair when fallback is omitted', async () => {
    const Def = component<State, never, never>({
      name: 'NoFallback',
      init: () => [{ label: 'hi' }, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'wrap' }, [
          ...clientOnly<State, never>({
            render: () => [span({ class: 'real' }, [text('real')])],
          }),
        ]),
      ],
    })
    const env = await jsdomEnv()
    const html = renderToString(Def, undefined, env)
    // Anchors are adjacent — nothing rendered between them.
    expect(html).toContain('<!--llui-client-only-start--><!--llui-client-only-end-->')
    expect(html).not.toContain('class="real"')
  })

  it('never invokes the render callback during SSR', async () => {
    let renderCalled = false
    const Def = component<State, never, never>({
      name: 'RenderSpy',
      init: () => [{ label: 'hi' }, []],
      update: (s) => [s, []],
      view: () => [
        div({}, [
          ...clientOnly<State, never>({
            render: () => {
              renderCalled = true
              return [text('should not run')]
            },
            fallback: () => [text('fallback ran')],
          }),
        ]),
      ],
    })
    const env = await jsdomEnv()
    renderToString(Def, undefined, env)
    expect(renderCalled).toBe(false)
  })

  it('fallback sees the host component state through the View bag', async () => {
    const Def = component<State, never, never>({
      name: 'FallbackState',
      init: () => [{ label: 'server-label' }, []],
      update: (s) => [s, []],
      view: () => [
        div({}, [
          ...clientOnly<State, never>({
            render: () => [text('real')],
            fallback: ({ text: t }) => [t((s: State) => `fallback:${s.label}`)],
          }),
        ]),
      ],
    })
    const env = await jsdomEnv()
    const html = renderToString(Def, undefined, env)
    expect(html).toContain('fallback:server-label')
  })
})

describe('clientOnly — client mount (fresh)', () => {
  it('runs render inline without emitting anchor comments', () => {
    const Def = component<State, never, never>({
      name: 'FreshMount',
      init: () => [{ label: 'x' }, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'host' }, [
          ...clientOnly<State, never>({
            render: () => [span({ class: 'real' }, [text('real widget')])],
            fallback: () => [span({ class: 'skeleton' }, [text('should not appear')])],
          }),
        ]),
      ],
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, Def)
    try {
      expect(container.innerHTML).not.toContain('llui-client-only-start')
      expect(container.innerHTML).not.toContain('llui-client-only-end')
      expect(container.querySelector('.real')).not.toBeNull()
      expect(container.querySelector('.skeleton')).toBeNull()
    } finally {
      handle.dispose()
      container.remove()
    }
  })

  it('never calls fallback during fresh client mount', () => {
    let fallbackCalled = false
    const Def = component<State, never, never>({
      name: 'FallbackSpy',
      init: () => [{ label: 'x' }, []],
      update: (s) => [s, []],
      view: () => [
        div({}, [
          ...clientOnly<State, never>({
            render: () => [text('real')],
            fallback: () => {
              fallbackCalled = true
              return [text('should not run')]
            },
          }),
        ]),
      ],
    })
    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    try {
      expect(fallbackCalled).toBe(false)
    } finally {
      handle.dispose()
    }
  })
})

describe('clientOnly — hydrate (atomic swap)', () => {
  it('replaces server fallback DOM with render output', async () => {
    const Def = component<State, never, never>({
      name: 'HydrateSwap',
      init: () => [{ label: 'hi' }, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'host' }, [
          ...clientOnly<State, never>({
            render: () => [span({ class: 'real' }, [text('real widget')])],
            fallback: () => [span({ class: 'skeleton' }, [text('loading…')])],
          }),
        ]),
      ],
    })

    const env = await jsdomEnv()
    const serverHtml = renderToString(Def, { label: 'hi' }, env)
    const container = document.createElement('div')
    container.innerHTML = serverHtml
    document.body.appendChild(container)

    // Sanity: server HTML has the fallback
    expect(container.querySelector('.skeleton')).not.toBeNull()
    expect(container.querySelector('.real')).toBeNull()

    const handle = hydrateApp(container, Def, { label: 'hi' })
    try {
      // After hydrate: real replaces fallback, anchors are gone
      // (atomic swap discards server DOM entirely).
      expect(container.querySelector('.real')).not.toBeNull()
      expect(container.querySelector('.skeleton')).toBeNull()
      expect(container.innerHTML).not.toContain('llui-client-only-start')
    } finally {
      handle.dispose()
      container.remove()
    }
  })

  it('remains reactive after hydrate — render output updates on state change', async () => {
    type S = { count: number }
    type M = { type: 'inc' }
    const Def = component<S, M, never>({
      name: 'Reactive',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ count: state.count + 1 }, []]
        }
      },
      view: ({ send }) => [
        div({ class: 'host' }, [
          ...clientOnly<S, M>({
            render: ({ text: t }) => [span({ class: 'real' }, [t((s: S) => `count:${s.count}`)])],
            fallback: () => [span({ class: 'skeleton' }, [text('skel')])],
          }),
        ]),
      ],
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
    })

    const env = await jsdomEnv()
    const html = renderToString(Def, { count: 3 }, env)
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    const handle = hydrateApp(container, Def, { count: 3 })
    try {
      expect(container.querySelector('.real')!.textContent).toBe('count:3')
      handle.send({ type: 'inc' })
      handle.flush()
      expect(container.querySelector('.real')!.textContent).toBe('count:4')
    } finally {
      handle.dispose()
      container.remove()
    }
  })
})

describe('clientOnly — bag.clientOnly (destructured form)', () => {
  it('emits the same SSR output as the imported primitive', async () => {
    const DefBag = component<State, never, never>({
      name: 'FromBag',
      init: () => [{ label: 'x' }, []],
      update: (s) => [s, []],
      view: ({ clientOnly: co }) => [
        div({ class: 'host' }, [
          ...co({
            render: () => [span({ class: 'real' })],
            fallback: () => [span({ class: 'skeleton' })],
          }),
        ]),
      ],
    })
    const env = await jsdomEnv()
    const html = renderToString(DefBag, undefined, env)
    expect(html).toContain('<!--llui-client-only-start-->')
    expect(html).toContain('class="skeleton"')
    expect(html).not.toContain('class="real"')
  })

  it('runs render on the client when called through the bag', () => {
    const DefBag = component<State, never, never>({
      name: 'BagClientMount',
      init: () => [{ label: 'x' }, []],
      update: (s) => [s, []],
      view: ({ clientOnly: co }) => [
        div({}, [
          ...co({
            render: () => [span({ class: 'real' })],
            fallback: () => [span({ class: 'skeleton' })],
          }),
        ]),
      ],
    })
    const container = document.createElement('div')
    const handle = mountApp(container, DefBag)
    try {
      expect(container.querySelector('.real')).not.toBeNull()
      expect(container.querySelector('.skeleton')).toBeNull()
    } finally {
      handle.dispose()
    }
  })
})

describe('__clientOnlyStub — emitted by the use-client directive', () => {
  it('produces a ComponentDef that emits clientOnly anchors during SSR', async () => {
    const StubbedWidget = __clientOnlyStub('MapWidget')
    type HostState = { x: number }
    const Host = component<HostState, never, never>({
      name: 'Host',
      init: () => [{ x: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'host' }, [...child({ def: StubbedWidget, key: 'map', props: () => ({}) })]),
      ],
    })
    const env = await jsdomEnv()
    const html = renderToString(Host, undefined, env)
    expect(html).toContain('<!--llui-client-only-start-->')
    expect(html).toContain('<!--llui-client-only-end-->')
  })

  it('the stub has the configured name for debugging', () => {
    const s = __clientOnlyStub('ExampleName')
    expect(s.name).toBe('ExampleName')
  })
})

describe('clientOnly — browserEnv for SSR edge case', () => {
  it('runs render immediately when SSR is called with browserEnv (user-opt-in)', () => {
    // When the user explicitly passes browserEnv to renderToString, they're
    // signaling "live browser runtime" — the primitive honors that and runs
    // render. Consistent with how `isBrowser` declares intent on the env.
    const Def = component<State, never, never>({
      name: 'BrowserEnvSSR',
      init: () => [{ label: 'x' }, []],
      update: (s) => [s, []],
      view: () => [
        div({}, [
          ...clientOnly<State, never>({
            render: () => [span({ class: 'real' }, [text('ran')])],
            fallback: () => [span({ class: 'skeleton' })],
          }),
        ]),
      ],
    })
    const html = renderToString(Def, undefined, browserEnv())
    expect(html).toContain('class="real"')
    expect(html).not.toContain('class="skeleton"')
    expect(html).not.toContain('llui-client-only-start')
  })
})
