import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/toggle-group'
import type { ToggleGroupState } from '../../src/components/toggle-group'

type Ctx = { tg: ToggleGroupState }
const wrap = (tg: ToggleGroupState): Ctx => ({ tg })

describe('toggle-group reducer', () => {
  it('defaults to single mode', () => {
    expect(init().type).toBe('single')
  })

  it('single mode: toggle swaps active value', () => {
    const s0 = init({ type: 'single', items: ['a', 'b', 'c'], value: ['a'] })
    const [s] = update(s0, { type: 'toggle', value: 'b' })
    expect(s.value).toEqual(['b'])
  })

  it('single deselectable: toggle off removes active', () => {
    const s0 = init({ type: 'single', items: ['a'], value: ['a'], deselectable: true })
    const [s] = update(s0, { type: 'toggle', value: 'a' })
    expect(s.value).toEqual([])
  })

  it('single non-deselectable: toggle keeps active', () => {
    const s0 = init({ type: 'single', items: ['a'], value: ['a'], deselectable: false })
    const [s] = update(s0, { type: 'toggle', value: 'a' })
    expect(s.value).toEqual(['a'])
  })

  it('multiple mode: toggle flips each', () => {
    const s0 = init({ type: 'multiple', items: ['a', 'b'], value: [] })
    const [s1] = update(s0, { type: 'toggle', value: 'a' })
    expect(s1.value).toEqual(['a'])
    const [s2] = update(s1, { type: 'toggle', value: 'b' })
    expect(s2.value).toEqual(['a', 'b'])
    const [s3] = update(s2, { type: 'toggle', value: 'a' })
    expect(s3.value).toEqual(['b'])
  })

  it('ignores disabled items', () => {
    const s0 = init({ items: ['a', 'b'], disabledItems: ['b'] })
    const [s] = update(s0, { type: 'toggle', value: 'b' })
    expect(s.value).toEqual([])
  })
})

describe('toggle-group.connect', () => {
  const p = connect<Ctx>((s) => s.tg, vi.fn())

  it('root has role=group', () => {
    expect(p.root.role).toBe('group')
  })

  it('item aria-pressed reflects value', () => {
    const a = p.item('a').root
    expect(a['aria-pressed'](wrap(init({ items: ['a', 'b'], value: ['a'] })))).toBe(true)
    expect(a['aria-pressed'](wrap(init({ items: ['a', 'b'], value: ['b'] })))).toBe(false)
  })

  it('item click sends toggle', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.tg, send)
    pc.item('a').root.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'toggle', value: 'a' })
  })

  it('ArrowRight sends focusNext', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.tg, send)
    pc.item('a').root.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'focusNext', from: 'a' })
  })
})
