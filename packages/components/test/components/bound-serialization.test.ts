import { describe, it, expect } from 'vitest'
import * as angleSlider from '../../src/components/angle-slider'
import * as asyncList from '../../src/components/async-list'
import * as breadcrumbs from '../../src/components/breadcrumbs'
import * as carousel from '../../src/components/carousel'
import * as colorPicker from '../../src/components/color-picker'
import * as datePicker from '../../src/components/date-picker'
import * as fileUpload from '../../src/components/file-upload'
import * as floatingPanel from '../../src/components/floating-panel'
import * as imageCropper from '../../src/components/image-cropper'
import * as marquee from '../../src/components/marquee'
import * as meter from '../../src/components/meter'
import * as numberInput from '../../src/components/number-input'
import * as pagination from '../../src/components/pagination'
import * as pinInput from '../../src/components/pin-input'
import * as progress from '../../src/components/progress'
import * as ratingGroup from '../../src/components/rating-group'
import * as scrollArea from '../../src/components/scroll-area'
import * as slider from '../../src/components/slider'
import * as splitter from '../../src/components/splitter'
import * as steps from '../../src/components/steps'
import * as table from '../../src/components/table'
import * as tagsInput from '../../src/components/tags-input'
import * as timePicker from '../../src/components/time-picker'
import * as timer from '../../src/components/timer'
import * as toast from '../../src/components/toast'
import * as tour from '../../src/components/tour'

/**
 * A BOUND in state is a finite number or an ABSENT one — never `±Infinity`,
 * never `NaN` (#177).
 *
 * This is the bound half of the same invariant `non-finite-input.test.ts`
 * covers for values, and it needs its own sweep because it is enforced
 * somewhere else: a bound defines the grid rather than naming a position on it,
 * so it never passes through `clamp`, and `finiteBound` normalises it at every
 * WRITE (`init`, and every message that sets one) instead.
 *
 * Two things go wrong when it does not, and the file asserts both:
 *
 *  1. SERIALIZATION. `JSON.stringify(Infinity)` and `JSON.stringify(NaN)` are
 *     both `null`, so a non-finite bound breaks the State-is-JSON-serializable
 *     invariant — devtools time-travel, `@llui/test` replay, agent state
 *     snapshots and SSR rehydration all compare serialized state. An unbounded
 *     `number-input` broke it on its DEFAULT configuration, and the rehydrated
 *     object held `null` in a field declared `number`.
 *  2. CLAMPING. `NaN` is not nullish, so a `NaN` bound survives every `??` and
 *     reaches the comparisons — all of which are false — and that side of the
 *     range silently stops clamping.
 *
 * The round trip is asserted with `toStrictEqual`, not `toEqual`: `toEqual`
 * ignores a property whose value is `undefined`, which is exactly the
 * difference between a state that OMITS an absent bound (round-trips as an
 * identity) and one that sets the key to `undefined` (rehydrates a key short).
 */

const NON_FINITE = [NaN, Infinity, -Infinity]

/** The state and its JSON round trip are the same object, key for key. */
function expectRoundTrip(state: unknown, label: string): void {
  expect(JSON.parse(JSON.stringify(state)), label).toStrictEqual(state)
}

/** No number anywhere in the state tree is non-finite. */
function expectAllFinite(state: unknown, label: string, path = ''): void {
  if (typeof state === 'number') {
    expect(Number.isFinite(state), `${label}${path}`).toBe(true)
    return
  }
  if (Array.isArray(state)) {
    state.forEach((v, i) => expectAllFinite(v, label, `${path}[${i}]`))
    return
  }
  if (state !== null && typeof state === 'object') {
    for (const [k, v] of Object.entries(state)) expectAllFinite(v, label, `${path}.${k}`)
  }
}

function expectSerializableState(state: unknown, label: string): void {
  expectAllFinite(state, label)
  expectRoundTrip(state, label)
}

/**
 * Every component that keeps a numeric bound in state, with the bound-carrying
 * `init` options poisoned by `bad`. `color-picker` is in the list as a control:
 * its min/max/step are `connect()` part-bag constants, so no bound reaches its
 * state and the sweep must still pass for it.
 */
