import type { Send, Signal } from '@llui/dom'
import { deriveOnce } from '../utils/derive.js'
import { allFiniteNumbers, finiteBound, finiteOrDefault } from '../utils/number.js'

/**
 * Meter — role="meter" gauge for a scalar measurement within a known range
 * (disk usage, a battery level, a lab result against its reference range).
 * Distinct from progressbar: a meter is never indeterminate and represents a
 * static measurement rather than task progress.
 *
 * ── The band model (#235) ────────────────────────────────────────────────
 *
 * State carries ONE model of quality: `bands`, a list of named regions each
 * with its own tone. A reference range is N bands (a lipid panel is four, a
 * thyroid panel three with asymmetric widths), and the reading is a MARKER
 * sitting on the banded track rather than a filled bar.
 *
 * The native `<meter>` spelling — `low` / `high` / `optimum` — is still how you
 * WRITE the three-segment case: `init` compiles it into the same `bands`, so
 * there is one derivation, one attribute vocabulary and one thing to style. It
 * is an INIT option, not a state field; nothing reads `state.low` any more.
 *
 * EDGES ARE HALF-OPEN, `[from, to)`. A value on a shared edge belongs to the
 * UPPER band, which is what lets adjacent bands tile with no ambiguity. The one
 * exception is the top of the track: a band whose `to` reaches `max` contains a
 * full-scale reading, which a half-open edge would otherwise leave in no band
 * at all. An ABSENT edge is open on that side (#177's unbounded-capable idiom —
 * the key is omitted, never set to `undefined`/`±Infinity`), which is how you
 * write "below 0.4" and "above 4.0".
 *
 * Bands are DATA, so their geometry is derived and never stored: `connect`
 * memoizes it on state identity with `deriveOnce`, one cell per instance.
 *
 * ── Static meters ────────────────────────────────────────────────────────
 *
 * A rendered lab result does not animate, and a page with dozens of them does
 * not want a TEA runtime each. That is not a meter-specific entry point: pass
 * `constant(state)` and `noSend` from `@llui/dom` and the whole part bag
 * resolves with no component around it (`test/stateless-connect.test.ts`).
 */

/**
 * A band's quality, and the whole `data-state` vocabulary. `neutral` is the
 * absence of an opinion — a plain gauge, or a band the author gave no tone —
 * and is deliberately not a synonym for `optimal`: a disk-usage meter with no
 * thresholds declared is not claiming the reading is good.
 */
export type MeterTone = 'optimal' | 'suboptimal' | 'critical' | 'neutral'

const TONES: readonly MeterTone[] = ['optimal', 'suboptimal', 'critical', 'neutral']

/**
 * A band as STATE holds it.
 *
 * `tone` is always present — `init`/`setBands` fill the default, so every read
 * is total. The EDGES follow #177's UNBOUNDED-CAPABLE idiom: an absent key
 * means the band is open on that side, and the key is OMITTED rather than set
 * to `undefined`, so the JSON round trip is an identity key for key.
 *
 * `label` is what `aria-valuetext` announces ("2.1 mIU/L, optimal") — the
 * accessibility win the band model exists for, since a bare `aria-valuenow` of
 * 47 says nothing about whether the reading is in range. An author-written band
 * defaults its label to its `id`; write `label: ''` to announce nothing.
 */
export interface MeterBand {
  id: string
  tone: MeterTone
  /** Lower edge, INCLUSIVE. Absent → open below. */
  from?: number
  /** Upper edge, EXCLUSIVE (inclusive only where it reaches `max`). Absent → open above. */
  to?: number
  label?: string
}

/** A band as a consumer WRITES it; `init`/`setBands` normalise it into a {@link MeterBand}. */
export interface MeterBandInit {
  id: string
  from?: number
  to?: number
  tone?: MeterTone
  label?: string
}

export interface MeterState {
  value: number
  min: number
  max: number
  /**
   * The reference range, in AUTHOR ORDER. Nothing is sorted or merged: order
   * decides which band wins an overlap (the first match) and the order the
   * view draws them in, and re-ordering the author's ids would silently change
   * both.
   */
  bands: MeterBand[]
}

