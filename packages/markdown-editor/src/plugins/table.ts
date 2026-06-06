// Table plugin — GFM tables backed by @lexical/table nodes, with a hand-written
// multiline transformer that imports `| a | b |` syntax to a TableNode and
// exports it back. Cells are ordinary editable paragraphs.
//
// Place `tablePlugin()` before `corePlugin()` so its multiline transformer is
// tried ahead of the generic code-block one.

import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
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
import type { MultilineElementTransformer } from '@lexical/markdown'
import { button, text } from '@llui/dom'
import { definePluginUI } from './ui.js'
import { OVERLAY_Z, hideOverlay, onViewportChange, overlayRoot } from './overlay.js'
import type { MarkdownPlugin } from './types.js'

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
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim().replace(/\\\|/g, '|'))
}

function isSeparator(line: string | undefined): boolean {
  return !!line && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
}

function isRow(line: string | undefined): boolean {
  return !!line && /^\s*\|.*\|\s*$/.test(line.trim())
}

function makeCell(textValue: string, header: boolean): TableCellNode {
  const cell = $createTableCellNode(
    header ? TableCellHeaderStates.COLUMN : TableCellHeaderStates.NO_STATUS,
  )
  cell.append($createParagraphNode().append($createTextNode(textValue)))
  return cell
}

function buildTable(header: string[], body: string[][]): TableNode {
  const table = $createTableNode()
  const headerRow = $createTableRowNode()
  for (const h of header) headerRow.append(makeCell(h, true))
  table.append(headerRow)
  for (const row of body) {
    const tr = $createTableRowNode()
    for (let i = 0; i < header.length; i++) tr.append(makeCell(row[i] ?? '', false))
    table.append(tr)
  }
  return table
}

const TABLE_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node: LexicalNode): string | null => {
    if (!$isTableNode(node)) return null
    const rows = node.getChildren() as TableRowNode[]
    if (rows.length === 0) return null
    const lines: string[] = []
    rows.forEach((row, ri) => {
      const cells = row.getChildren() as TableCellNode[]
      const texts = cells.map((c) => c.getTextContent().replace(/\|/g, '\\|').replace(/\n/g, ' '))
      lines.push('| ' + texts.join(' | ') + ' |')
      if (ri === 0) lines.push('| ' + texts.map(() => '---').join(' | ') + ' |')
    })
    return lines.join('\n')
  },
  regExpStart: /^\s*\|(.+)\|\s*$/,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    if (!isSeparator(lines[startLineIndex + 1])) return null // header must be followed by a separator
    let end = startLineIndex + 2
    const body: string[][] = []
    while (end < lines.length && isRow(lines[end]) && !isSeparator(lines[end])) {
      body.push(splitRow(lines[end]!))
      end++
    }
    rootNode.append(buildTable(splitRow(lines[startLineIndex]!), body))
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
              ),
            ),
          ),
        surfaces: ['toolbar', 'slash', 'context'],
      },
    ],
  }
}
