import { describe, it, expect, vi } from 'vitest'
import { pathHandle } from '@llui/dom'
import { init, update, connect, focusTarget } from '../../src/components/accordion'
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
 * F1) — `closing` retention now only ever engages when `animated &&
 * isExitWatched(exitWatchers)`.
 */
function attached(state: ReturnType<typeof init>): ReturnType<typeof init> {
  return update(state, { type: 'exitWatcherAttach' })[0]
}

describe('accordion reducer', () => {
  it('initializes with defaults (single, collapsible)', () => {
    const s = init()
    expect(s).toEqual({
      value: [],
      multiple: false,
      collapsible: true,
      disabled: false,
      items: [],
      closing: [],
      exitGenerations: [],
      exitSequence: 0,
      animated: false,
      exitWatchers: { session: expect.any(String), count: 0 },
    })
  })

  it('init always starts unwatched, never trusting a persisted/hydrated value (#264 review M1)', () => {
    // Simulates a host handing `init()` a persisted/rehydrated options blob
    // that happens to carry a stray `exitWatchers` field (e.g. spread from
    // an old serialized STATE rather than a real `AccordionInit`) — `init()`
    // must never inherit it: a watcher can only be truthfully counted by its
    // OWN mount running again after hydration, since mounts never survive a
    // serialize/deserialize round trip. `AccordionInit`'s fields are all
    // optional, so a plain (non-cast) object with one extra property is
    // still structurally assignable — no `as unknown as` needed.
    const tampered = { value: ['a'], exitWatchers: { session: 'stale-session', count: 7 } }
    expect(isExitWatched(init(tampered).exitWatchers)).toBe(false)
  })

  it('toggle opens a closed item (single)', () => {
    const [s] = update(init({ items: ['a', 'b'] }), { type: 'toggle', value: 'a' })
    expect(s.value).toEqual(['a'])
  })

  it('toggle closes an open item (single + collapsible)', () => {
    const [s] = update(init({ items: ['a', 'b'], value: ['a'] }), { type: 'toggle', value: 'a' })
    expect(s.value).toEqual([])
  })

  it('toggle switches items (single, not closing previous)', () => {
    const [s] = update(init({ items: ['a', 'b'], value: ['a'] }), { type: 'toggle', value: 'b' })
    expect(s.value).toEqual(['b'])
  })

  it('toggle cannot close last open item when collapsible=false', () => {
    const [s] = update(init({ items: ['a'], value: ['a'], collapsible: false }), {
      type: 'toggle',
      value: 'a',
    })
    expect(s.value).toEqual(['a'])
  })

  it('multiple mode keeps multiple items open', () => {
    const s0 = init({ items: ['a', 'b', 'c'], multiple: true })
    const [s1] = update(s0, { type: 'toggle', value: 'a' })
    const [s2] = update(s1, { type: 'toggle', value: 'b' })
    expect(s2.value).toEqual(['a', 'b'])
  })

  it('multiple mode can close any item', () => {
    const s0 = init({ items: ['a', 'b'], value: ['a', 'b'], multiple: true })
    const [s1] = update(s0, { type: 'toggle', value: 'a' })
    expect(s1.value).toEqual(['b'])
  })

  it('open is idempotent', () => {
    const [s] = update(init({ value: ['a'] }), { type: 'open', value: 'a' })
    expect(s.value).toEqual(['a'])
  })

  it('close respects collapsible=false in single mode', () => {
    const [s] = update(init({ value: ['a'], collapsible: false }), {
      type: 'close',
      value: 'a',
    })
    expect(s.value).toEqual(['a'])
  })

  it('disabled blocks all state mutations', () => {
    const s0 = init({ disabled: true })
    const [s1] = update(s0, { type: 'toggle', value: 'a' })
    expect(s1.value).toEqual([])
  })

  it('retains a closing item only when animation is explicitly enabled', () => {
    const instant = update(init({ value: ['a'] }), { type: 'close', value: 'a' })[0]
    expect(instant).toMatchObject({ value: [], closing: [] })

    const animated = update(attached(init({ value: ['a'], animated: true })), {
      type: 'close',
      value: 'a',
    })[0]
    expect(animated).toMatchObject({ value: [], closing: ['a'] })
  })

  it('completes and interrupts a retained close without changing controlled value', () => {
    const closing = update(attached(init({ value: ['a'], animated: true })), {
      type: 'setValue',
      value: ['b'],
    })[0]
    expect(closing).toMatchObject({ value: ['b'], closing: ['a'] })

    const reopened = update(closing, { type: 'open', value: 'a' })[0]
    // Reopening a interrupts ITS close; single-mode replacement starts b's.
    expect(reopened).toMatchObject({ value: ['a'], closing: ['b'] })

    const closingAgain = update(reopened, { type: 'close', value: 'a' })[0]
    const complete = update(closingAgain, {
      type: 'exitComplete',
      value: 'a',
      generation: closingAgain.exitGenerations.find(({ value }) => value === 'a')!.generation,
    })[0]
    expect(complete).toMatchObject({ value: [], closing: ['b'] })
  })

  it('rejects a stale completion from an earlier exit generation', () => {
    const first = update(attached(init({ value: ['a'], animated: true })), {
      type: 'close',
      value: 'a',
    })[0]
    const reopened = update(first, { type: 'open', value: 'a' })[0]
    const second = update(reopened, { type: 'close', value: 'a' })[0]

    expect(first.exitGenerations).toEqual([{ value: 'a', generation: 1 }])
    expect(second.exitGenerations).toEqual([{ value: 'a', generation: 2 }])
    expect(update(second, { type: 'exitComplete', value: 'a', generation: 1 })[0].closing).toEqual([
      'a',
    ])
    expect(update(second, { type: 'exitComplete', value: 'a', generation: 2 })[0].closing).toEqual(
      [],
    )
  })

  it('tracks adversarial string values without prototype collisions', () => {
    const closing = update(
      attached(
        init({
          value: ['__proto__', 'constructor', 'toString'],
          multiple: true,
          animated: true,
        }),
      ),
      { type: 'setValue', value: [] },
    )[0]

    expect(closing.exitGenerations).toEqual([
      { value: '__proto__', generation: 1 },
      { value: 'constructor', generation: 2 },
      { value: 'toString', generation: 3 },
    ])
    expect(
      update(closing, { type: 'exitComplete', value: '__proto__', generation: 1 })[0].closing,
    ).toEqual(['constructor', 'toString'])
  })

  it('prunes completed ids while keeping generations monotonic across churn', () => {
    let state = attached(init({ value: ['item-0'], animated: true }))
    for (let index = 0; index < 50; index += 1) {
      const value = `item-${index}`
      state = update(state, { type: 'setValue', value: [] })[0]
      const generation = state.exitGenerations.find((entry) => entry.value === value)!.generation
      state = update(state, { type: 'exitComplete', value, generation })[0]
      expect(state.exitGenerations).toEqual([])
      state = update(state, { type: 'setValue', value: [`item-${index + 1}`] })[0]
    }
    expect(state.exitSequence).toBe(50)
  })
})

