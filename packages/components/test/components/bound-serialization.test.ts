import { describe, it, expect } from 'vitest'
import * as angleSlider from '../../src/components/angle-slider'
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
import * as slider from '../../src/components/slider'
import * as splitter from '../../src/components/splitter'
import * as table from '../../src/components/table'
import * as tagsInput from '../../src/components/tags-input'
import * as timePicker from '../../src/components/time-picker'
import * as timer from '../../src/components/timer'
import * as toast from '../../src/components/toast'

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

  it('file-upload keeps enforcing its size limit', () => {
    // `f.size > NaN` is false, so a poisoned `maxSize` accepted every file.
    const s = fileUpload.init({ maxSize: NaN })
    expect(s.maxSize).toBe(0)
  })

  it('pin-input still builds a cell array', () => {
    // `new Array(NaN)` THROWS — the poisoned bound was not merely stored here.
    for (const bad of NON_FINITE) {
      const s = pinInput.init({ length: bad })
      expect(s.length).toBe(4)
      expect(s.values).toHaveLength(4)
    }
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
