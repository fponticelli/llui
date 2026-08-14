import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/tags-input'
import type { TagsInputState, TagsInputMsg } from '../../src/components/tags-input'
import { pathHandle } from '@llui/dom'
import { rootSignal, signalOf } from '../_signal'

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
  const p = connect(rootSignal(), vi.fn())

  it('input onKeyDown Enter adds tag', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    pc.input.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'addTag' })
  })

  it('comma delimiter adds tag', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send)
    const ev = new KeyboardEvent('keydown', { key: ',', cancelable: true })
    pc.input.onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({ type: 'addTag' })
  })

  it('Backspace with empty input sends removeLast', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    const input = document.createElement('input')
    input.value = ''
    const ev = new KeyboardEvent('keydown', { key: 'Backspace' })
    Object.defineProperty(ev, 'target', { value: input })
    pc.input.onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({ type: 'removeLast' })
  })

  it('tag.remove sends removeTag', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.tag('apple', 3).remove.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'removeTag', index: 3 })
  })

  it('validate blocks addTag when returning errors', () => {
    const h = harness(init(), { validate: (v) => (v.length < 2 ? ['too short'] : null) })
    // Simulate typing a short tag
    const input = document.createElement('input')
    input.value = 'x'
    const inputEvent = new Event('input')
    Object.defineProperty(inputEvent, 'target', { value: input })
    h.parts.input.onInput(inputEvent)
    // Try to add via Enter
    h.parts.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(h.sent).not.toContainEqual(expect.objectContaining({ type: 'addTag' }))
    // Now type a valid tag
    input.value = 'ab'
    const inputEvent2 = new Event('input')
    Object.defineProperty(inputEvent2, 'target', { value: input })
    h.parts.input.onInput(inputEvent2)
    h.parts.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(h.sent).toContainEqual({ type: 'addTag' })
    expect(h.state.value).toEqual(['ab'])
  })
})

/**
 * A live signal over a real reducer: `connect` must read the in-progress input
 * from STATE. It used to mirror it in a closure fed only by `onInput`, so a
 * value that arrived by any other path (agent `send`, host write) left the
 * mirror empty — and `validate && candidate !== ''` then short-circuited, so
 * `validate` NEVER RAN and the tag was added anyway (#120).
 */
function harness(initial: TagsInputState, opts?: Parameters<typeof connect>[2]) {
  let state = initial
  const sent: TagsInputMsg[] = []
  const send = (m: TagsInputMsg): void => {
    sent.push(m)
    ;[state] = update(state, m)
  }
  const parts = connect(
    pathHandle<TagsInputState>(() => state, ''),
    send,
    opts,
  )
  return {
    parts,
    sent,
    send,
    get state() {
      return state
    },
  }
}

describe('tags-input reads the in-progress input from state', () => {
  it('runs validate on a value that reached state without onInput', () => {
    const validate = vi.fn((v: string) => (v === 'nope' ? ['banned'] : null))
    const h = harness(init(), { validate })
    // The value arrives by `send` — an agent write, or a host setInput.
    h.send({ type: 'setInput', value: 'nope' })
    h.parts.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(validate).toHaveBeenCalledWith('nope')
    expect(h.sent).not.toContainEqual(expect.objectContaining({ type: 'addTag' }))
    expect(h.state.value).toEqual([])
  })

  it('commits a state-set value that passes validate', () => {
    const h = harness(init(), { validate: () => null })
    h.send({ type: 'setInput', value: 'ok' })
    h.parts.input.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(h.state.value).toEqual(['ok'])
  })

  it('blur commit validates the state value too', () => {
    const validate = vi.fn(() => ['nope'])
    const h = harness(init(), { validate })
    h.send({ type: 'setInput', value: 'x' })
    h.parts.input.onBlur(new FocusEvent('blur'))
    expect(validate).toHaveBeenCalledWith('x')
    expect(h.state.value).toEqual([])
  })
})