function poisonedInits(bad: number): Array<[string, unknown]> {
  return [
    ['angle-slider', angleSlider.init({ value: 45, min: bad, max: bad, step: bad })],
    ['breadcrumbs', breadcrumbs.init({ maxVisible: bad })],
    ['carousel', carousel.init({ count: bad, interval: bad, swipeThreshold: bad })],
    ['color-picker', colorPicker.init({})],
    ['date-picker', datePicker.init({ months: bad })],
    ['file-upload', fileUpload.init({ maxFiles: bad, maxSize: bad, minFileSize: bad })],
    [
      'floating-panel',
      floatingPanel.init({
        minSize: { width: bad, height: bad },
        maxSize: { width: bad, height: bad },
      }),
    ],
    [
      'image-cropper',
      imageCropper.init({ image: { width: bad, height: bad }, minSize: bad, aspectRatio: bad }),
    ],
    ['marquee', marquee.init({ durationSec: bad })],
    ['meter', meter.init({ min: bad, max: bad, low: bad, high: bad, optimum: bad })],
    ['number-input', numberInput.init({ value: 5, min: bad, max: bad, step: bad })],
    ['pagination', pagination.init({ pageSize: bad, total: bad, siblings: bad, boundaries: bad })],
    ['pin-input', pinInput.init({ length: bad })],
    ['progress', progress.init({ min: bad, max: bad })],
    ['rating-group', ratingGroup.init({ count: bad })],
    ['slider', slider.init({ min: bad, max: bad, step: bad, minStepsBetweenThumbs: bad })],
    ['splitter', splitter.init({ min: bad, max: bad, step: bad })],
    ['table', table.init({ pageSize: bad })],
    ['tags-input', tagsInput.init({ max: bad })],
    ['time-picker', timePicker.init({ minuteStep: bad, secondStep: bad })],
    ['timer', timer.init({ targetMs: bad })],
    ['toast', toast.init({ max: bad })],
  ]
}

/** The same components, with no options at all. */
function defaultInits(): Array<[string, unknown]> {
  return [
    ['angle-slider', angleSlider.init()],
    ['breadcrumbs', breadcrumbs.init()],
    ['carousel', carousel.init()],
    ['color-picker', colorPicker.init()],
    ['date-picker', datePicker.init()],
    ['file-upload', fileUpload.init()],
    ['floating-panel', floatingPanel.init()],
    ['image-cropper', imageCropper.init()],
    ['marquee', marquee.init()],
    ['meter', meter.init()],
    ['number-input', numberInput.init()],
    ['pagination', pagination.init()],
    ['pin-input', pinInput.init()],
    ['progress', progress.init()],
    ['rating-group', ratingGroup.init()],
    ['slider', slider.init()],
    ['splitter', splitter.init()],
    ['table', table.init()],
    ['tags-input', tagsInput.init()],
    ['time-picker', timePicker.init()],
    ['timer', timer.init()],
    ['toast', toast.init()],
  ]
}

describe('the DEFAULT state of every bound-keeping component is serializable (#177)', () => {
  it('round-trips through JSON unchanged', () => {
    for (const [name, state] of defaultInits()) expectSerializableState(state, name)
  })

  it('number-input in particular — the default IS the unbounded case', () => {
    // The whole issue: this state broke the invariant with no bad input
    // anywhere, because "unbounded" was spelled `±Infinity`.
    const s = numberInput.init({ value: 5 })
    expect('min' in s, 'min key').toBe(false)
    expect('max' in s, 'max key').toBe(false)
    expectSerializableState(s, 'number-input default')
  })
})

describe('init never stores a non-finite bound (#177)', () => {
  for (const bad of NON_FINITE) {
    it(`init({ …: ${bad} })`, () => {
      for (const [name, state] of poisonedInits(bad)) {
        expectSerializableState(state, `${name} init(${bad})`)
      }
    })
  }
})

