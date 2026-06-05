// Floating selection toolbar — a bubble of inline-format actions that appears
// above a non-collapsed text selection. A plugin-UI overlay: `register` watches
// selection changes and positions/fills the bar; clicking a button runs the
// command on the still-live selection.

import { $getSelection, $isRangeSelection } from 'lexical'
import { $findMatchingParent } from '@lexical/utils'
import { $isLinkNode } from '@lexical/link'
import { button, div, each, portal, show, span, text, unsafeHtml, type Signal } from '@llui/dom'
import { definePluginUI } from './ui.js'
import { DEFAULT_GLYPHS } from '../surfaces/toolbar.js'
import type { CommandItem, MarkdownPlugin } from './types.js'

interface BarItem {
  id: string
  label: string
  glyph: string
  active: boolean
}

interface FloatState {
  open: boolean
  x: number
  y: number
  items: BarItem[]
}

type FloatMsg =
  | { type: 'show'; x: number; y: number; items: BarItem[] }
  | { type: 'hide' }
  | { type: 'run'; index: number }

type FloatEffect = { type: 'run'; id: string }

interface InlineFormat {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  code: boolean
  link: boolean
}

function readFormat(editor: import('lexical').LexicalEditor): InlineFormat {
  return editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) {
      return { bold: false, italic: false, strikethrough: false, code: false, link: false }
    }
    return {
      bold: selection.hasFormat('bold'),
      italic: selection.hasFormat('italic'),
      strikethrough: selection.hasFormat('strikethrough'),
      code: selection.hasFormat('code'),
      link: $findMatchingParent(selection.anchor.getNode(), (n) => $isLinkNode(n)) !== null,
    }
  })
}

function activeFor(id: string, fmt: InlineFormat): boolean {
  switch (id) {
    case 'bold':
      return fmt.bold
    case 'italic':
      return fmt.italic
    case 'strikethrough':
      return fmt.strikethrough
    case 'code':
      return fmt.code
    case 'link':
      return fmt.link
    default:
      return false
  }
}

export function floatingToolbarPlugin(): MarkdownPlugin {
  let floatingItems: CommandItem[] = []

  return {
    name: 'floatingToolbar',
    onItems: (items) => {
      floatingItems = items.filter((i) =>
        i.surfaces ? i.surfaces.includes('floating') : i.group === 'inline',
      )
    },
    register: (editor, ctx) => {
      const refresh = (): void => {
        const collapsed = editor.getEditorState().read(() => {
          const s = $getSelection()
          return !$isRangeSelection(s) || s.isCollapsed()
        })
        const dom = typeof window !== 'undefined' ? window.getSelection() : null
        if (collapsed || !dom || dom.rangeCount === 0) {
          ctx.emit({ type: 'plugin', name: 'floatingToolbar', msg: { type: 'hide' } })
          return
        }
        const rect = dom.getRangeAt(0).getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          ctx.emit({ type: 'plugin', name: 'floatingToolbar', msg: { type: 'hide' } })
          return
        }
        const fmt = readFormat(editor)
        const items: BarItem[] = floatingItems.map((i) => ({
          id: i.id,
          label: i.label,
          glyph: DEFAULT_GLYPHS[i.id] ?? i.label,
          active: activeFor(i.id, fmt),
        }))
        ctx.emit({
          type: 'plugin',
          name: 'floatingToolbar',
          msg: { type: 'show', x: rect.left + rect.width / 2, y: rect.top, items },
        })
      }
      return editor.registerUpdateListener(() => refresh())
    },
    ui: definePluginUI<FloatState, FloatMsg, FloatEffect>({
      init: () => ({ open: false, x: 0, y: 0, items: [] }),
      update: (state, msg) => {
        switch (msg.type) {
          case 'show':
            return { open: msg.items.length > 0, x: msg.x, y: msg.y, items: msg.items }
          case 'hide':
            return state.open ? { ...state, open: false } : state
          case 'run': {
            const item = state.items[msg.index]
            return item ? [state, [{ type: 'run', id: item.id }]] : state
          }
        }
      },
      onEffect: (effect, ctx) => {
        ctx.emit({ type: 'runCommand', id: effect.id })
      },
      view: ({ state, send }) => [
        show(state.at('open'), () => [
          portal(() => [
            div(
              {
                'data-scope': 'md-floating',
                'data-part': 'root',
                style: state.at('x').map((x) => `--md-fx:${x}px`) as Signal<string>,
              },
              [
                div(
                  {
                    'data-scope': 'md-floating',
                    'data-part': 'bar',
                    style: state
                      .at('y')
                      .map(
                        (y) =>
                          `position:fixed;left:var(--md-fx);top:${y}px;transform:translate(-50%,-115%);z-index:62`,
                      ) as Signal<string>,
                  },
                  [
                    each(state.at('items') as Signal<BarItem[]>, {
                      key: (it) => it.id,
                      render: (item, index) => [
                        button(
                          {
                            type: 'button',
                            'data-scope': 'md-floating',
                            'data-part': 'item',
                            'data-active': item.map((it) => (it.active ? '' : undefined)),
                            'aria-label': item.map((it) => it.label),
                            onMouseDown: (e: MouseEvent) => {
                              e.preventDefault()
                              send({ type: 'run', index: index.peek() })
                            },
                          },
                          [
                            span({ 'data-part': 'glyph', 'aria-hidden': 'true' }, [
                              renderGlyph(item),
                            ]),
                          ],
                        ),
                      ],
                    }),
                  ],
                ),
              ],
            ),
          ]),
        ]),
      ],
    }),
  }
}

/** Render an item's glyph (SVG markup → unsafeHtml, otherwise text). */
function renderGlyph(item: Signal<BarItem>): import('@llui/dom').Mountable {
  // The glyph value is stable per row; reading once is fine.
  const glyph = item.peek().glyph
  return glyph.trimStart().startsWith('<svg') ? unsafeHtml(glyph) : text(item.map((it) => it.glyph))
}
