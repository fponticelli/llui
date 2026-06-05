import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { corePlugin } from '../src/plugins/core.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'

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
