import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  each,
  eachDirect,
  virtualEach,
  branch,
  show,
  div,
  li,
  span,
  ul,
  text,
  p,
} from '../../src/signals/authoring'
import { derived } from '../../src/signals/handle'
import { signalEach } from '../../src/signals/each'
import { el, signalText } from '../../src/signals/dom'
import type { Signal } from '../../src/signals/types'

// #165 — the items seam, and the mount boundary behind it.
//
// `mask.ts:resolveSegs` is explicitly undefined-safe: a path walk that runs off the
// end of the data returns `undefined` rather than throwing. `each`'s reconcile is
// ONE STEP further along that same path and used to be the single link that wasn't
// (`source.items(state).length`), so `each(sec.at('items'), …)` threw a TypeError
// where `.at()` had politely returned undefined.
//
// The throw then escaped `SignalScopeImpl.mount`, which ran its bindings in a
// try/catch-free loop, and ABANDONED THE DOCUMENT HALF-DRAWN: the reporting
// incident rendered a header, a section heading and an empty table, then nothing —
// no rows, no totals, no footer — reading as "this patient takes no medications"
// with correct, complete data and no error on screen.
//
// Three properties are pinned here:
//   1. the seam is TOTAL (`each` AND `virtualEach` render empty, never throw),
//   2. dev is LOUD about it (naming the primitive and the dep path) but says
//      nothing about a legitimately empty array,
//   3. a throwing binding is contained to ITSELF at mount — the rest of the
//      document still mounts, and the throw is reported, not swallowed.

interface Row {
  id: number
  name: string
}

function container(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  document.body.innerHTML = ''
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
  error.mockRestore()
})

const warnings = (): string[] => warn.mock.calls.map((args: unknown[]) => String(args[0]))

// ── Part 1: the seam is total ────────────────────────────────────────────────

describe('#165 part 1 — an absent items path renders empty instead of throwing', () => {
  // The reported shape exactly: the TYPE says `section.items` is there; the DATA
  // (a payload that arrived without it) does not, so `.at('items')` walks off the
  // end and produces `undefined`.
  interface S {
    section: { title: string; items: readonly Row[] }
  }
  const missingItems = (): S => ({
    section: { title: 'Medications' } as { title: string; items: readonly Row[] },
  })

  const def = (init: () => S) => ({
    name: 'Report',
    init,
    update: (s: S) => s,
    view: ({ state }: { state: Signal<S> }) => [
      el('h1', {}, ['Report']),
      ul([
        each(state.at('section').at('items'), {
          key: (r: Row) => r.id,
          render: (item: Signal<Row>) => [li([text(item.at('name'))])],
        }),
      ]),
      el('footer', {}, ['Totals']),
    ],
  })

  it('does not throw, renders an empty list, and still mounts the REST of the document', () => {
    const c = container()
    let h: ReturnType<typeof mountSignalComponent<S, never>> | null = null
    expect(() => {
      h = mountSignalComponent<S, never>(c, def(missingItems))
    }).not.toThrow()
    // The half-drawn document is the whole point: everything AFTER the list must
    // be present, not just everything before it.
    expect(c.querySelector('h1')?.textContent).toBe('Report')
    expect(c.querySelectorAll('li').length).toBe(0)
    expect(c.querySelector('footer')?.textContent).toBe('Totals')
    // The seam is TOTAL, not merely CAUGHT: nothing threw at all. Without this the
    // assertions above are satisfied by part 3's mount boundary containing the very
    // TypeError part 1 exists to prevent — the fix would look green while the throw
    // still happened on every reconcile.
    expect(error).not.toHaveBeenCalled()
    h!.dispose()
  })

  it('warns in dev, naming the primitive AND the dep path it read', () => {
    const c = container()
    const h = mountSignalComponent<S, never>(c, def(missingItems))
    expect(warnings().length).toBe(1)
    const msg = warnings()[0]!
    expect(msg).toContain('each')
    expect(msg).toContain('undefined')
    // The path is what moves the error back to its cause — without it the report
    // names no state the author wrote.
    expect(msg).toContain('section.items')
    h.dispose()
  })

  it('does NOT warn for a legitimately empty array', () => {
    const c = container()
    const h = mountSignalComponent<S, never>(
      c,
      def(() => ({ section: { title: 'Medications', items: [] } })),
    )
    expect(c.querySelectorAll('li').length).toBe(0)
    expect(warnings()).toEqual([])
    h.dispose()
  })

  it('warns once per nullish RUN, and again after the source recovers', () => {
    const c = container()
    type M = { type: 'load' } | { type: 'clear' } | { type: 'touch' }
    const h = mountSignalComponent<S, M>(c, {
      name: 'Recovering',
      init: missingItems,
      update: (s, m) =>
        m.type === 'load'
          ? { section: { title: s.section.title, items: [{ id: 1, name: 'a' }] } }
          : m.type === 'clear'
            ? missingItems()
            : { section: { ...s.section, title: `${s.section.title}!` } },
      view: ({ state }) => [
        ul([
          each(state.at('section').at('items'), {
            key: (r) => r.id,
            render: (item) => [li([text(item.at('name'))])],
          }),
        ]),
      ],
    })
    expect(warnings().length).toBe(1)
    // Reconciles again while still nullish (a title change fans out to the list's
    // whole-state deps) — must not re-warn; a per-frame list would flood the console.
    h.send({ type: 'touch' })
    h.send({ type: 'touch' })
    expect(warnings().length).toBe(1)
    // Recovers: rows appear, no new warning.
    h.send({ type: 'load' })
    expect(c.querySelectorAll('li').length).toBe(1)
    expect(warnings().length).toBe(1)
    // Breaks again: a NEW occurrence is a new report, not silence.
    h.send({ type: 'clear' })
    expect(c.querySelectorAll('li').length).toBe(0)
    expect(warnings().length).toBe(2)
    h.dispose()
  })

  it('treats a null items source the same as undefined, and says so', () => {
    // `EachSource.items` is honestly typed nullable, so this needs no cast: it is
    // the exact contract the reconcile is written against.
    const c = container()
    const h = mountSignalComponent<{ n: number }, never>(c, {
      name: 'NullItems',
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        el('h1', {}, ['kept']),
        el('ul', {}, [
          signalEach<Row>(
            { items: () => null, deps: ['rows'] },
            (r) => r.id,
            () => [el('li', {}, ['x'])],
          ),
        ]),
      ],
    })
    expect(c.querySelectorAll('li').length).toBe(0)
    expect(c.querySelector('h1')?.textContent).toBe('kept')
    expect(warnings()[0]).toContain('null')
    h.dispose()
  })
})

