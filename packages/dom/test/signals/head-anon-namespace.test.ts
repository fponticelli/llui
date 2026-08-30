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
import { describe, it, expect, vi } from 'vitest'
import { renderNodes } from '../../src/signals/ssr'
import { mountSignalComponent } from '../../src/signals/component'
import { component, div, each, show, text } from '../../src/signals/authoring'
import { collectHeadSink, style, HEAD_SINK } from '../../src/signals/head'
import { signalIsland as island } from '../../src/signals/island'
import { signalLazy as lazy } from '../../src/signals/lazy'
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
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/** The same shape, read off a LIVE `document.head` (the per-document fallback sink). */
function liveHead(doc: Document): Array<[string, string]> {
  return [...doc.head.querySelectorAll('[data-llui-head]')]
    .map((el): [string, string] => [el.getAttribute('data-llui-head') ?? '', el.textContent ?? ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
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
      ['style:#~1/1', '/* ISLAND */'],
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
      ['style:#~1/1', '/* OUTER */'],
      ['style:#~1/~1/1', '/* INNER */'],
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
      ['style:#~1/1', '/* A */'],
      ['style:#~1/2', '/* B */'],
      ['style:#~2/1', '/* A */'],
      ['style:#~2/2', '/* B */'],
    ])
    // The client mounts the islands from `runMounts`, AFTER the host build has
    // finished — so the host's own second entry is minted before either island's
    // first on the client and after them on the server. Namespacing is what makes
    // the two orders produce the same key set.
    expect(clientEntries(Page)).toEqual(server)
  })

  it('allocates at PLACEMENT, not at mount — an arm island numbers after its flat siblings', () => {
    // THE most load-bearing decision in the fix, and the one a reader is most likely to
    // "simplify" away: the namespace is allocated in the placing build, NOT in the
    // deferred mount callback. This shape is where the two differ. A `show` arm is
    // BUILT during the mount pass, after the whole top-level build has finished — so by
    // PLACEMENT order the two flat islands take `i1`/`i2` and the arm's island takes
    // `i3` on BOTH sides, while by MOUNT order the client interleaves them differently
    // and mints a key set the server never produced. Same key, different content, which
    // is hydration adopting the wrong tag.
    const Leaf = (marker: string) =>
      component<{ n: number }, Inert>({
        name: 'Leaf',
        init: () => ({ n: 0 }),
        update: (s) => s,
        view: () => [style(marker)],
      })
    const Page = component<{ open: boolean }, Inert>({
      name: 'Page',
      init: () => ({ open: true }),
      update: (s) => s,
      view: ({ state }) => [
        div({ class: 'a' }, [island<{ n: number }, Inert>({ def: Leaf('/* FLAT-1 */') })]),
        show(state.at('open'), () => [
          div({ class: 'arm' }, [island<{ n: number }, Inert>({ def: Leaf('/* ARM */') })]),
        ]),
        div({ class: 'c' }, [island<{ n: number }, Inert>({ def: Leaf('/* FLAT-2 */') })]),
      ],
    })

    const server = serverEntries(Page)
    expect(server).toEqual([
      ['style:#~1/1', '/* FLAT-1 */'],
      ['style:#~2/1', '/* FLAT-2 */'],
      ['style:#~3/1', '/* ARM */'],
    ])
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

  it('`lazy` is an isolated instance too — its loaded component gets its own namespace', async () => {
    // `lazy` mounts an isolated instance exactly as `island` does, so it had the SAME
    // defect: unnamespaced, the loaded component's first anonymous `<style>` took
    // `style:#1` and the HOST's entry disappeared. Measured before the fix, with the
    // island version of this shape as the control:
    //   island : [["style:#1","/* HOST */"],["style:#~1/1","/* CHILD */"]]  ← both live
    //   lazy   : [["style:#1","/* CHILD */"]]                               ← host GONE
    const Loaded = component<{ n: number }, Inert>({
      name: 'Loaded',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [style('/* LAZY-CHILD */')],
    })
    const Sibling = component<{ n: number }, Inert>({
      name: 'Sibling',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [style('/* SIBLING */')],
    })
    const Page = component<{ shell: string }, Inert>({
      name: 'Page',
      init: () => ({ shell: 's' }),
      update: (s) => s,
      view: () => [
        style('/* HOST */'),
        div({ class: 'l' }, [lazy({ loader: async () => Loaded, fallback: () => [text('…')] })]),
        div({ class: 's' }, [island<{ n: number }, Inert>({ def: Sibling })]),
      ],
    })

    // The server renders NOTHING for a lazy (the loader cannot settle in a synchronous
    // render) — but it must still ALLOCATE the namespace at placement, or the sibling
    // island numbers `i1` server-side and `i2` client-side and its key stops matching.
    const server = serverEntries(Page)
    expect(server).toEqual([
      ['style:#1', '/* HOST */'],
      ['style:#~2/1', '/* SIBLING */'],
    ])

    // The client half is read off a REAL `document.head`, not a collector: this mount
    // SEEDS NO `HEAD_SINK` AT ALL, so the loaded component resolves the context to its
    // `null` default and writes to the per-document fallback sink. That is the sink the
    // host falls back to as well, which is exactly why the two collided. Note the cause:
    // `lazy` DOES forward the placing build's contexts (#243) — there is simply nothing
    // here to forward, which is what makes this assertion independent of #243.
    const doc = document.implementation.createHTMLDocument('lazy-ns')
    const container = doc.createElement('div')
    doc.body.appendChild(container)
    const handle = mountSignalComponent(container as unknown as Element, Page)
    for (let i = 0; i < 20 && liveHead(doc).length < 3; i++) {
      await new Promise((r) => setTimeout(r, 2))
    }
    const client = liveHead(doc)
    handle.dispose()

    // All three survive, and every key the SERVER emitted means the same thing here.
    expect(client).toEqual([
      ['style:#1', '/* HOST */'],
      ['style:#~1/1', '/* LAZY-CHILD */'],
      ['style:#~2/1', '/* SIBLING */'],
    ])
    for (const [key, text_] of server) expect(client).toContainEqual([key, text_])
  })

  it('WARNS in dev when an anonymous key is claimed while another writer holds it', () => {
    // The other half of the fix, on the items-seam precedent: namespacing removes the
    // collision everywhere the runtime can name an instance, but two `mountApp` roots
    // that name NEITHER still overwrite each other and nothing can name them
    // automatically. Containment without visibility is what made #240 invisible for as
    // long as it was, so the residue is REPORTED rather than left silent.
    const Widget = component<{ n: number }, Inert>({
      name: 'Widget',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [style('/* ANON */')],
    })
    const sink = collectHeadSink()
    const contexts = new Map<symbol, unknown>([[HEAD_SINK.id, sink]])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const a = renderNodes(Widget, undefined, document, contexts)
      expect(warn).not.toHaveBeenCalled() // first writer: nothing to collide with
      const b = renderNodes(Widget, undefined, document, contexts)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('style:#1')
      expect(String(warn.mock.calls[0]?.[0])).toContain('headNamespace')
      a.dispose()
      b.dispose()

      // …and NOT when the same pair is namespaced — the cure silences the report.
      warn.mockClear()
      const c = renderNodes(Widget, undefined, document, contexts)
      const d = renderNodes(Widget, undefined, document, contexts, 'admin')
      expect(warn).not.toHaveBeenCalled()
      c.dispose()
      d.dispose()
    } finally {
      warn.mockRestore()
    }
  })

  it('does NOT warn for a NAMED entry, whose stacking is the documented behaviour', () => {
    // One-direction, deliberately: a named entry (`title`, a `meta` with a `name`, a
    // `style` with an `id`) is SUPPOSED to stack — a nested page overriding its
    // layout's title is the feature. Only an anonymous key, whose two writers are two
    // different tags that an ordinal happened to name alike, is a defect.
    // The `id` deliberately CONTAINS a `#`. Anonymity is the key's SHAPE
    // (`<tag>:#<ordinal>`), not the presence of a `#` anywhere in it — an `id` is
    // caller-supplied, so `style:id=a#b` reads as anonymous to a substring test and gets
    // reported for stacking exactly as it is supposed to. A plain `id: 'theme'` cannot
    // reach that path, which is why this fixture does not use one.
    const Titled = component<{ n: number }, Inert>({
      name: 'Titled',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [style('/* KEYED */', { id: 'theme' }), style('/* HASHED */', { id: 'a#b' })],
    })
    const sink = collectHeadSink()
    const contexts = new Map<symbol, unknown>([[HEAD_SINK.id, sink]])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const a = renderNodes(Titled, undefined, document, contexts)
      const b = renderNodes(Titled, undefined, document, contexts)
      expect(warn).not.toHaveBeenCalled()
      // …and the keys really were the named ones, so the silence is not vacuous.
      expect([...sink.serialize(document).keys].sort()).toEqual(['style:id=a#b', 'style:id=theme'])
      a.dispose()
      b.dispose()
    } finally {
      warn.mockRestore()
    }
  })

  it('REJECTS a headNamespace that could land in another instance’s key space', () => {
    const Widget = component<{ n: number }, Inert>({
      name: 'Widget',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [style('/* ANON */')],
    })
    const mount = (ns: string) => () =>
      mountSignalComponent(document.createElement('div'), Widget, { headNamespace: ns })

    // '' IS the root namespace — accepting it would make "I named my second root" a
    // silent no-op, which is worse than the collision it was meant to fix.
    expect(mount('')).toThrow(/not a valid head namespace/)
    // `~` is the runtime's own marker: a caller must not be able to smuggle it into a
    // name of their own.
    expect(mount('a~b')).toThrow(/not a valid head namespace/)
    expect(mount('~1x')).toThrow(/not a valid head namespace/)
    // `/` is the nesting separator — this one reaches INTO another instance's subtree.
    expect(mount('app/i1')).toThrow(/not a valid head namespace/)
    expect(mount('app/')).toThrow(/not a valid head namespace/)

    // A plain name is fine — including one an `i`-prefixed auto scheme would have
    // claimed, which is the whole point of the `~` marker.
    for (const ok of ['admin', 'i1', 'L1']) {
      const h = mount(ok)()
      h.dispose()
    }

    // THE ONE RESIDUAL, pinned rather than claimed closed: a bare `~<n>` IS what an
    // island directly under a root is handed, so it is accepted and a caller who writes
    // it lands in that island's key space. It is NOT unclosable — the runtime's own
    // allocation is routed through the same PUBLIC `headNamespace` string, and giving it
    // an internal channel instead (a second internal parameter, or a `trusted` flag on
    // the already-internal `headAnonScope`) would let the public path reject every `~`
    // outright, with no exported type and no change to the key format. It is left open
    // as a judgement about cost: `~1` is not a name anyone writes by accident — unlike
    // `i1`, which is why the marker is `~` and not `i` — and the dev-mode warning above
    // reports it if it ever happens.
    const smuggled = mount('~1')()
    smuggled.dispose()
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
    expect(server.map(([k]) => k)).toEqual(['style:#1', 'style:#~1/1', 'style:#~2/1'])
    expect(clientEntries(Page)).toEqual(server)
  })
})
