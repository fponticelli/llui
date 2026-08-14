import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transition } from '../src/transition'
import { collapse } from '../src/presets'
import { spring } from '../src/spring'

// Issue #106 — the LEAVE direction of the interrupt story was written three
// times (transition/collapse/spring) and the ENTER direction zero times.
// `runs.isActive` was called exactly once in the whole package.
//
// An element resting mid-leave that is re-entered (the `each()` row
// resurrection, the `@llui/vike` route seam on a persistent element) drove to
// the far end and re-animated from there: opacity `["", "0", "1"]`, height
// `0px → 150px` with no measurement, spring restarting at its hardcoded `from`.
//
// jsdom does not interpolate, so "mid-leave" is simulated by writing the
// in-between value the browser would be showing.

/** Record every value written to `property` through `style.setProperty`. */
function recordWrites(el: HTMLElement, property: string): string[] {
  const writes: string[] = []
  const style = el.style
  const original = style.setProperty.bind(style)
  style.setProperty = (prop: string, value: string | null, priority?: string): void => {
    if (prop === property) writes.push(value ?? '')
    original(prop, value, priority)
  }
  return writes
}

function makeEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('transition(): an enter interrupting a leave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function fadeSpec() {
    return transition({
      duration: 200,
      enterActive: { transition: 'opacity 200ms' },
      enterFrom: { opacity: 0 },
      enterTo: { opacity: 1 },
      leaveActive: { transition: 'opacity 200ms' },
      leaveFrom: { opacity: 1 },
      leaveTo: { opacity: 0 },
    })
  }

  it('continues from the element’s current value instead of writing enterFrom', () => {
    const el = makeEl()
    const t = fadeSpec()

    void t.leave!([el])
    el.style.opacity = '0.4' // where the browser would be, mid-fade-out

    const writes = recordWrites(el, 'opacity')
    t.enter!([el])

    // '' is the superseded leave's rollback (no reflow between it and the next
    // write, so nothing is painted at that value); then the frozen current
    // value, then the target. `enterFrom`'s 0 — the far end — never appears.
    expect(writes).toEqual(['', '0.4', '1'])
  })

  it('still applies enterFrom for a fresh (non-interrupting) enter', () => {
    const el = makeEl()
    const t = fadeSpec()

    const writes = recordWrites(el, 'opacity')
    t.enter!([el])

    expect(writes).toEqual(['0', '1'])
  })

  it('treats a COMPLETED leave as resting, not as an interrupt', async () => {
    // A settled leave keeps its resting values registered but is not in flight —
    // the route seam's leave-then-enter must take the normal enterFrom path.
    const el = makeEl()
    const t = fadeSpec()

    void t.leave!([el])
    await vi.advanceTimersByTimeAsync(400)

    const writes = recordWrites(el, 'opacity')
    t.enter!([el])

    expect(writes).toEqual(['', '0', '1'])
  })

  it('freezes every property the phase animates, not just the first', () => {
    const el = makeEl()
    const t = transition({
      duration: 200,
      enterActive: { transition: 'opacity 200ms, transform 200ms' },
      enterFrom: { opacity: 0, transform: 'translate(0, -20px)' },
      enterTo: { opacity: 1, transform: 'translate(0, 0)' },
      leaveActive: { transition: 'opacity 200ms, transform 200ms' },
      leaveFrom: { opacity: 1, transform: 'translate(0, 0)' },
      leaveTo: { opacity: 0, transform: 'translate(0, -20px)' },
    })

    void t.leave!([el])
    el.style.opacity = '0.4'
    el.style.transform = 'translate(0, -8px)'

    const opacity = recordWrites(el, 'opacity')
    const transform = recordWrites(el, 'transform')
    t.enter!([el])

    expect(opacity).toEqual(['', '0.4', '1'])
    expect(transform).toEqual(['', 'translate(0, -8px)', 'translate(0, 0)'])
  })
})

