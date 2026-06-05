import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $setSelection,
  $getSelection,
  $isRangeSelection,
} from 'lexical'
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $readBaseFormat } from '../src/selection.js'

function editor() {
  return createHeadlessEditor({
    namespace: 'test',
    nodes: [HeadingNode, QuoteNode],
    onError: (e) => {
      throw e
    },
  })
}

describe('$readBaseFormat', () => {
  it('reports no selection when there is none', () => {
    const ed = editor()
    ed.update(
      () => {
        const p = $createParagraphNode().append($createTextNode('hello'))
        $getRoot().clear().append(p)
        $setSelection(null)
      },
      { discrete: true },
    )
    const fmt = ed.getEditorState().read(() => $readBaseFormat())
    expect(fmt.hasSelection).toBe(false)
    expect(fmt.blockType).toBe('paragraph')
  })

  it('detects a paragraph block and collapsed selection', () => {
    const ed = editor()
    ed.update(
      () => {
        const text = $createTextNode('hello')
        const p = $createParagraphNode().append(text)
        $getRoot().clear().append(p)
        text.select(5, 5)
      },
      { discrete: true },
    )
    const fmt = ed.getEditorState().read(() => $readBaseFormat())
    expect(fmt.hasSelection).toBe(true)
    expect(fmt.isCollapsed).toBe(true)
    expect(fmt.blockType).toBe('paragraph')
    expect(fmt.bold).toBe(false)
  })

  it('detects heading level from the block', () => {
    const ed = editor()
    ed.update(
      () => {
        const text = $createTextNode('Title')
        const h = $createHeadingNode('h2').append(text)
        $getRoot().clear().append(h)
        text.select(0, 5)
      },
      { discrete: true },
    )
    const fmt = ed.getEditorState().read(() => $readBaseFormat())
    expect(fmt.blockType).toBe('h2')
    expect(fmt.isCollapsed).toBe(false)
  })

  it('detects a quote block', () => {
    const ed = editor()
    ed.update(
      () => {
        const text = $createTextNode('quoted')
        const q = $createQuoteNode().append(text)
        $getRoot().clear().append(q)
        text.select(0, 0)
      },
      { discrete: true },
    )
    const fmt = ed.getEditorState().read(() => $readBaseFormat())
    expect(fmt.blockType).toBe('quote')
  })

  it('reflects bold text format on the selection', () => {
    const ed = editor()
    ed.update(
      () => {
        const text = $createTextNode('bold')
        const p = $createParagraphNode().append(text)
        $getRoot().clear().append(p)
        text.select(0, 4)
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.formatText('bold')
      },
      { discrete: true },
    )
    const fmt = ed.getEditorState().read(() => $readBaseFormat())
    expect(fmt.bold).toBe(true)
    expect(fmt.italic).toBe(false)
  })
})