describe('a bound-writing message never stores a non-finite bound (#177)', () => {
  for (const bad of NON_FINITE) {
    it(`setMin/setMax/setCount/… (${bad})`, () => {
      const check = (label: string, state: unknown) => expectSerializableState(state, label)

      const angle = angleSlider.init({ value: 45 })
      check(`angle setMin(${bad})`, angleSlider.update(angle, { type: 'setMin', min: bad })[0])
      check(`angle setMax(${bad})`, angleSlider.update(angle, { type: 'setMax', max: bad })[0])

      check(
        `progress setMax(${bad})`,
        progress.update(progress.init(), { type: 'setMax', max: bad })[0],
      )
      check(`meter setMax(${bad})`, meter.update(meter.init(), { type: 'setMax', max: bad })[0])

      const pages = pagination.init({ total: 95 })
      check(
        `pagination setPageSize(${bad})`,
        pagination.update(pages, { type: 'setPageSize', pageSize: bad })[0],
      )
      check(
        `pagination setTotal(${bad})`,
        pagination.update(pages, { type: 'setTotal', total: bad })[0],
      )

      check(
        `carousel setCount(${bad})`,
        carousel.update(carousel.init({ count: 3 }), { type: 'setCount', count: bad })[0],
      )
      check(
        `timer setTarget(${bad})`,
        timer.update(timer.init(), { type: 'setTarget', targetMs: bad })[0],
      )
      check(
        `marquee setDuration(${bad})`,
        marquee.update(marquee.init(), { type: 'setDuration', durationSec: bad })[0],
      )

      const cropper = imageCropper.init({ image: { width: 400, height: 300 } })
      check(
        `image-cropper setImage(${bad})`,
        imageCropper.update(cropper, { type: 'setImage', width: bad, height: bad })[0],
      )
      check(
        `image-cropper setAspectRatio(${bad})`,
        imageCropper.update(cropper, { type: 'setAspectRatio', ratio: bad })[0],
      )
    })
  }
})

