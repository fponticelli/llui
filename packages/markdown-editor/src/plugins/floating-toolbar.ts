// Floating selection toolbar — a bubble of inline-format actions that appears
// above a non-collapsed text selection. A plugin-UI overlay: `register` watches
// selection changes and positions/fills the bar; clicking a button runs the
// command on the still-live selection.

import { $isRangeSelection, BLUR_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { $isLinkNode } from '@lexical/link'
import type { CommitFacts } from '@llui/lexical'
import { button, each, span, text, unsafeHtml, type Signal } from '@llui/dom'
import { definePluginUI } from './ui.js'
import { OVERLAY_Z, hideOverlay, onViewportChange, overlayRoot } from './overlay.js'
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

/** Read the inline format of the shared commit's selection. Runs inside the
 * hub's read context, so it needs no read of its own. */
function readFormat(facts: CommitFacts): InlineFormat {
  const selection = facts.selection
  if (!$isRangeSelection(selection)) {
    return { bold: false, italic: false, strikethrough: false, code: false, link: false }
  }
  return {
    bold: selection.hasFormat('bold'),
    italic: selection.hasFormat('italic'),
    strikethrough: selection.hasFormat('strikethrough'),
    code: selection.hasFormat('code'),
    // Same chain `$findMatchingParent` would climb, walked once for every
    // plugin that needs it.
    link: facts.ancestorsOf(facts.anchorNode).some($isLinkNode),
  }
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
      const refresh = (facts: CommitFacts): void => {
        // Collapsed (or non-range) selection: no bubble, and — the point of the
        // gate — no caret measurement.
        if (!facts.isRange || facts.isCollapsed) {
          ctx.emit({ type: 'plugin', name: 'floatingToolbar', msg: { type: 'hide' } })
          return
        }
        const rect = facts.caretRect()
        if (rect === null || (rect.width === 0 && rect.height === 0)) {
          ctx.emit({ type: 'plugin', name: 'floatingToolbar', msg: { type: 'hide' } })
          return
        }
        const fmt = readFormat(facts)
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
      return mergeRegister(
        ctx.onCommit(refresh),
        // Keep the bubble glued to the selection while the page scrolls. No
        // commit happens, so the facts have to be derived on demand.
        onViewportChange(() => ctx.withFacts(refresh)),
        // Dismiss when the editor loses focus. Without this the bubble lingers
        // when something steals focus WITHOUT changing the editor state — most
        // visibly the link dialog, whose modal input focus leaves the bubble
        // stranded (and dead) over the backdrop. Toolbar-button clicks keep focus
        // (their mousedown preventDefaults), so this never fires mid-interaction.
        editor.registerCommand(
          BLUR_COMMAND,
          () => {
            ctx.emit({ type: 'plugin', name: 'floatingToolbar', msg: { type: 'hide' } })
            return false
          },
          COMMAND_PRIORITY_LOW,
        ),
      )
    },
    ui: definePluginUI<FloatState, FloatMsg, FloatEffect>({
      init: () => ({ open: false, x: 0, y: 0, items: [] }),
      update: (state, msg) => {
        switch (msg.type) {
          case 'show':
            return { open: msg.items.length > 0, x: msg.x, y: msg.y, items: msg.items }
          case 'hide':
            return hideOverlay(state)
          case 'run': {
            const item = state.items[msg.index]
            return item ? [state, [{ type: 'run', id: item.id }]] : state
          }
        }
      },
      onEffect: (effect, ctx) => {
        ctx.emit({ type: 'runCommand', id: effect.id })
      },
      // `x` is the selection's horizontal centre; the transform centres the bar on
      // it and lifts it above the selection.
      view: ({ state, send }) =>
        overlayRoot({
          open: state.at('open'),
          x: state.at('x'),
          y: state.at('y'),
          zIndex: OVERLAY_Z.floatingToolbar,
          transform: 'transform:translate(-50%,-115%)',
          attrs: { 'data-scope': 'md-floating', 'data-part': 'bar' },
          children: () => [
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
                  [span({ 'data-part': 'glyph', 'aria-hidden': 'true' }, [renderGlyph(item)])],
                ),
              ],
            }),
          ],
        }),
    }),
  }
}

/** Render an item's glyph (SVG markup → unsafeHtml, otherwise text). */
function renderGlyph(item: Signal<BarItem>): import('@llui/dom').Mountable {
  // The glyph value is stable per row; reading once is fine.
  const glyph = item.peek().glyph
  return glyph.trimStart().startsWith('<svg') ? unsafeHtml(glyph) : text(item.map((it) => it.glyph))
}