describe('focusTarget', () => {
  const items = ['a', 'b', 'c']
  const s = init({ items })

  it('focusNext wraps around', () => {
    expect(focusTarget(s, { type: 'focusNext', value: 'a' })).toBe('b')
    expect(focusTarget(s, { type: 'focusNext', value: 'c' })).toBe('a')
  })

  it('focusPrev wraps around', () => {
    expect(focusTarget(s, { type: 'focusPrev', value: 'a' })).toBe('c')
    expect(focusTarget(s, { type: 'focusPrev', value: 'b' })).toBe('a')
  })

  it('focusFirst/Last', () => {
    expect(focusTarget(s, { type: 'focusFirst' })).toBe('a')
    expect(focusTarget(s, { type: 'focusLast' })).toBe('c')
  })

  it('returns null for unknown value', () => {
    expect(focusTarget(s, { type: 'focusNext', value: 'zzz' })).toBeNull()
  })
})

describe('accordion.connect', () => {
  const parts = connect(rootSignal(), vi.fn(), { id: 'acc1' })

  it('item.trigger aria-controls points to content id', () => {
    expect(parts.item('a').trigger['aria-controls']).toBe('acc1:content:a')
    expect(parts.item('a').trigger.id).toBe('acc1:trigger:a')
  })

  it('item.content aria-labelledby points to trigger id', () => {
    expect(parts.item('a').content['aria-labelledby']).toBe('acc1:trigger:a')
    expect(parts.item('a').content.id).toBe('acc1:content:a')
  })

  it('item aria-expanded reflects open state', () => {
    const a = parts.item('a').trigger
    expect(read(a['aria-expanded'], init({ value: ['a'] }))).toBe(true)
    expect(read(a['aria-expanded'], init({ value: [] }))).toBe(false)
  })

  it('item content.hidden reflects closed state', () => {
    const a = parts.item('a').content
    expect(read(a.hidden, init({ value: ['a'] }))).toBe(false)
    expect(read(a.hidden, init({ value: [] }))).toBe(true)
  })

  it('keeps closing content mounted, labelled, and noninteractive until its own animation ends', () => {
    const send = vi.fn()
    const closing = update(attached(init({ value: ['a'], animated: true })), {
      type: 'close',
      value: 'a',
    })[0]
    const p = connect(signalOf(closing), send, { id: 'x' }).item('a').content
    expect(read(p.hidden, closing)).toBe(false)
    expect(read(p['data-state'], closing)).toBe('closing')
    expect(read(p['aria-hidden'], closing)).toBe('true')
    expect(read(p.inert, closing)).toBe(true)

    const content = document.createElement('div')
    content.style.setProperty('--llui-disclosure-exit-animation', 'accordion-up')
    content.addEventListener('animationstart', p.onAnimationStart as EventListener)
    content.addEventListener('animationend', p.onAnimationEnd as EventListener)
    content.dispatchEvent(animationEvent('animationstart', 'accordion-up'))
    content.dispatchEvent(animationEvent('animationend', 'accordion-up'))
    expect(send).toHaveBeenCalledWith({ type: 'exitComplete', value: 'a', generation: 1 })
  })

  it('click sends toggle', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.item('a').trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle', value: 'a' })
  })

  it('ArrowDown/Up dispatch focus messages and preventDefault', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send, { id: 'x' })
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    p.item('a').trigger.onKeyDown(down)
    expect(down.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'focusNext', value: 'a' })
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    p.item('b').trigger.onKeyDown(up)
    expect(send).toHaveBeenCalledWith({ type: 'focusPrev', value: 'b' })
  })

  it('Home/End dispatch focusFirst/focusLast', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send, { id: 'x' })
    p.item('a').trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }))
    p.item('a').trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'focusFirst' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'focusLast' })
  })
})

