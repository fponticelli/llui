import { describe, it, expect, vi } from 'vitest'
import { tagSend } from '@llui/dom'
import { wrapChildSend } from '../../src/utils/child-send'

type Outer = { type: 'picker'; msg: Inner } | { type: 'other' }
type Inner = { type: 'setHue'; h: number } | { type: 'setAlpha'; alpha: number }

describe('wrapChildSend', () => {
  it('dispatches the wrapped message through the parent send', () => {
    const send = vi.fn()
    const child = wrapChildSend<Outer, Inner>(send, (m) => ({ type: 'picker', msg: m }), ['picker'])
    child({ type: 'setHue', h: 200 })
    expect(send).toHaveBeenCalledWith({ type: 'picker', msg: { type: 'setHue', h: 200 } })
  })

  it('tags the returned dispatcher with __lluiVariants', () => {
    const send = vi.fn()
    const child = wrapChildSend<Outer, Inner>(send, (m) => ({ type: 'picker', msg: m }), ['picker'])
    expect((child as unknown as { __lluiVariants?: readonly string[] }).__lluiVariants).toEqual([
      'picker',
    ])
  })

  it('a tagSend call built from the wrapped send reports the PARENT variant, not its own', () => {
    // This is the actual mechanism `tagSend` uses (binding-descriptors.ts):
    // `send.__lluiVariants`, when present, overrides the per-call variant
    // list — which is exactly what makes an embedded child's own handlers
    // report the parent's wrapper type instead of the child's internal one.
    const send = vi.fn()
    const child = wrapChildSend<Outer, Inner>(send, (m) => ({ type: 'picker', msg: m }), ['picker'])
    const handler = tagSend(child, ['setHue'], () => child({ type: 'setHue', h: 1 }))
    expect((handler as unknown as { __lluiVariants?: readonly string[] }).__lluiVariants).toEqual([
      'picker',
    ])
  })
})
