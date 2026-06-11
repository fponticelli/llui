import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect as radioConnect, init as radioInit } from '../../src/components/radio-group'
import { connect as sliderConnect, init as sliderInit } from '../../src/components/slider'
import { signalOf } from '../_signal'

// These components carry reading direction in their own State (`dir`), the
// single wave-5 convention: every horizontal-arrow handler routes through
// `flipArrow(e.key, state.peek().dir)`. So RTL is exercised by seeding the
// state with `dir: 'rtl'` (via `init({ dir: 'rtl' })`), exactly as the
// per-component rtl tests do. Orientation, by contrast, is read from the DOM
// (`closest('[data-orientation="vertical"]')`), so the vertical case still
// builds a real ancestor.

describe('RTL keyboard navigation', () => {
  let rtlRoot: HTMLElement

  beforeEach(() => {
    rtlRoot = document.createElement('div')
    rtlRoot.setAttribute('dir', 'rtl')
    document.body.appendChild(rtlRoot)
  })

  afterEach(() => {
    rtlRoot.remove()
  })

  it('radio-group: ArrowRight in LTR sends selectNext', () => {
    const send = vi.fn()
    const parts = radioConnect(signalOf(radioInit({ items: ['a', 'b', 'c'] })), send, { id: 'rg1' })
    // LTR (default dir): ArrowRight → selectNext (normal)
    parts
      .item('a')
      .root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'selectNext', from: 'a' })
  })

  it('radio-group: ArrowRight in RTL sends selectPrev (reversed)', () => {
    const send = vi.fn()
    const parts = radioConnect(signalOf(radioInit({ items: ['a', 'b', 'c'], dir: 'rtl' })), send, {
      id: 'rg2',
    })
    parts
      .item('a')
      .root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'selectPrev', from: 'a' })
  })

  it('radio-group: ArrowLeft in RTL sends selectNext (reversed)', () => {
    const send = vi.fn()
    const parts = radioConnect(signalOf(radioInit({ items: ['a', 'b', 'c'], dir: 'rtl' })), send, {
      id: 'rg3',
    })
    parts
      .item('a')
      .root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'selectNext', from: 'a' })
  })

  it('radio-group: ArrowUp/Down are NOT flipped in RTL', () => {
    const send = vi.fn()
    const parts = radioConnect(
      signalOf(radioInit({ items: ['a', 'b'], orientation: 'vertical', dir: 'rtl' })),
      send,
      { id: 'rg4' },
    )

    // Orientation is read from the DOM, so build a vertical ancestor.
    const group = document.createElement('div')
    group.setAttribute('data-orientation', 'vertical')
    rtlRoot.appendChild(group)
    const btn = document.createElement('button')
    group.appendChild(btn)

    const e = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    Object.defineProperty(e, 'currentTarget', { value: btn })
    parts.item('a').root.onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'selectNext', from: 'a' })
  })

  it('slider: ArrowLeft in RTL sends increment (reversed)', () => {
    const send = vi.fn()
    const parts = sliderConnect(signalOf(sliderInit({ dir: 'rtl' })), send)

    parts
      .thumb(0)
      .thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 0 })
  })

  it('slider: ArrowUp is NOT flipped in RTL', () => {
    const send = vi.fn()
    const parts = sliderConnect(signalOf(sliderInit({ dir: 'rtl' })), send)

    parts
      .thumb(0)
      .thumb.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 0 })
  })
})
