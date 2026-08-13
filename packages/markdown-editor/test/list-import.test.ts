// List import correctness against CommonMark/GFM — the cases upstream
// `@lexical/markdown` gets wrong and this package therefore owns.
//
//  - #100: `- [X]` (uppercase) imported as UNCHECKED. The pattern is matched
//    case-insensitively but the state is derived with `match[3] === 'x'`, so the
//    marker was consumed and the tick silently dropped. Nothing reported it: a
//    document opened and re-saved came back with the user's box cleared.

import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $getRoot, type LexicalNode } from 'lexical'
import { $isListNode, $isListItemNode } from '@lexical/list'
import { corePlugin } from '../src/plugins/core.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'

const transformers = buildTransformers([corePlugin()])

/** One block of the document, flattened to the facts these tests assert. */
interface Block {
  kind: string
  listType?: string
  items?: Array<{ checked: boolean | undefined; text: string }>
}

function editor(): ReturnType<typeof createHeadlessEditor> {
  return createHeadlessEditor({
    namespace: 'list-import',
    nodes: [...GFM_NODES],
    onError: (e) => {
      throw e
    },
  })
}

/** Import `markdown` and describe the resulting blocks. */
function blocks(markdown: string): Block[] {
  const ed = editor()
  ed.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return ed.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node: LexicalNode): Block => {
        if (!$isListNode(node)) return { kind: node.getType() }
        return {
          kind: 'list',
          listType: node.getListType(),
          items: node
            .getChildren()
            .flatMap((item) =>
              $isListItemNode(item)
                ? [{ checked: item.getChecked(), text: item.getTextContent() }]
                : [],
            ),
        }
      }),
  )
}

/** Import then export — what a document opened and re-saved comes back as. */
function roundtrip(markdown: string): string {
  const ed = editor()
  ed.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return ed.getEditorState().read(() => $convertToMarkdownString(transformers))
}

const checkList = (items: Array<[boolean, string]>): Block[] => [
  {
    kind: 'list',
    listType: 'check',
    items: items.map(([checked, text]) => ({ checked, text })),
  },
]

describe('issue #100: an uppercase task marker keeps its checked state', () => {
  it('imports `- [X] done` as CHECKED', () => {
    expect(blocks('- [X] done')).toEqual(checkList([[true, 'done']]))
  })

  it('still imports `- [x] done` as checked', () => {
    expect(blocks('- [x] done')).toEqual(checkList([[true, 'done']]))
  })

  it('still imports `- [ ] todo` as unchecked', () => {
    expect(blocks('- [ ] todo')).toEqual(checkList([[false, 'todo']]))
  })

  it('imports `* [X] star` as checked', () => {
    expect(blocks('* [X] star')).toEqual(checkList([[true, 'star']]))
  })

  it('imports `+ [X] plus` as checked', () => {
    expect(blocks('+ [X] plus')).toEqual(checkList([[true, 'plus']]))
  })

  it('imports a bare `[X] done` (no bullet) as checked', () => {
    expect(blocks('[X] done')).toEqual(checkList([[true, 'done']]))
  })

  it('imports a mixed-case run item by item', () => {
    expect(blocks('- [X] a\n- [x] b\n- [ ] c')).toEqual(
      checkList([
        [true, 'a'],
        [true, 'b'],
        [false, 'c'],
      ]),
    )
  })

  it('normalises the export to lowercase `[x]`, and that round-trips', () => {
    expect(roundtrip('- [X] done')).toBe('- [x] done')
    expect(roundtrip('- [x] done')).toBe('- [x] done')
    expect(roundtrip('- [ ] todo')).toBe('- [ ] todo')
  })

  it('keeps the authored bullet character while normalising the tick', () => {
    expect(roundtrip('* [X] star')).toBe('* [x] star')
  })
})