export type MeterMsg =
  /** @humanOnly */
  | { type: 'setValue'; value: number }
  /** @humanOnly */
  | { type: 'setMax'; max: number }
  /** @humanOnly */
  | { type: 'setBands'; bands: readonly MeterBandInit[] }

export interface MeterInit {
  value?: number
  min?: number
  max?: number
  /**
   * Native `<meter>` spelling for the three-segment case, compiled into
   * {@link MeterState.bands} as `low` / `middle` / `high`. Ignored when
   * `bands` is given and yields at least one usable band — which is what makes
   * `bands: []` keep the single-optimum behaviour.
   */
  low?: number
  high?: number
  optimum?: number
  bands?: readonly MeterBandInit[]
}

function isTone(raw: unknown): raw is MeterTone {
  return typeof raw === 'string' && (TONES as readonly string[]).includes(raw)
}

/**
 * Author bands → state bands.
 *
 * An entry with no string `id` is DROPPED: an id is what `parts.band(id)`
 * addresses and what an `each` row keys on, and a row with no stable key has no
 * handle to reorder by.
 *
 * A non-finite edge is normalised away by `finiteBound` (#177) and the band is
 * OPEN on that side — the same reading `number-input` gives an unusable `min`.
 * An INVERTED band (`from > to`) is kept as written and simply matches nothing;
 * swapping the edges would invent an interval the author did not write, and
 * dropping the band would make the rendered list disagree with state.
 */
function normalizeBands(raw: readonly MeterBandInit[] | undefined): MeterBand[] {
  if (!Array.isArray(raw)) return []
  const out: MeterBand[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.id !== 'string') continue
    const band: MeterBand = { id: entry.id, tone: isTone(entry.tone) ? entry.tone : 'neutral' }
    const from = finiteBound(entry.from)
    const to = finiteBound(entry.to)
    if (from !== undefined) band.from = from
    if (to !== undefined) band.to = to
    band.label = typeof entry.label === 'string' ? entry.label : entry.id
    out.push(band)
  }
  return out
}

/**
 * The native `<meter>` three-segment range as bands.
 *
 * Segments are positional (`low` / `middle` / `high`); the TONE is the quality,
 * and it is decided the way the HTML gauge does — the segment holding `optimum`
 * is optimal, the one next to it sub-optimal, the far one critical. With no
 * `optimum` there is no preference at all, so every segment is `neutral`.
 *
 * They carry NO label: `low` / `middle` / `high` are positions, not names a
 * screen reader should read out, and a real name is consumer text that would
 * need a locale. An author who wants an announcement writes explicit bands.
 */
function nativeBands(
  low: number | undefined,
  high: number | undefined,
  optimum: number | undefined,
): MeterBand[] {
  if (low === undefined && high === undefined && optimum === undefined) return []
  const segmentOf = (v: number): number =>
    low !== undefined && v < low ? 0 : high !== undefined && v >= high ? 2 : 1
  const optimumSegment = optimum === undefined ? null : segmentOf(optimum)
  const toneFor = (segment: number): MeterTone => {
    if (optimumSegment === null) return 'neutral'
    const distance = Math.abs(segment - optimumSegment)
    return distance === 0 ? 'optimal' : distance === 1 ? 'suboptimal' : 'critical'
  }

  const bands: MeterBand[] = []
  if (low !== undefined) bands.push({ id: 'low', tone: toneFor(0), to: low })
  const middle: MeterBand = { id: 'middle', tone: toneFor(1) }
  if (low !== undefined) middle.from = low
  if (high !== undefined) middle.to = high
  bands.push(middle)
  if (high !== undefined) bands.push({ id: 'high', tone: toneFor(2), from: high })
  return bands
}

export function init(opts: MeterInit = {}): MeterState {
  // Every bound normalised (#177). `min`/`max` are required, so a non-finite
  // one takes the default; band edges are unbounded-capable, so an unusable one
  // is left out and reads as open.
  const explicit = normalizeBands(opts.bands)
  return {
    value: finiteOrDefault(opts.value, 0),
    min: finiteBound(opts.min) ?? 0,
    max: finiteBound(opts.max) ?? 100,
    bands:
      explicit.length > 0
        ? explicit
        : nativeBands(finiteBound(opts.low), finiteBound(opts.high), finiteBound(opts.optimum)),
  }
}

