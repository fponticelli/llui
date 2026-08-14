import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, isComplete, getValue } from '../../src/components/pin-input'
import type { PinInputMsg } from '../../src/components/pin-input'
import { rootSignal, read } from '../_signal'

describe('pin-input reducer', () => {
  it('initializes empty values of given length', () => {
    const s = init({ length: 6 })
    expect(s.values).toEqual(['', '', '', '', '', ''])
    expect(s.length).toBe(6)
  })

  it('setValue sanitizes numeric type', () => {
    const s0 = init({ length: 4, type: 'numeric' })
    const [s1] = update(s0, { type: 'setValue', index: 0, value: 'a' })
    expect(s1.values[0]).toBe('')
    const [s2] = update(s0, { type: 'setValue', index: 0, value: '3' })
    expect(s2.values[0]).toBe('3')
  })

  it('setValue auto-advances focus', () => {
    const s0 = init({ length: 4 })
    const [s] = update(s0, { type: 'setValue', index: 0, value: '1' })
    expect(s.focusedIndex).toBe(1)
  })

  it('setValue at last index does not advance', () => {
    const s0 = init({ length: 4 })
    const [s] = update(s0, { type: 'setValue', index: 3, value: '5' })
    expect(s.focusedIndex).toBe(3)
  })

  it('setAll fills from paste', () => {
    const s0 = init({ length: 6, type: 'numeric' })
    const [s] = update(s0, { type: 'setAll', values: '1234abc'.split('') })
    expect(s.values.slice(0, 4)).toEqual(['1', '2', '3', '4'])
    expect(s.values[4]).toBe('')
  })

  it('setAll distributes across every slot, skipping separators (#125 defect 6)', () => {
    const s0 = init({ length: 6, type: 'numeric' })
    const [s] = update(s0, { type: 'setAll', values: '123-456'.split('') })
    // Sanitizing per SLOT left a hole where the separator fell.
    expect(s.values).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(s.focusedIndex).toBe(5)
  })

  it('setAll accepts multi-character entries', () => {
    const [s] = update(init({ length: 4, type: 'numeric' }), {
      type: 'setAll',
      values: ['12 34'],
    })
    expect(s.values).toEqual(['1', '2', '3', '4'])
  })

  it('clear resets everything', () => {
    const s0 = { ...init({ length: 3 }), values: ['1', '2', '3'], focusedIndex: 2 }
    const [s] = update(s0, { type: 'clear' })
    expect(s.values).toEqual(['', '', ''])
    expect(s.focusedIndex).toBe(0)
  })

  it('backspace clears current when non-empty', () => {
    const s0 = { ...init({ length: 3 }), values: ['1', '2', ''], focusedIndex: 1 }
    const [s] = update(s0, { type: 'backspace', index: 1 })
    expect(s.values).toEqual(['1', '', ''])
  })

  it('backspace jumps back when current is empty', () => {
    const s0 = { ...init({ length: 3 }), values: ['1', '', ''], focusedIndex: 1 }
    const [s] = update(s0, { type: 'backspace', index: 1 })
    expect(s.values).toEqual(['', '', ''])
    expect(s.focusedIndex).toBe(0)
  })
})

describe('pin-input helpers', () => {
  it('isComplete returns true when all filled', () => {
    expect(isComplete({ ...init({ length: 3 }), values: ['1', '2', '3'] })).toBe(true)
    expect(isComplete({ ...init({ length: 3 }), values: ['1', '', '3'] })).toBe(false)
  })

  it('getValue concatenates', () => {
    expect(getValue({ ...init({ length: 3 }), values: ['1', '2', '3'] })).toBe('123')
  })
})

