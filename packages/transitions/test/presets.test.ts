import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fade, slide, scale, collapse } from '../src/presets'

function makeEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('fade()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sets opacity 0 → 1 on enter', () => {
    const el = makeEl()
    const t = fade({ duration: 100 })
    t.enter!([el])
    expect(el.style.opacity).toBe('1')
  })

  it('restores an author-set inline opacity after the transition (finding 8)', async () => {
    const el = makeEl()
    el.style.opacity = '0.5' // author-set inline value
    const t = fade({ duration: 100 })
    t.enter!([el])
    // Drive the fallback timer so the enter completes and cleanup runs.
    await vi.advanceTimersByTimeAsync(200)
    // Cleanup must RESTORE the pre-transition inline value, not blank it.
    expect(el.style.opacity).toBe('0.5')
  })

  it('sets opacity 1 → 0 on leave', () => {
    const el = makeEl()
    const t = fade({ duration: 100 })
    void t.leave!([el])
    expect(el.style.opacity).toBe('0')
  })

  it('applies custom easing', () => {
    const el = makeEl()
    const t = fade({ duration: 200, easing: 'ease-in' })
    t.enter!([el])
    expect(el.style.transition).toContain('ease-in')
    expect(el.style.transition).toContain('200ms')
  })

  it('appear=false disables enter', () => {
    const t = fade({ appear: false })
    expect(t.enter).toBeUndefined()
  })
})

describe('slide()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('slides from above with direction=down', () => {
    const el = makeEl()
    const t = slide({ direction: 'down', distance: 30, duration: 100 })
    void t.leave!([el])
    expect(el.style.transform).toBe('translate(0, -30px)')
  })

  it('slides from below with direction=up', () => {
    const el = makeEl()
    const t = slide({ direction: 'up', distance: 20, duration: 100 })
    void t.leave!([el])
    expect(el.style.transform).toBe('translate(0, 20px)')
  })

  it('final enter transform is identity', () => {
    const el = makeEl()
    const t = slide({ direction: 'up', duration: 100 })
    t.enter!([el])
    expect(el.style.transform).toBe('translate(0, 0)')
  })

  it('includes opacity when fade=true (default)', () => {
    const el = makeEl()
    const t = slide({ duration: 100 })
    void t.leave!([el])
    expect(el.style.opacity).toBe('0')
  })

  it('omits opacity when fade=false', () => {
    const el = makeEl()
    const t = slide({ duration: 100, fade: false })
    void t.leave!([el])
    expect(el.style.opacity).toBe('')
  })
})

describe('scale()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses from factor on leave', () => {
    const el = makeEl()
    const t = scale({ from: 0.5, duration: 100 })
    void t.leave!([el])
    expect(el.style.transform).toBe('scale(0.5)')
  })

  it('final enter transform is scale(1)', () => {
    const el = makeEl()
    const t = scale({ duration: 100 })
    t.enter!([el])
    expect(el.style.transform).toBe('scale(1)')
  })

  it('applies custom origin', () => {
    const el = makeEl()
    const t = scale({ duration: 100, origin: 'top left' })
    t.enter!([el])
    expect(el.style.transformOrigin).toBe('top left')
  })
})

