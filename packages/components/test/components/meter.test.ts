import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  percent,
  bandAt,
  toneAt,
  type MeterBandGeometry,
  type MeterState,
} from '../../src/components/meter'
import { rootSignal, read } from '../_signal'

describe('meter reducer', () => {
  it('initializes with value=0, the default range and no bands', () => {
    expect(init()).toStrictEqual({ value: 0, min: 0, max: 100, bands: [] })
  })

  it('setValue updates value', () => {
    const [s] = update(init(), { type: 'setValue', value: 50 })
    expect(s.value).toBe(50)
  })

  it('setMax updates max', () => {
    const [s] = update(init(), { type: 'setMax', max: 200 })
    expect(s.max).toBe(200)
  })

  it('setBands replaces the range outright', () => {
    const s = init({ low: 20, high: 80, optimum: 90 })
    const [next] = update(s, { type: 'setBands', bands: [{ id: 'all', tone: 'optimal' }] })
    expect(next.bands).toStrictEqual([{ id: 'all', tone: 'optimal', label: 'all' }])
  })

  it('setBands with an empty list clears the range — it does NOT re-synthesise the native one', () => {
    // `low`/`high`/`optimum` are init OPTIONS, not state, so after a setBands
    // there is nothing left to re-derive them from. Stated so the asymmetry
    // with `init({ bands: [] })` is a decision and not a surprise.
    const s = init({ low: 20, high: 80, optimum: 90 })
    expect(s.bands).toHaveLength(3)
    expect(update(s, { type: 'setBands', bands: [] })[0].bands).toStrictEqual([])
  })
})

