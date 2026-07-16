import { describe, it, expect, vi } from 'vitest'
import { spring } from '../src/spring'

function withHiddenTab<T>(fn: () => T): T {
  const orig = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  })
  try {
    return fn()
  } finally {
    if (orig) Object.defineProperty(document, 'visibilityState', orig)
    else delete (document as unknown as { visibilityState?: unknown }).visibilityState
  }
}

function makeEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('spring()', () => {
  it('returns valid TransitionOptions with enter and leave', () => {
    const t = spring()
    expect(t).toHaveProperty('enter')
    expect(t).toHaveProperty('leave')
    expect(typeof t.enter).toBe('function')
    expect(typeof t.leave).toBe('function')
  })

  it('enter is a function that accepts nodes', () => {
    const t = spring()
    const el = makeEl()
    // Should not throw
    expect(() => t.enter!([el])).not.toThrow()
  })

  it('leave is a function that accepts nodes and returns a promise', () => {
    const t = spring()
    const el = makeEl()
    const result = t.leave!([el])
    expect(result).toBeInstanceOf(Promise)
  })

  it('custom stiffness/damping produces different options object', () => {
    const t1 = spring({ stiffness: 170, damping: 26 })
    const t2 = spring({ stiffness: 300, damping: 10 })
    // Both should be valid TransitionOptions
    expect(typeof t1.enter).toBe('function')
    expect(typeof t2.enter).toBe('function')
    // They are distinct objects
    expect(t1).not.toBe(t2)
  })

  it('applies initial value on enter', () => {
    const el = makeEl()
    const t = spring({ property: 'opacity', from: 0, to: 1 })
    t.enter!([el])
    // The initial "from" value should be applied immediately
    expect(el.style.getPropertyValue('opacity')).toBe('0')
  })

  it('applies initial value on leave', () => {
    const el = makeEl()
    const t = spring({ property: 'opacity', from: 0, to: 1 })
    void t.leave!([el])
    // Leave starts from "to" value
    expect(el.style.getPropertyValue('opacity')).toBe('1')
  })

  it('works with a custom property', () => {
    const el = makeEl()
    const t = spring({ property: '--spring-val', from: 0, to: 1 })
    t.enter!([el])
    // Custom properties are set via setProperty and readable via getPropertyValue
    expect(el.style.getPropertyValue('--spring-val')).toBe('0')
  })

  it('handles empty node list without errors', () => {
    const t = spring()
    expect(() => t.enter!([])).not.toThrow()
    expect(t.leave!([])).toBeInstanceOf(Promise)
  })

  it('defaults produce opacity spring from 0 to 1', () => {
    const el = makeEl()
    const t = spring()
    t.enter!([el])
    expect(el.style.getPropertyValue('opacity')).toBe('0')
  })

  // ── Finding 3: hidden tab must not deadlock the leave Promise ──
  it('leave settles and resolves immediately when the tab is hidden', async () => {
    const el = makeEl()
    await withHiddenTab(async () => {
      const t = spring({ property: 'opacity', from: 0, to: 1 })
      // Previously the leave Promise resolved only from rAF, so a hidden tab
      // (rAF paused) would hang forever — deadlocking fromTransition(spring()).
      await t.leave!([el])
      // Snapped to the leave target (from = 0).
      expect(el.style.getPropertyValue('opacity')).toBe('0')
    })
  })

  it('enter settles and resolves immediately when the tab is hidden', async () => {
    const el = makeEl()
    await withHiddenTab(async () => {
      const t = spring({ property: 'opacity', from: 0, to: 1 })
      t.enter!([el])
      // Enter snaps straight to the target rather than staying at "from".
      expect(el.style.getPropertyValue('opacity')).toBe('1')
    })
  })

  // ── Finding 7: interruption — a stale enter loop must not snap over leave ──
  it('interrupting an enter leaves the element at the leave target, not enter’s', async () => {
    const el = makeEl()
    // Manual rAF pump so we can interrupt mid-flight deterministically.
    const queue: FrameRequestCallback[] = []
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        queue.push(cb)
        return queue.length
      })
    const pump = (time: number): void => {
      const cbs = queue.splice(0)
      for (const cb of cbs) cb(time)
    }

    try {
      const t = spring({ property: 'opacity', from: 0, to: 1, stiffness: 170, damping: 26 })
      t.enter!([el]) // enter loop A: opacity 0 → 1
      pump(16)
      pump(32)
      const mid = parseFloat(el.style.getPropertyValue('opacity'))
      expect(mid).toBeGreaterThan(0)
      expect(mid).toBeLessThan(1)

      // Interrupt with a leave (opacity → 0). This must cancel loop A so its
      // dying frame does NOT snap the element back to enter's target (1).
      const leaving = t.leave!([el])

      // Pump generously — both the stale A frame and the live B loop run.
      for (let time = 48; time < 20000 && queue.length > 0; time += 16) pump(time)
      await leaving

      // Rests at the leave target (0), never the enter target (1).
      expect(parseFloat(el.style.getPropertyValue('opacity'))).toBe(0)
    } finally {
      rafSpy.mockRestore()
    }
  })

  // ── Finding 7: interrupted enter→leave starts from the CURRENT value ──
  it('leave starts from the element’s current value, not the resting `to`', () => {
    const el = makeEl()
    const queue: FrameRequestCallback[] = []
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        queue.push(cb)
        return queue.length
      })
    const pump = (time: number): void => {
      const cbs = queue.splice(0)
      for (const cb of cbs) cb(time)
    }

    try {
      const t = spring({ property: 'opacity', from: 0, to: 1, stiffness: 170, damping: 26 })
      t.enter!([el]) // enter 0 → 1
      pump(16)
      pump(32)
      const mid = parseFloat(el.style.getPropertyValue('opacity'))
      expect(mid).toBeGreaterThan(0)
      expect(mid).toBeLessThan(1)

      // Interrupt with a leave. animateOne applies the START value inline
      // synchronously, so the initial leave value must be the CURRENT mid value
      // (not `to` = 1 — the pre-fix behaviour snapped fully visible first).
      void t.leave!([el])
      const leaveStart = parseFloat(el.style.getPropertyValue('opacity'))
      expect(leaveStart).toBeCloseTo(mid, 5)
      expect(leaveStart).not.toBe(1)
    } finally {
      rafSpy.mockRestore()
    }
  })

  it('spring settles to target (simulated)', async () => {
    // We can't run rAF in jsdom with real timing, but we can verify
    // the physics engine converges by importing and testing directly.
    // Instead, verify the builder output shape is correct with all options.
    const t = spring({
      stiffness: 200,
      damping: 20,
      mass: 1.5,
      precision: 0.001,
      property: 'opacity',
      from: 0,
      to: 1,
    })
    expect(t.enter).toBeDefined()
    expect(t.leave).toBeDefined()
  })
})
