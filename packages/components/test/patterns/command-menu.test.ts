import { describe, it, expect, afterEach } from 'vitest'
import { component, mountApp } from '@llui/dom'
import {
  init,
  update,
  connect,
  view,
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

describe('commandMenu highlight', () => {
  const ids = (s: CommandMenuState): string | null => s.highlighted

  it('opening highlights the first enabled command (cmdk convention)', () => {
    const s = open(init({ commands: [{ ...COMMANDS[4]!, group: 'Edit' }, ...COMMANDS] }))
    // COMMANDS[4] (paste) is disabled and sorts first here, so it is skipped.
    expect(ids(s)).toBe('new-file')
  })

  it('a closed palette highlights nothing', () => {
    expect(ids(init({ commands: COMMANDS }))).toBeNull()
  })

  it('highlightNext/Prev walk the ENABLED filtered commands and wrap', () => {
    let s = open(init({ commands: COMMANDS }))
    s = update(s, { type: 'highlightNext' })[0]
    expect(ids(s)).toBe('open-file')
    s = update(s, { type: 'highlightLast' })[0]
    // `paste` is last but disabled.
    expect(ids(s)).toBe('copy')
    s = update(s, { type: 'highlightNext' })[0]
    expect(ids(s)).toBe('new-file')
    s = update(s, { type: 'highlightPrev' })[0]
    expect(ids(s)).toBe('copy')
    s = update(s, { type: 'highlightFirst' })[0]
    expect(ids(s)).toBe('new-file')
  })

  it('filtering keeps a still-visible highlight and re-seeds a filtered-out one', () => {
    let s = open(init({ commands: COMMANDS }))
    s = update(s, { type: 'highlight', commandId: 'open-file' })[0]
    s = update(s, { type: 'setQuery', query: 'file' })[0]
    expect(ids(s)).toBe('open-file')
    // (A re-seed would pick `new-file`, the first enabled match.)
    s = update(s, { type: 'setQuery', query: 'copy' })[0]
    expect(ids(s)).toBe('copy')
    s = update(s, { type: 'setQuery', query: 'zzz' })[0]
    expect(ids(s)).toBeNull()
  })

  it('highlight ignores a disabled or filtered-out command', () => {
    let s = open(init({ commands: COMMANDS }))
    s = update(s, { type: 'highlight', commandId: 'paste' })[0]
    expect(ids(s)).toBe('new-file')
    s = update(s, { type: 'setQuery', query: 'file' })[0]
    const same = update(s, { type: 'highlight', commandId: 'copy' })[0]
    expect(same).toBe(s)
  })

  it('executeHighlighted runs the highlighted command', () => {
    let s = open(init({ commands: COMMANDS }))
    s = update(s, { type: 'highlightNext' })[0]
    const [next, fx] = update(s, { type: 'executeHighlighted' })
    expect(fx).toEqual([{ type: 'execute', commandId: 'open-file' }])
    expect(next.open).toBe(false)
    expect(ids(next)).toBeNull()
  })

  it('executeHighlighted with nothing highlighted is a no-op', () => {
    const s = update(open(init({ commands: COMMANDS })), { type: 'setQuery', query: 'zzz' })[0]
    const [next, fx] = update(s, { type: 'executeHighlighted' })
    expect(next).toBe(s)
    expect(fx).toEqual([])
  })
})

describe('commandMenu view', () => {
  let app: ReturnType<typeof mountApp> | null = null
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  interface Ctx {
    cmd: CommandMenuState
  }
  type AppMsg = { type: 'cmd'; msg: CommandMenuMsg }

  function mount(): { executed: string[] } {
    const executed: string[] = []
    const def = component<Ctx, AppMsg, CommandMenuEffect>({
      name: 'CommandMenuViewTest',
      init: () => [{ cmd: init({ commands: COMMANDS, open: true }) }, []],
      update: (state, msg) => {
        const [cmd, fx] = update(state.cmd, msg.msg)
        return [{ cmd }, fx]
      },
      view: ({ state, send }) => [
        view({ state: state.at('cmd'), send: (m) => send({ type: 'cmd', msg: m }), id: 'cmdk' }),
      ],
      onEffect: (effect) => {
        executed.push(effect.commandId)
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = mountApp(host, def)
    return { executed }
  }

  const listbox = (): HTMLElement => document.querySelector<HTMLElement>('[role="listbox"]')!
  const options = (): HTMLElement[] =>
    Array.from(listbox().querySelectorAll<HTMLElement>('[role="option"]'))
  const searchInput = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>('input[role="combobox"]')!
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const type = async (value: string): Promise<void> => {
    const el = searchInput()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  }
  const key = async (k: string): Promise<void> => {
    searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    await settle()
  }

  it('renders every filtered command as an option of the listbox', async () => {
    mount()
    await settle()
    expect(listbox()).not.toBeNull()
    expect(options().map((o) => o.textContent)).toEqual([
      'New File',
      'Open File',
      'Save',
      'Copy',
      'Paste',
    ])
    expect(options().map((o) => o.id)).toEqual(
      ['new-file', 'open-file', 'save', 'copy', 'paste'].map((c) => `cmdk:combobox:item:${c}`),
    )
    const paste = options()[4]!
    expect(paste.getAttribute('aria-disabled')).toBe('true')
    expect(listbox().getAttribute('id')).toBe(searchInput().getAttribute('aria-controls'))
  })

  it('buckets options into labelled groups that the listbox owns', async () => {
    mount()
    await settle()
    const groups = Array.from(listbox().querySelectorAll<HTMLElement>('[role="group"]'))
    expect(groups).toHaveLength(2)
    const labels = groups.map((g) => {
      const labelId = g.getAttribute('aria-labelledby')!
      return document.getElementById(labelId)?.textContent
    })
    expect(labels).toEqual(['File', 'Edit'])
    expect(groups[0]!.querySelectorAll('[role="option"]')).toHaveLength(3)
    expect(groups[1]!.querySelectorAll('[role="option"]')).toHaveLength(2)
  })

  it('an ungrouped command is rendered without a dangling group label', async () => {
    const def = component<Ctx, AppMsg, CommandMenuEffect>({
      name: 'CommandMenuUngrouped',
      init: () => [{ cmd: init({ commands: [{ id: 'solo', label: 'Solo' }], open: true }) }, []],
      update: (state, msg) => [{ cmd: update(state.cmd, msg.msg)[0] }, []],
      view: ({ state, send }) => [
        view({ state: state.at('cmd'), send: (m) => send({ type: 'cmd', msg: m }), id: 'cmdk' }),
      ],
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = mountApp(host, def)
    await settle()
    expect(options().map((o) => o.textContent)).toEqual(['Solo'])
    for (const el of Array.from(document.querySelectorAll('[aria-labelledby]'))) {
      for (const id of el.getAttribute('aria-labelledby')!.split(/\s+/)) {
        expect(document.getElementById(id), id).not.toBeNull()
      }
    }
  })

  it('typing filters the options and toggles the empty state', async () => {
    mount()
    await settle()
    await type('file')
    expect(options().map((o) => o.textContent)).toEqual(['New File', 'Open File'])
    const empty = document.querySelector('[data-scope="command-menu"][data-part="empty"]')!
    expect(empty.hasAttribute('data-empty')).toBe(false)
    await type('zzz-no-match')
    expect(options()).toHaveLength(0)
    expect(empty.hasAttribute('data-empty')).toBe(true)
    expect(searchInput().hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('aria-activedescendant follows the arrow keys over enabled options', async () => {
    mount()
    await settle()
    const input = searchInput()
    expect(input.getAttribute('aria-activedescendant')).toBe('cmdk:combobox:item:new-file')
    expect(options()[0]!.hasAttribute('data-highlighted')).toBe(true)
    await key('ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toBe('cmdk:combobox:item:open-file')
    expect(options()[1]!.hasAttribute('data-highlighted')).toBe(true)
    expect(options()[0]!.hasAttribute('data-highlighted')).toBe(false)
    await key('End')
    expect(input.getAttribute('aria-activedescendant')).toBe('cmdk:combobox:item:copy')
    await key('Home')
    expect(input.getAttribute('aria-activedescendant')).toBe('cmdk:combobox:item:new-file')
    await key('ArrowUp')
    expect(input.getAttribute('aria-activedescendant')).toBe('cmdk:combobox:item:copy')
    const id = input.getAttribute('aria-activedescendant')!
    expect(document.getElementById(id)?.getAttribute('role')).toBe('option')
  })

  it('Enter runs the highlighted command and closes the palette', async () => {
    const { executed } = mount()
    await settle()
    await key('ArrowDown')
    await key('ArrowDown')
    await key('Enter')
    expect(executed).toEqual(['save'])
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('clicking an option runs it', async () => {
    const { executed } = mount()
    await settle()
    options()[3]!.click()
    await settle()
    expect(executed).toEqual(['copy'])
  })

  it('Escape clears a query first, then closes', async () => {
    mount()
    await settle()
    await type('file')
    await key('Escape')
    expect(searchInput().value).toBe('')
    expect(options()).toHaveLength(5)
    await key('Escape')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
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