describe('#165 part 1 — virtualEach has the identical gap and the identical fix', () => {
  interface S {
    section: { items: readonly Row[] }
  }
  it('renders empty, does not throw, and warns naming virtualEach', () => {
    const c = container()
    let h: ReturnType<typeof mountSignalComponent<S, never>> | null = null
    expect(() => {
      h = mountSignalComponent<S, never>(c, {
        name: 'VirtualReport',
        init: () => ({ section: {} as { items: readonly Row[] } }),
        update: (s) => s,
        view: ({ state }) => [
          virtualEach<Row>({
            items: state.at('section').at('items'),
            key: (r) => r.id,
            itemHeight: 20,
            containerHeight: 100,
            render: () => [div([text('row')])],
          }),
          el('footer', {}, ['Totals']),
        ],
      })
    }).not.toThrow()
    expect(c.querySelectorAll('[data-virtual-item]').length).toBe(0)
    expect(c.querySelector('footer')?.textContent).toBe('Totals')
    // Total, not caught — see the `each` case above.
    expect(error).not.toHaveBeenCalled()
    const msg = warnings()[0]!
    expect(msg).toContain('virtualEach')
    expect(msg).toContain('section.items')
    h!.dispose()
  })
})

// ── Part 3: the mount boundary ───────────────────────────────────────────────

