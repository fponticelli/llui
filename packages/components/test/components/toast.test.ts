import { describe, it, expect, vi } from 'vitest'
import { pathHandle } from '@llui/dom'
import { init, update, connect, nextToastId, isPaused } from '../../src/components/toast'
import type { Toast } from '../../src/components/toast'
import { rootSignal, read, signalOf } from '../_signal'

function makeToast(overrides: Partial<Toast> = {}): Toast {
  const duration = overrides.duration ?? 5000
  return {
    id: nextToastId(),
    type: 'info',
    duration,
    remainingMs: duration ?? 0,
    dismissable: true,
    pausedBy: [],
    status: 'open',
    ...overrides,
  }
}

describe('toast reducer', () => {
  it('initializes with empty toasts', () => {
    const s = init()
    expect(s.toasts).toEqual([])
    expect(s.max).toBe(5)
  })

  it('create adds toast', () => {
    const [s] = update(init(), { type: 'create', toast: makeToast({ title: 'Hi' }) })
    expect(s.toasts).toHaveLength(1)
    expect(s.toasts[0]!.title).toBe('Hi')
    expect(s.toasts[0]!.pausedBy).toEqual([])
  })

  it('create seeds remainingMs from duration when omitted', () => {
    const [s] = update(init(), {
      type: 'create',
      toast: { id: 'x', type: 'info', duration: 3000, dismissable: true },
    })
    expect(s.toasts[0]!.remainingMs).toBe(3000)
    expect(s.toasts[0]!.pausedBy).toEqual([])
  })

  it('create with null duration is sticky (remainingMs Infinity-free, never auto-dismisses)', () => {
    const [s] = update(init(), {
      type: 'create',
      toast: { id: 'x', type: 'info', duration: null, dismissable: true },
    })
    expect(s.toasts[0]!.duration).toBeNull()
    // ticking a sticky toast never removes it
    const [s2] = update(s, { type: 'tick', id: 'x', elapsedMs: 1_000_000 })
    expect(s2.toasts.map((t) => t.id)).toEqual(['x'])
  })

  it('create enforces max — drops oldest', () => {
    let s = init({ max: 2 })
    s = update(s, { type: 'create', toast: makeToast({ id: 'a' }) })[0]
    s = update(s, { type: 'create', toast: makeToast({ id: 'b' }) })[0]
    s = update(s, { type: 'create', toast: makeToast({ id: 'c' }) })[0]
    expect(s.toasts.map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('dismiss removes toast', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'create', toast: makeToast({ id: 'y' }) })[0]
    const [s2] = update(s, { type: 'dismiss', id: 'x' })
    expect(s2.toasts.map((t) => t.id)).toEqual(['y'])
  })

  it('dismissAll clears', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast() })[0]
    s = update(s, { type: 'create', toast: makeToast() })[0]
    const [s2] = update(s, { type: 'dismissAll' })
    expect(s2.toasts).toEqual([])
  })

  it('update patches a toast', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', title: 'A' }) })[0]
    const [s2] = update(s, { type: 'update', id: 'x', patch: { title: 'B', type: 'success' } })
    expect(s2.toasts[0]!.title).toBe('B')
    expect(s2.toasts[0]!.type).toBe('success')
  })

  it('update patching duration re-seeds remainingMs, including a sticky (loading) -> finite transition', () => {
    let s = init()
    // A sticky toast (duration: null) is created with remainingMs frozen at 0
    // (nothing to count down from) — the loading->success shape both demos use.
    s = update(s, {
      type: 'create',
      toast: makeToast({ id: 'x', type: 'loading', duration: null, remainingMs: 0 }),
    })[0]
    expect(s.toasts[0]!.remainingMs).toBe(0)
    const [s2] = update(s, {
      type: 'update',
      id: 'x',
      patch: { type: 'success', duration: 3000 },
    })
    // The reseeded countdown must actually last the full duration: a single
    // small tick must NOT dismiss it.
    expect(s2.toasts[0]!.remainingMs).toBe(3000)
    const [s3] = update(s2, { type: 'tick', id: 'x', elapsedMs: 100 })
    expect(s3.toasts).toHaveLength(1)
    expect(s3.toasts[0]!.remainingMs).toBe(2900)
  })

  it('update patching a field other than duration leaves remainingMs untouched', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 5000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1000 })[0]
    expect(s.toasts[0]!.remainingMs).toBe(4000)
    const [s2] = update(s, { type: 'update', id: 'x', patch: { title: 'New title' } })
    expect(s2.toasts[0]!.remainingMs).toBe(4000)
  })

  it('pause/resume without a reason use the manual reason', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'pause', id: 'x' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual(['manual'])
    expect(isPaused(s.toasts[0]!)).toBe(true)
    s = update(s, { type: 'resume', id: 'x' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual([])
    expect(isPaused(s.toasts[0]!)).toBe(false)
  })

  it('pauseAll/resumeAll', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'create', toast: makeToast({ id: 'y' }) })[0]
    s = update(s, { type: 'pauseAll' })[0]
    expect(s.toasts.map((t) => t.pausedBy)).toEqual([['manual'], ['manual']])
    s = update(s, { type: 'resumeAll' })[0]
    expect(s.toasts.map((t) => t.pausedBy)).toEqual([[], []])
  })

  /**
   * #265 G6: hover and focus are independent pause REASONS. One boolean let
   * pointer-leave resume a toast whose close button still had keyboard focus
   * (and blur resume one still under the pointer).
   */
  it('each pause reason is released only by its own resume', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 1000 }) })[0]
    s = update(s, { type: 'pause', id: 'x', reason: 'focus' })[0]
    s = update(s, { type: 'pause', id: 'x', reason: 'hover' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual(['focus', 'hover'])
    // Pointer leaves while focus stays inside: still paused.
    s = update(s, { type: 'resume', id: 'x', reason: 'hover' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual(['focus'])
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 5000 })[0]
    expect(s.toasts[0]!.remainingMs).toBe(1000)
    // A manual resume does not release a real focus either.
    s = update(s, { type: 'resume', id: 'x' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual(['focus'])
    s = update(s, { type: 'resumeAll' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual(['focus'])
    // Focus leaves: now it runs.
    s = update(s, { type: 'resume', id: 'x', reason: 'focus' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual([])
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 400 })[0]
    expect(s.toasts[0]!.remainingMs).toBe(600)
  })

  it('pausedBy is a canonical set: repeats are no-ops and order is fixed', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'pause', id: 'x', reason: 'manual' })[0]
    s = update(s, { type: 'pause', id: 'x', reason: 'hover' })[0]
    const before = s
    // An already-held reason returns the SAME state (no spurious reconcile).
    expect(update(s, { type: 'pause', id: 'x', reason: 'hover' })[0]).toBe(before)
    s = update(s, { type: 'pause', id: 'x', reason: 'focus' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual(['focus', 'hover', 'manual'])
    // Releasing a reason nobody holds, or on an unknown id, is a no-op too.
    expect(update(s, { type: 'resume', id: 'y' })[0]).toBe(s)
    const released = update(s, { type: 'resume', id: 'x', reason: 'hover' })[0]
    expect(update(released, { type: 'resume', id: 'x', reason: 'hover' })[0]).toBe(released)
  })

  it('create seeds pausedBy from the input, canonicalized', () => {
    const [s] = update(init(), {
      type: 'create',
      toast: {
        id: 'x',
        type: 'info',
        duration: 1000,
        dismissable: true,
        pausedBy: ['manual', 'focus', 'manual'],
      },
    })
    expect(s.toasts[0]!.pausedBy).toEqual(['focus', 'manual'])
  })

  it('pauseAll/resumeAll take a reason too', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'pause', id: 'x', reason: 'hover' })[0]
    s = update(s, { type: 'pauseAll', reason: 'focus' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual(['focus', 'hover'])
    s = update(s, { type: 'resumeAll', reason: 'focus' })[0]
    expect(s.toasts[0]!.pausedBy).toEqual(['hover'])
  })

  /**
   * #265 G6 / E4: elapsed wall time is never negative. A negative tick (clock
   * skew, a bad subtraction) used to EXTEND the countdown past `duration`.
   */
  it('ignores a negative tick', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 1000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 300 })[0]
    expect(update(s, { type: 'tick', id: 'x', elapsedMs: -5000 })[0]).toBe(s)
    expect(s.toasts[0]!.remainingMs).toBe(700)
  })

  it('ignores a non-finite tick', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 1000 }) })[0]
    for (const elapsedMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(update(s, { type: 'tick', id: 'x', elapsedMs })[0]).toBe(s)
    }
  })

  /**
   * #265 G6: `undefined` in a patch means "not patched". A present-but-
   * undefined `duration` used to re-seed the countdown to 0 and dismiss the
   * toast on the next tick.
   */
  it('an undefined REQUIRED field is not patched; an undefined OPTIONAL field is cleared', () => {
    let s = init()
    s = update(s, {
      type: 'create',
      toast: makeToast({ id: 'x', duration: 3000, title: 'T' }),
    })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1000 })[0]
    s = update(s, {
      type: 'update',
      id: 'x',
      patch: { duration: undefined, title: undefined, description: 'D' },
    })[0]
    // `duration` is required: undefined leaves the countdown alone. `title`
    // is optional: undefined clears it.
    expect(s.toasts[0]).toMatchObject({ duration: 3000, remainingMs: 2000, description: 'D' })
    expect(s.toasts[0]!.title).toBeUndefined()
    s = update(s, {
      type: 'update',
      id: 'x',
      patch: { type: undefined, dismissable: undefined, ariaLive: 'assertive' },
    })[0]
    expect(s.toasts[0]).toMatchObject({ type: 'info', dismissable: true, ariaLive: 'assertive' })
    s = update(s, { type: 'update', id: 'x', patch: { ariaLive: undefined } })[0]
    expect(s.toasts[0]!.ariaLive).toBeUndefined()
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1000 })[0]
    expect(s.toasts.map((t) => t.remainingMs)).toEqual([1000])
  })

  it('init defaults placement to bottom-end', () => {
    expect(init().placement).toBe('bottom-end')
  })

  it('setPlacement changes the region placement, leaving toasts untouched', () => {
    let s = init({ placement: 'bottom-end' })
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'setPlacement', placement: 'top-start' })[0]
    expect(s.placement).toBe('top-start')
    expect(s.toasts).toHaveLength(1)
  })

  it('setPlacement accepts all six ToastPlacement values', () => {
    const placements = [
      'top',
      'top-start',
      'top-end',
      'bottom',
      'bottom-start',
      'bottom-end',
    ] as const
    for (const placement of placements) {
      const s = update(init(), { type: 'setPlacement', placement })[0]
      expect(s.placement).toBe(placement)
    }
  })
})

