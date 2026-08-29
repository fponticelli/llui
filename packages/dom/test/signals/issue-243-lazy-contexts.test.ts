// #243 — `lazy()` mounts an ISOLATED component instance, so nothing reaches it
// implicitly: it builds under a fresh `runBuild` with no parent build on the stack.
// It used to forward NO `contexts` at all, so every ancestor `provide()` was lost —
// silently, with no error and no warning. This is #231's defect one primitive over.
//
// The distinction the tests below exist to pin is PLACEMENT vs MOUNT TIME. `provide`
// is immutable-by-swap: it installs a map for the duration of its synchronous
// `render()` and restores the PARENT map reference afterwards. `lazy`'s mount is a
// promise continuation, so a snapshot taken there sees a map with no ancestor
// `provide` in it. Taking it at placement is the only thing that works, and the
// LAZILY-BUILT placements (an arm toggled on after mount, a row appended after
// mount) are where a mount-time read differs most visibly from a placement read.
import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import type { SignalComponentDef } from '../../src/signals/component'
import { component, div, each, lazy, show, text } from '../../src/signals/authoring'
import { createContext, provide, useContext } from '../../src/signals/context'
import { collectHeadSink, style, HEAD_SINK } from '../../src/signals/head'
import type { CollectHeadSink } from '../../src/signals/head'

/** A microtask tick — lets a resolved loader promise settle. */
const tick = (): Promise<void> => Promise.resolve().then(() => {})

const Theme = createContext('DEFAULT', 'theme')
const Locale = createContext('en', 'locale')
const Density = createContext('comfy', 'density')

type Inert = { type: 'noop' }

/** Reads all three contexts at BUILD time — i.e. inside the isolated instance's own
 * `runBuild`, which is the build that must see the placing build's map. */
const Leaf = component<{ n: number }, Inert>({
  name: 'Leaf',
  init: () => ({ n: 0 }),
  update: (s) => s,
  view: () => [
    div({ class: 'leaf' }, [
      text(`${useContext(Theme)}/${useContext(Locale)}/${useContext(Density)}`),
    ]),
  ],
})

const loadLeaf = (): Promise<SignalComponentDef<{ n: number }, Inert>> => Promise.resolve(Leaf)

const leafText = (container: Element): string | undefined =>
  container.querySelector('.leaf')?.textContent ?? undefined

