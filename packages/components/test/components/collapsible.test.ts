import { describe, it, expect, vi } from 'vitest'
import { pathHandle } from '@llui/dom'
import { init, update, connect } from '../../src/components/collapsible'
import { isExitWatched } from '../../src/internal/disclosure-motion'
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
 * F1) — `closing` retention only ever engages when `animated &&
 * isExitWatched(exitWatchers)`.
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
      exitWatchers: { session: expect.any(String), count: 0 },
    })
  })

  it('init always starts unwatched, never trusting a persisted/hydrated value (#264 review M1)', () => {
    // `CollapsibleInit`'s fields are all optional, so a plain (non-cast)
    // object with one extra property is still structurally assignable.
    const tampered = { open: true, exitWatchers: { session: 'stale-session', count: 7 } }
    expect(isExitWatched(init(tampered).exitWatchers)).toBe(false)
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
    expect(s.open).toBe(false)
    expect(s.closing).toBe(false)
    expect(isExitWatched(s.exitWatchers)).toBe(false)
  })

  it('exitWatcherAttach marks the slice watched; a subsequent close then retains', () => {
    const attachedState = update(init({ open: true, animated: true }), {
      type: 'exitWatcherAttach',
    })[0]
    expect(isExitWatched(attachedState.exitWatchers)).toBe(true)
    const closing = update(attachedState, { type: 'close' })[0]
    expect(closing).toMatchObject({ open: false, closing: true })
  })

  it('a second exitWatcherAttach over the same slice increments the count (two placements)', () => {
    const once = update(init({ open: true, animated: true }), { type: 'exitWatcherAttach' })[0]
    const twice = update(once, { type: 'exitWatcherAttach' })[0]
    expect(twice.exitWatchers.count).toBe(2)
    expect(isExitWatched(twice.exitWatchers)).toBe(true)
  })

  it('exitWatcherDetach mid-closing settles it immediately rather than leaving it stuck', () => {
    const closing = update(attached(init({ open: true, animated: true })), { type: 'close' })[0]
    expect(closing.closing).toBe(true)
    const detached = update(closing, { type: 'exitWatcherDetach' })[0]
    expect(detached.closing).toBe(false)
    expect(isExitWatched(detached.exitWatchers)).toBe(false)
  })

  it('exitWatcherDetach never goes negative and stays unwatched, even if already at 0 (#264 review M1)', () => {
    // The reducer no longer tracks a stray closure count — the real mount
    // COUNT lives entirely in the `exitWatchers` field itself (#264
    // review-264i), so a stray/duplicate `exitWatcherDetach` clamps at 0
    // rather than going negative, and stays unwatched.
    let state = init({ open: true, animated: true })
    state = update(state, { type: 'exitWatcherDetach' })[0]
    expect(isExitWatched(state.exitWatchers)).toBe(false)
    expect(state.exitWatchers.count).toBe(0)
    state = update(state, { type: 'exitWatcherDetach' })[0]
    expect(isExitWatched(state.exitWatchers)).toBe(false)
    expect(state.exitWatchers.count).toBe(0)
  })

  it('attach/detach are pure: the same input produces the same output every time (reducer purity)', () => {
    const base = init({ open: true, animated: true })
    const a1 = update(base, { type: 'exitWatcherAttach' })[0]
    const a2 = update(base, { type: 'exitWatcherAttach' })[0]
    expect(a1).toEqual(a2)
    const attached1 = update(a1, { type: 'exitWatcherDetach' })[0]
    const attached2 = update(a2, { type: 'exitWatcherDetach' })[0]
    expect(attached1).toEqual(attached2)
  })

  it('a restored slice with a FOREIGN session and a stale positive count is unwatched, and a close does not retain', () => {
    const restored = {
      ...init({ open: true, animated: true }),
      exitWatchers: { session: 'a-past-page-load', count: 5 },
    }
    expect(isExitWatched(restored.exitWatchers)).toBe(false)
    const [s] = update(restored, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.closing).toBe(false)
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

  it('update() never calls console.warn — the diagnostic lives at the connect() boundary, not the reducer (#264 review BLOCK 2)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ open: true, animated: true }) // watcher never attached
      for (let i = 0; i < 5; i += 1) {
        state = update(state, { type: 'close' })[0]
        state = update(state, { type: 'open' })[0]
      }
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('collapsible connect() dev warning (#264 review BLOCK 2 — moved out of the reducer)', () => {
  it('fires exactly once per instance, from a real click, when exitCompletion was never placed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ open: true, animated: true })
      const send = (msg: Parameters<typeof update>[1]): void => {
        state = update(state, msg)[0]
      }
      const p = connect(
        pathHandle<ReturnType<typeof init>>(() => state, ''),
        send,
        { id: 'x' },
      )
      const el = document.createElement('button')
      document.body.append(el)
      const click = (): void => {
        const event = new MouseEvent('click')
        Object.defineProperty(event, 'currentTarget', { value: el })
        p.trigger.onClick(event)
      }
      click()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('exitCompletion')
      state = update(state, { type: 'open' })[0]
      click()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      el.remove()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('never fires for a purely programmatic close bypassing the trigger (documented scope, like completeIfUnanimatedAfterToggle)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const state = attached(init({ open: true, animated: true }))
      const detached = update(state, { type: 'exitWatcherDetach' })[0]
      update(detached, { type: 'close' })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})