describe('toast countdown (tick-driven, timer-free)', () => {
  it('tick advances remainingMs', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 5000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1000 })[0]
    expect(s.toasts[0]!.remainingMs).toBe(4000)
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1500 })[0]
    expect(s.toasts[0]!.remainingMs).toBe(2500)
  })

  it('paused toast freezes remainingMs on tick', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 5000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1000 })[0]
    expect(s.toasts[0]!.remainingMs).toBe(4000)
    s = update(s, { type: 'pause', id: 'x' })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 2000 })[0]
    // frozen: still 4000
    expect(s.toasts[0]!.remainingMs).toBe(4000)
    s = update(s, { type: 'resume', id: 'x' })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1000 })[0]
    expect(s.toasts[0]!.remainingMs).toBe(3000)
  })

  it('reducer auto-dismisses when remainingMs reaches 0', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 2000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 2000 })[0]
    expect(s.toasts.map((t) => t.id)).toEqual([])
  })

  it('reducer auto-dismisses on overshoot (elapsed beyond remaining)', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 2000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 5000 })[0]
    expect(s.toasts.map((t) => t.id)).toEqual([])
  })

  it('multiple toasts: pause/resume/expiry ordering is independent', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'a', duration: 3000 }) })[0]
    s = update(s, { type: 'create', toast: makeToast({ id: 'b', duration: 5000 }) })[0]
    // pause b, advance both
    s = update(s, { type: 'pause', id: 'b' })[0]
    s = update(s, { type: 'tick', id: 'a', elapsedMs: 1000 })[0]
    s = update(s, { type: 'tick', id: 'b', elapsedMs: 1000 })[0]
    expect(s.toasts.find((t) => t.id === 'a')!.remainingMs).toBe(2000)
    expect(s.toasts.find((t) => t.id === 'b')!.remainingMs).toBe(5000) // frozen
    // expire a
    s = update(s, { type: 'tick', id: 'a', elapsedMs: 2000 })[0]
    expect(s.toasts.map((t) => t.id)).toEqual(['b'])
    // resume b and expire it
    s = update(s, { type: 'resume', id: 'b' })[0]
    s = update(s, { type: 'tick', id: 'b', elapsedMs: 5000 })[0]
    expect(s.toasts.map((t) => t.id)).toEqual([])
  })

  it('tick on unknown id is a no-op', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 2000 }) })[0]
    const [s2] = update(s, { type: 'tick', id: 'missing', elapsedMs: 1000 })
    expect(s2.toasts[0]!.remainingMs).toBe(2000)
  })
})

