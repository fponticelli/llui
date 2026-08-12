// Mention plugin — an `@`-triggered typeahead. Same shape as the slash menu, but
// the candidates come from a configurable `source`, and choosing inserts the
// mention text (`@label`) rather than running a command. Demonstrates a second
// typeahead built on the plugin-UI seam with no new machinery.

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
import type { MarkdownPlugin } from './types.js'

export interface Mention {
  id: string
  label: string
}

interface Row {
  id: string
  label: string
  active: boolean
}

interface MentionState {
  open: boolean
  query: string
  items: Row[]
  index: number
  x: number
  y: number
}

type MentionMsg =
  | { type: 'show'; query: string; items: Mention[]; x: number; y: number }
  | { type: 'hide' }
  | { type: 'move'; delta: number }
  | { type: 'choose' }
  | { type: 'click'; index: number }

type MentionEffect = { type: 'insert'; label: string; query: string }

const TRIGGER = /(?:^|\s)@(\w*)$/

const DEFAULT_MENTIONS: readonly Mention[] = [
  { id: 'franco', label: 'Franco' },
  { id: 'ada', label: 'Ada' },
  { id: 'grace', label: 'Grace' },
  { id: 'linus', label: 'Linus' },
  { id: 'margaret', label: 'Margaret' },
]

function withActive(items: readonly Mention[], index: number): Row[] {
  return items.map((it, i) => ({ id: it.id, label: it.label, active: i === index }))
}

/** The active `@` query before the collapsed caret, or null. Derived from the
 * shared commit facts — no selection walk of its own. */
function mentionQuery(facts: CommitFacts): string | null {
  if (facts.textBeforeCaret === null) return null
  const match = facts.textBeforeCaret.match(TRIGGER)
  return match ? (match[1] ?? '') : null
}

function caretXY(facts: CommitFacts): { x: number; y: number } {
  const rect = facts.caretRect()
  return rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 }
}

export interface MentionPluginOptions {
  /** Resolve candidates for a query (default: a small sample list). */
  source?: (query: string) => readonly Mention[]
}

export function mentionPlugin(opts: MentionPluginOptions = {}): MarkdownPlugin {
  const source =
    opts.source ??
    ((query: string) =>
      DEFAULT_MENTIONS.filter((m) => m.label.toLowerCase().includes(query.toLowerCase())))

  return {
    name: 'mention',
    register: (editor, ctx) => {
      // See the note in `slash.ts`: a keydown precedes the commit it causes, so
      // the last commit's query is what a fresh read would return.
      let liveQuery: string | null = null
      const isActive = (): boolean => liveQuery !== null

      const refresh = (facts: CommitFacts): void => {
        const query = mentionQuery(facts)
        liveQuery = query
        if (query === null) {
          ctx.emit({ type: 'plugin', name: 'mention', msg: { type: 'hide' } })
          return
        }
        const items = [...source(query)].slice(0, 8)
        const { x, y } = caretXY(facts)
        ctx.emit({ type: 'plugin', name: 'mention', msg: { type: 'show', query, items, x, y } })
      }

      const nav = (delta: number, e: KeyboardEvent | null): boolean => {
        if (!isActive()) return false
        e?.preventDefault()
        ctx.emit({ type: 'plugin', name: 'mention', msg: { type: 'move', delta } })
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
            ctx.emit({ type: 'plugin', name: 'mention', msg: { type: 'choose' } })
            return true
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (!isActive()) return false
            ctx.emit({ type: 'plugin', name: 'mention', msg: { type: 'hide' } })
            return true
          },
          COMMAND_PRIORITY_HIGH,
        ),
      )
    },
    ui: definePluginUI<MentionState, MentionMsg, MentionEffect>({
      init: () => ({ open: false, query: '', items: [], index: 0, x: 0, y: 0 }),
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
            return [
              { ...state, open: false },
              [{ type: 'insert', label: item.label, query: state.query }],
            ]
          }
          case 'click': {
            const item = state.items[msg.index]
            if (!item) return state
            return [
              { ...state, open: false },
              [{ type: 'insert', label: item.label, query: state.query }],
            ]
          }
        }
      },
      onEffect: (effect, ctx) => {
        const editor = ctx.editor()
        if (!editor) return
        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
          const node = selection.anchor.getNode()
          if (!$isTextNode(node)) return
          const offset = selection.anchor.offset
          const start = offset - effect.query.length - 1
          if (start >= 0) node.spliceText(start, effect.query.length + 1, `@${effect.label} `, true)
        })
      },
      view: ({ state, send }) =>
        overlayRoot({
          open: state.at('open'),
          x: state.at('x'),
          y: state.at('y'),
          zIndex: OVERLAY_Z.typeahead,
          attrs: { 'data-scope': 'md-slash', 'data-part': 'root' },
          children: () => [
            each(state.at('items') as Signal<Row[]>, {
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
                  [text(item.map((it) => `@${it.label}`))],
                ),
              ],
            }),
          ],
        }),
    }),
  }
}