describe('#243 — lazy() forwards the placing build’s contexts', () => {
  it('inherits the context values provided by the placing build', async () => {
    const container = document.createElement('div')
    const Host = component<{ label: string }, Inert>({
      init: () => ({ label: 'p' }),
      update: (s) => s,
      view: () => [
        provide(Theme, 'PROVIDED', () => [
          lazy<{ n: number }, Inert, never>({ loader: loadLeaf, fallback: () => [text('…')] }),
        ]),
      ],
    })
    const host = mountSignalComponent(container, Host)
    await tick()
    expect(leafText(container)).toBe('PROVIDED/en/comfy')
    host.dispose()
  })

  it('merges an explicit contexts map OVER the inherited one (never replacing it)', async () => {
    const container = document.createElement('div')
    const explicit = new Map<symbol, unknown>([
      [Locale.id, 'it'], // overrides the inherited value
      [Density.id, 'compact'], // adds one no ancestor provided
    ])
    const Host = component<{ label: string }, Inert>({
      init: () => ({ label: 'p' }),
      update: (s) => s,
      view: () => [
        provide(Theme, 'PROVIDED', () => [
          provide(Locale, 'fr', () => [
            lazy<{ n: number }, Inert, never>({
              loader: loadLeaf,
              fallback: () => [text('…')],
              contexts: explicit,
            }),
          ]),
        ]),
      ],
    })
    const host = mountSignalComponent(container, Host)
    await tick()
    // Theme survives (inherited, never named explicitly) — a REPLACE loses it.
    // Locale is the explicit value, not the inherited 'fr'. Density is added.
    expect(leafText(container)).toBe('PROVIDED/it/compact')
    host.dispose()
  })

  // ── The lazily-BUILT placements ───────────────────────────────────
  // Each of these provides TWO values, and the two halves measure different things.
  //
  // The OUTER `provide` (Theme) wraps the structural primitive itself. It proves the
  // value survives the threading `show`/`each` do: the arm/row is built long after
  // the host's `provide()` returned, so the only map still carrying it is the one the
  // primitive captured at its own placement — and `lazy` must read THAT map.
  //
  // The INNER `provide` (Locale) sits inside the arm/row body, so the swap-and-restore
  // happens in the arm's OWN build ctx. That is the half that separates placement from
  // mount time: an outer-provide-only fixture is satisfied by a mount-time read too,
  // because the arm ctx's map is seeded once and never swapped back. Measured — with
  // the snapshot moved into the deferred mount, an outer-only version of these two
  // tests stays GREEN while both of these go red.

  it('inherits through a `show` arm toggled ON after mount', async () => {
    const container = document.createElement('div')
    const Host = component<{ open: boolean }, { type: 'open' }>({
      init: () => ({ open: false }),
      update: (s, m) => (m.type === 'open' ? { open: true } : s),
      view: ({ state }) => [
        provide(Theme, 'ARM', () => [
          show(state.at('open'), () => [
            provide(Locale, 'inner', () => [
              lazy<{ n: number }, Inert, never>({ loader: loadLeaf, fallback: () => [text('…')] }),
            ]),
          ]),
        ]),
      ],
    })
    const host = mountSignalComponent(container, Host)
    await tick()
    expect(container.querySelector('.leaf')).toBeNull() // arm is off

    host.send({ type: 'open' }) // arm builds NOW — the outer provide() long since returned
    await tick()
    expect(leafText(container)).toBe('ARM/inner/comfy')
    host.dispose()
  })

  it('inherits through an `each` row appended after mount', async () => {
    const container = document.createElement('div')
    interface Row {
      id: string
    }
    const Host = component<{ rows: Row[] }, { type: 'add' }>({
      init: () => ({ rows: [] }),
      update: (s, m) => (m.type === 'add' ? { rows: [...s.rows, { id: 'r1' }] } : s),
      view: ({ state }) => [
        provide(Theme, 'ROW', () => [
          each(state.at('rows'), {
            key: (r) => r.id,
            // Wrapped in an element: a bare isolated instance is not a valid row
            // root (see #239). The wrap is irrelevant to what this test measures.
            render: () => [
              div({ class: 'row' }, [
                provide(Locale, 'inner', () => [
                  lazy<{ n: number }, Inert, never>({
                    loader: loadLeaf,
                    fallback: () => [text('…')],
                  }),
                ]),
              ]),
            ],
          }),
        ]),
      ],
    })
    const host = mountSignalComponent(container, Host)
    await tick()
    expect(container.querySelector('.leaf')).toBeNull() // no rows yet

    host.send({ type: 'add' }) // the row builds NOW
    await tick()
    expect(leafText(container)).toBe('ROW/inner/comfy')
    host.dispose()
  })

  // ── The HEAD_SINK half ────────────────────────────────────────────
  // A seeded `HEAD_SINK` is a context like any other, so the same miss made a lazy
  // child's head entries resolve their sink to `null` and vanish. This is the half
  // an i18n test cannot see: nothing renders wrong, the entry is simply absent.

  /** Every collected head entry as `[key, text]`, sorted. */
  const entries = (sink: CollectHeadSink): Array<[string, string]> => {
    const { head } = sink.serialize(document)
    const probe = document.createElement('div')
    probe.innerHTML = head
    return [...probe.children]
      .map((el): [string, string] => [
        el.getAttribute('data-llui-head') ?? '',
        el.textContent ?? '',
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  }

  it("an id-keyed head entry from a lazy child reaches the host's seeded collector", async () => {
    const StyledLeaf = component<{ n: number }, Inert>({
      name: 'StyledLeaf',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [div({ class: 'leaf' }, []), style('/* LAZY */', { id: 'lazy-marker' })],
    })
    const Host = component<{ label: string }, Inert>({
      init: () => ({ label: 'p' }),
      update: (s) => s,
      view: () => [
        style('/* HOST */', { id: 'host-marker' }),
        div({ class: 'shell' }, [
          lazy<{ n: number }, Inert, never>({
            loader: () => Promise.resolve(StyledLeaf),
            fallback: () => [text('…')],
          }),
        ]),
      ],
    })

    const sink = collectHeadSink()
    const container = document.createElement('div')
    const host = mountSignalComponent(container, Host, {
      contexts: new Map<symbol, unknown>([[HEAD_SINK.id, sink]]),
    })
    await tick()

    // BOTH entries. Before the fix the sink held only the host's: the lazy child
    // resolved `HEAD_SINK` to its default (`null`) and fell back to the live
    // `document.head`, so the collector never saw it at all.
    expect(entries(sink)).toEqual([
      ['style:id=host-marker', '/* HOST */'],
      ['style:id=lazy-marker', '/* LAZY */'],
    ])
    host.dispose()
  })

  // ── The error arm is NOT the isolated instance ────────────────────
  // `opts.error(e)` is HOST view code built as an arm in the host's own scope, so it
  // takes the placing build's map and NOT the caller's `contexts`, which are declared
  // as extras for the loaded component. Both directions are pinned here: the arm still
  // sees what its ancestors provided, and it does not see the explicit extras.

  it('the error arm inherits the placing map but NOT the explicit `contexts`', async () => {
    const container = document.createElement('div')
    const Host = component<{ label: string }, Inert>({
      init: () => ({ label: 'p' }),
      update: (s) => s,
      view: () => [
        provide(Theme, 'PROVIDED', () => [
          lazy<{ n: number }, Inert, never>({
            loader: () => Promise.reject(new Error('boom')),
            fallback: () => [text('…')],
            contexts: new Map<symbol, unknown>([
              [Theme.id, 'FOR-THE-INSTANCE'],
              [Density.id, 'FOR-THE-INSTANCE'],
            ]),
            error: () => [
              div({ class: 'err' }, [
                text(`${useContext(Theme)}/${useContext(Locale)}/${useContext(Density)}`),
              ]),
            ],
          }),
        ]),
      ],
    })
    const host = mountSignalComponent(container, Host)
    await tick()
    // Theme is the INHERITED 'PROVIDED', not the explicit override; Density is the
    // context default, not the explicit addition.
    expect(container.querySelector('.err')?.textContent).toBe('PROVIDED/en/comfy')
    host.dispose()
  })
})