describe('a dropped bound leaves the component still clamping (#177)', () => {
  // Serializability is only half of it. The reason a non-finite bound is
  // REFUSED rather than stored is that every comparison against `NaN` is false,
  // so storing one switches that side of the range off — measured on
  // angle-slider, where `setValue(-9999)` stored -9999 after a `setMin: NaN`.
  it('angle-slider keeps its range after a refused setMin/setMax', () => {
    for (const bad of NON_FINITE) {
      const [s] = angleSlider.update(angleSlider.init({ value: 45 }), { type: 'setMin', min: bad })
      expect(angleSlider.update(s, { type: 'setValue', value: -9999 })[0].value).toBe(0)
      const [t] = angleSlider.update(angleSlider.init({ value: 45 }), { type: 'setMax', max: bad })
      expect(angleSlider.update(t, { type: 'setValue', value: 9999 })[0].value).toBe(360)
    }
  })

  it('rating-group keeps clamping into 0..count', () => {
    for (const bad of NON_FINITE) {
      const s = ratingGroup.init({ count: bad, value: 2 })
      expect(ratingGroup.update(s, { type: 'setValue', value: 99 })[0].value).toBe(5)
      expect(ratingGroup.update(s, { type: 'toEnd' })[0].value).toBe(5)
    }
  })

  it('splitter keeps clamping into 0..100', () => {
    for (const bad of NON_FINITE) {
      const s = splitter.init({ min: bad, max: bad })
      expect(splitter.update(s, { type: 'setPosition', position: 999 })[0].position).toBe(100)
      expect(splitter.update(s, { type: 'toMin' })[0].position).toBe(0)
      expect(splitter.update(s, { type: 'toMax' })[0].position).toBe(100)
    }
  })

  it('file-upload normalises a non-finite limit to its UNLIMITED sentinel', () => {
    // Stated exactly, because the name of this test used to over-claim: 0 is
    // `file-upload`'s "no limit" value (`state.maxSize > 0` gates the check),
    // and it is also the documented default a refused bound falls back to. So
    // for `maxSize` specifically, NaN -> 0 changes the STATE (serializable now)
    // and NOT the enforcement: `f.size > NaN` and `f.size > 0 === false` both
    // accept everything. The same holds for `minFileSize`, `maxFiles` and
    // `tags-input.max`, whose sentinel is also 0.
    const s = fileUpload.init({ maxSize: NaN })
    expect(s.maxSize).toBe(0)
    expectSerializableState(s, 'file-upload maxSize NaN')
    const big = { id: 'a', name: 'a.txt', size: 10_000, type: 'text/plain', lastModified: 0 }
    expect(fileUpload.validateFiles([big], s, 0).accepted).toHaveLength(1)

    // What the normalisation DOES protect is a limit that is actually a limit:
    // it stays enforced, and it is the only shape that ever rejected a file.
    const limited = fileUpload.init({ maxSize: 50 })
    const v = fileUpload.validateFiles([big], limited, 0)
    expect(v.accepted).toHaveLength(0)
    expect(v.rejected[0]?.errors[0]).toEqual({ code: 'TOO_LARGE', max: 50 })
  })

  it('pin-input builds a cell array for a degenerate length', () => {
    // `new Array(n)` THROWS a RangeError unless `n` is a non-negative integer,
    // so `length` was a CRASH in `init` rather than a bad value in state — and
    // finiteness alone does not close it: 2.5 and -1 are finite and throw.
    for (const bad of [...NON_FINITE, 2.5, -1, -0.5]) {
      const s = pinInput.init({ length: bad })
      expect(Number.isSafeInteger(s.length), `length ${bad}`).toBe(true)
      expect(s.length, `length ${bad}`).toBeGreaterThanOrEqual(0)
      expect(s.values, `values ${bad}`).toHaveLength(s.length)
      expectSerializableState(s, `pin-input length ${bad}`)
    }
    // A usable count is untouched, fraction and all — it truncates, it does not
    // round up to a cell the view would have nothing to render into.
    expect(pinInput.init({ length: 6 }).length).toBe(6)
    expect(pinInput.init({ length: 6.9 }).length).toBe(6)
  })

  it('floating-panel keeps clamping the panel size', () => {
    const s = floatingPanel.init({
      minSize: { width: NaN, height: NaN },
      maxSize: { width: NaN, height: 400 },
    })
    expect(s.minSize).toStrictEqual({ width: 200, height: 150 })
    // The finite half of a partly-unusable maximum survives; the other axis is
    // simply absent, which is what `clampSize` already read as unbounded.
    expect(s.maxSize).toStrictEqual({ height: 400 })
    const [resized] = floatingPanel.update(s, { type: 'setSize', width: 9999, height: 9999 })
    expect(resized.size).toStrictEqual({ width: 9999, height: 400 })
    expectSerializableState(resized, 'floating-panel resized')
  })
})

/**
 * A NON-BOUND number in state is finite too (#214). Unlike a value on a grid,
 * these positions, counters, measurements, and timestamps have no legal range
 * that can supply a replacement during an update. Initialization therefore
 * uses the field's ordinary default; a runtime message is refused atomically.
 */
