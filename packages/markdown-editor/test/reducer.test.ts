import { describe, it, expect } from 'vitest'
import { init, update, EMPTY_FORMAT, type EditorState, type FormatState } from '../src/state.js'

function state(overrides: Partial<EditorState> = {}): EditorState {
  const [s] = init({ value: 'hello world', readOnly: false })
  return { ...s, ...overrides }
}

const fmt = (over: Partial<FormatState> = {}): FormatState => ({ ...EMPTY_FORMAT, ...over })

describe('init', () => {
  it('seeds value, word and char counts', () => {
    const [s, fx] = init({ value: 'hello world', readOnly: false })
    expect(s.value).toBe('hello world')
    expect(s.wordCount).toBe(2)
    expect(s.charCount).toBe(11)
    expect(s.dirty).toBe(false)
    expect(s.ui.activeOverlay).toBe('none')
    expect(fx).toEqual([])
  })

  it('counts zero words for empty/blank input', () => {
    expect(init({ value: '', readOnly: false })[0].wordCount).toBe(0)
    expect(init({ value: '   ', readOnly: false })[0].wordCount).toBe(0)
  })
})

describe('update: markdownChanged', () => {
  it('updates value, marks dirty, and emits a change effect', () => {
    const [s, fx] = update(state(), { type: 'markdownChanged', value: '# new' })
    expect(s.value).toBe('# new')
    expect(s.dirty).toBe(true)
    expect(fx).toEqual([{ type: 'emitChange', value: '# new' }])
  })

  it('is a no-op when the value is unchanged (echo safety)', () => {
    const s0 = state({ value: 'same' })
    const [s, fx] = update(s0, { type: 'markdownChanged', value: 'same' })
    expect(s).toBe(s0)
    expect(fx).toEqual([])
  })
})

describe('update: formatChanged', () => {
  it('stores format + counts and emits a format effect', () => {
    const f = fmt({ bold: true, blockType: 'h2' })
    const [s, fx] = update(state(), {
      type: 'formatChanged',
      format: f,
      wordCount: 5,
      charCount: 20,
    })
    expect(s.format).toEqual(f)
    expect(s.wordCount).toBe(5)
    expect(s.charCount).toBe(20)
    expect(fx).toEqual([{ type: 'emitFormat', format: f }])
  })
})

describe('update: runCommand', () => {
  it('emits an execCommand effect carrying the id', () => {
    const [s, fx] = update(state(), { type: 'runCommand', id: 'bold' })
    expect(fx).toEqual([{ type: 'execCommand', id: 'bold' }])
    expect(s).toEqual(state())
  })
})

describe('update: setValue', () => {
  it('emits an applyValue effect for a foreign value', () => {
    const [s, fx] = update(state({ value: 'old' }), { type: 'setValue', value: 'new' })
    expect(s.value).toBe('new')
    expect(fx).toEqual([{ type: 'applyValue', value: 'new' }])
  })

  it('is a no-op when the value is unchanged', () => {
    const s0 = state({ value: 'same' })
    const [s, fx] = update(s0, { type: 'setValue', value: 'same' })
    expect(s).toBe(s0)
    expect(fx).toEqual([])
  })
})

describe('update: overlays', () => {
  it('opens an overlay with a position and resets slash query for slash', () => {
    const [s] = update(
      state({ ui: { activeOverlay: 'none', slashQuery: 'x', menu: { x: 0, y: 0 } } }),
      { type: 'openOverlay', overlay: 'context', x: 10, y: 20 },
    )
    expect(s.ui.activeOverlay).toBe('context')
    expect(s.ui.menu).toEqual({ x: 10, y: 20 })
  })

  it('closes an open overlay and clears the slash query', () => {
    const [s] = update(
      state({ ui: { activeOverlay: 'slash', slashQuery: 'head', menu: { x: 0, y: 0 } } }),
      { type: 'closeOverlay' },
    )
    expect(s.ui.activeOverlay).toBe('none')
    expect(s.ui.slashQuery).toBe('')
  })

  it('closeOverlay is a no-op when nothing is open', () => {
    const s0 = state()
    const [s, fx] = update(s0, { type: 'closeOverlay' })
    expect(s).toBe(s0)
    expect(fx).toEqual([])
  })

  it('tracks the slash query', () => {
    const [s] = update(state(), { type: 'slashQuery', query: 'quo' })
    expect(s.ui.slashQuery).toBe('quo')
  })
})

describe('update: setReadOnly', () => {
  it('flips readOnly', () => {
    const [s] = update(state({ readOnly: false }), { type: 'setReadOnly', readOnly: true })
    expect(s.readOnly).toBe(true)
  })

  it('is a no-op when unchanged', () => {
    const s0 = state({ readOnly: true })
    const [s, fx] = update(s0, { type: 'setReadOnly', readOnly: true })
    expect(s).toBe(s0)
    expect(fx).toEqual([])
  })
})