describe('accordion exitCompletion fail-safe (#264 item F1)', () => {
  it('a forgotten exitCompletion (watcher never attached) closes instantly, never retains', () => {
    const [s] = update(init({ value: ['a'], animated: true }), { type: 'close', value: 'a' })
    expect(s.value).toEqual([])
    expect(s.closing).toEqual([])
    expect(isExitWatched(s.exitWatchers)).toBe(false)
  })

  it('exitWatcherAttach marks the slice watched; a subsequent close then retains', () => {
    const attachedState = update(init({ value: ['a'], animated: true }), {
      type: 'exitWatcherAttach',
    })[0]
    expect(isExitWatched(attachedState.exitWatchers)).toBe(true)
    const closing = update(attachedState, { type: 'close', value: 'a' })[0]
    expect(closing).toMatchObject({ value: [], closing: ['a'] })
  })

  it('a second exitWatcherAttach over the same slice increments the count (two placements)', () => {
    const once = update(init({ value: ['a'], animated: true }), { type: 'exitWatcherAttach' })[0]
    const twice = update(once, { type: 'exitWatcherAttach' })[0]
    expect(twice.exitWatchers.count).toBe(2)
    expect(isExitWatched(twice.exitWatchers)).toBe(true)
  })

  it('exitWatcherDetach mid-closing settles it immediately rather than leaving it stuck', () => {
    const closing = update(attached(init({ value: ['a'], animated: true })), {
      type: 'close',
      value: 'a',
    })[0]
    expect(closing.closing).toEqual(['a'])
    const detached = update(closing, { type: 'exitWatcherDetach' })[0]
    expect(detached.closing).toEqual([])
    expect(detached.exitGenerations).toEqual([])
    expect(isExitWatched(detached.exitWatchers)).toBe(false)
  })

  it('exitWatcherDetach never goes negative and stays unwatched, even if already at 0 (#264 review M1)', () => {
    // The reducer no longer tracks a stray closure count — the real mount
    // COUNT lives entirely in the `exitWatchers` field itself (#264
    // review-264i), so a stray/duplicate `exitWatcherDetach` clamps at 0
    // rather than going negative, and stays unwatched.
    let state = init({ value: ['a'], animated: true })
    state = update(state, { type: 'exitWatcherDetach' })[0]
    expect(isExitWatched(state.exitWatchers)).toBe(false)
    expect(state.exitWatchers.count).toBe(0)
    state = update(state, { type: 'exitWatcherDetach' })[0]
    expect(isExitWatched(state.exitWatchers)).toBe(false)
    expect(state.exitWatchers.count).toBe(0)
  })

  it('attach/detach are pure: the same input produces the same output every time (reducer purity)', () => {
    const base = init({ value: ['a'], animated: true })
    const a1 = update(base, { type: 'exitWatcherAttach' })[0]
    const a2 = update(base, { type: 'exitWatcherAttach' })[0]
    expect(a1).toEqual(a2)
    const attached1 = update(a1, { type: 'exitWatcherDetach' })[0]
    const attached2 = update(a2, { type: 'exitWatcherDetach' })[0]
    expect(attached1).toEqual(attached2)
  })

  it('a restored slice with a FOREIGN session and a stale positive count is unwatched, and a close does not retain', () => {
    // Simulates a state slice restored from a past page load (a different
    // JS realm, so a different session token) whose `count` was left at a
    // real, nonzero value from that session — reading it directly, without
    // ever sending exitWatcherAttach/Detach, must still be unwatched: the
    // whole point of the session token is that `isExitWatched` alone
    // decides this, with no recovery message required.
    const restored = {
      ...init({ value: ['a'], animated: true }),
      exitWatchers: { session: 'a-past-page-load', count: 5 },
    }
    expect(isExitWatched(restored.exitWatchers)).toBe(false)
    const [s] = update(restored, { type: 'close', value: 'a' })
    expect(s.value).toEqual([])
    expect(s.closing).toEqual([])
  })

  it('no warning fires when the watcher is attached (placed correctly)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const s = attached(init({ value: ['a'], animated: true }))
      update(s, { type: 'close', value: 'a' })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('no warning fires when animated is false (instant close is intentional)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      update(init({ value: ['a'] }), { type: 'close', value: 'a' })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('single-mode switching without a watcher closes the departing item instantly too', () => {
    const [s] = update(init({ value: ['a'], animated: true }), { type: 'toggle', value: 'b' })
    expect(s).toMatchObject({ value: ['b'], closing: [] })
  })

  it('update() never calls console.warn — the diagnostic lives at the connect() boundary, not the reducer (#264 review BLOCK 2)', () => {
    // A reducer must stay pure so replayTrace/propertyTest (which RE-RUN a
    // recorded message history) cannot re-emit a diagnostic as a side effect
    // of replaying, rather than of anything happening for the first time.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ value: ['a'], animated: true }) // watcher never attached
      for (let i = 0; i < 5; i += 1) {
        state = update(state, { type: 'close', value: 'a' })[0]
        state = update(state, { type: 'open', value: 'a' })[0]
      }
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('accordion connect() dev warning (#264 review BLOCK 2 — moved out of the reducer)', () => {
  it('fires exactly once per instance, from a real click, when exitCompletion was never placed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ value: ['a'], animated: true })
      const send = (msg: Parameters<typeof update>[1]): void => {
        state = update(state, msg)[0]
      }
      // A LIVE signal handle (`.peek()` re-reads the mutable `state` closure
      // on every call, unlike `signalOf`'s fixed snapshot) — needed here
      // because the warning must observe the state `send` just produced.
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
        p.item('a').trigger.onClick(event)
      }
      click()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('exitCompletion')
      // Throttled: a second miss on the SAME connect() instance does not warn again.
      state = update(state, { type: 'open', value: 'a' })[0]
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
      const state = attached(init({ value: ['a'], animated: true }))
      // Detach it again so the watcher is gone but exercise the message path
      // a host would use directly, bypassing connect()'s own handlers.
      const detached = update(state, { type: 'exitWatcherDetach' })[0]
      update(detached, { type: 'close', value: 'a' })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})