describe('non-bound numeric initialization uses documented defaults (#214)', () => {
  for (const bad of NON_FINITE) {
    it(`defaults every poisoned field (${bad}) without throwing`, () => {
      const states: Array<[string, unknown]> = [
        ['async-list.page', asyncList.init({ page: bad })],
        ['carousel.current', carousel.init({ current: bad })],
        ['meter.value', meter.init({ value: bad })],
        ['pagination.page', pagination.init({ page: bad })],
        ['progress.value', progress.init({ value: bad })],
        ['rating-group.value', ratingGroup.init({ value: bad })],
        ['splitter.position', splitter.init({ position: bad })],
        [
          'steps.current/completed',
          steps.init({ current: bad, completed: [0, bad, 2], steps: ['a', 'b', 'c'] }),
        ],
        ['timer.elapsedMs', timer.init({ elapsedMs: bad })],
        [
          'tour.index',
          tour.init({
            index: bad,
            steps: [{ id: 'a', title: 'A', description: '', target: '#a' }],
          }),
        ],
        [
          'date-picker.visibleMonth/visibleYear',
          datePicker.init({ value: '2024-06-15', visibleMonth: bad, visibleYear: bad }),
        ],
        [
          'floating-panel.position/size',
          floatingPanel.init({
            position: { x: bad, y: 44 },
            size: { width: 320, height: bad },
          }),
        ],
        [
          'floating-panel.position/size inverse axes',
          floatingPanel.init({
            position: { x: 11, y: bad },
            size: { width: bad, height: 250 },
          }),
        ],
        [
          'color-picker.hsv/alpha',
          colorPicker.init({ hsv: { h: bad, s: bad, v: bad }, alpha: bad }),
        ],
        ['color-picker.hsl', colorPicker.init({ hsl: { h: bad, s: bad, l: bad } })],
      ]
      for (const [label, state] of states) expectSerializableState(state, label)

      expect(asyncList.init({ page: bad }).page).toBe(0)
      expect(carousel.init({ current: bad }).current).toBe(0)
      expect(meter.init({ value: bad }).value).toBe(0)
      expect(pagination.init({ page: bad }).page).toBe(1)
      expect(progress.init({ value: bad }).value).toBe(0)
      expect(ratingGroup.init({ value: bad }).value).toBe(0)
      expect(splitter.init({ position: bad }).position).toBe(50)
      expect(steps.init({ current: bad, completed: [0, bad] })).toMatchObject({
        current: 0,
        completed: [],
      })
      expect(timer.init({ elapsedMs: bad }).elapsedMs).toBe(0)
      expect(
        tour.init({
          index: bad,
          steps: [{ id: 'a', title: 'A', description: '', target: '#a' }],
        }).index,
      ).toBe(0)
      expect(
        datePicker.init({ value: '2024-06-15', visibleMonth: bad, visibleYear: bad }),
      ).toMatchObject({ visibleMonth: 6, visibleYear: 2024 })
      expect(
        floatingPanel.init({
          position: { x: bad, y: 44 },
          size: { width: 320, height: bad },
        }),
      ).toMatchObject({ position: { x: 100, y: 44 }, size: { width: 320, height: 300 } })
      expect(
        floatingPanel.init({
          position: { x: 11, y: bad },
          size: { width: bad, height: 250 },
        }),
      ).toMatchObject({ position: { x: 11, y: 100 }, size: { width: 400, height: 250 } })
      expect(colorPicker.init({ hsv: { h: bad, s: bad, v: bad }, alpha: bad })).toMatchObject({
        hsv: { h: 0, s: 100, v: 100 },
        alpha: 1,
      })
    })
  }

  it('keeps explicit null as progress indeterminate state', () => {
    expect(progress.init({ value: null }).value).toBeNull()
  })
})

