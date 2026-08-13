// List import correctness against CommonMark/GFM — the cases upstream
// `@lexical/markdown` gets wrong and this package therefore owns.
//
//  - #100: `- [X]` (uppercase) imported as UNCHECKED. The pattern is matched
//    case-insensitively but the state is derived with `match[3] === 'x'`, so the
//    marker was consumed and the tick silently dropped. Nothing reported it: a
//    document opened and re-saved came back with the user's box cleared.
//
//  - #129: a bullet-marker change did not start a new list, so two adjacent
//    lists merged on import and the second marker was lost on export.
//    CommonMark 0.31 §5.3: "Changing the bullet or ordered list delimiter starts
//    a new list." A blank line between items of the SAME marker only makes the
//    list loose — it does not split it — so the marker change is the only way
//    CommonMark can express two adjacent lists at all.

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

describe('issue #129: a marker change starts a new list', () => {
  const bullets = (...texts: string[]): Block => ({
    kind: 'list',
    listType: 'bullet',
    items: texts.map((text) => ({ checked: undefined, text })),
  })

  it('imports `- a` / `* b` as TWO lists', () => {
    expect(blocks('- a\n\n* b')).toEqual([bullets('a'), bullets('b')])
  })

  it('imports `- a` / `* b` as two lists without a blank line between them', () => {
    expect(blocks('- a\n* b')).toEqual([bullets('a'), bullets('b')])
  })

  it('splits at every marker change across a run of three', () => {
    expect(blocks('- a\n\n* b\n\n+ c')).toEqual([bullets('a'), bullets('b'), bullets('c')])
  })

  it('imports `- [ ] a` / `* [ ] b` as two task lists', () => {
    expect(blocks('- [ ] a\n\n* [ ] b')).toEqual([
      { kind: 'list', listType: 'check', items: [{ checked: false, text: 'a' }] },
      { kind: 'list', listType: 'check', items: [{ checked: false, text: 'b' }] },
    ])
  })

  it('imports `1. a` / `1) b` as two ordered lists (the delimiter is the same rule)', () => {
    expect(blocks('1. a\n\n1) b')).toEqual([
      { kind: 'list', listType: 'number', items: [{ checked: undefined, text: 'a' }] },
      { kind: 'list', listType: 'number', items: [{ checked: undefined, text: 'b' }] },
    ])
  })

  // Looseness must NOT become a split: a blank line between items of the same
  // marker is a loose list, still one list.
  it('keeps a consistent marker as ONE list, blank lines included', () => {
    expect(blocks('- a\n- b\n- c')).toEqual([bullets('a', 'b', 'c')])
    expect(blocks('- a\n\n- b\n\n- c')).toEqual([bullets('a', 'b', 'c')])
    expect(blocks('* a\n\n* b')).toEqual([bullets('a', 'b')])
    expect(blocks('1. a\n\n2. b')).toEqual([
      {
        kind: 'list',
        listType: 'number',
        items: [
          { checked: undefined, text: 'a' },
          { checked: undefined, text: 'b' },
        ],
      },
    ])
  })

  it('exports adjacent sibling lists as markdown that reads back as two lists', () => {
    expect(roundtrip('- a\n\n* b')).toBe('- a\n\n* b')
    expect(roundtrip('- [ ] a\n\n* [ ] b')).toBe('- [ ] a\n\n* [ ] b')
    expect(roundtrip('1. a\n\n1) b')).toBe('1. a\n\n1) b')
    // …and that output re-imports as two lists, which is the whole point.
    expect(blocks(roundtrip('- a\n\n* b'))).toEqual([bullets('a'), bullets('b')])
  })

  it('round-trips the authored bullet character', () => {
    expect(roundtrip('* a\n* b')).toBe('* a\n* b')
    expect(roundtrip('+ a\n+ b')).toBe('+ a\n+ b')
    expect(roundtrip('- a\n- b')).toBe('- a\n- b')
  })

  it('round-trips the authored ordered delimiter', () => {
    expect(roundtrip('1) a\n2) b')).toBe('1) a\n2) b')
    expect(roundtrip('1. a\n2. b')).toBe('1. a\n2. b')
  })

  it('does not split the outer list when an INDENTED item changes marker', () => {
    // Lexical's importer models nesting as an item INDENT rather than a real
    // subtree, so "the marker of a list" can only mean its top-level marker. An
    // indented item therefore neither records nor tests one — otherwise a
    // nested marker change would tear the outer list in two.
    expect(blocks('- a\n    * b\n- c')).toHaveLength(1)
    expect(blocks('- a\n    - b\n- c')).toHaveLength(1)
  })
})
