import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, nextToastId } from '../../src/components/toast'
import type { Toast, ToasterState } from '../../src/components/toast'

type Ctx = { t: ToasterState }

function makeToast(overrides: Partial<Toast> = {}): Toast {
  return {
    id: nextToastId(),
    type: 'info',
    duration: 5000,
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

describe('toast.connect', () => {
  const parts = connect<Ctx>((s) => s.t, vi.fn())

  it('region role=region', () => {
    expect(parts.region.role).toBe('region')
    const label = parts.region['aria-label']
    expect(typeof label === 'function' ? label({} as Ctx) : label).toBe('Notifications')
  })

  it('toast root uses assertive for error type', () => {
    const error = makeToast({ id: 'e', type: 'error' })
    const info = makeToast({ id: 'i', type: 'info' })
    expect(parts.toast(error).root['aria-live']).toBe('assertive')
    expect(parts.toast(info).root['aria-live']).toBe('polite')
  })

  it('closeTrigger dismisses', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.t, send)
    const t = makeToast({ id: 'x' })
    p.toast(t).closeTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'dismiss', id: 'x' })
  })

  it('pointerEnter pauses, pointerLeave resumes', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.t, send)
    const t = makeToast({ id: 'x' })
    p.toast(t).root.onPointerEnter(new PointerEvent('pointerenter'))
    p.toast(t).root.onPointerLeave(new PointerEvent('pointerleave'))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'pause', id: 'x' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'resume', id: 'x' })
  })
})
