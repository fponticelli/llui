import { describe, it, expect, vi } from 'vitest'
import { renderToString } from '../../src/signals/ssr'
import { hydrateSignalApp, mountSignalComponent } from '../../src/signals/component'
import { component, div, each, text } from '../../src/signals/authoring'
import { createContext, provide, useContext } from '../../src/signals/context'
import { onMount } from '../../src/signals/build-context'
import { derived } from '../../src/signals/handle'
import { subApp } from '../../src/signals/escape-hatch'
import type { Renderable } from '../../src/signals/element'
import type { SignalComponentHandle } from '../../src/signals/component'

// An isolated instance used to bail on `c.ssr` and emit a bare `<!--subApp-->`, so
// its whole subtree was missing from the server HTML: a post-hydration pop-in, and
// nothing at all without JS. It now renders a real body — a build plus one mount
// against the seed state, with no update loop, no effects and no mount lifecycle.

interface LeafState {
  count: number
  label: string
}
type LeafMsg = { type: 'inc' }

const Leaf = component<LeafState, LeafMsg>({
  name: 'Leaf',
  init: () => ({ count: 3, label: 'leaf' }),
  update: (s, m) => (m.type === 'inc' ? { ...s, count: s.count + 1 } : s),
  view: ({ state }) => [div({ class: 'leaf' }, [text(state.at('count').map((c) => `c${c}`))])],
})

interface HostState {
  shell: string
}
type HostMsg = { type: 'noop' }

/** A host whose view is a shell div plus whatever island `body` places. */
function hostWith(body: () => Renderable) {
  return component<HostState, HostMsg>({
    name: 'Host',
    init: () => ({ shell: 'shell' }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 'shell' }, [text(state.at('shell'))]), ...body()],
  })
}

type Inert = { type: 'noop' }