describe('#165 part 3 — a throwing binding at MOUNT is contained to itself', () => {
  interface S {
    label: string
  }

  const throwingDef = {
    name: 'Boundary',
    init: (): S => ({ label: 'ok' }),
    update: (s: S) => s,
    view: () => [
      el('h1', {}, ['header']),
      el('p', {}, [
        signalText(() => {
          throw new Error('accessor boom')
        }, ['label']),
      ]),
      el('footer', {}, ['footer']),
    ],
  }

  it('leaves the REST of the document mounted', () => {
    const c = container()
    let h: ReturnType<typeof mountSignalComponent<S, never>> | null = null
    expect(() => {
      h = mountSignalComponent<S, never>(c, throwingDef)
    }).not.toThrow()
    expect(c.querySelector('h1')?.textContent).toBe('header')
    // The binding that threw wrote nothing — its own <p> is empty, not the page.
    expect(c.querySelector('p')?.textContent).toBe('')
    expect(c.querySelector('footer')?.textContent).toBe('footer')
    h!.dispose()
  })

  it('reports the throw on the console even with NO hook installed', () => {
    // Containment without visibility is how #165 became a silent wrong page. The
    // console write is unconditional for exactly that reason (mirroring
    // component.ts's subscriber isolation).
    const c = container()
    const h = mountSignalComponent<S, never>(c, throwingDef)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]![0])).toContain('isolated')
    h.dispose()
  })

  it('routes a ROW mount throw to the setOnBindingError hook, and keeps the list alive', () => {
    // The incident's throw came from a row mounted DURING A COMMIT, not from the
    // initial mount — so drive the boundary that way. The hook path is the agent's
    // `drain.errors` channel; the envelope must be the one the update path produces.
    const c = container()
    const seen: Array<{ kind: string; message: string }> = []
    interface LS {
      rows: readonly Row[]
    }
    const h = mountSignalComponent<LS, { type: 'add' }>(c, {
      name: 'HookedBoundary',
      init: () => ({ rows: [] }),
      update: (s) => ({ rows: [...s.rows, { id: s.rows.length + 1, name: 'r' }] }),
      view: ({ state }) => [
        el('h1', {}, ['header']),
        el('ul', {}, [
          each(state.at('rows'), {
            key: (r) => r.id,
            render: (item) => [
              li([
                // A row binding that throws for the SECOND row only, so the first
                // row's DOM proves the list itself survived.
                signalText(() => {
                  if (item.peek().id === 2) throw new Error('row boom')
                  return item.peek().name
                }, ['item.id']),
                // A binding AFTER the throwing one, in the SAME row scope. Only the
                // mount boundary can get this committed — without it the row's
                // binding loop aborts at the throw and this stays empty, whether or
                // not an outer catch contains the escape.
                span([signalText(() => 'tail', ['item.id'])]),
              ]),
            ],
          }),
        ]),
        el('footer', {}, ['footer']),
      ],
    })
    h.setOnBindingError((e) => seen.push({ kind: e.kind, message: e.message }))
    h.send({ type: 'add' })
    h.send({ type: 'add' })
    expect(seen).toEqual([{ kind: 'binding', message: 'row boom' }])
    // Both rows exist; only the throwing binding's own text is missing — the
    // sibling binding AFTER it in the same row scope still committed.
    expect(Array.from(c.querySelectorAll('li')).map((n) => n.textContent)).toEqual([
      'rtail',
      'tail',
    ])
    expect(c.querySelector('footer')?.textContent).toBe('footer')
    h.dispose()
  })

  it('does NOT contain a framework authoring invariant — those stay fatal', () => {
    // The boundary is for DATA surprises. `each: a row cannot have a show/branch/
    // each as its top-level node` is a tree that cannot be reconciled: contained, it
    // would mount and then fail as a NotFoundError several interactions later —
    // the very displacement #165 is filed about.
    const c = container()
    expect(() =>
      mountSignalComponent<{ rows: readonly Row[] }, never>(c, {
        name: 'FragmentRoot',
        init: () => ({ rows: [{ id: 1, name: 'a' }] }),
        update: (s) => s,
        view: ({ state }) => [
          ul([
            each(state.at('rows'), {
              key: (r) => r.id,
              render: (item) => [
                branch(item.at('name'), { a: () => [span([text('x')])] }) as never,
              ],
            }),
          ]),
        ],
      }),
    ).toThrow(/Wrap it in an element so the row has a stable boundary/)
  })

  it('leaves UPDATE unguarded — the asymmetry is deliberate', () => {
    // A throw at update leaves the PREVIOUS, consistent frame in the DOM and aborts
    // the settle round, which drops that round's effects and reaches the `send`
    // caller. That is commit-scope schedule contract (see
    // test/signals/scheduler-throw-path.test.ts); mount has no previous frame to
    // fall back on, which is why only mount is guarded by default.
    const c = container()
    interface St {
      ok: boolean
    }
    const h = mountSignalComponent<St, { type: 'flip' }>(c, {
      name: 'UpdateUnguarded',
      init: () => ({ ok: true }),
      update: () => ({ ok: false }),
      view: () => [
        el('span', {}, [
          signalText(
            (s) => {
              if (!(s as St).ok) throw new Error('update boom')
              return 'fine'
            },
            ['ok'],
          ),
        ]),
      ],
    })
    expect(c.querySelector('span')?.textContent).toBe('fine')
    expect(() => h.send({ type: 'flip' })).toThrow(/update boom/)
    h.dispose()
  })
})