describe('toast presence (per-toast exit animation)', () => {
  it('a created toast is born open', () => {
    const [s] = update(init(), { type: 'create', toast: makeToast({ id: 'x' }) })
    expect(s.toasts[0]!.status).toBe('open')
  })

  it('create seeds status open when omitted', () => {
    const [s] = update(init(), {
      type: 'create',
      toast: { id: 'x', type: 'info', duration: 3000, dismissable: true },
    })
    expect(s.toasts[0]!.status).toBe('open')
  })

  it('non-animated: dismiss removes the toast synchronously (no hang)', () => {
    let s = init() // animated defaults to false
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    const [s2] = update(s, { type: 'dismiss', id: 'x' })
    expect(s2.toasts.map((t) => t.id)).toEqual([])
  })

  it('non-animated: countdown expiry removes synchronously', () => {
    let s = init({ animated: false })
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 2000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 2000 })[0]
    expect(s.toasts.map((t) => t.id)).toEqual([])
  })

  it('animated: dismiss moves to closing & stays mounted, animationEnd removes it', () => {
    let s = init({ animated: true })
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    // close request → closing, still mounted
    s = update(s, { type: 'dismiss', id: 'x' })[0]
    expect(s.toasts.map((t) => t.id)).toEqual(['x'])
    expect(s.toasts[0]!.status).toBe('closing')
    // animationend → removed
    s = update(s, { type: 'animationEnd', id: 'x' })[0]
    expect(s.toasts.map((t) => t.id)).toEqual([])
  })

  it('animated: countdown expiry moves to closing (kept mounted) then animationEnd removes', () => {
    let s = init({ animated: true })
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 2000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 2000 })[0]
    expect(s.toasts.map((t) => t.id)).toEqual(['x'])
    expect(s.toasts[0]!.status).toBe('closing')
    s = update(s, { type: 'animationEnd', id: 'x' })[0]
    expect(s.toasts.map((t) => t.id)).toEqual([])
  })

  it('animated: a closing toast freezes its countdown (no further tick decay)', () => {
    let s = init({ animated: true })
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 4000 }) })[0]
    s = update(s, { type: 'dismiss', id: 'x' })[0]
    expect(s.toasts[0]!.status).toBe('closing')
    const before = s.toasts[0]!.remainingMs
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1000 })[0]
    expect(s.toasts[0]!.remainingMs).toBe(before)
    expect(s.toasts[0]!.status).toBe('closing')
  })

  it('animated: re-dismissing a closing toast is idempotent', () => {
    let s = init({ animated: true })
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'dismiss', id: 'x' })[0]
    const after = update(s, { type: 'dismiss', id: 'x' })[0]
    expect(after.toasts.map((t) => t.id)).toEqual(['x'])
    expect(after.toasts[0]!.status).toBe('closing')
  })

  it('animated: dismissAll moves all to closing, keeping them mounted', () => {
    let s = init({ animated: true })
    s = update(s, { type: 'create', toast: makeToast({ id: 'a' }) })[0]
    s = update(s, { type: 'create', toast: makeToast({ id: 'b' }) })[0]
    s = update(s, { type: 'dismissAll' })[0]
    expect(s.toasts.map((t) => t.id)).toEqual(['a', 'b'])
    expect(s.toasts.every((t) => t.status === 'closing')).toBe(true)
  })

  it('animationEnd only removes a toast that is actually closing', () => {
    let s = init({ animated: true })
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    // not closing yet — animationEnd (e.g. an enter animation) must not remove it
    const [s2] = update(s, { type: 'animationEnd', id: 'x' })
    expect(s2.toasts.map((t) => t.id)).toEqual(['x'])
  })
})

