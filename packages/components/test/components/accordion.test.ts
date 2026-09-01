import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, focusTarget } from '../../src/components/accordion'
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
    })[0]
    expect(animated).toMatchObject({ value: [], closing: ['a'] })
  })

  it('completes and interrupts a retained close without changing controlled value', () => {
    const closing = update(init({ value: ['a'], animated: true }), {
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
    const first = update(init({ value: ['a'], animated: true }), {
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
      init({
        value: ['__proto__', 'constructor', 'toString'],
        multiple: true,
        animated: true,
      }),
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
    let state = init({ value: ['item-0'], animated: true })
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
    const closing = update(init({ value: ['a'], animated: true }), {
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