// ── The incident shape ───────────────────────────────────────────────────────

describe('#165 — the reported shape: a nested each under an arm swapped loading→ready', () => {
  interface Section {
    id: number
    title: string
    items: readonly Row[]
  }
  interface S {
    phase: 'loading' | 'ready'
    sections: readonly Section[]
  }

  it('renders every OTHER section, the totals and the footer when one section has no items', () => {
    const c = container()
    const h = mountSignalComponent<S, { type: 'loaded' }>(c, {
      name: 'MedicationReport',
      init: () => ({ phase: 'loading', sections: [] }),
      update: () => ({
        phase: 'ready' as const,
        sections: [
          { id: 1, title: 'Current', items: [{ id: 10, name: 'metformin' }] },
          // The payload that arrived without `items` — the incident's data.
          { id: 2, title: 'Discontinued' } as Section,
          { id: 3, title: 'PRN', items: [{ id: 30, name: 'ibuprofen' }] },
        ],
      }),
      view: ({ state }) => [
        el('h1', {}, ['Medication report']),
        // The AsyncView shape: an arm swap mounts the whole ready subtree from
        // inside a commit, which is where the throw used to escape.
        branch(state.at('phase'), {
          loading: () => [p([text('loading…')])],
          ready: () => [
            div([
              each(state.at('sections'), {
                key: (s: Section) => s.id,
                render: (section: Signal<Section>) => [
                  el('section', {}, [
                    el('h2', {}, [text(section.at('title'))]),
                    ul([
                      // The nested each whose items source derives from the OUTER
                      // each's item signal.
                      each(section.at('items'), {
                        key: (r: Row) => r.id,
                        render: (row: Signal<Row>) => [li([text(row.at('name'))])],
                      }),
                    ]),
                  ]),
                ],
              }),
            ]),
          ],
        }),
        el('footer', {}, ['end of report']),
      ],
    })

    expect(c.querySelector('p')?.textContent).toBe('loading…')
    expect(() => h.send({ type: 'loaded' })).not.toThrow()

    // Every section heading, both populated lists, and the footer — the things the
    // incident lost.
    expect(Array.from(c.querySelectorAll('h2')).map((n) => n.textContent)).toEqual([
      'Current',
      'Discontinued',
      'PRN',
    ])
    expect(Array.from(c.querySelectorAll('li')).map((n) => n.textContent)).toEqual([
      'metformin',
      'ibuprofen',
    ])
    expect(c.querySelector('footer')?.textContent).toBe('end of report')
    // Nothing threw on the way: the seam is total, not merely contained.
    expect(error).not.toHaveBeenCalled()
    // And the empty one is REPORTED, not silently empty.
    expect(warnings().length).toBe(1)
    expect(warnings()[0]).toContain('each')
    h.dispose()
  })
})

// ── B3: the guard's boundary is the COMMIT ROUND, and the effect frame is unchanged
//
// The rule: a mount OUTSIDE a commit round is guarded; a mount INSIDE one is not
// (unless a `setOnBindingError` hook is installed — main's pre-existing behaviour).
//
// The first cut of #165 guarded every mount, which quietly changed a documented
// schedule: a row mounted mid-`send` was contained, so the round COMPLETED and
// DISPATCHED effects that `commit-scope.ts` says a round which throws must drop.
// That was reverted deliberately. A binding in a row/arm mounted mid-send throws
// directly from `mount`; #225's deferral of that fresh scope's child traversal does
// not contain or reschedule the failure.
//
// So these four traces pin BOTH directions of the boundary. The in-round three are
// byte-identical to `origin/main`; the out-of-round one is the #165 fix.