describe('collapse(): an enter interrupting a leave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * An element that measures 150px naturally and 60px right now.
   *
   * `collapse` writes the size through the `style.height` accessor rather than
   * `setProperty`, so the observable moment is the REFLOW: `forceReflow` reads
   * `offsetHeight` between the start value and the target, and the value the
   * element sits at then is the value the transition animates FROM.
   */
  function sizedEl(): {
    el: HTMLElement
    rectReads: () => number
    heightAtReflow: () => string[]
  } {
    const el = makeEl()
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 150 })
    let reads = 0
    el.getBoundingClientRect = () => {
      reads++
      return { height: 60, width: 60, left: 0, top: 0 } as DOMRect
    }
    const atReflow: string[] = []
    Object.defineProperty(el, 'offsetHeight', {
      configurable: true,
      get: () => {
        atReflow.push(el.style.height)
        return 0
      },
    })
    return { el, rectReads: () => reads, heightAtReflow: () => atReflow }
  }

  it('measures the current size rather than assuming 0px', () => {
    const { el, rectReads, heightAtReflow } = sizedEl()
    const c = collapse({ duration: 200 })

    void c.leave!([el])
    expect(rectReads()).toBe(1) // the leave's own measurement
    expect(heightAtReflow()).toEqual(['60px'])

    c.enter!([el])

    // The interrupting enter MEASURES…
    expect(rectReads()).toBe(2)
    // …and animates from that size, not from a collapsed 0px.
    expect(heightAtReflow()).toEqual(['60px', '60px'])
    expect(el.style.height).toBe('150px')
  })

  it('still starts a fresh enter from 0px', () => {
    const { el, heightAtReflow } = sizedEl()
    const c = collapse({ duration: 200 })

    c.enter!([el])

    expect(heightAtReflow()).toEqual(['0px'])
    expect(el.style.height).toBe('150px')
  })

  it('treats a COMPLETED leave as resting, not as an interrupt', async () => {
    const { el, rectReads, heightAtReflow } = sizedEl()
    const c = collapse({ duration: 200 })

    void c.leave!([el])
    await vi.advanceTimersByTimeAsync(400)
    const readsAfterLeave = rectReads()

    c.enter!([el])

    // Nothing in flight: no measurement, and the open animates from 0px.
    expect(rectReads()).toBe(readsAfterLeave)
    expect(heightAtReflow()).toEqual(['60px', '0px'])
  })
})

describe('spring(): an enter interrupting a leave', () => {
  /** Manual rAF pump so a loop can be interrupted mid-flight deterministically. */
  function pumpableRaf() {
    const queue: FrameRequestCallback[] = []
    const spy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        queue.push(cb)
        return queue.length
      })
    const pump = (time: number): void => {
      for (const cb of queue.splice(0)) cb(time)
    }
    return { pump, restore: () => spy.mockRestore() }
  }

  it('starts from the element’s current value, not the hardcoded `from`', () => {
    const el = makeEl()
    const { pump, restore } = pumpableRaf()
    try {
      const t = spring({ property: 'opacity', from: 0, to: 1 })

      void t.leave!([el]) // 1 → 0
      pump(16)
      pump(32)
      const mid = parseFloat(el.style.getPropertyValue('opacity'))
      expect(mid).toBeGreaterThan(0)
      expect(mid).toBeLessThan(1)

      // `animateOne` writes its start value inline synchronously.
      t.enter!([el])
      const enterStart = parseFloat(el.style.getPropertyValue('opacity'))
      expect(enterStart).toBeCloseTo(mid, 5)
      expect(enterStart).not.toBe(0)
    } finally {
      restore()
    }
  })

  it('still starts a fresh enter from `from`', () => {
    const el = makeEl()
    const { restore } = pumpableRaf()
    try {
      const t = spring({ property: 'opacity', from: 0, to: 1 })
      t.enter!([el])
      expect(el.style.getPropertyValue('opacity')).toBe('0')
    } finally {
      restore()
    }
  })

  it('starts from `from` again once a leave has fully settled', () => {
    const el = makeEl()
    const { pump, restore } = pumpableRaf()
    try {
      const t = spring({ property: 'opacity', from: 0, to: 1 })
      void t.leave!([el])
      // Pump to settlement — the loop ends and deregisters the element.
      for (let time = 16; time < 20000; time += 16) pump(time)
      expect(parseFloat(el.style.getPropertyValue('opacity'))).toBe(0)

      t.enter!([el])
      // Nothing in flight: the enter is a fresh one starting at `from` (0),
      // which is also exactly where the settled leave left it.
      expect(el.style.getPropertyValue('opacity')).toBe('0')
    } finally {
      restore()
    }
  })
})
