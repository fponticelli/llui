import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDisposerRegistry } from '../src/hud-lifecycle.js'

// The two-phase teardown contract the HUD's destroy() order rests on (#115):
// peripherals FIFO, then the core (component, DOM) in reverse — so the
// component is disposed before the nodes it mounted into, exactly the order
// the old trailing registration block produced.

describe('createDisposerRegistry', () => {
  it('runs peripherals in registration order, then core in reverse', () => {
    const order: string[] = []
    const reg = createDisposerRegistry()
    reg.addCore(() => order.push('dom')) // appended first → removed last
    reg.add(() => order.push('listener'))
    reg.addCore(() => order.push('component'))
    reg.add(() => order.push('timer'))
    reg.dispose()
    expect(order).toEqual(['listener', 'timer', 'component', 'dom'])
  })

  it('is idempotent across both phases', () => {
    const order: string[] = []
    const reg = createDisposerRegistry()
    reg.add(() => order.push('a'))
    reg.addCore(() => order.push('b'))
    reg.dispose()
    reg.dispose()
    expect(order).toEqual(['a', 'b'])
  })

  it('disposes a late registration immediately, in either phase', () => {
    const order: string[] = []
    const reg = createDisposerRegistry()
    reg.dispose()
    reg.add(() => order.push('late-add'))
    reg.addCore(() => order.push('late-core'))
    expect(order).toEqual(['late-add', 'late-core'])
  })

  it('a throwing disposer does not strand the rest', () => {
    const order: string[] = []
    const reg = createDisposerRegistry()
    reg.add(() => {
      throw new Error('boom')
    })
    reg.add(() => order.push('after'))
    reg.addCore(() => {
      throw new Error('boom')
    })
    reg.addCore(() => order.push('core'))
    expect(() => reg.dispose()).not.toThrow()
    expect(order).toEqual(['after', 'core'])
  })

  // …but it must not be silent either. `NotesStore.dispose()` being REQUIRED
  // is a type-level guard only: a `as unknown as NotesStore` fake reaches
  // destroy() and throws a TypeError right here, which used to read as a
  // clean teardown.
  it('reports a throwing disposer instead of swallowing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reg = createDisposerRegistry()
    reg.add(() => {
      throw new Error('boom')
    })
    reg.dispose()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('teardown threw')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})
