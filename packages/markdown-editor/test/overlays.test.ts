import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp } from '@llui/dom'
import { $getRoot, $setSelection, type LexicalEditor } from 'lexical'
import {
  $createTableSelectionFrom,
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
} from '@lexical/table'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { linkPlugin } from '../src/plugins/link.js'
import { contextMenuPlugin } from '../src/plugins/context-menu.js'
import { floatingToolbarPlugin } from '../src/plugins/floating-toolbar.js'
import { tablePlugin } from '../src/plugins/table.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

let container: HTMLElement
let app: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

describe('context menu plugin', () => {
  it('opens at a point, lists items, and closes', async () => {
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), linkPlugin(), contextMenuPlugin()],
        defaultValue: 'x',
      }),
    )
    app.send({
      type: 'plugin',
      name: 'contextMenu',
      msg: {
        type: 'open',
        x: 30,
        y: 40,
        items: [
          { id: 'link', label: 'Link' },
          { id: 'undo', label: 'Undo' },
        ],
      },
    })
    await wait(0)
    const root = document.querySelector(
      '[data-scope="md-context"][data-part="root"]',
    ) as HTMLElement
    expect(root).not.toBeNull()
    expect(root.getAttribute('style')).toContain('left:30px')
    expect(document.querySelectorAll('[data-scope="md-context"][data-part="option"]').length).toBe(
      2,
    )

    app.send({ type: 'plugin', name: 'contextMenu', msg: { type: 'close' } })
    await wait(0)
    expect(document.querySelector('[data-scope="md-context"][data-part="root"]')).toBeNull()
  })
})

describe('floating toolbar plugin', () => {
  it('renders a bubble with active state and runs a command', async () => {
    app = mountApp(
      container,
      markdownEditor({ plugins: [corePlugin(), floatingToolbarPlugin()], defaultValue: 'hello' }),
    )
    app.send({
      type: 'plugin',
      name: 'floatingToolbar',
      msg: {
        type: 'show',
        x: 100,
        y: 50,
        items: [
          { id: 'bold', label: 'Bold', glyph: 'B', active: true },
          { id: 'italic', label: 'Italic', glyph: 'I', active: false },
        ],
      },
    })
    await wait(0)
    const items = [...document.querySelectorAll('[data-scope="md-floating"][data-part="item"]')]
    expect(items).toHaveLength(2)
    expect(items[0]?.hasAttribute('data-active')).toBe(true)
    expect(items[1]?.hasAttribute('data-active')).toBe(false)

    app.send({ type: 'plugin', name: 'floatingToolbar', msg: { type: 'hide' } })
    await wait(0)
    expect(document.querySelector('[data-scope="md-floating"][data-part="bar"]')).toBeNull()
  })
})

describe('table editing tools', () => {
  it('shows the toolbar in a cell and inserts a row at the selection', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        plugins: [tablePlugin(), corePlugin()],
        defaultValue: '| A | B |\n| --- | --- |\n| 1 | 2 |',
        onReady: (e) => {
          editor = e
        },
      }),
    )
    await wait(0)
    // Place the caret in the first body cell.
    editor.update(
      () => {
        const table = $getRoot().getChildren().find($isTableNode)
        if (!$isTableNode(table)) return
        const row = table.getChildren()[1]
        if (!$isTableRowNode(row)) return
        const cell = row.getChildren()[0]
        if ($isTableCellNode(cell)) cell.selectStart()
      },
      { discrete: true },
    )
    await wait(0)
    expect(document.querySelector('[data-scope="md-table-tools"][data-part="bar"]')).not.toBeNull()
    expect(
      document.querySelectorAll('[data-scope="md-table-tools"][data-part="tool"]').length,
    ).toBe(7)

    const rowsBefore = container.querySelectorAll('table tr').length
    app.send({ type: 'plugin', name: 'table', msg: { type: 'op', id: 'rowBelow' } })
    await wait(0)
    expect(container.querySelectorAll('table tr').length).toBe(rowsBefore + 1)
  })

  it('stays visible under a multi-cell TableSelection and can delete the table', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        plugins: [tablePlugin(), corePlugin()],
        defaultValue: '| A | B |\n| --- | --- |\n| 1 | 2 |',
        onReady: (e) => {
          editor = e
        },
      }),
    )
    await wait(0)
    // Drag-select from header cell A to body cell 2 — a TableSelection, not a
    // RangeSelection. A RangeSelection-only check would have hidden the toolbar.
    editor.update(
      () => {
        const table = $getRoot().getChildren().find($isTableNode)
        if (!$isTableNode(table)) return
        const header = table.getChildren()[0]
        const body = table.getChildren()[1]
        if (!$isTableRowNode(header) || !$isTableRowNode(body)) return
        const anchor = header.getChildren()[0]
        const focus = body.getChildren()[1]
        if ($isTableCellNode(anchor) && $isTableCellNode(focus)) {
          $setSelection($createTableSelectionFrom(table, anchor, focus))
        }
      },
      { discrete: true },
    )
    await wait(0)
    expect(document.querySelector('[data-scope="md-table-tools"][data-part="bar"]')).not.toBeNull()

    // Delete-table must work under a TableSelection (not silently no-op).
    expect(container.querySelectorAll('table').length).toBe(1)
    app.send({ type: 'plugin', name: 'table', msg: { type: 'op', id: 'delTable' } })
    await wait(0)
    expect(container.querySelectorAll('table').length).toBe(0)
  })
})
