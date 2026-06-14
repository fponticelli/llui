import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isRangeSelection,
  $getSelection,
  PASTE_COMMAND,
} from 'lexical'
import { corePlugin } from '../src/plugins/core.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { $insertMarkdownAtSelection, registerMarkdownPaste } from '../src/paste.js'

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

/** Build a synthetic paste event. jsdom can't construct a real ClipboardEvent
 * with a populated clipboardData, so we hand the command a minimal stand-in. */
function fakePaste(opts: { plain?: string; html?: string }): {
  event: ClipboardEvent
  prevented: () => boolean
} {
  const types: string[] = []
  if (opts.html !== undefined) types.push('text/html')
  if (opts.plain !== undefined) types.push('text/plain')
  let prevented = false
  const event = {
    target: null,
    clipboardData: {
      types,
      getData: (format: string) =>
        format === 'text/plain'
          ? (opts.plain ?? '')
          : format === 'text/html'
            ? (opts.html ?? '')
            : '',
    },
    preventDefault: () => {
      prevented = true
    },
  }
  return { event: event as unknown as ClipboardEvent, prevented: () => prevented }
}

describe('registerMarkdownPaste — PASTE_COMMAND handler', () => {
  function seeded() {
    const editor = newEditor()
    const dispose = registerMarkdownPaste(editor, transformers)
    editor.update(
      () => {
        $convertFromMarkdownString('seed', transformers)
        $getRoot().selectEnd()
      },
      { discrete: true },
    )
    return { editor, dispose }
  }

  it('converts a plain-text paste, claims the event, and prevents default', () => {
    const { editor, dispose } = seeded()
    const { event, prevented } = fakePaste({ plain: 'a **bold** paste' })
    const handled = editor.dispatchCommand(PASTE_COMMAND, event)
    expect(handled).toBe(true)
    expect(prevented()).toBe(true)
    // The pasted markdown is converted (the **bold** survives as inline format)
    // and inserted at the caret after the existing "seed" text.
    expect(editor.read(() => $convertToMarkdownString(transformers))).toBe('seeda **bold** paste')
    dispose()
  })

  it('defers to Lexical (returns false, no preventDefault) when text/html is present', () => {
    const { editor, dispose } = seeded()
    const { event, prevented } = fakePaste({ plain: '# ignored', html: '<h1>rich</h1>' })
    const handled = editor.dispatchCommand(PASTE_COMMAND, event)
    expect(handled).toBe(false)
    expect(prevented()).toBe(false)
    expect(editor.read(() => $convertToMarkdownString(transformers))).toBe('seed')
    dispose()
  })

  it('defers (returns false) on an empty plain-text clipboard', () => {
    const { editor, dispose } = seeded()
    const { event, prevented } = fakePaste({ plain: '' })
    const handled = editor.dispatchCommand(PASTE_COMMAND, event)
    expect(handled).toBe(false)
    expect(prevented()).toBe(false)
    dispose()
  })
})
