import { describe, it, expect, vi } from 'vitest'
import { pathHandle } from '@llui/dom'
import { init, update, connect } from '../../src/components/collapsible'
import { attachExitWatcher, detachExitWatcher } from '../../src/internal/disclosure-motion'
import { rootSignal, signalOf, read } from '../_signal'

function animationEvent(type: string, animationName: string): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'animationName', { value: animationName })
  return event
}

describe('collapsible reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({
      open: false,
      disabled: false,
      closing: false,
      exitGeneration: 0,
      animated: false,
    })
  })

  it('init is fully deterministic — no random/ambient field of any kind (#264 review-264j)', () => {
    expect(init({ open: true, animated: true })).toEqual(init({ open: true, animated: true }))
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

  it('retains closing content only when animation is explicitly enabled AND retain is stamped', () => {
    const instant = update(init({ open: true }), { type: 'close' })[0]
    expect(instant).toMatchObject({ open: false, closing: false })

    const noRetain = update(init({ open: true, animated: true }), { type: 'close' })[0]
    expect(noRetain).toMatchObject({ open: false, closing: false })

    const animated = update(init({ open: true, animated: true }), {
      type: 'close',
      retain: true,
    })[0]
    expect(animated).toMatchObject({ open: false, closing: true })
  })

  it('reopen interrupts a retained close and exitComplete hides it', () => {
    const closing = update(init({ open: true, animated: true }), {
      type: 'close',
      retain: true,
    })[0]
    expect(update(closing, { type: 'open' })[0]).toMatchObject({ open: true, closing: false })
    expect(
      update(closing, { type: 'exitComplete', generation: closing.exitGeneration })[0],
    ).toMatchObject({
      open: false,
      closing: false,
    })
  })

  it('rejects a stale completion from an earlier exit generation', () => {
    const first = update(init({ open: true, animated: true }), {
      type: 'close',
      retain: true,
    })[0]
    const reopened = update(first, { type: 'open' })[0]
    const second = update(reopened, { type: 'close', retain: true })[0]

    expect(first.exitGeneration).toBe(1)
    expect(second.exitGeneration).toBe(2)
    expect(update(second, { type: 'exitComplete', generation: 1 })[0].closing).toBe(true)
    expect(update(second, { type: 'exitComplete', generation: 2 })[0].closing).toBe(false)
  })

  it('reducer purity: identical (state, msg) always produces an identical result', () => {
    const base = init({ open: true, animated: true })
    const msg = { type: 'close' as const, retain: true }
    expect(update(base, msg)[0]).toEqual(update(base, msg)[0])
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
    const closing = update(init({ open: true, animated: true }), {
      type: 'close',
      retain: true,
    })[0]
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

  it('trigger click sends toggle, stamping retain: false when no exitCompletion is attached for this id', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle', retain: false })
  })
})

describe('collapsible exitCompletion fail-safe (#264 item F1, mechanism per #264 review-264j)', () => {
  it('a close with no retain (or retain: false) closes instantly, never retains', () => {
    const [s1] = update(init({ open: true, animated: true }), { type: 'close' })
    expect(s1.open).toBe(false)
    expect(s1.closing).toBe(false)

    const [s2] = update(init({ open: true, animated: true }), { type: 'close', retain: false })
    expect(s2.closing).toBe(false)
  })

  it('a close with retain: true retains, exactly when animated is also true', () => {
    const retained = update(init({ open: true, animated: true }), {
      type: 'close',
      retain: true,
    })[0]
    expect(retained).toMatchObject({ open: false, closing: true })

    const notAnimated = update(init({ open: true, animated: false }), {
      type: 'close',
      retain: true,
    })[0]
    expect(notAnimated.closing).toBe(false)
  })

  it('exitComplete settles a retained panel — the SAME message a watcher-detach settle uses', () => {
    const closing = update(init({ open: true, animated: true }), {
      type: 'close',
      retain: true,
    })[0]
    expect(closing.closing).toBe(true)
    const settled = update(closing, { type: 'exitComplete', generation: closing.exitGeneration })[0]
    expect(settled.closing).toBe(false)
  })

  it('reducer purity: identical (state, msg) always produces an identical result', () => {
    const base = init({ open: true, animated: true })
    const msg = { type: 'close' as const, retain: true }
    expect(update(base, msg)[0]).toEqual(update(base, msg)[0])
  })

  it('init() carries no runtime/watcher field of any kind — a plain JSON round trip is a no-op', () => {
    const s = init({ open: true, animated: true })
    const roundTripped: typeof s = JSON.parse(JSON.stringify(s))
    expect(roundTripped).toEqual(s)
    const [next] = update(roundTripped, { type: 'close' })
    expect(next.open).toBe(false)
  })

  it('update() never calls console.warn under ANY message, retained or not (#264 review BLOCK 2)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ open: true, animated: true })
      for (let i = 0; i < 5; i += 1) {
        state = update(state, { type: 'close', retain: i % 2 === 0 })[0]
        state = update(state, { type: 'open' })[0]
      }
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('collapsible connect() dev warning (registry-based, #264 review-264j)', () => {
  it('fires exactly once per id, from a real click, when exitCompletion is never attached', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let state = init({ open: true, animated: true })
      const send = (msg: Parameters<typeof update>[1]): void => {
        state = update(state, msg)[0]
      }
      const p = connect(
        pathHandle<ReturnType<typeof init>>(() => state, ''),
        send,
        {
          id: 'collapsible-warn-once-per-id',
        },
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

  it('never fires once the id has a real attached watcher (registry, not state)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const id = 'collapsible-warn-attached-no-fire'
    try {
      let state = init({ open: true, animated: true })
      const send = (msg: Parameters<typeof update>[1]): void => {
        state = update(state, msg)[0]
      }
      const p = connect(
        pathHandle<ReturnType<typeof init>>(() => state, ''),
        send,
        { id },
      )
      attachExitWatcher('collapsible:' + id)
      const el = document.createElement('button')
      document.body.append(el)
      const event = new MouseEvent('click')
      Object.defineProperty(event, 'currentTarget', { value: el })
      p.trigger.onClick(event)
      expect(warnSpy).not.toHaveBeenCalled()
      el.remove()
    } finally {
      detachExitWatcher('collapsible:' + id)
      warnSpy.mockRestore()
    }
  })

  it("never fires for a purely programmatic close bypassing connect()'s own handlers (documented scope)", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const state = init({ open: true, animated: true })
      update(state, { type: 'close' })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})