describe('#165 B3 — the effect frame when a SUBTREE is mounted during a send', () => {
  interface RowS {
    rows: readonly Row[]
  }
  type FX = { type: 'FX' }

  it('a ROW mounted mid-send throws and DROPS the round’s effects, exactly as on main', () => {
    // The trace the narrowing exists to preserve. The row's scope mounts from inside
    // `commitToDom`'s reconcile, so `commitRoundDepth > 0` and the guard stands
    // down: the throw escapes directly from mount, `drain` never reaches its
    // dispatch, and the effects this round collected are dropped.
    const c = container()
    const log: string[] = []
    const h = mountSignalComponent<RowS, { type: 'add' }, FX>(c, {
      name: 'RowMountEffectFrame',
      init: () => ({ rows: [] }),
      update: (s) => [
        { rows: [...s.rows, { id: s.rows.length + 1, name: 'r' }] },
        [{ type: 'FX' }],
      ],
      view: ({ state }) => [
        el('h1', {}, ['header']),
        ul([
          each(state.at('rows'), {
            key: (r) => r.id,
            render: () => [
              li([
                signalText(() => {
                  throw new Error('row mount boom')
                }, ['item.id']),
              ]),
            ],
          }),
        ]),
        el('footer', {}, ['footer']),
      ],
      onEffect: (e) => {
        log.push(`effect:${e.type}`)
      },
    })
    expect(() => h.send({ type: 'add' })).toThrow(/row mount boom/)
    expect(log).toEqual([])
    h.dispose()
  })

  it('the SAME row binding IS contained when the mount is outside a round', () => {
    // The other side of the boundary, and the whole of #165's fix: at the initial
    // mount there is no round to abort, so the throw is contained, the sibling
    // binding after it in the same row still commits, and the document is whole.
    const c = container()
    const h = mountSignalComponent<RowS, never>(c, {
      name: 'RowMountOutsideRound',
      init: () => ({ rows: [{ id: 1, name: 'r' }] }),
      update: (s) => s,
      view: ({ state }) => [
        el('h1', {}, ['header']),
        ul([
          each(state.at('rows'), {
            key: (r) => r.id,
            render: () => [
              li([
                signalText(() => {
                  throw new Error('row mount boom')
                }, ['item.id']),
                signalText(() => 'tail', ['item.id']),
              ]),
            ],
          }),
        ]),
        el('footer', {}, ['footer']),
      ],
    })
    expect(c.querySelector('h1')?.textContent).toBe('header')
    expect(c.querySelector('li')?.textContent).toBe('tail')
    expect(c.querySelector('footer')?.textContent).toBe('footer')
    h.dispose()
  })

  it('an ARM mounted mid-send still throws and still DROPS the round’s effects', () => {
    // The arm mounts from inside the round, so the guard stands down for the same
    // reason the row's does. The binding throws directly from `scope.mount`; it
    // does not depend on a redundant same-round child sweep (#225 removes that
    // sweep without changing this failure/effect schedule).
    const c = container()
    const log: string[] = []
    interface ArmS {
      phase: 'loading' | 'ready'
    }
    const h = mountSignalComponent<ArmS, { type: 'go' }, FX>(c, {
      name: 'ArmMountEffectFrame',
      init: () => ({ phase: 'loading' }),
      update: () => [{ phase: 'ready' as const }, [{ type: 'FX' }]],
      view: ({ state }) => [
        branch(state.at('phase'), {
          loading: () => [p([text('loading')])],
          ready: () => [
            div([
              signalText(() => {
                throw new Error('arm mount boom')
              }, ['phase']),
            ]),
          ],
        }),
      ],
      onEffect: (e) => {
        log.push(`effect:${e.type}`)
      },
    })
    expect(() => h.send({ type: 'go' })).toThrow(/arm mount boom/)
    // Dropped, exactly as the commit-scope header requires of a round that throws.
    expect(log).toEqual([])
    h.dispose()
  })

  it('a TOP-LEVEL binding throw at update is untouched by the guard', () => {
    // The property `scheduler-throw-path.test.ts` pins, restated here so the three
    // traces sit side by side and a future change cannot move one without the
    // difference being visible.
    const c = container()
    const log: string[] = []
    interface St {
      ok: boolean
    }
    const h = mountSignalComponent<St, { type: 'flip' }, FX>(c, {
      name: 'TopLevelEffectFrame',
      init: () => ({ ok: true }),
      update: () => [{ ok: false }, [{ type: 'FX' }]],
      view: () => [
        el('span', {}, [
          signalText(
            (s) => {
              if (!(s as St).ok) throw new Error('top boom')
              return 'fine'
            },
            ['ok'],
          ),
        ]),
      ],
      onEffect: (e) => {
        log.push(`effect:${e.type}`)
      },
    })
    expect(() => h.send({ type: 'flip' })).toThrow(/top boom/)
    expect(log).toEqual([])
    h.dispose()
  })
})

