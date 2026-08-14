// Slash command menu — a `/` command palette built as a plugin. It uses both the
// engine `register` hook (to detect the `/query` trigger and drive keyboard nav
// from editor events) and the plugin-UI extension (state + the floating menu
// view + command execution). The flagship demonstration that the plugin-UI seam
// handles complex, stateful overlays.

import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import type { CommitFacts } from '@llui/lexical'
import { div, each, text, type Signal } from '@llui/dom'
import { definePluginUI } from './ui.js'
import { OVERLAY_Z, hideOverlay, overlayRoot } from './overlay.js'
import { surfaceGate } from './surface-open.js'
import type { CommandItem, MarkdownPlugin } from './types.js'

interface MenuItem {
  id: string
  label: string
}

/** A rendered row — the `active` flag is row-local so `each` highlights reliably. */
interface MenuRow {
  id: string
  label: string
  active: boolean
}

interface SlashState {
  open: boolean
  query: string
  items: MenuRow[]
  index: number
  x: number
  y: number
}

function withActive(items: readonly MenuItem[], index: number): MenuRow[] {
  return items.map((it, i) => ({ id: it.id, label: it.label, active: i === index }))
}

type SlashMsg =
  | { type: 'show'; query: string; items: MenuItem[]; x: number; y: number }
  | { type: 'hide' }
  | { type: 'move'; delta: number }
  | { type: 'choose' }
  | { type: 'click'; index: number }

type SlashEffect = { type: 'run'; id: string; query: string }

const TRIGGER = /(?:^|\s)\/([\w-]*)$/

/** The active slash query before the collapsed caret, or null. Derived from the
 * shared commit facts — no selection walk of its own. */
function slashQuery(facts: CommitFacts): string | null {
  if (facts.textBeforeCaret === null) return null
  const match = facts.textBeforeCaret.match(TRIGGER)
  return match ? (match[1] ?? '') : null
}

function caretXY(facts: CommitFacts): { x: number; y: number } {
  const rect = facts.caretRect()
  return rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 }
}

function matches(item: CommandItem, query: string): boolean {
  if (query === '') return true
  const q = query.toLowerCase()
  if (item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)) return true
  return (item.keywords ?? []).some((k) => k.toLowerCase().includes(q))
}

export function slashPlugin(): MarkdownPlugin {
  let slashItems: CommandItem[] = []

  const filtered = (query: string): MenuItem[] =>
    slashItems.filter((i) => matches(i, query)).map((i) => ({ id: i.id, label: i.label }))

  return {
    name: 'slash',
    onItems: (items) => {
      slashItems = items.filter((i) =>
        i.surfaces
          ? i.surfaces.includes('slash')
          : ['block', 'list', 'insert'].includes(i.group ?? ''),
      )
    },
    register: (editor, ctx) => {
      // The gate is "the MENU IS UP", read from the live slice — never "the caret
      // is on a `/`" (issue #130). The two differ in both directions: a dismissed
      // menu leaves the trigger text in place (no commit follows a dismissal, so a
      // cached query would stay set forever), and a query matching nothing opens
      // no menu at all. Claiming a key on the caret's position swallowed Escape
      // in both, and the host's COMMAND_PRIORITY_LOW handler never saw it.
      const isActive = surfaceGate(editor, 'slash')

      const refresh = (facts: CommitFacts): void => {
        const query = slashQuery(facts)
        if (query === null) {
          ctx.emit({ type: 'plugin', name: 'slash', msg: { type: 'hide' } })
          return
        }
        const items = filtered(query)
        const { x, y } = caretXY(facts)
        ctx.emit({ type: 'plugin', name: 'slash', msg: { type: 'show', query, items, x, y } })
      }

      const nav = (delta: number, e: KeyboardEvent | null): boolean => {
        if (!isActive()) return false
        e?.preventDefault()
        ctx.emit({ type: 'plugin', name: 'slash', msg: { type: 'move', delta } })
        return true
      }

      return mergeRegister(
        ctx.onCommit(refresh),
        editor.registerCommand(KEY_ARROW_DOWN_COMMAND, (e) => nav(1, e), COMMAND_PRIORITY_HIGH),
        editor.registerCommand(KEY_ARROW_UP_COMMAND, (e) => nav(-1, e), COMMAND_PRIORITY_HIGH),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (e) => {
            if (!isActive()) return false
            e?.preventDefault()
            ctx.emit({ type: 'plugin', name: 'slash', msg: { type: 'choose' } })
            return true
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (!isActive()) return false
            ctx.emit({ type: 'plugin', name: 'slash', msg: { type: 'hide' } })
            return true
          },
          COMMAND_PRIORITY_HIGH,
        ),
      )
    },
    ui: definePluginUI<SlashState, SlashMsg, SlashEffect>({
      init: () => ({ open: false, query: '', items: [], index: 0, x: 0, y: 0 }),
      // What `register`'s key handlers gate on — the same flag the overlay renders
      // from, so a dismissal, a chosen row and an empty result set all read alike.
      isOpen: (state) => state.open,
      update: (state, msg) => {
        switch (msg.type) {
          case 'show':
            return {
              open: msg.items.length > 0,
              query: msg.query,
              items: withActive(msg.items, 0),
              index: 0,
              x: msg.x,
              y: msg.y,
            }
          case 'hide':
            return hideOverlay(state)
          case 'move': {
            if (!state.open || state.items.length === 0) return state
            const index = (state.index + msg.delta + state.items.length) % state.items.length
            return { ...state, index, items: withActive(state.items, index) }
          }
          case 'choose': {
            const item = state.items[state.index]
            if (!state.open || !item) return hideOverlay(state)
            return [{ ...state, open: false }, [{ type: 'run', id: item.id, query: state.query }]]
          }
          case 'click': {
            const item = state.items[msg.index]
            if (!item) return state
            return [{ ...state, open: false }, [{ type: 'run', id: item.id, query: state.query }]]
          }
        }
      },
      onEffect: (effect, ctx) => {
        const editor = ctx.editor()
        if (!editor) return
        // Remove the typed "/query" before running the command.
        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
          const node = selection.anchor.getNode()
          if (!$isTextNode(node)) return
          const offset = selection.anchor.offset
          const start = offset - effect.query.length - 1
          if (start >= 0) node.spliceText(start, effect.query.length + 1, '', true)
        })
        ctx.emit({ type: 'runCommand', id: effect.id })
      },
      view: ({ state, send }) =>
        overlayRoot({
          open: state.at('open'),
          x: state.at('x'),
          y: state.at('y'),
          zIndex: OVERLAY_Z.typeahead,
          attrs: { 'data-scope': 'md-slash', 'data-part': 'root' },
          children: () => [
            each(state.at('items') as Signal<MenuRow[]>, {
              key: (it) => it.id,
              render: (item, index) => [
                div(
                  {
                    'data-scope': 'md-slash',
                    'data-part': 'option',
                    'data-active': item.map((it) => (it.active ? '' : undefined)),
                    onMouseDown: (e: MouseEvent) => {
                      e.preventDefault()
                      send({ type: 'click', index: index.peek() })
                    },
                  },
                  [text(item.map((it) => it.label))],
                ),
              ],
            }),
          ],
        }),
    }),
  }
}
