// CommonMark list nesting on import (#226).
//
// Markdown is the canonical representation for consumers of this package, so
// assertions cover both the Lexical hierarchy produced at import and the
// Markdown produced after that hierarchy is exported again.

import { $isListItemNode, $isListNode } from '@lexical/list'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $getRoot, $isElementNode, type ElementNode } from 'lexical'
import { describe, expect, it } from 'vitest'
import { corePlugin } from '../src/plugins/core.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { buildTransformers } from '../src/transformers/registry.js'

const transformers = buildTransformers([corePlugin()])

function editor() {
  return createHeadlessEditor({
    namespace: 'list-nesting',
    nodes: [...GFM_NODES],
    onError: (error) => {
      throw error
    },
  })
}

/** The imported list items as `<depth>:<text>` lines. */
function outline(markdown: string): string[] {
  const ed = editor()
  return outlineIn(ed, markdown)
}

function outlineIn(ed: ReturnType<typeof editor>, markdown: string): string[] {
  ed.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return ed.getEditorState().read(() => {
    const lines: string[] = []
    collect($getRoot(), 0, lines)
    return lines
  })
}

function collect(node: ElementNode, depth: number, lines: string[]): void {
  for (const child of node.getChildren()) {
    if ($isListNode(child)) {
      collect(child, depth, lines)
      continue
    }
    if ($isListItemNode(child)) {
      const nested = child.getChildren().filter($isListNode)
      const own = child
        .getChildren()
        .filter((candidate) => !$isListNode(candidate))
        .map((candidate) => candidate.getTextContent())
        .join('')
      if (own.length > 0 || nested.length === 0) lines.push(`${String(depth)}:${own}`)
      for (const list of nested) collect(list, depth + 1, lines)
      continue
    }
    if ($isElementNode(child)) collect(child, depth, lines)
  }
}

function roundtrip(markdown: string): string {
  const ed = editor()
  ed.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return ed.getEditorState().read(() => $convertToMarkdownString(transformers))
}

const markers = [
  { marker: '- ', contentColumn: 2 },
  { marker: '* ', contentColumn: 2 },
  { marker: '+ ', contentColumn: 2 },
  { marker: '- [ ] ', contentColumn: 2 },
  { marker: '1. ', contentColumn: 3 },
  { marker: '10. ', contentColumn: 4 },
] as const

describe('a child list starts at its parent item content indentation', () => {
  it('preserves a two-space child under a bullet parent', () => {
    const markdown = '- alpha\n  - beta'
    expect(outline(markdown)).toEqual(['0:alpha', '1:beta'])
    expect(roundtrip(markdown)).toBe('- alpha\n    - beta')
  })

  it('includes all ordinary marker padding in the parent content indentation', () => {
    expect(outline('-  alpha\n  - beta')).toEqual(['0:alpha', '0:beta'])
    expect(outline('-  alpha\n   - beta')).toEqual(['0:alpha', '1:beta'])
  })

  it('does not promote a marker beyond the three-column child prefix to a list item', () => {
    const markdown = '- alpha\n\n      - code, not a child list'
    expect(outline(markdown)).toEqual(['0:alpha'])
    expect(roundtrip(markdown)).toBe(markdown)
  })

  it('uses the list marker rather than the task marker as a task parent boundary', () => {
    expect(outline('- [ ] task\n  - [x] child')).toEqual(['0:task', '1:child'])
    expect(outline('- [ ] task\n  - child')).toEqual(['0:task', '1:child'])
    expect(roundtrip('- [ ] task\n  - [x] child')).toBe('- [ ] task\n    - [x] child')
  })

  it('keeps indentation beyond four columns as item content', () => {
    const markdown = '-     alpha\n  - beta'
    expect(outline(markdown)).toEqual(['0:    alpha', '1:beta'])
    expect(roundtrip(markdown)).toBe('-     alpha\n    - beta')
  })

  it('uses one padding column when a list item starts blank', () => {
    expect(outline('-    \n  - child')).toEqual(['0:', '1:child'])
    expect(outline('1.    \n   - child')).toEqual(['0:', '1:child'])
  })

  it('does not reinterpret an indented-code task marker as a checklist', () => {
    const markdown = '-     [ ] code'
    expect(outline(markdown)).toEqual(['0:    [ ] code'])
    expect(roundtrip(markdown)).toBe(markdown)
  })

  it.each([
    ['two spaces', '  '],
    ['three spaces', '   '],
    ['four spaces', '    '],
    ['a tab', '\t'],
  ])('reads %s under a one-space bullet marker as one nested level', (_name, indent) => {
    expect(outline(`- alpha\n${indent}- beta`)).toEqual(['0:alpha', '1:beta'])
  })

  it('uses each ordered marker width at and before its boundary', () => {
    expect(outline('1. alpha\n   1. beta')).toEqual(['0:alpha', '1:beta'])
    expect(outline('1. alpha\n  1. beta')).toEqual(['0:alpha', '0:beta'])
    expect(outline('10. alpha\n    1. beta')).toEqual(['0:alpha', '1:beta'])
    expect(outline('10. alpha\n   1. beta')).toEqual(['0:alpha', '0:beta'])
  })

  it('preserves mixed list types across three levels and an outdent', () => {
    const markdown = '- alpha\n  1. one\n     - deep\n  2. two\n- omega'
    expect(outline(markdown)).toEqual(['0:alpha', '1:one', '2:deep', '1:two', '0:omega'])
    const exported = roundtrip(markdown)
    expect(outline(exported)).toEqual(['0:alpha', '1:one', '2:deep', '1:two', '0:omega'])
  })
})