describe('meter band normalisation', () => {
  it('defaults a missing tone to neutral and a missing label to the id', () => {
    expect(init({ bands: [{ id: 'ok', from: 0, to: 5 }] }).bands).toStrictEqual([
      { id: 'ok', tone: 'neutral', from: 0, to: 5, label: 'ok' },
    ])
  })

  it('keeps an explicit empty label — that is how an announcement is suppressed', () => {
    expect(init({ bands: [{ id: 'ok', label: '' }] }).bands[0]!.label).toBe('')
  })

  it('rejects a tone it does not know', () => {
    const bands = [{ id: 'x', tone: 'danger' as unknown as 'critical' }]
    expect(init({ bands }).bands[0]!.tone).toBe('neutral')
  })

  it('drops an entry with no string id — a row with no key cannot be reordered', () => {
    const bands = [{ id: 'a' }, { from: 1, to: 2 } as unknown as { id: string }, { id: 'b' }]
    expect(init({ bands }).bands.map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('omits a non-finite edge rather than storing it (#177)', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const band = init({ bands: [{ id: 'x', from: bad, to: bad }] }).bands[0]!
      expect('from' in band, `from ${bad}`).toBe(false)
      expect('to' in band, `to ${bad}`).toBe(false)
    }
  })

  it('keeps author ORDER — nothing is sorted or merged', () => {
    const bands = [
      { id: 'high', from: 80 },
      { id: 'low', to: 20 },
      { id: 'mid', from: 20, to: 80 },
    ]
    expect(init({ bands }).bands.map((b) => b.id)).toEqual(['high', 'low', 'mid'])
  })
})

describe('meter: the native <meter> spelling compiles into bands', () => {
  it('low/high/optimum become three positional segments', () => {
    expect(init({ low: 20, high: 80, optimum: 90 }).bands).toStrictEqual([
      { id: 'low', tone: 'critical', to: 20 },
      { id: 'middle', tone: 'suboptimal', from: 20, to: 80 },
      { id: 'high', tone: 'optimal', from: 80 },
    ])
  })

  it('carries no label, so it announces nothing a screen reader has to decode', () => {
    for (const band of init({ low: 20, high: 80, optimum: 90 }).bands) {
      expect('label' in band, band.id).toBe(false)
    }
  })

  it('without an optimum there is no preference at all — every segment is neutral', () => {
    expect(init({ low: 20, high: 80 }).bands.map((b) => b.tone)).toEqual([
      'neutral',
      'neutral',
      'neutral',
    ])
  })

  it('a missing low or high drops that segment', () => {
    expect(init({ high: 80, optimum: 90 }).bands.map((b) => b.id)).toEqual(['middle', 'high'])
    expect(init({ low: 20, optimum: 10 }).bands.map((b) => b.id)).toEqual(['low', 'middle'])
    expect(init({ optimum: 50 }).bands.map((b) => b.id)).toEqual(['middle'])
  })

  it('explicit bands WIN over the native spelling', () => {
    const s = init({ low: 20, high: 80, optimum: 90, bands: [{ id: 'only' }] })
    expect(s.bands.map((b) => b.id)).toEqual(['only'])
  })

  it('bands: [] keeps the single-optimum behaviour (#235)', () => {
    expect(init({ low: 20, high: 80, optimum: 90, bands: [] }).bands.map((b) => b.id)).toEqual([
      'low',
      'middle',
      'high',
    ])
    // …and so does a list whose every entry is unusable.
    const junk = [{ from: 1 } as unknown as { id: string }]
    expect(init({ low: 20, high: 80, optimum: 90, bands: junk }).bands).toHaveLength(3)
  })

  describe('native tone parity with the old thresholdState table', () => {
    // The same nine cases the three-way `thresholdState` used to assert, in the
    // vocabulary that replaced it: optimal -> 'optimal', the ADJACENT segment ->
    // 'suboptimal' (was 'high'), the FAR one -> 'critical' (was 'low').
    const at = (opts: Parameters<typeof init>[0]) => toneAt(init(opts))

    it('optimum high (higher is better)', () => {
      const base = { low: 20, high: 80, optimum: 90 }
      expect(at({ value: 90, ...base })).toBe('optimal')
      expect(at({ value: 50, ...base })).toBe('suboptimal')
      expect(at({ value: 10, ...base })).toBe('critical')
    })

    it('optimum low (lower is better)', () => {
      const base = { low: 20, high: 80, optimum: 10 }
      expect(at({ value: 5, ...base })).toBe('optimal')
      expect(at({ value: 50, ...base })).toBe('suboptimal')
      expect(at({ value: 95, ...base })).toBe('critical')
    })

    it('optimum in the middle (both ends are merely sub-optimal)', () => {
      const base = { low: 20, high: 80, optimum: 50 }
      expect(at({ value: 50, ...base })).toBe('optimal')
      expect(at({ value: 10, ...base })).toBe('suboptimal')
      expect(at({ value: 95, ...base })).toBe('suboptimal')
    })

    it('no thresholds at all reads NEUTRAL, not optimal', () => {
      // The one deliberate change of meaning: a plain gauge is not claiming the
      // reading is good. `thresholdState(init())` used to answer 'optimal'.
      expect(at({ value: 50 })).toBe('neutral')
      expect(bandAt(init({ value: 50 }))).toBeNull()
    })
  })
})

describe('meter percent', () => {
  it('computes correctly', () => {
    expect(percent(init({ value: 50 }))).toBe(50)
    expect(percent(init({ value: 25, max: 200 }))).toBe(12.5)
  })

  it('respects min offset', () => {
    expect(percent(init({ value: 30, min: 20, max: 40 }))).toBe(50)
  })

  it('returns 0 for a non-positive range', () => {
    expect(percent(init({ value: 5, min: 10, max: 10 }))).toBe(0)
    expect(percent(init({ value: 5, min: 40, max: 10 }))).toBe(0)
  })
})

describe('meter bandAt — the membership rule', () => {
  // A four-band reference range, tiling [0, 10) and open at both ends.
  const PANEL = [
    { id: 'deficient', to: 2, tone: 'critical' as const },
    { id: 'low', from: 2, to: 4, tone: 'suboptimal' as const },
    { id: 'optimal', from: 4, to: 8, tone: 'optimal' as const },
    { id: 'excess', from: 8, tone: 'critical' as const },
  ]
  const at = (value: number) => bandAt(init({ value, min: 0, max: 10, bands: PANEL }))?.id ?? null

  it('places a value inside a band', () => {
    expect(at(1)).toBe('deficient')
    expect(at(3)).toBe('low')
    expect(at(6)).toBe('optimal')
    expect(at(9)).toBe('excess')
  })

  it('a shared edge belongs to the UPPER band — [from, to)', () => {
    expect(at(2)).toBe('low')
    expect(at(4)).toBe('optimal')
    expect(at(8)).toBe('excess')
  })

  it('an absent edge is open on that side', () => {
    expect(at(-50)).toBe('deficient')
    expect(at(9999)).toBe('excess')
  })

  it('the TOP of the track is inclusive, so a full-scale reading is in a band', () => {
    // Without the exception a half-open top edge leaves `value === max` in no
    // band at all — the one place the uniform rule gives a useless answer.
    const capped = [
      { id: 'lower', from: 0, to: 50 },
      { id: 'upper', from: 50, to: 100 },
    ]
    const state = (value: number) => init({ value, min: 0, max: 100, bands: capped })
    expect(bandAt(state(100))?.id).toBe('upper')
    expect(bandAt(state(50))?.id).toBe('upper')
    // It is scoped to the TRACK's top, not to "the last band": a band that
    // stops short of `max` still ends half-open.
    const short = [{ id: 'lower', from: 0, to: 50 }]
    expect(bandAt(init({ value: 50, min: 0, max: 100, bands: short }))).toBeNull()
  })

  it('a value below every band, above every band, or in a GAP is in NO band', () => {
    const gapped = [
      { id: 'a', from: 0, to: 10 },
      { id: 'b', from: 20, to: 30 },
    ]
    const state = (value: number) => init({ value, min: 0, max: 100, bands: gapped })
    expect(bandAt(state(15))).toBeNull() // the gap
    expect(bandAt(state(-1))).toBeNull() // below all
    expect(bandAt(state(80))).toBeNull() // above all
    expect(toneAt(state(15))).toBe('neutral')
  })

  it('OVERLAPPING bands: the first match in author order wins', () => {
    const overlap = [
      { id: 'wide', from: 0, to: 100, tone: 'neutral' as const },
      { id: 'narrow', from: 40, to: 60, tone: 'critical' as const },
    ]
    expect(bandAt(init({ value: 50, min: 0, max: 100, bands: overlap }))?.id).toBe('wide')
    // Reversing the author's order reverses the answer — nothing is sorted.
    expect(bandAt(init({ value: 50, min: 0, max: 100, bands: [...overlap].reverse() }))?.id).toBe(
      'narrow',
    )
  })

  it('an INVERTED band (from > to) matches nothing and is not repaired', () => {
    const s = init({ value: 5, min: 0, max: 10, bands: [{ id: 'bad', from: 8, to: 2 }] })
    expect(s.bands[0]).toMatchObject({ from: 8, to: 2 })
    expect(bandAt(s)).toBeNull()
    // Not even at its own edges.
    expect(bandAt({ ...s, value: 2 })).toBeNull()
    expect(bandAt({ ...s, value: 8 })).toBeNull()
  })

  it('DUPLICATE ids: the first wins, and both survive in state', () => {
    const dup = [
      { id: 'x', from: 0, to: 10, tone: 'optimal' as const },
      { id: 'x', from: 0, to: 10, tone: 'critical' as const },
    ]
    const s = init({ value: 5, min: 0, max: 10, bands: dup })
    expect(s.bands).toHaveLength(2)
    expect(bandAt(s)?.tone).toBe('optimal')
  })

  it('a band with NEITHER edge covers the whole track', () => {
    expect(bandAt(init({ value: -999, bands: [{ id: 'all' }] }))?.id).toBe('all')
  })

  it('a non-finite value is in no band', () => {
    const s = init({ value: 5, min: 0, max: 10, bands: [{ id: 'all' }] })
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(bandAt({ ...s, value: bad }), String(bad)).toBeNull()
    }
  })

  it('a state that lost its bands array reads as empty, it does not throw', () => {
    // The items-seam lesson one step smaller: a rehydrated blob missing the key
    // renders nothing rather than taking the page down.
    const broken = { value: 5, min: 0, max: 10 } as unknown as MeterState
    expect(bandAt(broken)).toBeNull()
    expect(toneAt(broken)).toBe('neutral')
  })

  it('a HOLE inside the bands array is dropped, not dereferenced', () => {
    // Guarding the array alone still dereferences what is in it: `[null]` threw
    // where `null` was handled. The seam is total at both levels.
    const holed = (bands: unknown[]) =>
      ({ value: 5, min: 0, max: 10, bands }) as unknown as MeterState
    for (const junk of [null, undefined, 'x', 7]) {
      expect(bandAt(holed([junk])), String(junk)).toBeNull()
      expect(toneAt(holed([junk])), String(junk)).toBe('neutral')
    }
    // A usable band beside the hole still resolves, and the hole draws nothing.
    const mixed = holed([null, { id: 'ok', tone: 'optimal', from: 0, to: 10 }])
    expect(bandAt(mixed)?.id).toBe('ok')
    const bag = connect(rootSignal<MeterState>(), vi.fn())
    expect(read(bag.bands, mixed).map((b) => b.id)).toEqual(['ok'])
  })
})