describe('pin-input.connect', () => {
  const p = connect(rootSignal(), vi.fn(), { id: 'pin' })

  it('root role=group with label', () => {
    expect(p.root.role).toBe('group')
    expect(p.root['aria-labelledby']).toBe('pin:label')
  })

  it('input type switches to password when masked', () => {
    expect(read(p.input(0).type, init({ mask: true }))).toBe('password')
    expect(read(p.input(0).type, init({ mask: false }))).toBe('text')
  })

  it('input inputmode tracks pin type', () => {
    expect(read(p.input(0).inputmode, init({ type: 'numeric' }))).toBe('numeric')
    expect(read(p.input(0).inputmode, init({ type: 'alphabetic' }))).toBe('text')
  })

  it('onInput sends setValue', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    const target = document.createElement('input')
    target.value = '5'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.input(2).onInput(ev)
    expect(send).toHaveBeenCalledWith({ type: 'setValue', index: 2, value: '5' })
  })

  it('backspace sends backspace msg', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, { id: 'x' })
    pc.input(1).onKeyDown(new KeyboardEvent('keydown', { key: 'Backspace' }))
    expect(send).toHaveBeenCalledWith({ type: 'backspace', index: 1 })
  })

  it('validate blocks setValue when returning errors', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send, {
      id: 'x',
      validate: (v) => (v === '0' ? ['zero not allowed'] : null),
    })
    // Try to input '0' — should be blocked
    const target = document.createElement('input')
    target.value = '0'
    const ev = new Event('input')
    Object.defineProperty(ev, 'target', { value: target })
    pc.input(0).onInput(ev)
    expect(send).not.toHaveBeenCalled()
    // Input '5' — should pass
    target.value = '5'
    const ev2 = new Event('input')
    Object.defineProperty(ev2, 'target', { value: target })
    pc.input(0).onInput(ev2)
    expect(send).toHaveBeenCalledWith({ type: 'setValue', index: 0, value: '5' })
  })
})

describe('pin-input paste (connect)', () => {
  /** Minimal stand-in for the `DataTransfer` jsdom does not implement: the
   * paste handler touches `getData` only. */
  class DataTransferStub {
    constructor(private readonly text: string) {}
    getData(type: string): string {
      return type === 'text' ? this.text : ''
    }
  }

  /** Minimal stand-in for `ClipboardEvent`. A real `Event` — so `dispatchEvent`
   * and `preventDefault` behave — carrying a `clipboardData`. No cast is needed
   * anywhere: `addEventListener('paste', …)` is typed through
   * `HTMLElementEventMap` and `dispatchEvent` takes an `Event`. */
  const ClipboardEventStub = class ClipboardEvent extends Event {
    readonly clipboardData: DataTransferStub
    constructor(type: string, init: { clipboardData: DataTransferStub }) {
      super(type, { bubbles: true, cancelable: true })
      this.clipboardData = init.clipboardData
    }
  }

  const paste = (text: string): { sent: PinInputMsg[]; event: Event } => {
    const sent: PinInputMsg[] = []
    const pc = connect(rootSignal(), (msg) => sent.push(msg), { id: 'x' })
    const field = document.createElement('input')
    field.addEventListener('paste', pc.input(0).onPaste)
    const event = new ClipboardEventStub('paste', { clipboardData: new DataTransferStub(text) })
    field.dispatchEvent(event)
    return { sent, event }
  }

  it('distributes a separator-carrying paste across every slot (#125 defect 6)', () => {
    const { sent, event } = paste('123-456')
    expect(event.defaultPrevented).toBe(true)
    expect(sent).toHaveLength(1)
    expect(update(init({ length: 6 }), sent[0]!)[0].values).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('sends an empty sequence when the clipboard holds nothing', () => {
    const { sent } = paste('')
    expect(update(init({ length: 4 }), sent[0]!)[0].values).toEqual(['', '', '', ''])
  })

  it('hands the clipboard text over WHOLE, so acceptedChars splits it by code point', () => {
    // `acceptedChars` judges a surrogate pair as one character, but only if it
    // arrives as one entry: `text.split('')` splits by UTF-16 code UNIT and
    // delivered two lone halves, which made the documented claim false.
    const { sent } = paste('1\u{1F600}2')
    expect(sent[0]).toEqual({ type: 'setAll', values: ['1\u{1F600}2'] })
  })
})
