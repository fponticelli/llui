import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transition } from '../src/transition'

// The LEAVE half of #106's "resume from the current value" story.
//
// Skipping `leaveFrom` for an interrupting leave is NOT the same thing as
// resuming from the current value: `runs.supersede` has already fired the
// interrupted enter's rollback, which `restoreInline`s the PRE-ENTER inline
// value — for a fade that is `''`, i.e. fully visible. So the element sat at
// full opacity at the reflow and the leave animated from there, which is
// exactly the snap the skip was meant to avoid.
//
// The observable moment is the REFLOW: `forceReflow` reads `offsetHeight`
// between the start value and the target, and whatever the element is showing
// then is the value the browser transitions FROM. jsdom does not interpolate,
// so "mid-flight" is simulated by writing the in-between value.

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

/** The value of `property` at each forced reflow — what the transition starts from. */
function watchReflow(el: HTMLElement, property: string): string[] {
  const seen: string[] = []
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    get: () => {
      seen.push(el.style.getPropertyValue(property))
      return 0
    },
  })
  return seen
}

function makeEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

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

describe('transition(): a leave interrupting an enter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('animates out from the element’s current value, measured at the reflow', () => {
    const el = makeEl()
    const t = fadeSpec()

    t.enter!([el])
    el.style.opacity = '0.4' // where the browser would be, mid-fade-in

    const writes = recordWrites(el, 'opacity')
    const atReflow = watchReflow(el, 'opacity')
    void t.leave!([el])

    // '' is the superseded enter's rollback (no reflow between it and the next
    // write, so nothing is painted at that value); then the frozen current
    // value, then the target.
    expect(writes).toEqual(['', '0.4', '0'])
    // The load-bearing assertion: the element is showing 0.4 — NOT the '' that
    // the rollback restored — when the browser recalculates style.
    expect(atReflow).toEqual(['0.4'])
  })

  it('still applies leaveFrom for a fresh (non-interrupting) leave', () => {
    const el = makeEl()
    const t = fadeSpec()

    const writes = recordWrites(el, 'opacity')
    const atReflow = watchReflow(el, 'opacity')
    void t.leave!([el])

    expect(writes).toEqual(['1', '0'])
    expect(atReflow).toEqual(['1'])
  })

  it('treats a COMPLETED enter as resting, not as an interrupt', async () => {
    const el = makeEl()
    const t = fadeSpec()

    t.enter!([el])
    await vi.advanceTimersByTimeAsync(400) // the enter finishes and cleans up

    const writes = recordWrites(el, 'opacity')
    const atReflow = watchReflow(el, 'opacity')
    void t.leave!([el])

    // Nothing in flight: the normal leaveFrom → leaveTo swap.
    expect(writes).toEqual(['1', '0'])
    expect(atReflow).toEqual(['1'])
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

    t.enter!([el])
    el.style.opacity = '0.4'
    el.style.transform = 'translate(0, -8px)'

    const opacity = recordWrites(el, 'opacity')
    const transform = recordWrites(el, 'transform')
    void t.leave!([el])

    expect(opacity).toEqual(['', '0.4', '0'])
    expect(transform).toEqual(['', 'translate(0, -8px)', 'translate(0, -20px)'])
  })

  it('keeps the frozen value through the swap — leaveFrom is never removed', () => {
    // Removing `leaveFrom` at the swap would strip the very inline value the
    // leave is meant to start from, since the frozen value is written under the
    // same property keys.
    const el = makeEl()
    const t = fadeSpec()

    t.enter!([el])
    el.style.opacity = '0.4'
    void t.leave!([el])

    expect(el.style.opacity).toBe('0')
  })
})