export function update(state: MeterState, msg: MeterMsg): [MeterState, never[]] {
  switch (msg.type) {
    case 'setValue':
      if (!allFiniteNumbers(msg.value)) return [state, []]
      return [{ ...state, value: msg.value }, []]
    case 'setMax': {
      // Dropped, not stored: keeping the range the meter already had is the
      // only answer that cannot make `percent` return `NaN` forever (#177).
      const max = finiteBound(msg.max)
      if (max === undefined) return [state, []]
      return [{ ...state, max }, []]
    }
    case 'setBands':
      // Replaces the range outright. It does NOT fall back to the native
      // spelling the way `init` does — `low`/`high`/`optimum` are init options,
      // not state, so there is nothing left to re-synthesise from.
      return [{ ...state, bands: normalizeBands(msg.bands) }, []]
  }
}

export function percent(state: MeterState): number {
  return valuePercent(state, state.value)
}

/** Where a value sits along the track, in percent. A non-positive range has no
 *  position to report, so everything sits at the start. */
function valuePercent(state: MeterState, value: number): number {
  const range = state.max - state.min
  if (!(range > 0) || !isFinite(range) || !isFinite(value)) return 0
  return ((value - state.min) / range) * 100
}

/**
 * Percent as a style string writes it, clamped into the track and with the
 * float noise trimmed. The reconciler commits on OUTPUT-equality, so a style
 * recomputed from unchanged data must be byte-identical — `0.1 + 0.2` reaching
 * one from a different route is a commit on every unrelated state change
 * (`chart`'s `path.ts:fmt`, same reason).
 */
function pct(n: number): string {
  if (!isFinite(n)) return '0'
  return String(Number(Math.max(0, Math.min(100, n)).toFixed(4)))
}

/** Deliberately NOT a type predicate: `MeterBand[]` already satisfies one, so
 *  `every` would narrow its false branch to `never` and the filter below would
 *  not type-check. The input is a rehydrated blob, hence `unknown`. */
const isBandLike = (band: unknown): boolean => band !== null && typeof band === 'object'

/**
 * Bands as a TOTAL read: a rehydrated state that lost the key — or carries a
 * HOLE the type forbids — renders empty rather than throwing (#165's items
 * seam, one step smaller). The seam is total at BOTH levels, because a guard on
 * the array alone still dereferences whatever is inside it: `bands: [null]`
 * threw where `bands: null` was handled.
 *
 * The common case returns the caller's OWN array with no allocation; only a
 * list that actually holds a hole pays for a copy.
 */
function bandsOf(state: MeterState): readonly MeterBand[] {
  const raw = state.bands
  if (!Array.isArray(raw)) return []
  return raw.every(isBandLike) ? raw : raw.filter(isBandLike)
}

/**
 * Index of the band the reading falls in, or -1.
 *
 * ONE membership rule, shared by `bandAt`, the derived layout and every
 * attribute: `[from, to)`, first match in author order, with the top of the
 * track inclusive. A value below every band, above every band, in a GAP between
 * two, or inside no band because they are all inverted, is in NO band — never
 * the nearest one. Inventing membership would misstate a lab result, which is
 * the one thing this widget must not do.
 */
function matchIndex(state: MeterState): number {
  const bands = bandsOf(state)
  const { value } = state
  if (!isFinite(value)) return -1
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!
    const from = band.from ?? -Infinity
    const to = band.to ?? Infinity
    if (value < from) continue
    if (value < to) return i
    // The top of the track is inclusive — see the header.
    if (value === to && to >= state.max) return i
  }
  return -1
}

/** The band the reading falls in, or `null`. See {@link matchIndex} for the rule. */
export function bandAt(state: MeterState): MeterBand | null {
  const index = matchIndex(state)
  return index < 0 ? null : bandsOf(state)[index]!
}

/** The current band's tone — the `data-state` every part carries. */
export function toneAt(state: MeterState): MeterTone {
  return bandAt(state)?.tone ?? 'neutral'
}

