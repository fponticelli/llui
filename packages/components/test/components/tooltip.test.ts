import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { component, mountApp, button, div, text } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/tooltip'
import type { TooltipState, TooltipMsg } from '../../src/components/tooltip'
import { rootSignal, read } from '../_signal'

describe('tooltip reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({ open: false })
  })

  it('show/hide/toggle/setOpen', () => {
    expect(update(init(), { type: 'show' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'hide' })[0].open).toBe(false)
    expect(update(init(), { type: 'toggle' })[0].open).toBe(true)
  })
})

describe('tooltip.connect', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pointerEnter schedules show after delay', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', delayOpen: 200 })
    p.trigger.onPointerEnter(new PointerEvent('pointerenter'))
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(199)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(send).toHaveBeenCalledWith({ type: 'show' })
  })

  it('pointerLeave schedules hide after delay', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', delayClose: 100 })
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(99)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('pointerLeave before delay cancels pending show', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', delayOpen: 300, delayClose: 0 })
    p.trigger.onPointerEnter(new PointerEvent('pointerenter'))
    vi.advanceTimersByTime(100)
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(500)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('focus opens immediately when openOnFocus=true', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.trigger.onFocus(new FocusEvent('focus'))
    expect(send).toHaveBeenCalledWith({ type: 'show' })
  })

  it('focus does nothing when openOnFocus=false', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', openOnFocus: false })
    p.trigger.onFocus(new FocusEvent('focus'))
    expect(send).not.toHaveBeenCalled()
  })

  it('blur closes immediately', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.trigger.onBlur(new FocusEvent('blur'))
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('Escape closes immediately and cancels timers', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', delayOpen: 300 })
    p.trigger.onPointerEnter(new PointerEvent('pointerenter'))
    p.trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    vi.advanceTimersByTime(500)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('aria-describedby only set when open', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'tip1' })
    expect(read(p.trigger['aria-describedby'], { open: true })).toBe('tip1:content')
    expect(read(p.trigger['aria-describedby'], { open: false })).toBeUndefined()
  })

  it('content pointerEnter cancels pending hide (interactive tooltip)', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', delayClose: 100 })
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(50)
    p.content.onPointerEnter(new PointerEvent('pointerenter'))
    vi.advanceTimersByTime(500)
    expect(send).not.toHaveBeenCalled()
  })

  it('trigger→content travel within delayClose keeps it open; leaving content then closes', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', delayClose: 100 })
    // Pointer leaves the trigger: a close is scheduled.
    p.trigger.onPointerLeave(new PointerEvent('pointerleave'))
    // Within the grace period the pointer reaches the content: close cancelled.
    vi.advanceTimersByTime(80)
    p.content.onPointerEnter(new PointerEvent('pointerenter'))
    vi.advanceTimersByTime(1000)
    expect(send).not.toHaveBeenCalled()
    // Now the pointer leaves the content: close scheduled, fires after delayClose.
    p.content.onPointerLeave(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(99)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('content Escape closes immediately and cancels timers', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x', delayClose: 100 })
    // A close is pending from leaving the content area...
    p.content.onPointerLeave(new PointerEvent('pointerleave'))
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))
    vi.advanceTimersByTime(500)
    // ...Escape closes once and cancels the pending timer (no double hide).
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'hide' })
  })

  it('content non-Escape key does nothing', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.content.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))
    expect(send).not.toHaveBeenCalled()
  })
})

type Ctx = { t: TooltipState }

describe('tooltip.overlay integration', () => {
  let currentApp: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }
    document.body.innerHTML = ''
  })

  function makeApp(initialOpen = false): void {
    const def = component<Ctx, TooltipMsg, never>({
      name: 'T',
      init: () => [{ t: init({ open: initialOpen }) }, []],
      update: (state, msg) => {
        const [next] = update(state.t, msg)
        return [{ t: next }, []]
      },
      view: ({ state, send }) => {
        const parts = connect(state.at('t'), send, { id: 'tip' })
        return [
          button({ ...parts.trigger }, [text('hover me')]),
          overlay({
            state: state.at('t'),
            send,
            parts,
            content: () => [div({ ...parts.content }, [text('the tip')])],
          }),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
  }

  it('renders no content when closed', () => {
    makeApp(false)
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('opens content in body portal', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
  })

  it('Escape from anywhere (focus not on trigger) dismisses', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
    // Focus is on neither trigger nor content — global dismissable still claims Escape.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('outside click does NOT dismiss (tooltips dismiss on leave/blur, not outside click)', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
  })
})
