// Table plugin — GFM tables backed by @lexical/table nodes, with a hand-written
// multiline transformer that imports `| a | b |` syntax to a TableNode and
// exports it back. Cells are ordinary editable paragraphs.
//
// Place `tablePlugin()` before `corePlugin()` so its multiline transformer is
// tried ahead of the generic code-block one.

import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  type ElementFormatType,
  type ElementNode,
  type LexicalNode,
} from 'lexical'
import { $insertNodeToNearestRoot, mergeRegister } from '@lexical/utils'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableNode,
  $isTableSelection,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table'
import {
  $convertFromMarkdownString,
  LINK,
  type MultilineElementTransformer,
  type Transformer,
} from '@lexical/markdown'
import { button, text } from '@llui/dom'
import { definePluginUI } from './ui.js'
import { OVERLAY_Z, hideOverlay, onViewportChange, overlayRoot } from './overlay.js'
import { INLINE_TEXT_TRANSFORMERS } from '../transformers/gfm.js'
import type { MarkdownPlugin } from './types.js'

/** Transformers used to parse/serialize a single table cell's INLINE content
 * (bold/italic/strikethrough/inline-code and links). No block/element or
 * multiline transformers, so a cell's markdown is always a single inline run —
 * this is what makes bold/link cells survive an export∘import round-trip instead
 * of being flattened to bare text. `LINK` needs `LinkNode`, which the core plugin
 * registers (tables are used alongside it). */
const CELL_TRANSFORMERS: readonly Transformer[] = [...INLINE_TEXT_TRANSFORMERS, LINK]

interface TableToolsState {
  open: boolean
  x: number
  y: number
}

type TableToolsMsg =
  | { type: 'show'; x: number; y: number }
  | { type: 'hide' }
  | { type: 'op'; id: string }
type TableToolsEffect = { type: 'run'; id: string }

const TABLE_TOOLS: ReadonlyArray<{ id: string; label: string; title: string }> = [
  { id: 'rowAbove', label: '↑＋', title: 'Insert row above' },
  { id: 'rowBelow', label: '↓＋', title: 'Insert row below' },
  { id: 'colLeft', label: '←＋', title: 'Insert column left' },
  { id: 'colRight', label: '→＋', title: 'Insert column right' },
  { id: 'delRow', label: '✕R', title: 'Delete row' },
  { id: 'delCol', label: '✕C', title: 'Delete column' },
  { id: 'delTable', label: '🗑', title: 'Delete table' },
]

/** Run a table editing operation against the current cell selection. */
function $runTableOp(id: string): void {
  switch (id) {
    case 'rowAbove':
      $insertTableRowAtSelection(false)
      return
    case 'rowBelow':
      $insertTableRowAtSelection(true)
      return
    case 'colLeft':
      $insertTableColumnAtSelection(false)
      return
    case 'colRight':
      $insertTableColumnAtSelection(true)
      return
    case 'delRow':
      $deleteTableRowAtSelection()
      return
    case 'delCol':
      $deleteTableColumnAtSelection()
      return
    case 'delTable': {
      const selection = $getSelection()
      // A focused cell is a RangeSelection; a multi-cell drag is a TableSelection.
      // Both carry an anchor pointing into a cell — accept either.
      if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return
      const cell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
      if (cell) $getTableNodeFromLexicalNodeOrThrow(cell).remove()
      return
    }
  }
}