describe('meter.connect', () => {
  const parts = connect(rootSignal(), vi.fn(), { label: 'Disk usage' })

  it('root has role=meter with aria-label', () => {
    expect(parts.root.role).toBe('meter')
    expect(parts.root['aria-label']).toBe('Disk usage')
  })

  it('reports valuemin/valuemax/valuenow', () => {
    const s = init({ value: 42, min: 0, max: 100 })
    expect(read(parts.root['aria-valuemin'], s)).toBe(0)
    expect(read(parts.root['aria-valuemax'], s)).toBe(100)
    expect(read(parts.root['aria-valuenow'], s)).toBe(42)
  })

  it('aria-valuetext uses the default percent format', () => {
    expect(read(parts.root['aria-valuetext'], init({ value: 75 }))).toBe('75%')
  })

  it('aria-valuetext honors min offset (matches the rendered bar)', () => {
    const s = init({ value: 75, min: 50, max: 100 })
    // (75-50)/(100-50) = 50% — must match the range bar, not value/max (75%).
    expect(read(parts.root['aria-valuetext'], s)).toBe('50%')
    expect(read(parts.valueText, s)).toBe('50%')
  })

  it('aria-valuetext honors a custom formatter', () => {
    const p = connect(rootSignal(), vi.fn(), {
      format: (v, max) => `${v} of ${max} GB`,
    })
    expect(read(p.root['aria-valuetext'], init({ value: 30, max: 100 }))).toBe('30 of 100 GB')
    expect(read(p.valueText, init({ value: 30, max: 100 }))).toBe('30 of 100 GB')
  })

  it('data-state reflects the current band tone', () => {
    const base = { low: 20, high: 80, optimum: 90 }
    expect(read(parts.root['data-state'], init({ value: 90, ...base }))).toBe('optimal')
    expect(read(parts.root['data-state'], init({ value: 50, ...base }))).toBe('suboptimal')
    expect(read(parts.root['data-state'], init({ value: 10, ...base }))).toBe('critical')
  })

  it('range style is percent-driven via inline-size', () => {
    expect(read(parts.range.style, init({ value: 30 }))).toContain('inline-size:30%')
  })

  it('range style clamps out-of-range values', () => {
    expect(read(parts.range.style, init({ value: 150 }))).toContain('inline-size:100%')
    expect(read(parts.range.style, init({ value: -20 }))).toContain('inline-size:0%')
  })

  it('track and range carry the same data-state', () => {
    const s = init({ value: 10, low: 20, high: 80, optimum: 90 })
    expect(read(parts.track['data-state'], s)).toBe('critical')
    expect(read(parts.range['data-state'], s)).toBe('critical')
  })

  it('a style string recomputed from a repeating fraction stays byte-identical', () => {
    // The reconciler commits on OUTPUT equality: unrounded percent reaches a
    // style as `33.33333333333333%` from one route and `33.333333333333336%`
    // from another, and every unrelated state change re-commits the attribute.
    const a = read(parts.range.style, init({ value: 10, min: 0, max: 30 }))
    const b = read(parts.range.style, init({ value: 20, min: 0, max: 60 }))
    expect(a).toBe(b)
    expect(a).toBe('inline-size:33.3333%;')
  })
})

