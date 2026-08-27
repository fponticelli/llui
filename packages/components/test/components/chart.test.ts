import { describe, it, expect, vi } from 'vitest'
import { rootSignal, signalOf, read } from '../_signal'
import {
  init,
  update,
  connect,
  geometry,
  type ChartState,
  type ChartMsg,
  type ChartRow,
} from '../../src/components/chart'

const SERIES = [
  { key: 'desktop', label: 'Desktop', mark: 'bar' as const },
  { key: 'mobile', label: 'Mobile', mark: 'bar' as const },
]
const ROWS: ChartRow[] = [
  { label: 'Jan', values: { desktop: 186, mobile: 80 } },
  { label: 'Feb', values: { desktop: 305, mobile: 200 } },
  { label: 'Mar', values: { desktop: 237, mobile: 120 } },
]

const base = (over: Partial<ChartState> = {}): ChartState => ({
  ...init({ series: SERIES, rows: ROWS, label: 'Visitors' }),
  ...over,
})

const step = (state: ChartState, ...msgs: ChartMsg[]): ChartState =>
  msgs.reduce((s, m) => update(s, m)[0], state)

describe('chart — state shape', () => {
  it('is JSON-serializable and round-trips key-for-key', () => {
    const state = base()
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('OMITS an absent bound rather than storing undefined or ±Infinity', () => {
    // #177: only the omission survives a JSON round trip unchanged. `-Infinity`
    // rehydrates as `null` in a field declared `number`.
    const state = init({ series: SERIES })
    expect('min' in state).toBe(false)
    expect('max' in state).toBe(false)
    expect(Object.keys(JSON.parse(JSON.stringify(state)))).toEqual(Object.keys(state))
  })

  it('a non-finite init bound is treated as absent', () => {
    const state = init({ series: SERIES, min: NaN, max: Infinity })
    expect('min' in state).toBe(false)
    expect('max' in state).toBe(false)
  })

  it('setMin/setMax store a finite bound and REMOVE it again on null', () => {
    let s = step(base(), { type: 'setMin', value: -10 })
    expect(s.min).toBe(-10)
    s = step(s, { type: 'setMin', value: null })
    expect('min' in s).toBe(false)
  })

  it('a NaN bound write is dropped, leaving the range clamping', () => {
    // The #177 failure: NaN is not nullish, so it survives `?? -Infinity` and
    // every comparison against it is false — that side stops clamping.
    const s = step(base(), { type: 'setMin', value: -10 }, { type: 'setMin', value: NaN })
    expect('min' in s).toBe(false)
    expect(Number.isFinite(geometry(s).domain.min)).toBe(true)
  })
})

describe('chart — the coordinate switch', () => {
  it('is ONE message, and re-projects every mark', () => {
    const cart = base()
    const polar = step(cart, { type: 'setCoord', coord: 'polar' })
    expect(polar.coord).toBe('polar')
    // Same series, same rows, same domain — a different projection.
    expect(polar.series).toEqual(cart.series)
    expect(polar.rows).toEqual(cart.rows)
    expect(geometry(polar).domain).toEqual(geometry(cart).domain)
    // A cartesian bar is a rect; a polar one is an annular sector.
    expect(geometry(cart).marks[0]!.d).not.toContain('A')
    expect(geometry(polar).marks[0]!.d).toContain('A')
  })

  it('gridlines follow the projection too', () => {
    const cart = geometry(base()).gridLines
    expect(cart.at(-1)!.d).not.toContain('A')
    const polar = geometry(step(base(), { type: 'setCoord', coord: 'polar' })).gridLines
    // Bars present → ring grid, which is arc-based.
    expect(polar.at(-1)!.d).toContain('A')
    // The v = 0 ring is a POINT, and a zero-radius circle correctly draws
    // nothing. It is the baseline in cartesian and the centre in polar.
    expect(polar[0]!.value).toBe(0)
    expect(polar[0]!.d).toBe('')
    expect(cart[0]!.d).not.toBe('')
  })

  it('a line series in polar becomes a CLOSED radar outline', () => {
    const s = step(
      init({ series: [{ key: 'a', label: 'A', mark: 'line' }], rows: ROWS, coord: 'polar' }),
    )
    expect(geometry(s).marks[0]!.d.endsWith('Z')).toBe(true)
  })

  it('the same line series in cartesian is OPEN', () => {
    const s = init({ series: [{ key: 'a', label: 'A', mark: 'line' }], rows: ROWS })
    expect(geometry(s).marks[0]!.d.endsWith('Z')).toBe(false)
  })

  it('setCoord to the current value is a no-op by reference', () => {
    const s = base()
    expect(update(s, { type: 'setCoord', coord: 'cartesian' })[0]).toBe(s)
  })
})

describe('chart — geometry', () => {
  it('derives one mark per row for a bar series, one per series otherwise', () => {
    const bars = geometry(base()).marks
    expect(bars.length).toBe(SERIES.length * ROWS.length)
    const lines = geometry(
      init({ series: [{ key: 'a', label: 'A', mark: 'line' }], rows: ROWS }),
    ).marks
    expect(lines.length).toBe(1)
  })

  it('unstacked bar series sit SIDE BY SIDE, not on top of each other', () => {
    // Overlaying them hides the shorter series entirely AND reads as a stacked
    // chart, so the picture does not merely omit data — it misstates it.
    const marks = geometry(base()).marks
    const janDesktop = marks.find((m) => m.seriesKey === 'desktop' && m.index === 0)!
    const janMobile = marks.find((m) => m.seriesKey === 'mobile' && m.index === 0)!
    const xOf = (d: string): number => Number(d.slice(1).split(',')[0])
    expect(xOf(janDesktop.d)).toBeLessThan(xOf(janMobile.d))
    // …and the second series' slot starts where the first one's ends.
    const firstRight = Number(janDesktop.d.split('L')[1]!.split(',')[0])
    expect(firstRight).toBeCloseTo(xOf(janMobile.d), 3)
  })

  it('STACKED bars share the full band', () => {
    const marks = geometry(step(base(), { type: 'setStacked', stacked: true })).marks
    const a = marks.find((m) => m.seriesKey === 'desktop' && m.index === 0)!
    const b = marks.find((m) => m.seriesKey === 'mobile' && m.index === 0)!
    const xOf = (d: string): number => Number(d.slice(1).split(',')[0])
    expect(xOf(a.d)).toBeCloseTo(xOf(b.d), 3)
  })

  it('isolating a series does NOT move the remaining bars', () => {
    const all = geometry(base()).marks.find((m) => m.seriesKey === 'mobile' && m.index === 0)!
    const isolated = geometry(step(base(), { type: 'setActiveSeries', key: 'mobile' })).marks.find(
      (m) => m.seriesKey === 'mobile' && m.index === 0,
    )!
    expect(isolated.d).toBe(all.d)
  })

  it('memoizes on state identity — one computation per update', () => {
    const s = base()
    expect(geometry(s)).toBe(geometry(s))
    expect(geometry(step(s, { type: 'setCoord', coord: 'polar' }))).not.toBe(geometry(s))
  })

  it('stacking offsets each series above the previous', () => {
    const flat = geometry(base()).domain
    const stacked = geometry(step(base(), { type: 'setStacked', stacked: true })).domain
    // Jan..Mar stack to 266 / 505 / 357, so the axis must reach past 305.
    expect(stacked.max).toBeGreaterThan(flat.max)
  })

  it('negative values stack DOWNWARD, not onto the positive pile', () => {
    const s = init({
      series: SERIES,
      rows: [{ label: 'Jan', values: { desktop: 100, mobile: -40 } }],
      stacked: true,
    })
    const d = geometry(s).domain
    expect(d.min).toBeLessThanOrEqual(-40)
    expect(d.max).toBeGreaterThanOrEqual(100)
  })

  it('a missing or non-finite cell reads as 0 rather than voiding the path', () => {
    const s = init({
      series: SERIES,
      rows: [{ label: 'Jan', values: { desktop: NaN } }],
    })
    for (const m of geometry(s).marks) expect(m.d).not.toContain('NaN')
  })

  it('no rows yields no marks and a usable domain', () => {
    const s = init({ series: SERIES })
    expect(geometry(s).marks).toEqual([])
    expect(geometry(s).domain.max).toBeGreaterThan(geometry(s).domain.min)
  })

  it('a polar frame is CENTRED — it does not inherit the axis gutters', () => {
    // Reserving cartesian left/bottom padding for a circle pushes it off centre.
    const g = geometry(step(base(), { type: 'setCoord', coord: 'polar' }))
    expect(g.frame.x).toBe(g.frame.y)
    expect(g.frame.width).toBe(g.frame.height + (base().width - base().height))
  })
})

describe('chart — the active cursor', () => {
  it('moveActive wraps in both directions', () => {
    let s = step(base(), { type: 'moveActive', delta: 1 })
    expect(s.activeIndex).toBe(0)
    s = step(s, { type: 'moveActive', delta: -1 })
    expect(s.activeIndex).toBe(ROWS.length - 1)
    s = step(s, { type: 'moveActive', delta: 1 })
    expect(s.activeIndex).toBe(0)
  })

  it('a backward move from nothing lands on the LAST row', () => {
    expect(step(base(), { type: 'moveActive', delta: -1 }).activeIndex).toBe(ROWS.length - 1)
  })

  it('setActive clamps into range and clears on null', () => {
    expect(step(base(), { type: 'setActive', index: 99 }).activeIndex).toBe(ROWS.length - 1)
    expect(step(base(), { type: 'setActive', index: -5 }).activeIndex).toBe(0)
    expect(
      step(base(), { type: 'setActive', index: 1 }, { type: 'setActive', index: null }).activeIndex,
    ).toBeNull()
  })

  it('a non-finite index is DROPPED, not stored', () => {
    const s = step(base(), { type: 'setActive', index: 1 }, { type: 'setActive', index: NaN })
    expect(s.activeIndex).toBe(1)
  })

  it('setRows CLEARS a cursor whose row no longer exists', () => {
    // Clamping to a neighbour would silently select a row the user never chose.
    const s = step(base(), { type: 'setActive', index: 2 }, { type: 'setRows', rows: [ROWS[0]!] })
    expect(s.activeIndex).toBeNull()
  })

  it('setRows KEEPS a cursor that still points at a row', () => {
    const s = step(
      base(),
      { type: 'setActive', index: 0 },
      { type: 'setRows', rows: [ROWS[0]!, ROWS[1]!] },
    )
    expect(s.activeIndex).toBe(0)
  })

  it('the tooltip anchors at the TALLEST visible value in the row', () => {
    const s = step(base(), { type: 'setActive', index: 1 })
    const g = geometry(s)
    expect(g.tooltipAt).not.toBeNull()
    expect(g.tooltipRows.map((r) => r.value)).toEqual([305, 200])
    // Feb's tallest is 305 (desktop); the anchor must sit at its top, which in
    // cartesian is a SMALLER y than the shorter mobile bar's top.
    const mobileOnly = geometry(step(s, { type: 'setActiveSeries', key: 'mobile' })).tooltipAt!
    expect(g.tooltipAt!.y).toBeLessThan(mobileOnly.y)
  })

  it('no cursor means no tooltip anchor and no rows', () => {
    const g = geometry(base())
    expect(g.tooltipAt).toBeNull()
    expect(g.tooltipRows).toEqual([])
  })
})

describe('chart — series isolation', () => {
  it('setActiveSeries dims the others without removing them', () => {
    const s = step(base(), { type: 'setActiveSeries', key: 'mobile' })
    const marks = geometry(s).marks
    expect(marks.length).toBe(SERIES.length * ROWS.length)
    expect(marks.filter((m) => m.dimmed).every((m) => m.seriesKey === 'desktop')).toBe(true)
    expect(marks.filter((m) => !m.dimmed).every((m) => m.seriesKey === 'mobile')).toBe(true)
  })

  it('an unknown series key is refused', () => {
    const s = base()
    expect(update(s, { type: 'setActiveSeries', key: 'nope' })[0]).toBe(s)
  })

  it('null shows them all again', () => {
    const s = step(
      base(),
      { type: 'setActiveSeries', key: 'mobile' },
      { type: 'setActiveSeries', key: null },
    )
    expect(geometry(s).marks.some((m) => m.dimmed)).toBe(false)
  })
})

describe('chart — size and polar options', () => {
  it('setSize refuses a non-positive or non-finite box', () => {
    const s = base()
    expect(update(s, { type: 'setSize', width: 0, height: 100 })[0]).toBe(s)
    expect(update(s, { type: 'setSize', width: NaN, height: 100 })[0]).toBe(s)
    expect(step(s, { type: 'setSize', width: 800, height: 400 }).width).toBe(800)
  })

  it('innerRadius is clamped below a full collapse', () => {
    expect(step(base(), { type: 'setInnerRadius', value: 5 }).innerRadius).toBe(0.95)
    expect(step(base(), { type: 'setInnerRadius', value: -1 }).innerRadius).toBe(0)
    expect(step(base(), { type: 'setInnerRadius', value: NaN }).innerRadius).toBe(0)
  })

  it('horizontal swaps the cartesian axes', () => {
    const upright = geometry(base()).categoryTicks[0]!
    const sideways = geometry(step(base(), { type: 'setHorizontal', horizontal: true }))
      .categoryTicks[0]!
    expect(upright.anchor).toBe('middle')
    expect(sideways.anchor).toBe('end')
  })
})

describe('chart — connect', () => {
  const signal = rootSignal<ChartState>()

  it('publishes the coordinate system and the cursor as data attributes', () => {
    const p = connect(signal, vi.fn(), { id: 'visitors' })
    expect(read(p.root['data-coord'], base())).toBe('cartesian')
    expect(read(p.root['data-coord'], base({ coord: 'polar' }))).toBe('polar')
    expect(read(p.root['data-active'], base())).toBeUndefined()
    expect(read(p.root['data-active'], base({ activeIndex: 1 }))).toBe('')
  })

  it('names the svg through its own title and description', () => {
    const p = connect(signal, vi.fn(), { id: 'visitors' })
    expect(p.svg['aria-labelledby']).toBe('visitors:title visitors:desc')
    expect(p.title.id).toBe('visitors:title')
    expect(p.desc.id).toBe('visitors:desc')
    expect(p.svg.role).toBe('img')
    expect(p.svg.tabindex).toBe(0)
  })

  it('the viewBox follows the state size', () => {
    const p = connect(signal, vi.fn(), { id: 'v' })
    expect(read(p.svg.viewBox, base())).toBe('0 0 640 320')
    expect(read(p.svg.viewBox, base({ width: 800, height: 400 }))).toBe('0 0 800 400')
  })

  it('the tooltip bag is ATTRIBUTES ONLY, so it can be spread', () => {
    const p = connect(signal, vi.fn(), { id: 'v' })
    expect(Object.keys(p.tooltip).sort()).toEqual([
      'aria-live',
      'data-part',
      'data-scope',
      'hidden',
      'role',
      'style',
    ])
    expect(read(p.tooltip.hidden, base())).toBe(true)
    expect(read(p.tooltip.hidden, base({ activeIndex: 0 }))).toBe(false)
  })

  it('arrow keys walk the rows and Escape clears', () => {
    const send = vi.fn()
    const p = connect(signalOf(base()), send, { id: 'v' })
    const key = (k: string): KeyboardEvent =>
      ({ key: k, preventDefault: vi.fn() }) as unknown as KeyboardEvent

    p.svg.onKeyDown(key('ArrowRight'))
    expect(send).toHaveBeenCalledWith({ type: 'moveActive', delta: 1 })
    p.svg.onKeyDown(key('ArrowLeft'))
    expect(send).toHaveBeenCalledWith({ type: 'moveActive', delta: -1 })
    p.svg.onKeyDown(key('Home'))
    expect(send).toHaveBeenCalledWith({ type: 'firstActive' })
    p.svg.onKeyDown(key('End'))
    expect(send).toHaveBeenCalledWith({ type: 'lastActive' })
  })

  it('Escape only claims the key when there IS a cursor to clear', () => {
    // Claiming it unconditionally makes a chart swallow the Escape that should
    // have closed the dialog it sits in.
    const send = vi.fn()
    const idle = connect(signalOf(base()), send, { id: 'v' })
    const ev = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent
    idle.svg.onKeyDown(ev)
    expect(ev.preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('an unhandled key is left alone', () => {
    const send = vi.fn()
    const p = connect(signalOf(base()), send, { id: 'v' })
    const ev = { key: 'Tab', preventDefault: vi.fn() } as unknown as KeyboardEvent
    p.svg.onKeyDown(ev)
    expect(ev.preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('blur and pointer-leave clear the cursor', () => {
    const send = vi.fn()
    const p = connect(signal, send, { id: 'v' })
    p.svg.onBlur({} as FocusEvent)
    expect(send).toHaveBeenCalledWith({ type: 'setActive', index: null })
    send.mockClear()
    p.svg.onPointerLeave({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'setActive', index: null })
  })

  it('legend items toggle isolation and report it as aria-pressed', () => {
    const send = vi.fn()
    const p = connect(signalOf(base()), send, { id: 'v' })
    const item = p.legendItem('mobile')
    expect(read(item['aria-pressed'], base())).toBe(false)
    expect(read(item['aria-pressed'], base({ activeSeries: 'mobile' }))).toBe(true)
    expect(read(item['data-dimmed'], base({ activeSeries: 'desktop' }))).toBe('')
    item.onClick({} as MouseEvent)
    expect(send).toHaveBeenCalledWith({ type: 'setActiveSeries', key: 'mobile' })
  })

  it('every drawn layer names a PART, so a skin has something to select', () => {
    // A recipe naming a part nobody publishes is dead CSS — the registry's most
    // expensive bug class, and it shipped here first as a container styling
    // `[data-part='grid']` against paths that carried no `data-part` at all.
    const p = connect(signal, vi.fn(), { id: 'v' })
    expect(p.layer['data-part']).toBe('layer')
    expect(p.grid['data-part']).toBe('grid')
    expect(p.axisLabel['data-part']).toBe('axis-label')
    const vertex = { seriesKey: 'desktop', index: 0, x: 5, y: 6, active: true }
    expect(p.dotProps(vertex)).toEqual({
      'data-scope': 'chart',
      'data-part': 'dot',
      'data-series': 'desktop',
      'data-active': '',
      cx: 5,
      cy: 6,
    })
  })

  it('markProps carries the state a skin styles from', () => {
    const p = connect(signal, vi.fn(), { id: 'v' })
    const mark = geometry(base({ activeIndex: 0 })).marks[0]!
    const props = p.markProps(mark)
    expect(props['data-mark']).toBe('bar')
    expect(props['data-series']).toBe('desktop')
    expect(props['data-active']).toBe('')
    expect(props.d).toBe(mark.d)
  })
})