function splitRow(line: string): string[] {
  // Strip the OUTER table pipes (always unescaped delimiters), then split on
  // unescaped `|` only — an escaped `\|` is literal cell content and must NOT
  // split the cell (export writes `\|` for a pipe in a cell; see TABLE_TRANSFORMER
  // export). Finally unescape `\|` → `|` so the round-trip is lossless.
  const inner = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function isSeparator(line: string | undefined): boolean {
  return !!line && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
}

/** Is `line` a GFM table row? GFM makes the leading and trailing pipes OPTIONAL
 * (`a | b` is as valid as `| a | b |`); the only requirement is at least one
 * unescaped cell delimiter. The old `\|.*\|` test rejected valid pipe-less-edge
 * rows, truncating imported tables. */
function isRow(line: string | undefined): boolean {
  if (line === undefined) return false
  const trimmed = line.trim()
  return trimmed !== '' && /(?<!\\)\|/.test(trimmed)
}

/** Map a GFM separator cell (`:---`, `:---:`, `---:`, `---`) to a cell alignment. */
function parseAlignment(separatorCell: string): ElementFormatType {
  const t = separatorCell.trim()
  const left = t.startsWith(':')
  const right = t.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return ''
}

/** Map a cell's alignment back to its GFM separator token. */
function alignmentSeparator(format: ElementFormatType): string {
  switch (format) {
    case 'center':
      return ':---:'
    case 'right':
    case 'end':
      return '---:'
    case 'left':
    case 'start':
      return ':---'
    default:
      return '---'
  }
}

/** Build a cell from its inline markdown, parsing bold/italic/link/etc. through
 * {@link CELL_TRANSFORMERS} (not a bare text node) and applying its column's
 * alignment. */
function makeCell(cellMarkdown: string, header: boolean, align: ElementFormatType): TableCellNode {
  const cell = $createTableCellNode(
    header ? TableCellHeaderStates.COLUMN : TableCellHeaderStates.NO_STATUS,
  )
  // Parse the cell's inline markdown into a paragraph of formatted text nodes.
  $convertFromMarkdownString(cellMarkdown, [...CELL_TRANSFORMERS], cell)
  // A blank cell yields no paragraph — keep the cell a well-formed single-paragraph.
  if (cell.getChildrenSize() === 0) cell.append($createParagraphNode())
  if (align !== '') cell.setFormat(align)
  return cell
}

function buildTable(
  header: string[],
  body: string[][],
  aligns: readonly ElementFormatType[],
): TableNode {
  const table = $createTableNode()
  const headerRow = $createTableRowNode()
  header.forEach((h, i) => headerRow.append(makeCell(h, true, aligns[i] ?? '')))
  table.append(headerRow)
  for (const row of body) {
    const tr = $createTableRowNode()
    for (let i = 0; i < header.length; i++)
      tr.append(makeCell(row[i] ?? '', false, aligns[i] ?? ''))
    table.append(tr)
  }
  return table
}

const TABLE_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node: LexicalNode, traverseChildren: (node: ElementNode) => string): string | null => {
    if (!$isTableNode(node)) return null
    const rows = node.getChildren() as TableRowNode[]
    if (rows.length === 0) return null
    const lines: string[] = []
    rows.forEach((row, ri) => {
      const cells = row.getChildren() as TableCellNode[]
      // Serialize each cell's INLINE content through the full transformer set
      // (so bold/italic/links survive), then escape `|` and flatten newlines so
      // the cell can't break the row.
      const texts = cells.map((c) =>
        traverseChildren(c).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim(),
      )
      lines.push('| ' + texts.join(' | ') + ' |')
      if (ri === 0) {
        // Reconstruct the alignment row from the header cells' alignments.
        const seps = cells.map((c) => alignmentSeparator(c.getFormatType()))
        lines.push('| ' + seps.join(' | ') + ' |')
      }
    })
    return lines.join('\n')
  },
  // Leading/trailing pipes are optional in GFM; require only one internal pipe.
  // A false positive is harmless — the header is only accepted when the NEXT line
  // is a delimiter row (checked below).
  regExpStart: /^\s*\|?.*(?<!\\)\|.*\|?\s*$/,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    if (!isSeparator(lines[startLineIndex + 1])) return null // header must be followed by a separator
    const aligns = splitRow(lines[startLineIndex + 1]!).map(parseAlignment)
    let end = startLineIndex + 2
    const body: string[][] = []
    while (end < lines.length && isRow(lines[end]) && !isSeparator(lines[end])) {
      body.push(splitRow(lines[end]!))
      end++
    }
    rootNode.append(buildTable(splitRow(lines[startLineIndex]!), body, aligns))
    return [true, end - 1]
  },
  // Import is handled manually above; a multiline transformer still needs replace.
  replace: () => false,
  type: 'multiline-element',
}

