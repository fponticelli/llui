import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isRangeSelection,
  $getSelection,
} from 'lexical'
import { corePlugin } from '../src/plugins/core.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { $insertMarkdownAtSelection } from '../src/paste.js'

const transformers = buildTransformers([corePlugin()])

function newEditor() {
  return createHeadlessEditor({
    namespace: 'paste',
    nodes: [...GFM_NODES],
    onError: (e: Error) => {
      throw e
    },
  })
}

/** Seed an empty doc with a single paragraph, place the caret in it, paste
 * `markdown` as rich nodes, and read back the serialized markdown. */
function pasteInto(seed: string, markdown: string): string {
  const editor = newEditor()
  editor.update(
    () => {
      $convertFromMarkdownString(seed, transformers)
      $getRoot().selectEnd()
    },
    { discrete: true },
  )
  editor.update(() => $insertMarkdownAtSelection(markdown, transformers), { discrete: true })
  let out = ''
  editor.getEditorState().read(() => {
    out = $convertToMarkdownString(transformers)
  })
  return out
}

describe('$insertMarkdownAtSelection — convert markdown on paste', () => {
  it('converts a heading pasted into an empty document', () => {
    expect(pasteInto('', '# Hello')).toBe('# Hello')
  })

  it('converts inline formatting (bold/italic/code/link)', () => {
    const md = 'Some **bold**, *italic*, `code`, and a [link](https://example.com)'
    expect(pasteInto('', md)).toBe(md)
  })

  it('converts a multi-block markdown paste into separate blocks', () => {
    const doc = ['# Title', '', 'A paragraph.', '', '- a', '- b'].join('\n')
    expect(pasteInto('', doc)).toBe(doc)
  })

  it('inserts at the caret rather than clobbering existing content', () => {
    // Caret sits at the end of the second paragraph; the existing blocks must
    // survive and the pasted text must appear (the first pasted block merges
    // into the current line, per Lexical insertNodes — that is correct paste UX).
    const out = pasteInto('First para\n\nSecond para', 'Pasted **rich** text')
    expect(out).toContain('First para')
    expect(out).toContain('Pasted **rich** text')
  })

  it('converts a task list paste into real check-list items', () => {
    const out = pasteInto('', '- [x] done\n- [ ] todo')
    expect(out).toBe('- [x] done\n- [ ] todo')
  })

  it('is a no-op without a range selection', () => {
    const editor = newEditor()
    editor.update(
      () => {
        const p = $createParagraphNode().append($createTextNode('seed'))
        $getRoot().append(p)
      },
      { discrete: true },
    )
    let handled: boolean | undefined
    editor.update(
      () => {
        // No selection set in this update → not a range selection.
        if ($isRangeSelection($getSelection())) return
        handled = $insertMarkdownAtSelection('# nope', transformers)
      },
      { discrete: true },
    )
    expect(handled).toBe(false)
    const out = editor.getEditorState().read(() => $convertToMarkdownString(transformers))
    expect(out).toBe('seed')
  })
})
