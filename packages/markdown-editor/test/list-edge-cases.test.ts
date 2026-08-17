// The list behaviours nothing else pins: the guards in the export half, the
// `1)` delimiter with no blank line, and nested marker normalization.
//
// Each of these was a surviving mutation or an undocumented behaviour when the
// #129 work was reviewed, so they are stated as tests rather than as prose that
// nothing checks.

import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $getRoot, type LexicalEditor } from 'lexical'
import { $isListItemNode, $isListNode } from '@lexical/list'
import { corePlugin } from '../src/plugins/core.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'

const transformers = buildTransformers([corePlugin()])

function editor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: 'list-edge-cases',
    nodes: [...GFM_NODES],
    onError: (e) => {
      throw e
    },
  })
}

/** Each root child as `listType(item|item)`, or `type(text)` for a non-list. */
function blocks(markdown: string): string[] {
  const ed = editor()
  ed.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return ed.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) =>
        $isListNode(node)
          ? `${node.getListType()}(${node
              .getChildren()
              .flatMap((item) => ($isListItemNode(item) ? [item.getTextContent()] : []))
              .join('|')})`
          : `${node.getType()}(${node.getTextContent()})`,
      ),
  )
}

function roundtrip(markdown: string): string {
  const ed = editor()
  ed.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return ed.getEditorState().read(() => $convertToMarkdownString(transformers))
}

describe('the `1)` ordered delimiter needs no blank line', () => {
  // `$convertFromMarkdownString`'s `shouldMergeAdjacentLines` defaults to
  // `false` (`@lexical/markdown/src/index.ts:67`) and none of this package's
  // four call sites overrides it, so there is no line-merging pre-pass to work
  // around. Stock swallows `1) b` as paragraph text, so the fork is strictly
  // better here — and `Closes #129` covers the delimiter criterion outright.
  it('imports `1. a` / `1) b` as two ordered lists with no blank line', () => {
    expect(blocks('1. a\n1) b')).toEqual(['number(a)', 'number(b)'])
  })

  it('splits again when the delimiter changes back', () => {
    expect(blocks('1. a\n1) b\n1. c')).toEqual(['number(a)', 'number(b)', 'number(c)'])
  })

  it('splits in the other order too', () => {
    expect(blocks('1) a\n1. b')).toEqual(['number(a)', 'number(b)'])
  })

  it('keeps a run of one delimiter as one list', () => {
    expect(blocks('1. a\n2. b\n3. c')).toEqual(['number(a|b|c)'])
  })
})

describe('$listExport escapes a leading ordinal in a bullet item', () => {
  // A bullet item whose text opens with `1. ` or `1) ` would read back as an
  // ordered list, so the delimiter is escaped. The `)` half is only correct
  // because this package added `)` as a delimiter it understands.
  it('escapes a `.` ordinal so the item stays a bullet on re-import', () => {
    expect(roundtrip('- 1\\. not ordered')).toBe('- 1\\. not ordered')
    expect(blocks(roundtrip('- 1\\. not ordered'))).toEqual(['bullet(1. not ordered)'])
  })

  it('escapes a `)` ordinal too', () => {
    expect(roundtrip('- 1\\) not ordered')).toBe('- 1\\) not ordered')
    expect(blocks(roundtrip('- 1\\) not ordered'))).toEqual(['bullet(1) not ordered)'])
  })

  it('does not escape an ordinal inside an ordered item', () => {
    // The escape is bullet/check-only: an ordered item already carries its own
    // prefix, so escaping there would corrupt the text.
    expect(roundtrip('1. 2. inner')).toBe('1. 2. inner')
  })

  it('escapes in a check item as well', () => {
    expect(roundtrip('- [ ] 1\\. not ordered')).toBe('- [ ] 1\\. not ordered')
  })
})

describe('nested marker normalization', () => {
  it('loses a NESTED marker on export — the round-trip guarantee is top-level only', () => {
    // An indented item never records a marker (see the module header), and
    // `$listExport` reads the marker of the list it renders, so the nested `*`
    // comes back as the outer list's `-`.
    expect(roundtrip('- a\n    * b')).toBe('- a\n    - b')
  })

  it('round-trips a TOP-LEVEL marker, which is what is guaranteed', () => {
    expect(roundtrip('* a\n* b')).toBe('* a\n* b')
    expect(roundtrip('+ a')).toBe('+ a')
  })
})
