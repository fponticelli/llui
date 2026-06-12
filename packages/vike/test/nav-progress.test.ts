import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNavigationProgress } from '../src/nav-progress'

// `createNavigationProgress()` is the first-class fix for the navigation-pending
// gap: @llui/vike apps that want a "client navigation in flight" loader had to
// hand-roll a module singleton + handle capture + a `nav/pending` message +
// reducer case. The factory collapses that to one line: it owns the pending
// state, exposes the two Vike `+onPageTransition*` hook functions to wire into
// the convention files, and publishes a LiveSignal<boolean> the layout binds.

describe('createNavigationProgress', () => {
  it('starts not pending; bind() fires immediately with the current (false) value', () => {
    const nav = createNavigationProgress()
    expect(nav.pending.peek()).toBe(false)

    const seen: boolean[] = []
    nav.pending.bind((p) => seen.push(p))
    expect(seen).toEqual([false]) // immediate fire with current value
  })

  it('onPageTransitionStart → pending true; onPageTransitionEnd → pending false', () => {
    const nav = createNavigationProgress()
    const seen: boolean[] = []
    nav.pending.bind((p) => seen.push(p))

    nav.onPageTransitionStart()
    expect(nav.pending.peek()).toBe(true)

    nav.onPageTransitionEnd()
    expect(nav.pending.peek()).toBe(false)

    expect(seen).toEqual([false, true, false])
  })

  it('does not re-notify when the published value is unchanged', () => {
    const nav = createNavigationProgress()
    const seen: boolean[] = []
    nav.pending.bind((p) => seen.push(p))

    nav.onPageTransitionStart()
    nav.onPageTransitionStart() // redundant — already pending
    nav.onPageTransitionEnd()
    nav.onPageTransitionEnd() // redundant — already settled

    expect(seen).toEqual([false, true, false])
  })

  it('the hook functions are detached-safe (assignable to `export const`)', () => {
    const nav = createNavigationProgress()
    // Simulate `export const onPageTransitionStart = nav.onPageTransitionStart`
    const { onPageTransitionStart, onPageTransitionEnd } = nav
    onPageTransitionStart()
    expect(nav.pending.peek()).toBe(true)
    onPageTransitionEnd()
    expect(nav.pending.peek()).toBe(false)
  })

  it('unbind() stops further notifications', () => {
    const nav = createNavigationProgress()
    const seen: boolean[] = []
    const unbind = nav.pending.bind((p) => seen.push(p))

    nav.onPageTransitionStart()
    unbind()
    nav.onPageTransitionEnd()

    expect(seen).toEqual([false, true]) // the post-unbind `false` is not delivered
  })

  describe('with delay (anti-flash debounce)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('a fast nav that ends before `delay` never publishes pending (no flash)', () => {
      const nav = createNavigationProgress({ delay: 120 })
      const seen: boolean[] = []
      nav.pending.bind((p) => seen.push(p))

      nav.onPageTransitionStart()
      vi.advanceTimersByTime(80) // prefetch-fast nav resolves before the reveal
      nav.onPageTransitionEnd()
      vi.advanceTimersByTime(200) // the would-be reveal timer must not fire

      expect(seen).toEqual([false]) // never flipped to true
      expect(nav.pending.peek()).toBe(false)
    })

    it('a slow nav publishes pending once `delay` elapses, then settles on end', () => {
      const nav = createNavigationProgress({ delay: 120 })
      const seen: boolean[] = []
      nav.pending.bind((p) => seen.push(p))

      nav.onPageTransitionStart()
      expect(nav.pending.peek()).toBe(false) // not revealed yet
      vi.advanceTimersByTime(120)
      expect(nav.pending.peek()).toBe(true) // revealed after the debounce window

      nav.onPageTransitionEnd()
      expect(nav.pending.peek()).toBe(false) // end settles immediately

      expect(seen).toEqual([false, true, false])
    })

    it('end always settles to false immediately and cancels a pending reveal timer', () => {
      const nav = createNavigationProgress({ delay: 120 })
      nav.onPageTransitionStart()
      nav.onPageTransitionEnd() // before the timer fires
      vi.advanceTimersByTime(500)
      expect(nav.pending.peek()).toBe(false)
    })
  })
})