/**
 * One band, laid out. Derived from state and stored nowhere: `from`/`to` are
 * the resolved VALUE edges (an open side takes the track bound), `start`/`size`
 * are the drawn box in percent, clamped into the track so a band reaching past
 * `min`/`max` paints inside it.
 */
export interface MeterBandGeometry {
  id: string
  tone: MeterTone
  label: string | undefined
  from: number
  to: number
  start: number
  size: number
  current: boolean
}

function computeLayout(state: MeterState): MeterBandGeometry[] {
  const bands = bandsOf(state)
  const current = matchIndex(state)
  const lo = Math.min(state.min, state.max)
  const hi = Math.max(state.min, state.max)
  return bands.map((band, index) => {
    const from = band.from ?? state.min
    const to = band.to ?? state.max
    const start = Number(pct(valuePercent(state, Math.max(lo, Math.min(hi, from)))))
    const end = Number(pct(valuePercent(state, Math.max(lo, Math.min(hi, to)))))
    return {
      id: band.id,
      tone: band.tone,
      label: band.label,
      from,
      to,
      start,
      size: Math.max(0, Number((end - start).toFixed(4))),
      current: index === current,
    }
  })
}

export interface MeterParts {
  root: {
    role: 'meter'
    'aria-valuemin': Signal<number>
    'aria-valuemax': Signal<number>
    'aria-valuenow': Signal<number>
    'aria-valuetext': Signal<string>
    'aria-label': string | undefined
    // Spelled out rather than aliased: `scripts/test/registry-attrs.test.ts`
    // reads part-bag VALUES syntactically and gives an ALIAS no verdict, which
    // is how the shipped skin came to style `data-[state=critical]` against a
    // machine emitting `low`/`high` — two rules of dead CSS, for a release.
    'data-state': Signal<'optimal' | 'suboptimal' | 'critical' | 'neutral'>
    /** The current band's id — absent when the reading is in no band. */
    'data-band': Signal<string | undefined>
    'data-scope': 'meter'
    'data-part': 'root'
  }
  track: {
    'data-state': Signal<'optimal' | 'suboptimal' | 'critical' | 'neutral'>
    'data-scope': 'meter'
    'data-part': 'track'
  }
  /** The filled bar of a classic gauge: `inline-size` up to the reading. */
  range: {
    'data-state': Signal<'optimal' | 'suboptimal' | 'critical' | 'neutral'>
    'data-scope': 'meter'
    'data-part': 'range'
    style: Signal<string>
  }
  /** The reading itself, for a BANDED track: positioned, not filled. */
  marker: {
    'data-state': Signal<'optimal' | 'suboptimal' | 'critical' | 'neutral'>
    'data-band': Signal<string | undefined>
    'data-scope': 'meter'
    'data-part': 'marker'
    style: Signal<string>
  }
  label: {
    'data-scope': 'meter'
    'data-part': 'label'
  }
  /** The laid-out bands, for `each` — key rows on `band.id`. */
  bands: Signal<MeterBandGeometry[]>
  /**
   * Attributes for one laid-out band, taking the ROW HANDLE `each` hands the
   * render function. It returns signals rather than plain values so the bag is
   * spreadable AS IS — `chart`'s `markProps` takes a snapshot instead and every
   * call site has to `peek()` the row and then re-bind the fields that move.
   */
  bandProps: (band: Signal<MeterBandGeometry>) => {
    'data-scope': 'meter'
    'data-part': 'band'
    'data-band': Signal<string>
    'data-state': Signal<'optimal' | 'suboptimal' | 'critical' | 'neutral'>
    'data-current': Signal<'' | undefined>
    style: Signal<string>
  }
  /**
   * One band by id, for a view that names its bands statically. An id no band
   * carries yields an INERT bag — `hidden`, zero-width, `neutral` — rather than
   * throwing: `connect` runs while the view is being built, so a typo would
   * take the whole page down instead of leaving one stripe undrawn.
   */
  band: (id: string) => {
    'data-scope': 'meter'
    'data-part': 'band'
    'data-band': string
    'data-state': Signal<'optimal' | 'suboptimal' | 'critical' | 'neutral'>
    'data-current': Signal<'' | undefined>
    hidden: Signal<boolean>
    style: Signal<string>
  }
  /** The formatted reading, WITHOUT the band name. */
  valueText: Signal<string>
  /** The current band's announced name, or `''`. */
  bandLabel: Signal<string>
}