describe('subApp under SSR', () => {
  it('renders the isolated view into the server HTML (not just an anchor)', () => {
    const Host = hostWith(() => subApp<LeafState, LeafMsg>({ reason: 'test: ssr body', def: Leaf }))
    const html = renderToString(Host, undefined, document)
    expect(html).toBe('<div class="shell">shell</div><!--subApp--><div class="leaf">c3</div>')
  })

  it('bakes the seed state in, including an explicit initialState', () => {
    const Host = hostWith(() =>
      subApp<LeafState, LeafMsg>({
        reason: 'test: ssr seed',
        def: Leaf,
        initialState: { count: 41, label: 'seeded' },
      }),
    )
    expect(renderToString(Host, undefined, document)).toContain('<div class="leaf">c41</div>')
  })

  it('inherits the placing build context into the server body', () => {
    const Theme = createContext('DEFAULT', 'theme')
    const Themed = component<{ n: number }, Inert>({
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [div({ class: 'themed' }, [text(useContext(Theme))])],
    })
    const Host = component<HostState, HostMsg>({
      init: () => ({ shell: 's' }),
      update: (s) => s,
      view: () => [
        provide(Theme, 'PROVIDED', () => [
          ...subApp<{ n: number }, Inert>({ reason: 'test: ssr ctx', def: Themed }),
        ]),
      ],
    })
    expect(renderToString(Host, undefined, document)).toContain(
      '<div class="themed">PROVIDED</div>',
    )
  })

  it('does not run the isolated view onMount on the server (the marker still emits)', () => {
    const ran = vi.fn()
    const Mounty = component<{ n: number }, Inert>({
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [div({ class: 'mounty' }, []), onMount(ran)],
    })
    const Host = hostWith(() =>
      subApp<{ n: number }, Inert>({ reason: 'test: ssr onMount', def: Mounty }),
    )
    const html = renderToString(Host, undefined, document)
    expect(ran).not.toHaveBeenCalled()
    expect(html).toContain('<!--onMount-->')
  })

  it('discards the isolated init()s effects (the server does not run them)', () => {
    const onEffect = vi.fn()
    const Effectful = component<{ n: number }, Inert, { type: 'boot' }>({
      init: () => [{ n: 0 }, [{ type: 'boot' }]],
      update: (s) => s,
      view: () => [div({ class: 'fx' }, [])],
      onEffect,
    })
    const Host = hostWith(() =>
      subApp<{ n: number }, Inert, { type: 'boot' }>({
        reason: 'test: ssr effects',
        def: Effectful,
      }),
    )
    expect(renderToString(Host, undefined, document)).toContain('<div class="fx">')
    expect(onEffect).not.toHaveBeenCalled()
  })

  it('renders an island placed inside an each row against the ISLAND state', () => {
    // The isolated build must NOT inherit the host build's `inRow`. The client
    // mount cannot inherit it — `mountSignalComponent` runs from `runMounts`, after
    // the host build has restored `ctx` to null — so a server build that does
    // renders something the client would never produce. `derived` is what makes
    // that observable: it is the one handle constructor that reads `__inRowBuild()`
    // at build time, and under an inherited `inRow` it rebases its
    // component-rooted inputs to `ctx.state` — a field the island's state has not
    // got, so every value resolves undefined.
    const DerivedLeaf = component<LeafState, LeafMsg>({
      init: () => ({ count: 3, label: 'leaf' }),
      update: (s) => s,
      view: ({ state }) => [
        div({ class: 'leaf' }, [
          text(derived(state.at('label'), state.at('count'), (l, c) => `${l}:${c}`)),
        ]),
      ],
    })
    const Rows = component<{ rows: Array<{ id: string }> }, Inert>({
      init: () => ({ rows: [{ id: 'a' }, { id: 'b' }] }),
      update: (s) => s,
      view: ({ state }) => [
        each(state.at('rows'), {
          key: (r) => r.id,
          render: (row) => [
            div({ class: 'row' }, [
              text(row.at('id')),
              ...subApp<LeafState, LeafMsg>({ reason: 'test: island in a row', def: DerivedLeaf }),
            ]),
          ],
        }),
      ],
    })
    const html = renderToString(Rows, undefined, document)
    expect(html).toContain('<div class="row">a<!--subApp--><div class="leaf">leaf:3</div></div>')
    expect(html).toContain('<div class="row">b<!--subApp--><div class="leaf">leaf:3</div></div>')

    // And it is exactly what the client produces.
    const fresh = document.createElement('div')
    const h = mountSignalComponent(fresh, Rows)
    expect(fresh.querySelectorAll('.leaf')).toHaveLength(2)
    for (const leaf of fresh.querySelectorAll('.leaf')) expect(leaf.textContent).toBe('leaf:3')
    h.dispose()
  })

  it('renders a nested island inside an island', () => {
    const Inner = component<{ n: number }, Inert>({
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [div({ class: 'inner' }, [text('in')])],
    })
    const Outer = component<{ n: number }, Inert>({
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        div({ class: 'outer' }, []),
        ...subApp<{ n: number }, Inert>({ reason: 'test: nested', def: Inner }),
      ],
    })
    const Host = hostWith(() => subApp<{ n: number }, Inert>({ reason: 'test: outer', def: Outer }))
    const html = renderToString(Host, undefined, document)
    expect(html).toContain('<div class="outer">')
    expect(html).toContain('<div class="inner">in</div>')
  })
})

describe('subApp SSR to hydration', () => {
  it('hydrates to exactly the fresh-client DOM, with one live instance', () => {
    let handle: SignalComponentHandle<LeafState, LeafMsg> | null = null
    const Host = hostWith(() =>
      subApp<LeafState, LeafMsg>({
        reason: 'test: hydrate',
        def: Leaf,
        onHandle: (h) => {
          handle = h
        },
      }),
    )

    // A fresh client mount is the oracle for what hydration must converge to.
    const fresh = document.createElement('div')
    const freshHandle = mountSignalComponent(fresh, Host)
    const freshHtml = fresh.innerHTML

    // Server render into a container, then hydrate over it.
    const container = document.createElement('div')
    container.innerHTML = renderToString(Host, undefined, document)
    // The server body IS there before hydration — which is what makes the count
    // below discriminating: a hydrate that claimed/appended instead of atomically
    // replacing would leave two `.leaf` nodes, not one.
    expect(container.querySelectorAll('.leaf')).toHaveLength(1)
    const hydrated = hydrateSignalApp(container, Host, { shell: 'shell' })

    expect(container.innerHTML).toBe(freshHtml)
    // The server body was REPLACED, not stacked beside the client one.
    expect(container.querySelectorAll('.leaf')).toHaveLength(1)
    expect(container.querySelector('.leaf')?.textContent).toBe('c3')

    // The real instance is live and independently driveable after hydration.
    expect(handle).not.toBeNull()
    handle!.send({ type: 'inc' })
    expect(container.querySelector('.leaf')?.textContent).toBe('c4')

    hydrated.dispose()
    freshHandle.dispose()
    expect(container.querySelector('.leaf')).toBeNull()
  })
})