// ── Issue #142 — the emitted `transition` SHORTHAND ──────────────────────────
//
// The CSS Transitions shorthand is a comma-separated list of single-transitions,
// not a property list with one trailing timing. `transform, opacity 250ms
// ease-out` therefore declares TWO transitions, and the first one omits every
// component — so `transform` takes the initial `transition-duration` of 0s,
// snaps instead of animating, and never fires a `transitionend`. Measured in
// Chromium 143 against the real preset: the value expanded to
// `transition-duration: 0s, 0.4s`, only `transitionstart:opacity` fired, and the
// computed transform sat at `matrix(1, 0, 0, 1, 0, 0)` for the whole run.
//
// jsdom sees NONE of that — `cssstyle` stores the shorthand verbatim and never
// expands it (`style.transitionDuration` reads back `''`), which is exactly why
// the package suite missed it for as long as it did. So these tests assert the
// emitted STRING, and a "a transition exists" assertion is worth nothing here.
describe('the emitted transition shorthand (#142)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** The value each preset installs on the element for its leave phase. */
  const emitted = (t: { leave?: (nodes: Node[]) => unknown }): string => {
    const el = makeEl()
    void t.leave!([el])
    return el.style.transition
  }

  it('slide() gives BOTH animated properties a duration and an easing', () => {
    expect(emitted(slide({ duration: 250, easing: 'ease-out' }))).toBe(
      'transform 250ms ease-out, opacity 250ms ease-out',
    )
  })

  it('scale() gives BOTH animated properties a duration and an easing', () => {
    expect(emitted(scale({ duration: 200, easing: 'ease-out' }))).toBe(
      'transform 200ms ease-out, opacity 200ms ease-out',
    )
  })

  it('slide({ fade: false }) still emits the single-property form', () => {
    expect(emitted(slide({ duration: 250, easing: 'ease-out', fade: false }))).toBe(
      'transform 250ms ease-out',
    )
  })

  it('scale({ fade: false }) still emits the single-property form', () => {
    expect(emitted(scale({ duration: 200, easing: 'linear', fade: false }))).toBe(
      'transform 200ms linear',
    )
  })

  it('fade() and collapse() emit the same per-property form', () => {
    expect(emitted(fade({ duration: 150, easing: 'ease-in' }))).toBe('opacity 150ms ease-in')
    expect(emitted(collapse({ duration: 250, easing: 'ease-out' }))).toBe('height 250ms ease-out')
    expect(emitted(collapse({ duration: 250, easing: 'ease-out', axis: 'x' }))).toBe(
      'width 250ms ease-out',
    )
  })

  // The generic form of the defect: whatever a preset animates, EVERY
  // single-transition in the list it emits must carry its own duration. A
  // property listed without one silently takes 0s.
  it.each([
    ['fade', () => fade({ duration: 120 })],
    ['slide', () => slide({ duration: 120 })],
    ['slide({fade:false})', () => slide({ duration: 120, fade: false })],
    ['scale', () => scale({ duration: 120 })],
    ['scale({fade:false})', () => scale({ duration: 120, fade: false })],
    ['collapse', () => collapse({ duration: 120 })],
  ] as const)('%s: every property in the list carries its own duration', (_name, make) => {
    const value = emitted(make())
    const singles = value.split(',').map((s) => s.trim())
    expect(singles.length).toBeGreaterThan(0)
    for (const single of singles) {
      // `<property> <duration> <easing>` — a bare property name means 0s.
      expect(single).toMatch(/^[a-z-]+ \d+ms \S+$/)
    }
  })
})

describe('collapse()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sets height 0 on leave then animates', () => {
    const el = makeEl()
    // jsdom returns 0 for scrollHeight but the code still runs
    const t = collapse({ duration: 100, axis: 'y' })
    void t.leave!([el])
    expect(el.style.overflow).toBe('hidden')
    expect(el.style.height).toBe('0px')
  })

  it('sets width on x axis', () => {
    const el = makeEl()
    const t = collapse({ duration: 100, axis: 'x' })
    void t.leave!([el])
    expect(el.style.width).toBe('0px')
  })

  // ── Finding 2: collapse restores inline styles instead of leaking them ──
  it('restores inline overflow/transition after enter completes', async () => {
    const el = makeEl()
    el.style.overflow = 'scroll'
    el.style.transition = 'color 1s'
    const t = collapse({ duration: 100 })
    t.enter!([el])
    expect(el.style.overflow).toBe('hidden')
    await vi.advanceTimersByTimeAsync(200)
    expect(el.style.overflow).toBe('scroll')
    expect(el.style.transition).toBe('color 1s')
  })

  // ── Finding 7: leave starts from the element’s CURRENT rendered size ──
  it('leave starts from the current rendered size, not the natural size', () => {
    const el = makeEl()
    // Simulate a partially-open element: current rendered height is 40px while
    // its natural (scroll) height would be larger. The leave must start the
    // collapse from 40px, not snap open to the natural size first.
    el.getBoundingClientRect = () =>
      ({
        height: 40,
        width: 12,
        top: 0,
        left: 0,
        right: 12,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    // Record every write to style.height so we can inspect the leave's start.
    const writes: string[] = []
    let current = ''
    Object.defineProperty(el.style, 'height', {
      configurable: true,
      get: () => current,
      set: (v: string) => {
        current = v
        writes.push(v)
      },
    })

    const t = collapse({ duration: 100, axis: 'y' })
    void t.leave!([el])

    // First height write is the leave's starting size (before the reflow → 0px).
    expect(writes[0]).toBe('40px')
    expect(writes[writes.length - 1]).toBe('0px')
  })

  it('a superseding leave rolls back enter and gates enter’s stale restore', async () => {
    const el = makeEl()
    el.style.overflow = 'scroll'
    const t = collapse({ duration: 100 })
    t.enter!([el])
    // Interrupt the open with a close on the same element.
    void t.leave!([el])
    expect(el.style.overflow).toBe('hidden') // leave's mutation is live
    // Past enter's duration: enter's delayed restore must NOT fire (it would
    // wrongly reset overflow to 'scroll' mid-close).
    await vi.advanceTimersByTimeAsync(300)
    expect(el.style.overflow).toBe('hidden')
    expect(el.style.height).toBe('0px')
  })
})
