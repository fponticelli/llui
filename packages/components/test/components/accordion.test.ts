import { describe, it, expect, vi } from 'vitest'
import { pathHandle } from '@llui/dom'
import { init, update, connect, focusTarget } from '../../src/components/accordion'
import { attachExitWatcher, detachExitWatcher } from '../../src/internal/disclosure-motion'
import { rootSignal, signalOf, read } from '../_signal'

function animationEvent(type: string, animationName: string): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'animationName', { value: animationName })
  return event
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
    })
  })

  it('init is fully deterministic — no random/ambient field of any kind (#264 review-264j)', () => {
    // "Is a watcher mounted" moved OUT of state entirely: two independent
    // init() calls with identical options must be byte-identical, which a
    // realm-random session token (a design REJECTED in review-264i for
    // exactly this reason — it broke replayTrace) could never guarantee.
    expect(init({ value: ['a'], animated: true })).toEqual(init({ value: ['a'], animated: true }))
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

    const animated = update(init({ value: ['a'], animated: true }), {
      type: 'close',
      value: 'a',
      retain: true,
    })[0]
    expect(animated).toMatchObject({ value: [], closing: ['a'] })
  })

  it('completes and interrupts a retained close without changing controlled value', () => {
    const closing = update(init({ value: ['a'], animated: true }), {
      type: 'setValue',
      value: ['b'],
      retain: true,
    })[0]
    expect(closing).toMatchObject({ value: ['b'], closing: ['a'] })

    const reopened = update(closing, { type: 'open', value: 'a', retain: true })[0]
    // Reopening a interrupts ITS close; single-mode replacement starts b's.
    expect(reopened).toMatchObject({ value: ['a'], closing: ['b'] })

    const closingAgain = update(reopened, { type: 'close', value: 'a', retain: true })[0]
    const complete = update(closingAgain, {
      type: 'exitComplete',
      value: 'a',
      generation: closingAgain.exitGenerations.find(({ value }) => value === 'a')!.generation,
    })[0]
    expect(complete).toMatchObject({ value: [], closing: ['b'] })
  })

  it('rejects a stale completion from an earlier exit generation', () => {
    const first = update(init({ value: ['a'], animated: true }), {
      type: 'close',
      value: 'a',
      retain: true,
    })[0]
    const reopened = update(first, { type: 'open', value: 'a' })[0]
    const second = update(reopened, { type: 'close', value: 'a', retain: true })[0]

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
      init({
        value: ['__proto__', 'constructor', 'toString'],
        multiple: true,
        animated: true,
      }),
      { type: 'setValue', value: [], retain: true },
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
    let state = init({ value: ['item-0'], animated: true })
    for (let index = 0; index < 50; index += 1) {
      const value = `item-${index}`
      state = update(state, { type: 'setValue', value: [], retain: true })[0]
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
    const closing = update(init({ value: ['a'], animated: true }), {
      type: 'close',
      value: 'a',
      retain: true,
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

  it('click sends toggle, stamping retain: false when no exitCompletion is attached for this id', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.item('a').trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle', value: 'a', retain: false })
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

describe('accordion exitCompletion fail-safe (#264 item F1, mechanism per #264 review-264j)', () => {
  it('a close with no retain (or retain: false) closes instantly, never retains — the fail-safe default', () => {
    const [s1] = update(init({ value: ['a'], animated: true }), { type: 'close', value: 'a' })
    expect(s1.value).toEqual([])
    expect(s1.closing).toEqual([])

    const [s2] = update(init({ value: ['a'], animated: true }), {
      type: 'close',
      value: 'a',
      retain: false,
    })
    expect(s2.closing).toEqual([])
  })

  it('a close with retain: true retains, exactly when animated is also true', () => {
    const retained = update(init({ value: ['a'], animated: true }), {
      type: 'close',
      value: 'a',
      retain: true,
    })[0]
    expect(retained).toMatchObject({ value: [], closing: ['a'] })

    // retain: true with animated: false still closes instantly — animated
    // gates it too, not retain alone.
    const notAnimated = update(init({ value: ['a'], animated: false }), {
      type: 'close',
      value: 'a',
      retain: true,
    })[0]
    expect(notAnimated.closing).toEqual([])
  })

  it('exitComplete settles a retained item — the SAME message a watcher-detach settle uses (no dedicated detach message exists any more)', () => {
    const closing = update(init({ value: ['a'], animated: true }), {
      type: 'close',
      value: 'a',
      retain: true,
    })[0]
    expect(closing.closing).toEqual(['a'])
    const generation = closing.exitGenerations.find((e) => e.value === 'a')!.generation
    const settled = update(closing, { type: 'exitComplete', value: 'a', generation })[0]
    expect(settled.closing).toEqual([])
    expect(settled.exitGenerations).toEqual([])
  })

  it('reducer purity: identical (state, msg) always produces an identical result — no ambient read of anything', () => {
    const base = init({ value: ['a'], animated: true })
    const msg = { type: 'close' as const, value: 'a', retain: true }
    const r1 = update(base, msg)[0]
    const r2 = update(base, msg)[0]
    expect(r1).toEqual(r2)
  })

  it('init() carries no runtime/watcher field of any kind — a plain JSON round trip is a no-op', () => {
    const s = init({ value: ['a'], animated: true })
    const roundTripped: typeof s = JSON.parse(JSON.stringify(s))
    expect(roundTripped).toEqual(s)
    // A restored slice with a stale `closing` entry from a past session and
    // NO retain ever stamped again still closes normally — nothing about
    // "was a watcher ever attached" can be read back out of it, because
    // nothing about it was ever written into state to begin with.
    const [next] = update(roundTripped, { type: 'close', value: 'a' })
    expect(next.value).toEqual([])
  })

  it('single-mode switching without retain closes the departing item instantly too', () => {
    const [s] = update(init({ value: ['a'], animated: true }), { type: 'toggle', value: 'b' })
    expect(s).toMatchObject({ value: ['b'], closing: [] })
  })

  it('update() never calls console.warn under ANY message, retained or not (#264 review BLOCK 2)', () => {
    // A reducer must stay pure so replayTrace/propertyTest (which RE-RUN a
    // recorded message history) cannot re-emit a diagnostic as a side effect
    // of replaying, rather than of anything happening for the first time —
    // the reducer no longer has anything to warn ABOUT: the warning lives
    // entirely at the connect() dispatch boundary now (see the browser-level
    // coverage in disclosure-exit-failsafe.test.ts).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ value: ['a'], animated: true })
      for (let i = 0; i < 5; i += 1) {
        state = update(state, { type: 'close', value: 'a', retain: i % 2 === 0 })[0]
        state = update(state, { type: 'open', value: 'a' })[0]
      }
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('accordion connect() dev warning (registry-based, #264 review-264j)', () => {
  it('fires exactly once per id, from a real click, when exitCompletion is never attached', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ value: ['a'], animated: true })
      const send = (msg: Parameters<typeof update>[1]): void => {
        state = update(state, msg)[0]
      }
      // A LIVE signal handle (`.peek()` re-reads the mutable `state` closure
      // on every call, unlike `signalOf`'s fixed snapshot) — needed here
      // because the warning must observe the state the click just produced.
      const p = connect(
        pathHandle<ReturnType<typeof init>>(() => state, ''),
        send,
        { id: 'warn-once-per-id-a' },
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
      // Throttled: a second miss on the SAME id does not warn again.
      state = update(state, { type: 'open', value: 'a' })[0]
      click()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      el.remove()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('never fires once the id has a real attached watcher (registry, not state)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const id = 'warn-attached-no-fire'
    try {
      let state = init({ value: ['a'], animated: true })
      const send = (msg: Parameters<typeof update>[1]): void => {
        state = update(state, msg)[0]
      }
      const p = connect(
        pathHandle<ReturnType<typeof init>>(() => state, ''),
        send,
        { id },
      )
      attachExitWatcher('accordion:' + id) // simulates a real exitCompletion mount for this id, scoped like connect() does
      const el = document.createElement('button')
      document.body.append(el)
      const event = new MouseEvent('click')
      Object.defineProperty(event, 'currentTarget', { value: el })
      p.item('a').trigger.onClick(event)
      expect(warnSpy).not.toHaveBeenCalled()
      el.remove()
    } finally {
      detachExitWatcher('accordion:' + id)
      warnSpy.mockRestore()
    }
  })

  it('never fires for a purely programmatic send({type:"close"}) bypassing connect()\'s own handlers (documented scope)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const state = init({ value: ['a'], animated: true })
      // A raw send bypassing connect()'s trigger handlers/close() helper —
      // no warning fires, because nothing at the connect() boundary ever
      // saw this dispatch (documented scope, matching
      // completeIfUnanimatedAfterToggle's identical gap).
      update(state, { type: 'close', value: 'a' })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})