export function tablePlugin(): MarkdownPlugin {
  return {
    name: 'table',
    nodes: [TableNode, TableRowNode, TableCellNode],
    transformers: [TABLE_TRANSFORMER],
    // A contextual toolbar appears above the table whenever the selection is in a
    // cell. It tracks the table's viewport rect, so it repositions on scroll/resize
    // (not just on editor updates) and only re-emits when the rect actually moves.
    register: (editor, ctx) => {
      let lastKey: string | null = null
      let lastX = NaN
      let lastY = NaN
      const refresh = (): void => {
        const tableKey = editor.getEditorState().read(() => {
          const selection = $getSelection()
          // RangeSelection = caret in a cell; TableSelection = multi-cell drag.
          if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return null
          const cell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
          return cell ? $getTableNodeFromLexicalNodeOrThrow(cell).getKey() : null
        })
        const el = tableKey ? editor.getElementByKey(tableKey) : null
        if (!el) {
          if (lastKey !== null) {
            lastKey = null
            lastX = NaN
            lastY = NaN
            ctx.emit({ type: 'plugin', name: 'table', msg: { type: 'hide' } })
          }
          return
        }
        const rect = el.getBoundingClientRect()
        // Typing inside a cell never moves the table's top-left; skip the redundant
        // emit so the overlay isn't reconciled on every keystroke.
        if (tableKey === lastKey && rect.left === lastX && rect.top === lastY) return
        lastKey = tableKey
        lastX = rect.left
        lastY = rect.top
        ctx.emit({
          type: 'plugin',
          name: 'table',
          msg: { type: 'show', x: rect.left, y: rect.top },
        })
      }
      return mergeRegister(
        editor.registerUpdateListener(() => refresh()),
        onViewportChange(refresh),
      )
    },
    ui: definePluginUI<TableToolsState, TableToolsMsg, TableToolsEffect>({
      init: () => ({ open: false, x: 0, y: 0 }),
      update: (state, msg) => {
        switch (msg.type) {
          case 'show':
            return state.open && state.x === msg.x && state.y === msg.y
              ? state
              : { open: true, x: msg.x, y: msg.y }
          case 'hide':
            return hideOverlay(state)
          case 'op':
            return [state, [{ type: 'run', id: msg.id }]]
        }
      },
      onEffect: (effect, ctx) => {
        const editor = ctx.editor()
        if (editor) editor.update(() => $runTableOp(effect.id))
      },
      view: ({ state, send }) =>
        overlayRoot({
          open: state.at('open'),
          x: state.at('x'),
          y: state.at('y'),
          zIndex: OVERLAY_Z.tableTools,
          // Lift the bar above the table's top edge.
          transform: 'transform:translateY(-118%)',
          attrs: { 'data-scope': 'md-table-tools', 'data-part': 'bar' },
          children: () =>
            TABLE_TOOLS.map((tool) =>
              button(
                {
                  type: 'button',
                  'data-scope': 'md-table-tools',
                  'data-part': 'tool',
                  title: tool.title,
                  'aria-label': tool.title,
                  onMouseDown: (e: MouseEvent) => {
                    e.preventDefault()
                    send({ type: 'op', id: tool.id })
                  },
                },
                [text(tool.label)],
              ),
            ),
        }),
    }),
    items: [
      {
        id: 'table',
        label: 'Table',
        icon: 'table',
        group: 'insert',
        keywords: ['grid', 'rows', 'columns'],
        run: (editor) =>
          editor.update(() =>
            $insertNodeToNearestRoot(
              buildTable(
                ['Column 1', 'Column 2'],
                [
                  ['', ''],
                  ['', ''],
                ],
                ['', ''],
              ),
            ),
          ),
        surfaces: ['toolbar', 'slash', 'context'],
      },
    ],
  }
}
