// #240 — anonymous head entries are keyed by an ordinal, and the ordinal used to be
// per BUILD. An isolated instance (`island`, or an adapter mounting a nested layer in
// its own pass) starts a fresh build, so its Nth anonymous `<style>`/`<script>` minted
// the same key as the host's Nth and one silently overwrote the other.
//
// The ordinal is now namespaced per OWNING INSTANCE: the root mints `1`, `2`, …; the
// first island placed in that build mints `i1/1`, `i1/2`, …; an island inside THAT one
// mints `i1/i1/1`. The namespace is allocated at PLACEMENT (during the host's build),
// which happens in the same document order on the server and on the client — so the
// two sides still agree key-for-key, which is what hydration's `data-llui-head`
// adoption rests on.
import { describe, it, expect } from 'vitest'
import { renderNodes } from '../../src/signals/ssr'
import { mountSignalComponent } from '../../src/signals/component'
import { component, div, each } from '../../src/signals/authoring'
import { collectHeadSink, style, HEAD_SINK } from '../../src/signals/head'
import { signalIsland as island } from '../../src/signals/island'
import type { CollectHeadSink } from '../../src/signals/head'
import type { SignalComponentDef } from '../../src/signals/component'

type Inert = { type: 'noop' }

/** Every collected head entry as `[key, text]`, sorted — the shape #240 reports in. */
function entries(sink: CollectHeadSink): Array<[string, string]> {
  const { head } = sink.serialize(document)
  const host = document.createElement('div')
  host.innerHTML = head
  return [...host.children]
    .map((el): [string, string] => [el.getAttribute('data-llui-head') ?? '', el.textContent ?? ''])
    .sort((a, b) => a[0].localeCompare(b[0]))
}

/** Server-render `def` into a fresh collector and read its entries. */
function serverEntries<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  extraContexts?: ReadonlyMap<symbol, unknown>,
): Array<[string, string]> {
  const sink = collectHeadSink()
  const contexts = new Map<symbol, unknown>([[HEAD_SINK.id, sink]])
  if (extraContexts) for (const [k, v] of extraContexts) contexts.set(k, v)
  const { dispose } = renderNodes(def, undefined, document, contexts)
  const out = entries(sink) // serialize BEFORE dispose (release)
  dispose()
  return out
}

/** Client-mount `def` into a fresh collector and read its entries. */
function clientEntries<S, M, E>(def: SignalComponentDef<S, M, E>): Array<[string, string]> {
  const sink = collectHeadSink()
  const container = document.createElement('div')
  const handle = mountSignalComponent(container, def, {
    contexts: new Map<symbol, unknown>([[HEAD_SINK.id, sink]]),
  })
  const out = entries(sink)
  handle.dispose()
  return out
}