describe('meter.connect — bands', () => {
  const PANEL = [
    { id: 'low', to: 0.4, tone: 'critical' as const, label: 'low' },
    { id: 'ref', from: 0.4, to: 4, tone: 'optimal' as const, label: 'optimal' },
    { id: 'high', from: 4, tone: 'critical' as const, label: 'high' },
  ]
  const parts = connect(rootSignal(), vi.fn(), {
    format: (v) => `${v} mIU/L`,
  })
  const state = (value: number) => init({ value, min: 0, max: 8, bands: PANEL })
  const layout = (value: number): MeterBandGeometry[] => read(parts.bands, state(value))

  it('aria-valuetext names the band the reading is in (#235)', () => {
    expect(read(parts.root['aria-valuetext'], state(2.1))).toBe('2.1 mIU/L, optimal')
    expect(read(parts.root['aria-valuetext'], state(0.1))).toBe('0.1 mIU/L, low')
    expect(read(parts.root['aria-valuetext'], state(6))).toBe('6 mIU/L, high')
  })

  it('announces the number ALONE when the reading is in no band', () => {
    const gapped = init({ value: 15, min: 0, max: 20, bands: [{ id: 'a', from: 0, to: 10 }] })
    expect(read(parts.root['aria-valuetext'], gapped)).toBe('15 mIU/L')
    expect(read(parts.bandLabel, gapped)).toBe('')
  })

  it('a band with an empty label suppresses the announcement', () => {
    const silent = init({ value: 5, min: 0, max: 10, bands: [{ id: 'internal', label: '' }] })
    expect(read(parts.root['aria-valuetext'], silent)).toBe('5 mIU/L')
  })

  it('the native spelling announces nothing extra — aria-valuetext is unchanged for it', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(
      read(p.root['aria-valuetext'], init({ value: 75, low: 20, high: 80, optimum: 90 })),
    ).toBe('75%')
  })

  it('valueText stays the NUMBER only; the band name is its own signal', () => {
    expect(read(parts.valueText, state(2.1))).toBe('2.1 mIU/L')
    expect(read(parts.bandLabel, state(2.1))).toBe('optimal')
  })

  it('root and marker carry the current band id, absent when there is none', () => {
    expect(read(parts.root['data-band'], state(2.1))).toBe('ref')
    expect(read(parts.marker['data-band'], state(2.1))).toBe('ref')
    const gapped = init({ value: 15, min: 0, max: 20, bands: [{ id: 'a', from: 0, to: 10 }] })
    expect(read(parts.root['data-band'], gapped)).toBeUndefined()
  })

  it('the marker is POSITIONED at the reading, where the range bar is FILLED to it', () => {
    expect(read(parts.marker.style, state(2))).toBe('inset-inline-start:25%;')
    expect(read(parts.range.style, state(2))).toBe('inline-size:25%;')
  })

  it('lays every band out across the track, clamped into it', () => {
    expect(layout(2.1)).toStrictEqual([
      {
        id: 'low',
        tone: 'critical',
        label: 'low',
        from: 0,
        to: 0.4,
        start: 0,
        size: 5,
        current: false,
      },
      {
        id: 'ref',
        tone: 'optimal',
        label: 'optimal',
        from: 0.4,
        to: 4,
        start: 5,
        size: 45,
        current: true,
      },
      {
        id: 'high',
        tone: 'critical',
        label: 'high',
        from: 4,
        to: 8,
        start: 50,
        size: 50,
        current: false,
      },
    ])
  })

  it('a band reaching past the track paints inside it', () => {
    const wide = init({ value: 5, min: 0, max: 10, bands: [{ id: 'w', from: -100, to: 100 }] })
    expect(read(parts.bands, wide)[0]).toMatchObject({ from: -100, to: 100, start: 0, size: 100 })
  })

  it('an inverted band lays out with zero width and is never current', () => {
    const bad = init({ value: 5, min: 0, max: 10, bands: [{ id: 'bad', from: 8, to: 2 }] })
    expect(read(parts.bands, bad)[0]).toMatchObject({ size: 0, current: false })
  })

  it('a non-positive range lays every band out at zero width', () => {
    const flat = init({ value: 5, min: 10, max: 10, bands: PANEL })
    for (const band of read(parts.bands, flat)) expect(band).toMatchObject({ start: 0, size: 0 })
  })

  it('bandProps binds the ROW handle, so the bag spreads with no peek', () => {
    const [low, ref] = layout(2.1)
    const row = parts.bandProps(rootSignal<MeterBandGeometry>())
    expect(row['data-scope']).toBe('meter')
    expect(row['data-part']).toBe('band')
    expect(read(row['data-band'], ref)).toBe('ref')
    expect(read(row['data-state'], ref)).toBe('optimal')
    expect(read(row['data-current'], ref)).toBe('')
    expect(read(row.style, ref)).toBe('inset-inline-start:5%;inline-size:45%;')
    // The SAME bag, read against a different row — nothing was snapshotted.
    expect(read(row['data-band'], low)).toBe('low')
    expect(read(row['data-current'], low)).toBeUndefined()
  })

  it('band(id) resolves one band reactively', () => {
    const ref = parts.band('ref')
    expect(ref['data-band']).toBe('ref')
    expect(read(ref['data-state'], state(2.1))).toBe('optimal')
    expect(read(ref['data-current'], state(2.1))).toBe('')
    expect(read(ref['data-current'], state(6))).toBeUndefined()
    expect(read(ref.hidden, state(2.1))).toBe(false)
    expect(read(ref.style, state(2.1))).toBe('inset-inline-start:5%;inline-size:45%;')
  })

  it('band(id) for an unknown id is INERT, not a throw', () => {
    // `connect` runs while the view is being built, so a typo must cost one
    // undrawn stripe, never the page.
    const ghost = parts.band('nope')
    expect(read(ghost.hidden, state(2.1))).toBe(true)
    expect(read(ghost['data-state'], state(2.1))).toBe('neutral')
    expect(read(ghost['data-current'], state(2.1))).toBeUndefined()
    expect(read(ghost.style, state(2.1))).toBe('inset-inline-start:0%;inline-size:0%;')
  })

  it('band(id) with duplicate ids resolves the first', () => {
    const dup = init({
      value: 5,
      min: 0,
      max: 10,
      bands: [
        { id: 'x', from: 0, to: 10, tone: 'optimal' as const },
        { id: 'x', from: 0, to: 2, tone: 'critical' as const },
      ],
    })
    expect(read(parts.band('x')['data-state'], dup)).toBe('optimal')
  })

  it('hands the same state back the same array, so `each` does not re-key', () => {
    const s = state(2.1)
    expect(read(parts.bands, s)).toBe(read(parts.bands, s))
    expect(read(parts.bands, state(2.1))).not.toBe(read(parts.bands, s))
  })

  it('gives each connected instance its OWN derivation cell', () => {
    // Stated precisely, because a mutation caught the first version of this
    // test asserting nothing: `Signal.map` memoizes in FRONT of `deriveOnce`, so
    // moving the cell to module scope changes only how OFTEN `computeLayout`
    // runs — invisible to a same-instance identity check, and the test above is
    // therefore about the map handle, not about the memo.
    //
    // What a shared cell DOES change is this: the second instance would be
    // handed the FIRST one's array instead of deriving its own, and from then on
    // every update by either meter would evict the other's memo — the failure
    // `utils/derive.ts` names explicitly, and the reason a page of static meters
    // must not share one cell.
    const a = connect(rootSignal<MeterState>(), vi.fn())
    const b = connect(rootSignal<MeterState>(), vi.fn())
    const s = state(2.1)
    expect(read(b.bands, s)).not.toBe(read(a.bands, s))
  })
})