describe('every supported marker pairing uses the parent boundary', () => {
  for (const parent of markers) {
    for (const child of markers) {
      const pairing = `${JSON.stringify(parent.marker)} then ${JSON.stringify(child.marker)}`

      it(`${pairing} nests at the boundary`, () => {
        const markdown = `${parent.marker}alpha\n${' '.repeat(parent.contentColumn)}${child.marker}beta`
        expect(outline(markdown)).toEqual(['0:alpha', '1:beta'])
      })

      it(`${pairing} remains flat one column before the boundary`, () => {
        const markdown = `${parent.marker}alpha\n${' '.repeat(parent.contentColumn - 1)}${child.marker}beta`
        expect(outline(markdown)).toEqual(['0:alpha', '0:beta'])
      })
    }
  }
})

describe('ordinary marker padding contributes to the parent boundary', () => {
  const parents = [
    { marker: '-', width: 1, task: false },
    { marker: '1.', width: 2, task: false },
    { marker: '10.', width: 3, task: false },
    { marker: '-', width: 1, task: true },
  ] as const

  for (const parent of parents) {
    for (const padding of [1, 2, 3, 4]) {
      const label = `${parent.task ? 'task ' : ''}${parent.marker} with ${String(padding)} padding columns`
      const prefix = `${parent.marker}${' '.repeat(padding)}${parent.task ? '[ ] ' : ''}`
      const boundary = parent.width + padding

      it(`${label} nests at its boundary`, () => {
        expect(outline(`${prefix}alpha\n${' '.repeat(boundary)}- beta`)).toEqual([
          '0:alpha',
          '1:beta',
        ])
      })

      it(`${label} stays flat immediately before its boundary`, () => {
        const preceding = ' '.repeat(boundary - 1)
        // Up to three leading columns can start a root-level sibling. Beyond
        // that, the marker is literal continuation content instead. Either
        // way it must not become a child of this item.
        expect(outline(`${prefix}alpha\n${preceding}- beta`)).toEqual(
          boundary - 1 <= 3 ? ['0:alpha', '0:beta'] : [`0:alpha\n${preceding}- beta`],
        )
      })
    }
  }

  it('uses tab stops rather than counting a tab as a fixed-width character', () => {
    expect(outline('-\talpha\n    - beta')).toEqual(['0:alpha', '1:beta'])
    expect(outline('-\talpha\n   - beta')).toEqual(['0:alpha', '0:beta'])
  })
})

describe('nesting context follows the imported document structure', () => {
  it('continues through blank lines that make a list loose', () => {
    expect(outline('- alpha\n\n  - beta')).toEqual(['0:alpha', '1:beta'])
  })

  it('resets after a paragraph before a later list', () => {
    expect(outline('- alpha\n  - beta\n\nparagraph\n\n  - gamma')).toEqual([
      '0:alpha',
      '1:beta',
      '0:gamma',
    ])
  })

  it('does not leak through consecutive imports in one editor', () => {
    const ed = editor()
    expect(outlineIn(ed, '- alpha\n  - beta\n    - gamma')).toEqual([
      '0:alpha',
      '1:beta',
      '2:gamma',
    ])
    expect(outlineIn(ed, '  - independent')).toEqual(['0:independent'])
  })

  it('does not share open items between editors', () => {
    const first = editor()
    const second = editor()
    expect(outlineIn(first, '- alpha\n  - beta')).toEqual(['0:alpha', '1:beta'])
    expect(outlineIn(second, '  - independent')).toEqual(['0:independent'])
    expect(outlineIn(first, '  - also independent')).toEqual(['0:also independent'])
  })

  it('does not inspect bullet-looking lines owned by a fenced code block', () => {
    const markdown = '- alpha\n\n```\n- code\n  - still code\n```'
    expect(outline(markdown)).toEqual(['0:alpha'])
    expect(roundtrip(markdown)).toBe(markdown)
  })
})
