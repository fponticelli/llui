import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/collapsible'
import { rootSignal, signalOf, read } from '../_signal'

function animationEvent(type: string, animationName: string): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'animationName', { value: animationName })
  return event
}

/**
 * Real usage always attaches the `exitCompletion` watcher (via mount) before
 * any interaction can happen, so unit tests exercising retained-exit
 * behavior via bare `update()` calls attach it explicitly first (#264 item
 * F1) — `closing` retention now only ever engages when `animated &&
 * exitWatcher` both hold.
 */
function attached(state: ReturnType<typeof init>): ReturnType<typeof init> {
  return update(state, { type: 'exitWatcherAttach' })[0]
}

describe('collapsible reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({
      open: false,
      disabled: false,
      closing: false,
      exitGeneration: 0,
      animated: false,
      exitWatcher: false,
      exitWarned: false,
    })
  })

  it('toggle alternates', () => {
    const [s1] = update(init(), { type: 'toggle' })
    expect(s1.open).toBe(true)
    const [s2] = update(s1, { type: 'toggle' })
    expect(s2.open).toBe(false)
  })

  it('open/close explicit', () => {
    expect(update(init(), { type: 'open' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'close' })[0].open).toBe(false)
  })

  it('disabled blocks toggling', () => {
    const [s] = update(init({ disabled: true }), { type: 'toggle' })
    expect(s.open).toBe(false)
  })

  it('retains closing content only when animation is explicitly enabled', () => {
    const instant = update(init({ open: true }), { type: 'close' })[0]
    expect(instant).toMatchObject({ open: false, closing: false })

    const animated = update(attached(init({ open: true, animated: true })), { type: 'close' })[0]
    expect(animated).toMatchObject({ open: false, closing: true })
  })

  it('reopen interrupts a retained close and exitComplete hides it', () => {
    const closing = update(attached(init({ open: true, animated: true })), { type: 'close' })[0]
    expect(update(closing, { type: 'open' })[0]).toMatchObject({ open: true, closing: false })
    expect(
      update(closing, { type: 'exitComplete', generation: closing.exitGeneration })[0],
    ).toMatchObject({
      open: false,
      closing: false,
    })
  })

  it('rejects a stale completion from an earlier exit generation', () => {
    const first = update(attached(init({ open: true, animated: true })), { type: 'close' })[0]
    const reopened = update(first, { type: 'open' })[0]
    const second = update(reopened, { type: 'close' })[0]

    expect(first.exitGeneration).toBe(1)
    expect(second.exitGeneration).toBe(2)
    expect(update(second, { type: 'exitComplete', generation: 1 })[0].closing).toBe(true)
    expect(update(second, { type: 'exitComplete', generation: 2 })[0].closing).toBe(false)
  })
})

describe('collapsible.connect', () => {
  const p = connect(rootSignal(), vi.fn(), { id: 'c1' })

  it('trigger aria-expanded reflects open', () => {
    expect(read(p.trigger['aria-expanded'], init({ open: true }))).toBe(true)
    expect(read(p.trigger['aria-expanded'], init({ open: false }))).toBe(false)
  })

  it('trigger aria-controls → content id', () => {
    expect(p.trigger['aria-controls']).toBe('c1:content')
  })

  it('content aria-labelledby → trigger id', () => {
    expect(p.content['aria-labelledby']).toBe('c1:trigger')
  })

  it('content.hidden reflects closed', () => {
    expect(read(p.content.hidden, init({ open: true }))).toBe(false)
    expect(read(p.content.hidden, init({ open: false }))).toBe(true)
  })

  it('keeps closing content mounted and noninteractive until its own animation ends', () => {
    const send = vi.fn()
    const closing = update(attached(init({ open: true, animated: true })), { type: 'close' })[0]
    const content = connect(signalOf(closing), send, { id: 'x' }).content
    expect(read(content.hidden, closing)).toBe(false)
    expect(read(content['data-state'], closing)).toBe('closing')
    expect(read(content['aria-hidden'], closing)).toBe('true')
    expect(read(content.inert, closing)).toBe(true)

    const element = document.createElement('div')
    element.style.setProperty('--llui-disclosure-exit-animation', 'collapse-up')
    element.addEventListener('animationstart', content.onAnimationStart as EventListener)
    element.addEventListener('animationend', content.onAnimationEnd as EventListener)
    element.dispatchEvent(animationEvent('animationstart', 'collapse-up'))
    element.dispatchEvent(animationEvent('animationend', 'collapse-up'))
    expect(send).toHaveBeenCalledWith({ type: 'exitComplete', generation: 1 })
  })

  it('trigger click sends toggle', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle' })
  })
})

describe('collapsible exitCompletion fail-safe (#264 item F1)', () => {
  it('a forgotten exitCompletion (watcher never attached) closes instantly, never retains', () => {
    const [s] = update(init({ open: true, animated: true }), { type: 'close' })
    expect(s).toMatchObject({ open: false, closing: false, exitWatcher: false })
  })

  it('exitWatcherAttach flips the flag; a subsequent close then retains', () => {
    const attachedState = update(init({ open: true, animated: true }), {
      type: 'exitWatcherAttach',
    })[0]
    expect(attachedState.exitWatcher).toBe(true)
    const closing = update(attachedState, { type: 'close' })[0]
    expect(closing).toMatchObject({ open: false, closing: true })
  })

  it('exitWatcherDetach mid-closing settles it immediately rather than leaving it stuck', () => {
    const closing = update(attached(init({ open: true, animated: true })), { type: 'close' })[0]
    expect(closing.closing).toBe(true)
    const detached = update(closing, { type: 'exitWatcherDetach' })[0]
    expect(detached).toMatchObject({ closing: false, exitWatcher: false })
  })

  it('DEV warning fires exactly once per instance when a close is missed for lack of a watcher', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ open: true, animated: true })
      state = update(state, { type: 'close' })[0]
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('exitCompletion')
      state = update(state, { type: 'open' })[0]
      state = update(state, { type: 'close' })[0]
      // Throttled: still exactly once for this instance.
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(state).toMatchObject({ open: false, exitWarned: true })
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('no warning fires when the watcher is attached (placed correctly)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const s = attached(init({ open: true, animated: true }))
      update(s, { type: 'close' })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('no warning fires when animated is false (instant close is intentional)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      update(init({ open: true }), { type: 'close' })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})
