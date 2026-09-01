import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/collapsible'
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

    const animated = update(init({ open: true, animated: true }), { type: 'close' })[0]
    expect(animated).toMatchObject({ open: false, closing: true })
  })

  it('reopen interrupts a retained close and exitComplete hides it', () => {
    const closing = update(init({ open: true, animated: true }), { type: 'close' })[0]
    expect(update(closing, { type: 'open' })[0]).toMatchObject({ open: true, closing: false })
    expect(
      update(closing, { type: 'exitComplete', generation: closing.exitGeneration })[0],
    ).toMatchObject({
      open: false,
      closing: false,
    })
  })

  it('rejects a stale completion from an earlier exit generation', () => {
    const first = update(init({ open: true, animated: true }), { type: 'close' })[0]
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
    const closing = update(init({ open: true, animated: true }), { type: 'close' })[0]
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
