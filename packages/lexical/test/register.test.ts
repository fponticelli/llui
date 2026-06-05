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
})
