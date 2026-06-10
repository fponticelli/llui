import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, nextToastId } from '../../src/components/toast'
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
    paused: false,
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
    expect(s.toasts[0]!.paused).toBe(false)
  })

  it('create seeds remainingMs from duration when omitted', () => {
    const [s] = update(init(), {
      type: 'create',
      toast: { id: 'x', type: 'info', duration: 3000, dismissable: true },
    })
    expect(s.toasts[0]!.remainingMs).toBe(3000)
    expect(s.toasts[0]!.paused).toBe(false)
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

  it('pause/resume flip paused flag', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'pause', id: 'x' })[0]
    expect(s.toasts[0]!.paused).toBe(true)
    s = update(s, { type: 'resume', id: 'x' })[0]
    expect(s.toasts[0]!.paused).toBe(false)
  })

  it('pauseAll/resumeAll', () => {
    let s = init()
    s = update(s, { type: 'create', toast: makeToast({ id: 'x' }) })[0]
    s = update(s, { type: 'create', toast: makeToast({ id: 'y' }) })[0]
    s = update(s, { type: 'pauseAll' })[0]
    expect(s.toasts.every((t) => t.paused)).toBe(true)
    s = update(s, { type: 'resumeAll' })[0]
    expect(s.toasts.every((t) => !t.paused)).toBe(true)
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

describe('toast.connect', () => {
  const parts = connect(rootSignal(), vi.fn())

  it('region role=region', () => {
    expect(parts.region.role).toBe('region')
    expect(read(parts.region['aria-label'], init())).toBe('Notifications')
  })

  it('toast root uses assertive (role=alert) for error type', () => {
    const error = makeToast({ id: 'e', type: 'error' })
    const info = makeToast({ id: 'i', type: 'info' })
    expect(parts.toast(signalOf(error)).root['aria-live']).toBe('assertive')
    expect(parts.toast(signalOf(error)).root.role).toBe('alert')
    expect(parts.toast(signalOf(info)).root['aria-live']).toBe('polite')
    expect(parts.toast(signalOf(info)).root.role).toBe('status')
  })

  it('per-toast ariaLive override wins over type-derived', () => {
    const error = makeToast({ id: 'e', type: 'error', ariaLive: 'polite' })
    const info = makeToast({ id: 'i', type: 'info', ariaLive: 'assertive' })
    expect(parts.toast(signalOf(error)).root['aria-live']).toBe('polite')
    expect(parts.toast(signalOf(error)).root.role).toBe('status')
    expect(parts.toast(signalOf(info)).root['aria-live']).toBe('assertive')
    expect(parts.toast(signalOf(info)).root.role).toBe('alert')
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

  it('pointerEnter pauses, pointerLeave resumes', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const t = makeToast({ id: 'x' })
    p.toast(signalOf(t)).root.onPointerEnter(new PointerEvent('pointerenter'))
    p.toast(signalOf(t)).root.onPointerLeave(new PointerEvent('pointerleave'))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'pause', id: 'x' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'resume', id: 'x' })
  })
})
