import { describe, it, expect } from 'vitest'
import {
  init,
  update,
  connect,
  watchHotkey,
  type CommandMenuState,
  type CommandMenuMsg,
  type CommandMenuEffect,
} from '../../src/patterns/command-menu'
import { rootSignal, read } from '../_signal'

const COMMANDS = [
  { id: 'new-file', label: 'New File', group: 'File', keywords: ['create', 'add'] },
  { id: 'open-file', label: 'Open File', group: 'File' },
  { id: 'save', label: 'Save', group: 'File', keywords: ['write', 'persist'] },
  { id: 'copy', label: 'Copy', group: 'Edit' },
  { id: 'paste', label: 'Paste', group: 'Edit', disabled: true },
]

function open(state: CommandMenuState): CommandMenuState {
  return update(state, { type: 'open' })[0]
}

describe('commandMenu reducer', () => {
  it('initializes closed with all commands and no filter', () => {
    const s = init({ commands: COMMANDS })
    expect(s.open).toBe(false)
    expect(s.commands).toHaveLength(5)
    expect(s.query).toBe('')
    expect(s.recents).toEqual([])
  })

  it('open focuses (resets) the filter and opens', () => {
    const dirty = { ...init({ commands: COMMANDS }), query: 'leftover' }
    const [s] = update(dirty, { type: 'open' })
    expect(s.open).toBe(true)
    expect(s.query).toBe('')
  })

  it('filters by label (case-insensitive)', () => {
    const [s] = update(open(init({ commands: COMMANDS })), { type: 'setQuery', query: 'save' })
    expect(s.filtered.map((c) => c.id)).toEqual(['save'])
  })

  it('filters by keyword as well as label', () => {
    const [s] = update(open(init({ commands: COMMANDS })), { type: 'setQuery', query: 'persist' })
    expect(s.filtered.map((c) => c.id)).toEqual(['save'])
  })

  it('groups expose only the filtered commands, preserving group order', () => {
    const [s] = update(open(init({ commands: COMMANDS })), { type: 'setQuery', query: '' })
    const groups = s.filteredGroups
    expect(groups.map((g) => g.label)).toEqual(['File', 'Edit'])
    expect(groups[0]!.commands.map((c) => c.id)).toEqual(['new-file', 'open-file', 'save'])
    expect(groups[1]!.commands.map((c) => c.id)).toEqual(['copy', 'paste'])
  })

  it('execute emits an intent effect, records a recent, and closes', () => {
    const [s, fx] = update(open(init({ commands: COMMANDS })), {
      type: 'execute',
      commandId: 'save',
    })
    expect(s.open).toBe(false)
    expect(s.recents[0]).toBe('save')
    const effect = fx.find(
      (e): e is Extract<CommandMenuEffect, { type: 'execute' }> => e.type === 'execute',
    )
    expect(effect?.commandId).toBe('save')
  })

  it('execute is a no-op for a disabled command (no effect, stays open)', () => {
    const [s, fx] = update(open(init({ commands: COMMANDS })), {
      type: 'execute',
      commandId: 'paste',
    })
    expect(s.open).toBe(true)
    expect(fx).toHaveLength(0)
    expect(s.recents).toEqual([])
  })

  it('recents rank most-recent-first and dedupe', () => {
    let s = open(init({ commands: COMMANDS }))
    s = update(s, { type: 'execute', commandId: 'copy' })[0]
    s = update(open(s), { type: 'execute', commandId: 'save' })[0]
    s = update(open(s), { type: 'execute', commandId: 'copy' })[0]
    expect(s.recents).toEqual(['copy', 'save'])
  })

  it('recents bubble matching commands to the front of an empty-query list', () => {
    let s = open(init({ commands: COMMANDS }))
    s = update(s, { type: 'execute', commandId: 'save' })[0]
    const [s2] = update(open(s), { type: 'setQuery', query: '' })
    // 'save' was last executed -> should sort ahead of its group siblings
    const fileGroup = s2.filteredGroups.find((g) => g.label === 'File')!
    expect(fileGroup.commands[0]!.id).toBe('save')
  })

  it('first Escape with a non-empty query clears the query (stays open)', () => {
    const opened = update(open(init({ commands: COMMANDS })), {
      type: 'setQuery',
      query: 'sa',
    })[0]
    const [s] = update(opened, { type: 'escape' })
    expect(s.open).toBe(true)
    expect(s.query).toBe('')
  })

  it('Escape with an empty query closes the menu', () => {
    const [s] = update(open(init({ commands: COMMANDS })), { type: 'escape' })
    expect(s.open).toBe(false)
  })

  it('close resets the query', () => {
    const opened = update(open(init({ commands: COMMANDS })), {
      type: 'setQuery',
      query: 'sa',
    })[0]
    const [s] = update(opened, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.query).toBe('')
  })
})

describe('commandMenu connect', () => {
  it('exposes dialog + combobox parts and an empty-state part', () => {
    const state = rootSignal<CommandMenuState>()
    const parts = connect(
      state,
      () => {
        /* noop */
      },
      { id: 'cmdk' },
    )
    expect(parts.dialog).toBeDefined()
    expect(parts.combobox).toBeDefined()
    expect(parts.empty['data-part']).toBe('empty')
  })

  it('shortcutHint returns the registered hint for a command', () => {
    const state = rootSignal<CommandMenuState>()
    const parts = connect(
      state,
      () => {
        /* noop */
      },
      { id: 'cmdk' },
    )
    const hinted = init({
      commands: [{ id: 'save', label: 'Save', shortcut: 'mod+s' }],
    })
    expect(read(parts.shortcutHint('save'), hinted)).toBe('mod+s')
    expect(read(parts.shortcutHint('missing'), hinted)).toBe('')
  })

  it('empty part reflects an empty filtered list', () => {
    const state = rootSignal<CommandMenuState>()
    const parts = connect(
      state,
      () => {
        /* noop */
      },
      { id: 'cmdk' },
    )
    const filtered = update(open(init({ commands: COMMANDS })), {
      type: 'setQuery',
      query: 'zzz-no-match',
    })[0]
    const populated = open(init({ commands: COMMANDS }))
    expect(read(parts.empty['data-empty'], filtered)).toBe('')
    expect(read(parts.empty['data-empty'], populated)).toBeUndefined()
  })
})

describe('watchHotkey helper', () => {
  it('fires the open intent on mod+k and returns a cleanup', () => {
    const sent: CommandMenuMsg[] = []
    const cleanup = watchHotkey((m) => sent.push(m))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    expect(sent).toEqual([{ type: 'open' }])
    cleanup()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    expect(sent).toHaveLength(1)
  })

  it('honors a custom combo and ignores non-matching keys', () => {
    const sent: CommandMenuMsg[] = []
    const cleanup = watchHotkey((m) => sent.push(m), 'mod+j')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    expect(sent).toHaveLength(0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }))
    expect(sent).toEqual([{ type: 'open' }])
    cleanup()
  })
})