describe('toast.connect', () => {
  const parts = connect(rootSignal(), vi.fn())

  it('region role=region', () => {
    expect(parts.region.role).toBe('region')
    expect(read(parts.region['aria-label'], init())).toBe('Notifications')
  })

  it('toast root uses assertive (role=alert) for error type', () => {
    const error = makeToast({ id: 'e', type: 'error' })
    const info = makeToast({ id: 'i', type: 'info' })
    expect(read(parts.toast(signalOf(error)).root['aria-live'], error)).toBe('assertive')
    expect(read(parts.toast(signalOf(error)).root.role, error)).toBe('alert')
    expect(read(parts.toast(signalOf(info)).root['aria-live'], info)).toBe('polite')
    expect(read(parts.toast(signalOf(info)).root.role, info)).toBe('status')
  })

  it('per-toast ariaLive override wins over type-derived', () => {
    const error = makeToast({ id: 'e', type: 'error', ariaLive: 'polite' })
    const info = makeToast({ id: 'i', type: 'info', ariaLive: 'assertive' })
    expect(read(parts.toast(signalOf(error)).root['aria-live'], error)).toBe('polite')
    expect(read(parts.toast(signalOf(error)).root.role, error)).toBe('status')
    expect(read(parts.toast(signalOf(info)).root['aria-live'], info)).toBe('assertive')
    expect(read(parts.toast(signalOf(info)).root.role, info)).toBe('alert')
  })

  it('root data-type reflects the toast type reactively', () => {
    const info = makeToast({ id: 'x', type: 'info' })
    expect(read(parts.toast(signalOf(info)).root['data-type'], info)).toBe('info')
  })

  it('update patching type/ariaLive is visible on the MOUNTED row (resolves the former freeze bug)', () => {
    // Regression for #265 finding #8: `connect()`'s `toast()` builder used to
    // read `type`/`ariaLive` once via `.peek()`, so a `toast.promise`-style
    // loading -> success `update` never reached the rendered `data-type`/
    // `role`/`aria-live` of an already-mounted row. They are now bound
    // reactively off the SAME row signal handed to `each`, so re-deriving the
    // parts against the post-update toast value must reflect the patch.
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', type: 'loading' }) })[0]
    const row = parts.toast(signalOf(s.toasts[0]!))
    expect(read(row.root['data-type'], s.toasts[0]!)).toBe('loading')
    expect(read(row.root.role, s.toasts[0]!)).toBe('status')

    const [s2] = update(s, {
      type: 'update',
      id: 'x',
      patch: { type: 'error', title: 'Failed' },
    })
    const updated = s2.toasts[0]!
    expect(updated.type).toBe('error')
    // Re-deriving the SAME row builder's Signal against the updated toast
    // value (what the runtime does on every commit) now reports 'error'/'alert'.
    expect(read(row.root['data-type'], updated)).toBe('error')
    expect(read(row.root.role, updated)).toBe('alert')
    expect(read(row.root['aria-live'], updated)).toBe('assertive')
  })

  it('ToastPatch cannot patch id (compile-time)', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    // @ts-expect-error id is not a patchable field — it is immutable for a
    // toast's lifetime, per ToastPatch's contract.
    update(s, { type: 'update', id: 'x', patch: { id: 'y' } })
  })

  it('progress(id) returns fraction remaining in [0,1]', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', duration: 4000 }) })[0]
    s = update(s, { type: 'tick', id: 'x', elapsedMs: 1000 })[0]
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.progress('x'), s)).toBeCloseTo(0.75, 5)
    const s2 = update(s, { type: 'tick', id: 'x', elapsedMs: 2000 })[0]
    expect(read(p.progress('x'), s2)).toBeCloseTo(0.25, 5)
  })

  it('progress(id) is 1 for a sticky (null duration) toast', () => {
    let s = init()
    s = update(s, {
      type: 'create',
      toast: { id: 'x', type: 'info', duration: null, dismissable: true },
    })[0]
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.progress('x'), s)).toBe(1)
  })

  it('progress(id) is 0 for a missing toast', () => {
    const s = init()
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.progress('missing'), s)).toBe(0)
  })

  it('closeTrigger dismisses', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const t = makeToast({ id: 'x' })
    p.toast(signalOf(t)).closeTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'dismiss', id: 'x' })
  })

  /**
   * #265 G6: `dismissable` is a live, patchable field. `false` hides the close
   * button (out of the accessibility tree and tab order) and a click that
   * still reaches it is ignored; `dismiss` from code keeps working.
   */
  it('dismissable gates the close trigger reactively', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x', dismissable: true }) })[0]
    const live = pathHandle<Toast>(() => s.toasts[0]!, '')
    const close = p.toast(live).closeTrigger
    expect(read(close.hidden, s.toasts[0]!)).toBe(false)

    s = update(s, { type: 'update', id: 'x', patch: { dismissable: false } })[0]
    expect(read(close.hidden, s.toasts[0]!)).toBe(true)
    close.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
    expect(update(s, { type: 'dismiss', id: 'x' })[0].toasts).toEqual([])

    s = update(s, { type: 'update', id: 'x', patch: { dismissable: true } })[0]
    expect(read(close.hidden, s.toasts[0]!)).toBe(false)
    close.onClick(new MouseEvent('click'))
    expect(send.mock.calls).toEqual([[{ type: 'dismiss', id: 'x' }]])
  })

  it('pointerEnter/Leave pause and resume the HOVER reason', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const t = makeToast({ id: 'x' })
    p.toast(signalOf(t)).root.onPointerEnter(new PointerEvent('pointerenter'))
    p.toast(signalOf(t)).root.onPointerLeave(new PointerEvent('pointerleave'))
    expect(send.mock.calls).toEqual([
      [{ type: 'pause', id: 'x', reason: 'hover' }],
      [{ type: 'resume', id: 'x', reason: 'hover' }],
    ])
  })

  /**
   * #265 G6 / E7: `focusout` also fires when focus moves BETWEEN two
   * descendants of the same row. Only leaving the row releases the focus
   * reason.
   */
  it('focusIn/Out pause and resume the FOCUS reason, ignoring moves inside the row', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const root = p.toast(signalOf(makeToast({ id: 'x' }))).root
    const rowEl = document.createElement('div')
    const second = document.createElement('button')
    const outside = document.createElement('button')
    rowEl.append(document.createElement('button'), second)
    document.body.append(rowEl, outside)
    const focusOut = (relatedTarget: EventTarget | null): FocusEvent => {
      const e = new FocusEvent('focusout', { relatedTarget })
      Object.defineProperty(e, 'currentTarget', { value: rowEl })
      return e
    }
    try {
      root.onFocusIn(new FocusEvent('focusin'))
      root.onFocusOut(focusOut(second))
      expect(send.mock.calls).toEqual([[{ type: 'pause', id: 'x', reason: 'focus' }]])
      root.onFocusOut(focusOut(outside))
      root.onFocusIn(new FocusEvent('focusin'))
      root.onFocusOut(focusOut(null))
      expect(send.mock.calls).toEqual([
        [{ type: 'pause', id: 'x', reason: 'focus' }],
        [{ type: 'resume', id: 'x', reason: 'focus' }],
        [{ type: 'pause', id: 'x', reason: 'focus' }],
        [{ type: 'resume', id: 'x', reason: 'focus' }],
      ])
    } finally {
      rowEl.remove()
      outside.remove()
    }
  })

  it('root data-state reflects the toast status reactively', () => {
    const open = makeToast({ id: 'x', status: 'open' })
    const closing = makeToast({ id: 'x', status: 'closing' })
    expect(read(parts.toast(signalOf(open)).root['data-state'], open)).toBe('open')
    expect(read(parts.toast(signalOf(closing)).root['data-state'], closing)).toBe('closing')
  })

  it('animationEnd / transitionEnd send animationEnd for the toast id', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const t = makeToast({ id: 'x' })
    p.toast(signalOf(t)).root.onAnimationEnd({} as AnimationEvent)
    expect(send).toHaveBeenCalledWith({ type: 'animationEnd', id: 'x' })
    p.toast(signalOf(t)).root.onTransitionEnd({} as TransitionEvent)
    expect(send).toHaveBeenLastCalledWith({ type: 'animationEnd', id: 'x' })
  })

  it('isPresent(id) tracks queue membership through closing', () => {
    let s = init({ animated: true })
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.isPresent('x'), s)).toBe(true)
    // still present while closing
    s = update(s, { type: 'dismiss', id: 'x' })[0]
    expect(read(p.isPresent('x'), s)).toBe(true)
    // gone after animationEnd
    s = update(s, { type: 'animationEnd', id: 'x' })[0]
    expect(read(p.isPresent('x'), s)).toBe(false)
    expect(read(p.isPresent('missing'), s)).toBe(false)
  })
})
