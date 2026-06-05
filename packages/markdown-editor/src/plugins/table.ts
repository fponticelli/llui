// Table plugin — GFM tables backed by @lexical/table nodes, with a hand-written
// multiline transformer that imports `| a | b |` syntax to a TableNode and
// exports it back. Cells are ordinary editable paragraphs.
//
// Place `tablePlugin()` before `corePlugin()` so its multiline transformer is
// tried ahead of the generic code-block one.

import { $createParagraphNode, $createTextNode, type LexicalNode } from 'lexical'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table'
import type { MultilineElementTransformer } from '@lexical/markdown'
import type { MarkdownPlugin } from './types.js'

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
