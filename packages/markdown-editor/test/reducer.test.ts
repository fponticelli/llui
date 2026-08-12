import { describe, it, expect } from 'vitest'
import { init, update, EMPTY_FORMAT, type EditorState, type FormatState } from '../src/state.js'

function state(overrides: Partial<EditorState> = {}): EditorState {
  const [s] = init({ value: 'hello world', readonly: false })
  return { ...s, ...overrides }
}

const fmt = (over: Partial<FormatState> = {}): FormatState => ({ ...EMPTY_FORMAT, ...over })

describe('init', () => {
  it('seeds value, word and char counts', () => {
    const [s, fx] = init({ value: 'hello world', readonly: false })
    expect(s.value).toBe('hello world')
    expect(s.wordCount).toBe(2)
    expect(s.charCount).toBe(11)
    expect(s.dirty).toBe(false)
    expect(s.ui.activeOverlay).toBe('none')
    expect(fx).toEqual([])
  })

  it('counts zero words for empty/blank input', () => {
    expect(init({ value: '', readonly: false })[0].wordCount).toBe(0)
    expect(init({ value: '   ', readonly: false })[0].wordCount).toBe(0)
  })
})

describe('update: markdownChanged', () => {
  it('updates value, marks dirty, and emits a change effect', () => {
    const [s, fx] = update(state(), { type: 'markdownChanged', value: '# new' })
    expect(s.value).toBe('# new')
    expect(s.dirty).toBe(true)
    expect(fx).toEqual([{ type: 'emitChange', value: '# new' }])
  })

  // Guard against re-growing a second echo authority here (issue #70): the seam
  // decides whether the document moved, this reducer only mirrors what it is
  // told. A reintroduced `if (msg.value === state.value) return [state, []]`
  // fails this test.
  //
  // A SHAPE lock, deliberately, not a behaviour pin: the seam's outbound gate
  // already makes a duplicate `markdownChanged` unreachable, so reintroducing
  // that `if` moves no integration test — which is exactly why the rule needs a
  // test of its own. #70 AC4 ("cover controlled mode with tests that fail if any
  // single guard is reintroduced") is asking for this one.
  it('mirrors an identical value without an equality check of its own', () => {
    const s0 = state({ value: 'same' })
    const [s, fx] = update(s0, { type: 'markdownChanged', value: 'same' })
    expect(s.value).toBe('same')
    expect(fx).toEqual([{ type: 'emitChange', value: 'same' }])
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

  // `dirty` describes the DOCUMENT, and only the seam knows whether a push moves
  // it, so the push itself must not set the flag — the seam reports back with
  // `valueApplied` and `dirty` follows that.
  it('mirrors the pushed value without claiming the document changed', () => {
    const [s] = update(state({ value: 'old', dirty: false }), { type: 'setValue', value: 'new' })
    expect(s.value).toBe('new')
    expect(s.dirty).toBe(false)
  })

  // The reducer's `value` is the last SERIALIZED document, so it cannot judge an
  // authored push: `_em_` and `*em*` are the same document but different strings,
  // and a push that races a pending keystroke is a different document behind the
  // same string. It forwards unconditionally and the seam decides (issue #70).
  it('forwards a push whose text equals the mirrored value — no equality check here', () => {
    const s0 = state({ value: 'same' })
    const [s, fx] = update(s0, { type: 'setValue', value: 'same' })
    expect(s.value).toBe('same')
    expect(fx).toEqual([{ type: 'applyValue', value: 'same' }])
  })
})

// The seam is the sole authority on whether a push reached the document, so it
// reports its actual decision back and `dirty` follows it. That keeps ONE owner
// of the question while `dirty` still means "the document moved" rather than
// "a push was made" (issue #70).
describe('update: valueApplied', () => {
  it('marks the document dirty when the seam wrote', () => {
    const [s, fx] = update(state({ dirty: false }), { type: 'valueApplied', applied: true })
    expect(s.dirty).toBe(true)
    expect(fx).toEqual([])
  })

  it('leaves the state untouched when the seam declined the push', () => {
    const s0 = state({ dirty: false })
    const [s, fx] = update(s0, { type: 'valueApplied', applied: false })
    expect(s).toBe(s0)
    expect(fx).toEqual([])
  })

  it('never clears a dirty flag an earlier edit set', () => {
    const [s] = update(state({ dirty: true }), { type: 'valueApplied', applied: false })
    expect(s.dirty).toBe(true)
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
  it('flips readonly', () => {
    const [s] = update(state({ readonly: false }), { type: 'setReadOnly', readonly: true })
    expect(s.readonly).toBe(true)
  })

  it('is a no-op when unchanged', () => {
    const s0 = state({ readonly: true })
    const [s, fx] = update(s0, { type: 'setReadOnly', readonly: true })
    expect(s).toBe(s0)
    expect(fx).toEqual([])
  })
})
