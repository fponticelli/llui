import { describe, it, expect } from 'vitest'
import { parseCombo, matchesCombo } from '../src/register.js'

function kbd(
  key: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {},
): KeyboardEvent {
  return {
    key,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
  } as KeyboardEvent
}

describe('parseCombo', () => {
  it('parses a simple mod chord', () => {
    expect(parseCombo('Mod-b')).toEqual({
      key: 'b',
      mod: true,
      shift: false,
      alt: false,
      ctrl: false,
    })
  })

  it('parses multiple modifiers and a digit key', () => {
    expect(parseCombo('Mod-Shift-7')).toEqual({
      key: '7',
      mod: true,
      shift: true,
      alt: false,
      ctrl: false,
    })
  })

  it('lower-cases single letter keys but keeps named keys', () => {
    expect(parseCombo('Mod-Alt-ArrowUp').key).toBe('ArrowUp')
    expect(parseCombo('Mod-B').key).toBe('b')
  })

  it('accepts cmd/meta/option aliases', () => {
    expect(parseCombo('Cmd-Option-i')).toEqual({
      key: 'i',
      mod: true,
      shift: false,
      alt: true,
      ctrl: false,
    })
  })
})

describe('matchesCombo', () => {
  it('Mod maps to metaKey on mac, ctrlKey elsewhere', () => {
    const combo = parseCombo('Mod-b')
    expect(matchesCombo(kbd('b', { metaKey: true }), combo, true)).toBe(true)
    expect(matchesCombo(kbd('b', { ctrlKey: true }), combo, true)).toBe(false)
    expect(matchesCombo(kbd('b', { ctrlKey: true }), combo, false)).toBe(true)
    expect(matchesCombo(kbd('b', { metaKey: true }), combo, false)).toBe(false)
  })

  it('requires shift to match exactly', () => {
    const combo = parseCombo('Mod-Shift-7')
    expect(matchesCombo(kbd('7', { metaKey: true, shiftKey: true }), combo, true)).toBe(true)
    expect(matchesCombo(kbd('7', { metaKey: true }), combo, true)).toBe(false)
  })

  it('rejects when an undeclared modifier is held', () => {
    const combo = parseCombo('Mod-b')
    expect(matchesCombo(kbd('b', { metaKey: true, altKey: true }), combo, true)).toBe(false)
  })

  it('rejects a different key', () => {
    const combo = parseCombo('Mod-b')
    expect(matchesCombo(kbd('i', { metaKey: true }), combo, true)).toBe(false)
  })

  describe('explicit Ctrl- chords', () => {
    it('fires off-mac (Ctrl folds onto the physical Ctrl key)', () => {
      const combo = parseCombo('Ctrl-b')
      // Regression: an explicit `Ctrl-` chord used to be dead off-mac.
      expect(matchesCombo(kbd('b', { ctrlKey: true }), combo, false)).toBe(true)
      // meta (Windows key) must NOT satisfy it off-mac.
      expect(matchesCombo(kbd('b', { metaKey: true }), combo, false)).toBe(false)
    })

    it('is equivalent to Mod- off-mac', () => {
      const ctrl = parseCombo('Ctrl-b')
      const mod = parseCombo('Mod-b')
      const evt = kbd('b', { ctrlKey: true })
      expect(matchesCombo(evt, ctrl, false)).toBe(true)
      expect(matchesCombo(evt, mod, false)).toBe(true)
    })

    it('targets ⌃ specifically on mac (distinct from ⌘/Mod)', () => {
      const combo = parseCombo('Ctrl-b')
      expect(matchesCombo(kbd('b', { ctrlKey: true }), combo, true)).toBe(true)
      // ⌘ does not satisfy an explicit ⌃ chord on mac.
      expect(matchesCombo(kbd('b', { metaKey: true }), combo, true)).toBe(false)
    })

    it('honours extra modifiers on a Ctrl chord off-mac', () => {
      const combo = parseCombo('Ctrl-Shift-k')
      expect(matchesCombo(kbd('k', { ctrlKey: true, shiftKey: true }), combo, false)).toBe(true)
      expect(matchesCombo(kbd('k', { ctrlKey: true }), combo, false)).toBe(false)
      // An undeclared alt rejects.
      expect(
        matchesCombo(kbd('k', { ctrlKey: true, shiftKey: true, altKey: true }), combo, false),
      ).toBe(false)
    })
  })
})