// ── N2: the third branded site had no covering test ──────────────────────────

describe('#165 N2 — a divergent eachDirect row structure stays fatal', () => {
  it('throws rather than being demoted to a console line', () => {
    // `eachDirect` is a public hand-written API, so a data-conditional factory can
    // emit a different binding structure per row — which would reuse the first row's
    // masks and silently mis-gate the row. The dev guard is branded; without the
    // brand the mount boundary would swallow it and ship the mis-masked row.
    const c = container()
    expect(() =>
      mountSignalComponent<{ rows: readonly Row[] }, never>(c, {
        name: 'DivergentDirectRow',
        init: () => ({
          rows: [
            { id: 1, name: 'a' },
            { id: 2, name: 'b' },
          ],
        }),
        update: (s) => s,
        view: ({ state }) => [
          el('ul', {}, [
            eachDirect(
              state.at('rows'),
              (r) => r.id,
              (doc, getCtx) => {
                const node = doc.createElement('li')
                const first = (getCtx().item as Row).id === 1
                return {
                  nodes: [node as unknown as Node],
                  // Row 1 emits one binding, row 2 emits a DIFFERENT set.
                  bindings: first
                    ? [
                        {
                          deps: ['item.name'],
                          produce: (ctx: unknown) => String((ctx as { item: Row }).item.name),
                          commit: (v: unknown) => {
                            node.textContent = String(v)
                          },
                        },
                      ]
                    : [
                        {
                          deps: ['item.id'],
                          produce: (ctx: unknown) => String((ctx as { item: Row }).item.id),
                          commit: (v: unknown) => {
                            node.textContent = String(v)
                          },
                        },
                      ],
                }
              },
            ),
          ]),
        ],
      }),
    ).toThrow(/emitted a different binding structure/)
  })
})

// ── B1 / B2: the two authoring errors review found demoted ───────────────────

describe('#165 B1/B2 — framework authoring errors are fatal, not console lines', () => {
  it('B1: compiledAway() inside an each row stays fatal', () => {
    // The guard behind all six lowering entry points. Unbranded it was swallowed,
    // and a mis-wired build (no @llui/vite-plugin) rendered a blank section with one
    // console line — #165's own failure mode reintroduced by the fix for #165.
    const c = container()
    expect(() =>
      mountSignalComponent<{ rows: readonly Row[] }, never>(c, {
        name: 'CompiledAwayInRow',
        init: () => ({ rows: [{ id: 1, name: 'a' }] }),
        update: (s) => s,
        view: ({ state }) => [
          ul([
            each(state.at('rows'), {
              key: (r) => r.id,
              // A plain value where a signal handle is required — what an untransformed
              // module produces at runtime.
              render: () => [li([text('literal' as never), show('nope' as never, () => [])])],
            }),
          ]),
        ],
      }),
    ).toThrow(/was not lowered by @llui\/vite-plugin/)
  })

  it('B2: derived() with a non-signal input inside an each row stays fatal', () => {
    const c = container()
    expect(() =>
      mountSignalComponent<{ rows: readonly Row[] }, never>(c, {
        name: 'DerivedInRow',
        init: () => ({ rows: [{ id: 1, name: 'a' }] }),
        update: (s) => s,
        view: ({ state }) => [
          ul([
            each(state.at('rows'), {
              key: (r) => r.id,
              render: (item) => [
                li([text(derived(item.at('name'), 'not-a-signal' as never, (a, b) => `${a}${b}`))]),
              ],
            }),
          ]),
        ],
      }),
    ).toThrow(/derived\(\): every input must be a signal/)
  })
})