export interface ConnectOptions {
  label?: string
  /** Custom formatter for the numeric half of the value text. */
  format?: (value: number, max: number) => string
}

export function connect(
  state: Signal<MeterState>,
  _send: Send<MeterMsg>,
  opts: ConnectOptions = {},
): MeterParts {
  const label = opts.label
  const format = opts.format

  // One cell per INSTANCE, never at module scope: every band binding and every
  // root attribute reads the same layout, and two mounted meters must not evict
  // each other's derivation (`utils/derive.ts`).
  const layout = deriveOnce(computeLayout)
  const current = (s: MeterState): MeterBandGeometry | null =>
    layout(s).find((band) => band.current) ?? null
  const byId = (s: MeterState, id: string): MeterBandGeometry | null =>
    layout(s).find((band) => band.id === id) ?? null

  const tone = (s: MeterState): MeterTone => current(s)?.tone ?? 'neutral'
  const bandName = (s: MeterState): string => current(s)?.label ?? ''
  const numericText = (s: MeterState): string =>
    format ? format(s.value, s.max) : defaultFormat(s)
  const valueText = (s: MeterState): string => {
    const name = bandName(s)
    return name === '' ? numericText(s) : `${numericText(s)}, ${name}`
  }

  return {
    root: {
      role: 'meter',
      'aria-valuemin': state.map((s) => s.min),
      'aria-valuemax': state.map((s) => s.max),
      'aria-valuenow': state.map((s) => s.value),
      'aria-valuetext': state.map((s) => valueText(s)),
      'aria-label': label,
      'data-state': state.map((s) => tone(s)),
      'data-band': state.map((s) => current(s)?.id),
      'data-scope': 'meter',
      'data-part': 'root',
    },
    track: {
      'data-state': state.map((s) => tone(s)),
      'data-scope': 'meter',
      'data-part': 'track',
    },
    range: {
      'data-state': state.map((s) => tone(s)),
      'data-scope': 'meter',
      'data-part': 'range',
      style: state.map((s) => `inline-size:${pct(percent(s))}%;`),
    },
    marker: {
      'data-state': state.map((s) => tone(s)),
      'data-band': state.map((s) => current(s)?.id),
      'data-scope': 'meter',
      'data-part': 'marker',
      style: state.map((s) => `inset-inline-start:${pct(percent(s))}%;`),
    },
    label: {
      'data-scope': 'meter',
      'data-part': 'label',
    },
    bands: state.map((s) => layout(s)),
    bandProps: (band) => ({
      'data-scope': 'meter',
      'data-part': 'band',
      'data-band': band.at('id'),
      'data-state': band.at('tone'),
      'data-current': band.map((b) => (b.current ? '' : undefined)),
      style: band.map((b) => bandStyle(b)),
    }),
    band: (id) => ({
      'data-scope': 'meter',
      'data-part': 'band',
      'data-band': id,
      'data-state': state.map((s) => byId(s, id)?.tone ?? 'neutral'),
      'data-current': state.map((s) => (byId(s, id)?.current === true ? '' : undefined)),
      hidden: state.map((s) => byId(s, id) === null),
      style: state.map((s) => {
        const band = byId(s, id)
        return band === null ? 'inset-inline-start:0%;inline-size:0%;' : bandStyle(band)
      }),
    }),
    valueText: state.map((s) => numericText(s)),
    bandLabel: state.map((s) => bandName(s)),
  }
}

function bandStyle(band: MeterBandGeometry): string {
  return `inset-inline-start:${pct(band.start)}%;inline-size:${pct(band.size)}%;`
}

function defaultFormat(state: MeterState): string {
  return `${Math.round(percent(state))}%`
}

export const meter = { init, update, connect, percent, bandAt, toneAt }