describe('non-bound numeric runtime messages are atomic no-ops (#214)', () => {
  function expectIgnored<S, E>(before: S, result: readonly [S, E], label: string): void {
    expect(result[0], label).toBe(before)
    expectSerializableState(result[0], label)
  }

  for (const bad of NON_FINITE) {
    it(`refuses single-number position/value writes (${bad})`, () => {
      const carouselState = carousel.init({ current: 1, count: 3 })
      expectIgnored(
        carouselState,
        carousel.update(carouselState, { type: 'goTo', index: bad }),
        'carousel goTo',
      )

      const paginationState = pagination.init({ page: 2, total: 100 })
      expectIgnored(
        paginationState,
        pagination.update(paginationState, { type: 'goTo', page: bad }),
        'pagination goTo',
      )

      const meterState = meter.init({ value: 30 })
      expectIgnored(
        meterState,
        meter.update(meterState, { type: 'setValue', value: bad }),
        'meter setValue',
      )

      const progressState = progress.init({ value: 30 })
      expectIgnored(
        progressState,
        progress.update(progressState, { type: 'setValue', value: bad }),
        'progress setValue',
      )

      const ratingState = ratingGroup.init({ value: 3 })
      expectIgnored(
        ratingState,
        ratingGroup.update(ratingState, { type: 'hover', value: bad }),
        'rating hover',
      )
    })

    it(`refuses every poisoned member of multi-number measurements (${bad})`, () => {
      const panel = floatingPanel.init({
        position: { x: 10, y: 20 },
        size: { width: 300, height: 250 },
      })
      for (const msg of [
        { type: 'setPosition' as const, x: bad, y: 40 },
        { type: 'setPosition' as const, x: 30, y: bad },
        { type: 'setSize' as const, width: bad, height: 260 },
        { type: 'setSize' as const, width: 320, height: bad },
      ]) {
        expectIgnored(panel, floatingPanel.update(panel, msg), `floating-panel ${msg.type}`)
      }

      const dragging = floatingPanel.update(panel, { type: 'dragStart' })[0]
      for (const msg of [
        { type: 'dragMove' as const, dx: bad, dy: 1 },
        { type: 'dragMove' as const, dx: 1, dy: bad },
      ]) {
        expectIgnored(dragging, floatingPanel.update(dragging, msg), 'floating-panel dragMove')
      }

      const resizing = floatingPanel.update(panel, { type: 'resizeStart', handle: 'se' })[0]
      for (const msg of [
        { type: 'resizeMove' as const, dx: bad, dy: 1 },
        { type: 'resizeMove' as const, dx: 1, dy: bad },
      ]) {
        expectIgnored(resizing, floatingPanel.update(resizing, msg), 'floating-panel resizeMove')
      }

      const dims = {
        type: 'setScroll' as const,
        scrollTop: 10,
        scrollLeft: 20,
        scrollWidth: 1000,
        scrollHeight: 800,
        clientWidth: 300,
        clientHeight: 200,
      }
      for (const field of [
        'scrollTop',
        'scrollLeft',
        'scrollWidth',
        'scrollHeight',
        'clientWidth',
        'clientHeight',
      ] as const) {
        const state = scrollArea.init()
        const msg = { ...dims, [field]: bad }
        expectIgnored(state, scrollArea.update(state, msg), `scroll-area ${field}`)
      }
    })

    it(`refuses invalid gesture coordinates before arithmetic (${bad})`, () => {
      const carouselState = carousel.init({ count: 3 })
      expectIgnored(
        carouselState,
        carousel.update(carouselState, { type: 'dragStart', x: bad }),
        'carousel dragStart',
      )
      const carouselDrag = carousel.update(carouselState, { type: 'dragStart', x: 10 })[0]
      expectIgnored(
        carouselDrag,
        carousel.update(carouselDrag, { type: 'dragMove', x: bad }),
        'carousel dragMove',
      )

      const cropper = imageCropper.init({ image: { width: 400, height: 300 } })
      const cropDrag = imageCropper.update(cropper, { type: 'dragStart' })[0]
      for (const msg of [
        { type: 'dragMove' as const, dx: bad, dy: 1 },
        { type: 'dragMove' as const, dx: 1, dy: bad },
      ]) {
        expectIgnored(cropDrag, imageCropper.update(cropDrag, msg), 'image-cropper dragMove')
      }
      const cropResize = imageCropper.update(cropper, { type: 'resizeStart', handle: 'se' })[0]
      for (const msg of [
        { type: 'resizeMove' as const, dx: bad, dy: 1 },
        { type: 'resizeMove' as const, dx: 1, dy: bad },
      ]) {
        expectIgnored(cropResize, imageCropper.update(cropResize, msg), 'image-cropper resizeMove')
      }
    })

    it(`refuses invalid external time/date inputs before arithmetic (${bad})`, () => {
      const idle = timer.init({ elapsedMs: 250 })
      expectIgnored(idle, timer.update(idle, { type: 'start', now: bad }), 'timer start')
      const running = timer.update(idle, { type: 'start', now: 1000 })[0]
      expectIgnored(running, timer.update(running, { type: 'pause', now: bad }), 'timer pause')
      expectIgnored(running, timer.update(running, { type: 'tick', now: bad }), 'timer tick')

      const calendar = datePicker.init({ value: '2024-06-15' })
      expectIgnored(
        calendar,
        datePicker.update(calendar, { type: 'moveFocus', days: bad }),
        'date-picker moveFocus',
      )
    })

    it(`refuses invalid step identifiers atomically (${bad})`, () => {
      const stepsState = steps.init({
        current: 0,
        completed: [0],
        steps: ['a', 'b', 'c'],
        linear: false,
      })
      for (const msg of [
        { type: 'goTo' as const, step: bad },
        { type: 'complete' as const, step: bad },
        { type: 'markError' as const, step: bad },
        { type: 'clearError' as const, step: bad },
      ]) {
        expectIgnored(stepsState, steps.update(stepsState, msg), `steps ${msg.type}`)
      }

      const tourState = tour.init({
        steps: [{ id: 'a', title: 'A', description: '', target: '#a' }],
      })
      expectIgnored(tourState, tour.update(tourState, { type: 'goto', index: bad }), 'tour goto')
    })
  }

  it('preserves valid finite position, measurement, time, and date behavior', () => {
    expect(
      carousel.update(carousel.init({ count: 3 }), { type: 'goTo', index: 2 })[0].current,
    ).toBe(2)
    expect(
      pagination.update(pagination.init({ total: 100 }), { type: 'goTo', page: 5 })[0].page,
    ).toBe(5)
    expect(
      floatingPanel.update(floatingPanel.init(), { type: 'setPosition', x: -25, y: 40 })[0]
        .position,
    ).toStrictEqual({ x: -25, y: 40 })
    expect(
      scrollArea.update(scrollArea.init(), {
        type: 'setScroll',
        scrollTop: 10,
        scrollLeft: 20,
        scrollWidth: 1000,
        scrollHeight: 800,
        clientWidth: 300,
        clientHeight: 200,
      })[0],
    ).toMatchObject({ scrollTop: 10, overflowX: true, overflowY: true })
    const running = timer.update(timer.init({ elapsedMs: 50 }), { type: 'start', now: 1000 })[0]
    expect(timer.update(running, { type: 'tick', now: 1100 })[0]).toMatchObject({
      elapsedMs: 150,
      startedAt: 1100,
    })
    expect(
      datePicker.update(datePicker.init({ value: '2024-06-15' }), { type: 'moveFocus', days: 1 })[0]
        .focused,
    ).toBe('2024-06-16')
  })
})

