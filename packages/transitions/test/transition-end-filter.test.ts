import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitForEnd } from '../src/anim'
import { transition } from '../src/transition'
import { collapse, slide, scale } from '../src/presets'

// Issue #105 — `waitForEnd` used to resolve on ANY `transitionend` whose target
// was the element, with no regard for WHICH property ended. The runtime detaches
// a leaving node on exactly that promise (`arm-controller.ts`), so an unrelated
// hover transition on the same element removed the node mid-animation, and on
// the enter side a stray end ran the cleanup and blanked the inline value
// mid-fade.
//
// DOCUMENTED DECISION — a `transitionend` carrying NO `propertyName` (an
// `undefined` or empty string, i.e. a synthetic `new Event('transitionend')`)
// still resolves. There is nothing to discriminate on, and every real browser
// populates the field; the alternative would be to ignore an event that may well
// be the genuine completion signal, which risks a hang rather than a jump.
describe('waitForEnd() property discrimination', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeEl(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  /** Let a `waitForEnd` resolution thread through its `.then` chain. */
  async function drain(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  function endOf(property: string): TransitionEvent {
    return new TransitionEvent('transitionend', { propertyName: property })
  }

  it('ignores a transitionend for a property the phase does not animate', async () => {
    const el = makeEl()
    let resolved = false
    void waitForEnd(el, 100_000, ['opacity']).then(() => {
      resolved = true
    })

    // An unrelated hover effect on the SAME element finishing.
    el.dispatchEvent(endOf('background-color'))
    await drain()
    expect(resolved).toBe(false)

    // The property actually being animated ends → resolve.
    el.dispatchEvent(endOf('opacity'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('waits for EVERY animated property of a multi-property transition', async () => {
    const el = makeEl()
    let resolved = false
    void waitForEnd(el, 100_000, ['opacity', 'transform']).then(() => {
      resolved = true
    })

    // `transition: opacity 100ms, transform 500ms` — opacity ends first.
    el.dispatchEvent(endOf('opacity'))
    await drain()
    expect(resolved).toBe(false)

    el.dispatchEvent(endOf('transform'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('accepts a camelCase property name, matching the kebab-case event field', async () => {
    const el = makeEl()
    let resolved = false
    // Specs are authored with DOM-style keys (`backgroundColor`); the event
    // reports the CSS name (`background-color`).
    void waitForEnd(el, 100_000, ['backgroundColor']).then(() => {
      resolved = true
    })
    el.dispatchEvent(endOf('background-color'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('resolves on a property-less transitionend (the documented fallback)', async () => {
    const el = makeEl()
    let resolved = false
    void waitForEnd(el, 100_000, ['opacity']).then(() => {
      resolved = true
    })
    el.dispatchEvent(new Event('transitionend'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('still resolves on any end when the phase animates no known property', async () => {
    const el = makeEl()
    let resolved = false
    // A class-driven spec contributes no style keys — nothing to filter on.
    void waitForEnd(el, 100_000, []).then(() => {
      resolved = true
    })
    el.dispatchEvent(endOf('background-color'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('still ignores an end bubbled from a descendant', async () => {
    const el = makeEl()
    const child = document.createElement('span')
    el.appendChild(child)
    let resolved = false
    void waitForEnd(el, 100_000, ['opacity']).then(() => {
      resolved = true
    })
    child.dispatchEvent(
      new TransitionEvent('transitionend', { propertyName: 'opacity', bubbles: true }),
    )
    await drain()
    expect(resolved).toBe(false)
  })

  it('consumes a transitioncancel for a property OUR transition started', async () => {
    // The browser giving up on a transition is a completion signal too: without
    // it a cancelled leave holds the node in the DOM for the whole declared
    // duration instead of resolving when the animation stopped.
    const el = makeEl()
    let resolved = false
    void waitForEnd(el, 100_000, ['opacity', 'transform']).then(() => {
      resolved = true
    })
    el.dispatchEvent(new TransitionEvent('transitionstart', { propertyName: 'opacity' }))
    el.dispatchEvent(new TransitionEvent('transitionstart', { propertyName: 'transform' }))

    // An unrelated property being cancelled says nothing about this phase.
    el.dispatchEvent(new TransitionEvent('transitioncancel', { propertyName: 'background-color' }))
    await drain()
    expect(resolved).toBe(false)

    // A cancel counts exactly as that property's end does — one of two here.
    el.dispatchEvent(new TransitionEvent('transitioncancel', { propertyName: 'opacity' }))
    await drain()
    expect(resolved).toBe(false)

    el.dispatchEvent(endOf('transform'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('ignores the cancel of a transition that was already running when the wait began', async () => {
    // DOCUMENTED DECISION — superseding a mid-flight phase CANCELS its
    // transitions, and those cancel events reach the listener the next phase
    // attaches microseconds later, in the same task. Consuming one would resolve
    // a phase that has not run for a single frame, and the runtime detaches a
    // leaving node on exactly this promise. So a cancel is only terminal for a
    // transition this wait saw START.
    const el = makeEl()
    let resolved = false
    void waitForEnd(el, 100_000, ['opacity']).then(() => {
      resolved = true
    })
    el.dispatchEvent(new TransitionEvent('transitioncancel', { propertyName: 'opacity' }))
    await drain()
    expect(resolved).toBe(false)

    // Once ours has started, its cancel resolves the wait.
    el.dispatchEvent(new TransitionEvent('transitionstart', { propertyName: 'opacity' }))
    el.dispatchEvent(new TransitionEvent('transitioncancel', { propertyName: 'opacity' }))
    await drain()
    expect(resolved).toBe(true)
  })

  it('ignores a transitioncancel bubbled from a descendant', async () => {
    const el = makeEl()
    const child = document.createElement('span')
    el.appendChild(child)
    let resolved = false
    void waitForEnd(el, 100_000, ['opacity']).then(() => {
      resolved = true
    })
    el.dispatchEvent(new TransitionEvent('transitionstart', { propertyName: 'opacity' }))
    child.dispatchEvent(
      new TransitionEvent('transitioncancel', { propertyName: 'opacity', bubbles: true }),
    )
    await drain()
    expect(resolved).toBe(false)
  })

  it('resolves a property-less transitioncancel, as it does a property-less end', async () => {
    const el = makeEl()
    let resolved = false
    void waitForEnd(el, 100_000, ['opacity']).then(() => {
      resolved = true
    })
    el.dispatchEvent(new Event('transitioncancel'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('still resolves on the fallback timer when the property never ends', async () => {
    const el = makeEl()
    let resolved = false
    void waitForEnd(el, 100, ['opacity']).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(200)
    expect(resolved).toBe(true)
  })
})

describe('transition() end filtering', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeEl(): HTMLElement {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  async function drain(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  function endOf(property: string): TransitionEvent {
    return new TransitionEvent('transitionend', { propertyName: property })
  }

  it('does not resolve a leave on an unrelated property (the node stays attached)', async () => {
    const el = makeEl()
    const t = transition({
      leaveActive: { transition: 'opacity 500ms' },
      leaveFrom: { opacity: 1 },
      leaveTo: { opacity: 0 },
      duration: 100_000,
    })
    let resolved = false
    void (t.leave!([el]) as Promise<void>).then(() => {
      resolved = true
    })

    el.dispatchEvent(endOf('background-color'))
    await drain()
    expect(resolved).toBe(false)

    el.dispatchEvent(endOf('opacity'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('holds a multi-property leave until the slowest property ends', async () => {
    const el = makeEl()
    const t = transition({
      leaveActive: { transition: 'opacity 100ms, transform 500ms' },
      leaveFrom: { opacity: 1, transform: 'translate(0, 0)' },
      leaveTo: { opacity: 0, transform: 'translate(0, -20px)' },
      duration: 100_000,
    })
    let resolved = false
    void (t.leave!([el]) as Promise<void>).then(() => {
      resolved = true
    })

    el.dispatchEvent(endOf('opacity'))
    await drain()
    expect(resolved).toBe(false)

    el.dispatchEvent(endOf('transform'))
    await drain()
    expect(resolved).toBe(true)
  })

  it('does not run the enter cleanup on a stray end', async () => {
    const el = makeEl()
    const t = transition({
      enterActive: 'active',
      enterFrom: { opacity: 0 },
      enterTo: { opacity: 1 },
      duration: 100_000,
    })
    t.enter!([el])
    expect(el.style.opacity).toBe('1')

    el.dispatchEvent(endOf('background-color'))
    await drain()
    // Cleanup would restore the pre-transition inline opacity ('') mid-fade.
    expect(el.style.opacity).toBe('1')
    expect(el.classList.contains('active')).toBe(true)

    el.dispatchEvent(endOf('opacity'))
    await drain()
    expect(el.style.opacity).toBe('')
    expect(el.classList.contains('active')).toBe(false)
  })

  it('ignores `transform-origin` — it is an active-phase helper, not an animated value', async () => {
    const el = makeEl()
    // `scale()` puts `transformOrigin` in `enterActive`; it never transitions,
    // so it must not join the set of properties the wait blocks on.
    const t = transition({
      enterActive: { transition: 'transform 200ms', transformOrigin: 'center' },
      enterFrom: { transform: 'scale(0.95)' },
      enterTo: { transform: 'scale(1)' },
      duration: 100_000,
    })
    t.enter!([el])
    el.dispatchEvent(endOf('transform'))
    await drain()
    expect(el.style.transform).toBe('')
  })
})

describe('slide() / scale() end filtering', () => {
  // NOT every shipped preset lines up with the property filter. `slide()` and
  // `scale()` install `transition: transform, opacity 250ms ease-out`, which the
  // CSS shorthand grammar reads as TWO single-transitions — the first, `transform`,
  // taking the initial `transition-duration` of 0s. A 0s transition fires no
  // `transitionend`, so `transform` never leaves the pending set and both presets
  // ALWAYS resolve on the fallback timer instead of on a real end. That costs the
  // 16ms buffer and can never hang, but it does make #105's discrimination inert
  // for two of the three shipped presets.
  //
  // The underlying preset bug — neither actually animates its transform in a
  // browser — is issue #142; fixing it should flip these tests to resolving on
  // the `transform` end. jsdom cannot see any of this: its `cssstyle` does not
  // expand the `transition` shorthand at all.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function drain(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  const presets = [
    ['slide', () => slide({ duration: 100 })],
    ['scale', () => scale({ duration: 100 })],
  ] as const

  it.each(presets)('%s(): the opacity end alone does not release the node', async (_name, make) => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    let resolved = false
    void (make().leave!([el]) as Promise<void>).then(() => {
      resolved = true
    })

    el.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'opacity' }))
    await drain()
    expect(resolved).toBe(false)

    // …and with no `transform` end ever coming, the fallback timer is what
    // resolves it — 100ms + the 16ms buffer.
    await vi.advanceTimersByTimeAsync(116)
    expect(resolved).toBe(true)
  })
})

describe('collapse() end filtering', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function drain(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  it('resolves a leave only on the size property it animates', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const c = collapse({ duration: 100_000 })
    let resolved = false
    void (c.leave!([el]) as Promise<void>).then(() => {
      resolved = true
    })

    el.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'opacity' }))
    await drain()
    expect(resolved).toBe(false)

    el.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'height' }))
    await drain()
    expect(resolved).toBe(true)
  })
})
