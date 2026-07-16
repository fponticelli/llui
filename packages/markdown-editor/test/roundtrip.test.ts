import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $getRoot, $isElementNode, COMMAND_PRIORITY_LOW, FORMAT_TEXT_COMMAND } from 'lexical'
import { $isListNode, $isListItemNode } from '@lexical/list'
import { corePlugin } from '../src/plugins/core.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { blockUnderlineFormat } from '../src/editor.js'

const transformers = buildTransformers([corePlugin()])

function roundtrip(markdown: string): string {
  const editor = createHeadlessEditor({
    namespace: 'rt',
    nodes: [...GFM_NODES],
    onError: (e) => {
      throw e
    },
  })
  let out = ''
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, transformers)
    },
    { discrete: true },
  )
  editor.getEditorState().read(() => {
    out = $convertToMarkdownString(transformers)
  })
  return out
}

describe('GFM markdown round-trip (in === out)', () => {
  const cases: Array<[string, string]> = [
    ['heading 1', '# Heading'],
    ['heading 3', '### Smaller'],
    ['bold', 'Some **bold** text'],
    ['italic', 'Some *italic* text'],
    ['strikethrough', 'Some ~~struck~~ text'],
    ['inline code', 'Call `fn()` now'],
    ['link', 'A [link](https://example.com) here'],
    ['blockquote', '> quoted line'],
    ['unordered list', '- one\n- two\n- three'],
    ['ordered list', '1. first\n2. second'],
    ['task list unchecked', '- [ ] todo'],
    ['task list checked', '- [x] done'],
    ['code block', '```\nconst a = 1\n```'],
    ['code block with language', '```ts\nconst a: number = 1\n```'],
  ]

  for (const [name, md] of cases) {
    it(name, () => {
      expect(roundtrip(md)).toBe(md)
    })
  }

  it('parses a task item as a real check-list item (not a bullet with literal [x])', () => {
    const editor = createHeadlessEditor({
      namespace: 'check',
      nodes: [...GFM_NODES],
      onError: (e) => {
        throw e
      },
    })
    editor.update(() => $convertFromMarkdownString('- [x] done\n- [ ] todo', transformers), {
      discrete: true,
    })
    const checks = editor.getEditorState().read(() => {
      const list = $getRoot().getFirstChild()
      if (!$isListNode(list)) return null
      return list
        .getChildren()
        .map((item) => ($isListItemNode(item) ? item.getChecked() : 'not-li'))
    })
    expect(checks).toEqual([true, false])
  })

  it('does not convert non-GFM ==highlight== syntax (kept as literal text)', () => {
    // HIGHLIGHT is excluded from the default set: `==..==` is not GFM, so it must
    // NOT be recognized as a mark — it stays literal and round-trips unchanged.
    const editor = createHeadlessEditor({
      namespace: 'no-highlight',
      nodes: [...GFM_NODES],
      onError: (e) => {
        throw e
      },
    })
    editor.update(() => $convertFromMarkdownString('a ==highlight== b', transformers), {
      discrete: true,
    })
    const hasMark = editor.getEditorState().read(() => {
      const para = $getRoot().getFirstChild()
      // A single unformatted text run means no highlight node was created.
      return !$isElementNode(para) || para.getChildrenSize() !== 1
    })
    expect(hasMark).toBe(false)
    expect(roundtrip('a ==highlight== b')).toBe('a ==highlight== b')
  })

  it('blocks the underline format so it can never be applied (unserializable in GFM)', () => {
    const editor = createHeadlessEditor({
      namespace: 'underline-block',
      nodes: [...GFM_NODES],
      onError: (e) => {
        throw e
      },
    })
    // A lower-priority observer stands in for the real FORMAT_TEXT applier
    // (registerRichText): it records which payloads reach it. The guard runs at
    // CRITICAL priority, ahead of it, so a swallowed format never gets here.
    const reached: string[] = []
    blockUnderlineFormat(editor)
    editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      (payload) => {
        reached.push(payload)
        return false
      },
      COMMAND_PRIORITY_LOW,
    )
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')
    // Underline was swallowed before reaching the applier; others pass through.
    expect(reached).toEqual(['bold', 'italic'])
  })

  it('preserves a multi-block document', () => {
    const doc = [
      '# Title',
      '',
      'A paragraph with **bold** and *italic*.',
      '',
      '- a',
      '- b',
      '',
      '> note',
    ].join('\n')
    expect(roundtrip(doc)).toBe(doc)
  })
})
