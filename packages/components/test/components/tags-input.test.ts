import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/tags-input'
import type { TagsInputState } from '../../src/components/tags-input'

type Ctx = { t: TagsInputState }

describe('tags-input reducer', () => {
  it('initializes empty', () => {
    expect(init()).toMatchObject({ value: [], inputValue: '', unique: true })
  })

  it('addTag from inputValue', () => {
    const s0 = { ...init(), inputValue: 'apple' }
    const [s] = update(s0, { type: 'addTag' })
    expect(s.value).toEqual(['apple'])
    expect(s.inputValue).toBe('')
  })

  it('addTag with explicit value', () => {
    const [s] = update(init(), { type: 'addTag', value: 'banana' })
    expect(s.value).toEqual(['banana'])
  })

  it('addTag skips empty strings', () => {
    const s0 = { ...init(), inputValue: '   ' }
    const [s] = update(s0, { type: 'addTag' })
    expect(s.value).toEqual([])
  })

  it('addTag trims whitespace', () => {
    const [s] = update(init(), { type: 'addTag', value: '  apple  ' })
    expect(s.value).toEqual(['apple'])
  })

  it('unique mode rejects duplicates', () => {
    const s0 = init({ value: ['apple'], unique: true })
    const [s] = update(s0, { type: 'addTag', value: 'apple' })
    expect(s.value).toEqual(['apple'])
  })

  it('max limit enforced', () => {
    const s0 = init({ value: ['a', 'b'], max: 2 })
    const [s] = update(s0, { type: 'addTag', value: 'c' })
    expect(s.value).toEqual(['a', 'b'])
  })

  it('removeTag by index', () => {
    const s0 = init({ value: ['a', 'b', 'c'] })
    const [s] = update(s0, { type: 'removeTag', index: 1 })
    expect(s.value).toEqual(['a', 'c'])
  })

  it('removeLast pops last', () => {
    const s0 = init({ value: ['a', 'b'] })
    const [s] = update(s0, { type: 'removeLast' })
    expect(s.value).toEqual(['a'])
  })

  it('clearAll empties value', () => {
    const s0 = init({ value: ['a', 'b'] })
    const [s] = update(s0, { type: 'clearAll' })
    expect(s.value).toEqual([])
  })

  it('focusTagPrev from null goes to last', () => {
    const s0 = init({ value: ['a', 'b', 'c'] })
    const [s] = update(s0, { type: 'focusTagPrev' })
    expect(s.focusedIndex).toBe(2)
  })

  it('focusTagNext from last clears focus', () => {
    const s0 = { ...init({ value: ['a', 'b'] }), focusedIndex: 1 }
    const [s] = update(s0, { type: 'focusTagNext' })
    expect(s.focusedIndex).toBeNull()
  })
})

describe('tags-input.connect', () => {
  const p = connect<Ctx>((s) => s.t, vi.fn())

  it('input onKeyDown Enter adds tag', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.t, send)
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    pc.input.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'addTag' })
  })

  it('comma delimiter adds tag', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.t, send)
    const ev = new KeyboardEvent('keydown', { key: ',', cancelable: true })
    pc.input.onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({ type: 'addTag' })
  })

  it('Backspace with empty input sends removeLast', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.t, send)
    const input = document.createElement('input')
    input.value = ''
    const ev = new KeyboardEvent('keydown', { key: 'Backspace' })
    Object.defineProperty(ev, 'target', { value: input })
    pc.input.onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({ type: 'removeLast' })
  })

  it('tag.remove sends removeTag', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.t, send)
    pc.tag('apple', 3).remove.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'removeTag', index: 3 })
  })
})