describe('zero-divisor numeric state requires a positive finite number (#214)', () => {
  for (const bad of [...NON_FINITE, 0, -1]) {
    it(`defaults invalid initialization and refuses runtime updates (${bad})`, () => {
      expect(pagination.init({ pageSize: bad }).pageSize).toBe(10)
      expect(imageCropper.init({ aspectRatio: bad }).aspectRatio).toBeNull()

      const pages = pagination.init({ page: 2, pageSize: 10, total: 95 })
      expect(pagination.update(pages, { type: 'setPageSize', pageSize: bad })[0]).toBe(pages)

      const cropper = imageCropper.init({
        image: { width: 400, height: 300 },
        aspectRatio: 16 / 9,
      })
      expect(imageCropper.update(cropper, { type: 'setAspectRatio', ratio: bad })[0]).toBe(cropper)
      expectSerializableState(cropper, `cropper ratio ${bad}`)
    })
  }

  it('keeps null unconstrained and positive finite values functional', () => {
    const cropper = imageCropper.init({ image: { width: 400, height: 300 }, aspectRatio: 1 })
    const [free] = imageCropper.update(cropper, { type: 'setAspectRatio', ratio: null })
    expect(free.aspectRatio).toBeNull()
    expect(imageCropper.init({ aspectRatio: 2 }).aspectRatio).toBe(2)

    const pages = pagination.init({ page: 2, pageSize: 10, total: 95 })
    expect(pagination.update(pages, { type: 'setPageSize', pageSize: 20 })[0]).toMatchObject({
      page: 1,
      pageSize: 20,
    })
  })
})
