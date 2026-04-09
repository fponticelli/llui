import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connect as radioConnect } from '../../src/components/radio-group'
import type { RadioGroupState } from '../../src/components/radio-group'
import { connect as sliderConnect } from '../../src/components/slider'
import type { SliderState } from '../../src/components/slider'

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
    type S = { r: RadioGroupState }
    const parts = radioConnect<S>((s) => s.r, send, { id: 'rg1' })
    // LTR: ArrowRight → selectNext (normal)
    parts
      .item('a')
      .root.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'selectNext', from: 'a' })
  })

  it('radio-group: ArrowRight in RTL sends selectPrev (reversed)', () => {
    const send = vi.fn()
    type S = { r: RadioGroupState }
    const parts = radioConnect<S>((s) => s.r, send, { id: 'rg2' })

    // Create a button inside RTL root and dispatch event through DOM
    const btn = document.createElement('button')
    rtlRoot.appendChild(btn)

    // Call onKeyDown with an event whose currentTarget is in RTL context
    const e = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    Object.defineProperty(e, 'currentTarget', { value: btn })
    parts.item('a').root.onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'selectPrev', from: 'a' })
  })

  it('radio-group: ArrowLeft in RTL sends selectNext (reversed)', () => {
    const send = vi.fn()
    type S = { r: RadioGroupState }
    const parts = radioConnect<S>((s) => s.r, send, { id: 'rg3' })

    const btn = document.createElement('button')
    rtlRoot.appendChild(btn)

    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    Object.defineProperty(e, 'currentTarget', { value: btn })
    parts.item('a').root.onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'selectNext', from: 'a' })
  })

  it('radio-group: ArrowUp/Down are NOT flipped in RTL', () => {
    const send = vi.fn()
    type S = { r: RadioGroupState }
    const parts = radioConnect<S>((s) => s.r, send, { id: 'rg4' })

    // Put in a vertical group so ArrowDown fires
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
    type S = { s: SliderState }
    const parts = sliderConnect<S>((s) => s.s, send)

    const btn = document.createElement('div')
    rtlRoot.appendChild(btn)

    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    Object.defineProperty(e, 'currentTarget', { value: btn })
    parts.thumb(0).thumb.onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 0 })
  })

  it('slider: ArrowUp is NOT flipped in RTL', () => {
    const send = vi.fn()
    type S = { s: SliderState }
    const parts = sliderConnect<S>((s) => s.s, send)

    const btn = document.createElement('div')
    rtlRoot.appendChild(btn)

    const e = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    Object.defineProperty(e, 'currentTarget', { value: btn })
    parts.thumb(0).thumb.onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'increment', index: 0 })
  })
})