describe('#240 — anonymous head keys are namespaced per owning instance', () => {
  it('a host and its island mint DISTINCT keys and both entries survive (server === client)', () => {
    const Island = component<{ n: number }, Inert>({
      name: 'Island',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [div({ class: 'island' }, []), style('/* ISLAND */')],
    })
    const Page = component<{ shell: string }, Inert>({
      name: 'Page',
      init: () => ({ shell: 's' }),
      update: (s) => s,
      view: () => [
        style('/* HOST */'),
        div({ class: 'shell' }, [island<{ n: number }, Inert>({ def: Island })]),
      ],
    })

    const server = serverEntries(Page)
    const client = clientEntries(Page)

    // Both entries survive — the collision dropped one of them entirely.
    expect(server).toEqual([
      ['style:#1', '/* HOST */'],
      ['style:#i1/1', '/* ISLAND */'],
    ])
    // …and the two sides agree key-for-key, which hydration's adoption rests on.
    expect(client).toEqual(server)
  })

  it('nested islands: three levels of anonymous entries, all distinct, server === client', () => {
    const Inner = component<{ n: number }, Inert>({
      name: 'Inner',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [div({ class: 'inner' }, []), style('/* INNER */')],
    })
    const Outer = component<{ n: number }, Inert>({
      name: 'Outer',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        style('/* OUTER */'),
        div({ class: 'outer' }, [island<{ n: number }, Inert>({ def: Inner })]),
      ],
    })
    const Page = component<{ shell: string }, Inert>({
      name: 'Page',
      init: () => ({ shell: 's' }),
      update: (s) => s,
      view: () => [
        style('/* HOST */'),
        div({ class: 'shell' }, [island<{ n: number }, Inert>({ def: Outer })]),
      ],
    })

    const server = serverEntries(Page)
    expect(server).toEqual([
      ['style:#1', '/* HOST */'],
      ['style:#i1/1', '/* OUTER */'],
      ['style:#i1/i1/1', '/* INNER */'],
    ])
    expect(clientEntries(Page)).toEqual(server)
  })

  it('sibling islands under one host get their own namespaces, and each numbers from 1', () => {
    const Leaf = component<{ n: number }, Inert>({
      name: 'Leaf',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [style('/* A */'), style('/* B */')],
    })
    const Page = component<{ shell: string }, Inert>({
      name: 'Page',
      init: () => ({ shell: 's' }),
      update: (s) => s,
      view: () => [
        style('/* HOST-1 */'),
        div({ class: 'a' }, [island<{ n: number }, Inert>({ def: Leaf })]),
        style('/* HOST-2 */'),
        div({ class: 'b' }, [island<{ n: number }, Inert>({ def: Leaf })]),
      ],
    })

    const server = serverEntries(Page)
    expect(server).toEqual([
      ['style:#1', '/* HOST-1 */'],
      ['style:#2', '/* HOST-2 */'],
      ['style:#i1/1', '/* A */'],
      ['style:#i1/2', '/* B */'],
      ['style:#i2/1', '/* A */'],
      ['style:#i2/2', '/* B */'],
    ])
    // The client mounts the islands from `runMounts`, AFTER the host build has
    // finished — so the host's own second entry is minted before either island's
    // first on the client and after them on the server. Namespacing is what makes
    // the two orders produce the same key set.
    expect(clientEntries(Page)).toEqual(server)
  })

  it('the ADAPTER seam namespaces a whole instance, on both a container mount and a render', () => {
    // The seam `island` uses internally is public, because an island is not the only
    // way two instances end up sharing one document/head sink: an adapter that mounts
    // a chain of layers in separate passes (`@llui/vike`) has the identical shape, and
    // two independent `mountApp` roots in one page are the same problem again — the
    // default namespace is UNPREFIXED, so two roots that take it collide exactly as a
    // host and its island used to. Naming each instance is the fix, and it must work
    // on the CONTAINER mount path and the server render, neither of which any island
    // takes (an island mounts at an ANCHOR).
    const Widget = component<{ n: number }, Inert>({
      name: 'Widget',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [style('/* WIDGET */'), style('/* SECOND */')],
    })

    // Server: one collector, two renders, distinct namespaces.
    const sink = collectHeadSink()
    const contexts = new Map<symbol, unknown>([[HEAD_SINK.id, sink]])
    const a = renderNodes(Widget, undefined, document, contexts)
    const b = renderNodes(Widget, undefined, document, contexts, 'L1')
    const server = entries(sink)
    a.dispose()
    b.dispose()
    expect(server).toEqual([
      ['style:#1', '/* WIDGET */'],
      ['style:#2', '/* SECOND */'],
      ['style:#L1/1', '/* WIDGET */'],
      ['style:#L1/2', '/* SECOND */'],
    ])

    // Client: one sink, two CONTAINER mounts, same key set.
    const clientSink = collectHeadSink()
    const clientContexts = new Map<symbol, unknown>([[HEAD_SINK.id, clientSink]])
    const first = mountSignalComponent(document.createElement('div'), Widget, {
      contexts: clientContexts,
    })
    const second = mountSignalComponent(document.createElement('div'), Widget, {
      contexts: clientContexts,
      headNamespace: 'L1',
    })
    expect(entries(clientSink)).toEqual(server)
    first.dispose()
    second.dispose()
  })

  it('an island inside an `each` row gets one namespace per ROW (server === client)', () => {
    const Leaf = component<{ n: number }, Inert>({
      name: 'Leaf',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [style('/* ROW */')],
    })
    const Page = component<{ rows: Array<{ id: string }> }, Inert>({
      name: 'Page',
      init: () => ({ rows: [{ id: 'a' }, { id: 'b' }] }),
      update: (s) => s,
      view: ({ state }) => [
        style('/* HOST */'),
        each(state.at('rows'), {
          key: (r) => r.id,
          render: () => [div({ class: 'row' }, [island<{ n: number }, Inert>({ def: Leaf })])],
        }),
      ],
    })

    const server = serverEntries(Page)
    expect(server.map(([k]) => k)).toEqual(['style:#1', 'style:#i1/1', 'style:#i2/1'])
    expect(clientEntries(Page)).toEqual(server)
  })
})
