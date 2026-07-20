// Frontmatter plugin — round-trip fidelity and, above all, the `---` COLLISION
// with `hrPlugin`. Every case here is run in BOTH plugin orders (and with
// hrPlugin absent) because the resolution must not depend on array position.

import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $getRoot, $isParagraphNode } from 'lexical'
import { LLuiDecoratorNode, $isLLuiDecoratorNode } from '@llui/lexical'
import { corePlugin } from '../src/plugins/core.js'
import { hrPlugin } from '../src/plugins/hr.js'
import {
  FRONTMATTER_BRIDGE_TYPE,
  frontmatterPlugin,
  $getFrontmatter,
  $setFrontmatter,
} from '../src/plugins/frontmatter.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'

function editorFor(plugins: readonly MarkdownPlugin[]) {
  const transformers = buildTransformers(plugins)
  const editor = createHeadlessEditor({
    namespace: 'fm',
    nodes: [...GFM_NODES, LLuiDecoratorNode],
    onError: (e) => {
      throw e
    },
  })
  return { editor, transformers }
}

function convertWith(plugins: readonly MarkdownPlugin[], markdown: string): string {
  const { editor, transformers } = editorFor(plugins)
  let out = ''
  editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  editor.getEditorState().read(() => {
    out = $convertToMarkdownString(transformers)
  })
  return out
}

/** Top-level node shapes: 'fm' | 'hr' | 'p:<text>' | '<type>'. */
function shapeWith(plugins: readonly MarkdownPlugin[], markdown: string): string[] {
  const { editor, transformers } = editorFor(plugins)
  editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) => {
        if ($isLLuiDecoratorNode(node)) {
          return node.getBridgeType() === FRONTMATTER_BRIDGE_TYPE ? 'fm' : node.getBridgeType()
        }
        if ($isParagraphNode(node)) return `p:${node.getTextContent()}`
        return node.getType()
      }),
  )
}

// The three configurations the collision must survive identically.
const CONFIGS: Array<[string, MarkdownPlugin[]]> = [
  ['frontmatter before hr', [frontmatterPlugin(), hrPlugin(), corePlugin()]],
  ['hr before frontmatter', [hrPlugin(), frontmatterPlugin(), corePlugin()]],
  ['frontmatter without hr', [frontmatterPlugin(), corePlugin()]],
]

describe.each(CONFIGS)('frontmatter (%s)', (_name, plugins) => {
  const convert = (md: string): string => convertWith(plugins, md)
  const shape = (md: string): string[] => shapeWith(plugins, md)

  it('round-trips a simple frontmatter block ahead of prose', () => {
    const md = '---\ntitle: Hello\n---\n\n# Heading'
    expect(shape(md)).toEqual(['fm', 'heading'])
    expect(convert(md)).toBe(md)
  })

  it('round-trips a document that is ONLY frontmatter', () => {
    const md = '---\ntitle: Hello\ndraft: true\n---'
    expect(shape(md)).toEqual(['fm'])
    expect(convert(md)).toBe(md)
  })

  it('round-trips an EMPTY frontmatter block', () => {
    const md = '---\n---\n\nbody'
    expect(shape(md)).toEqual(['fm', 'p:body'])
    expect(convert(md)).toBe(md)
  })

  it('preserves nested structures, lists, quotes and multi-line values verbatim', () => {
    // Exactly the shapes lance\'s split-on-first-colon parser degrades.
    const body = [
      'title: "A: colonful, quoted"',
      'tags:',
      '  - alpha',
      '  - beta',
      'author:',
      '  name: Ada',
      '  email: ada@example.com',
      'summary: >',
      '  folded text that',
      '  spans lines',
      'literal: |',
      '  line one',
      '  line two',
      'empty:',
    ].join('\n')
    const md = `---\n${body}\n---\n\nprose`
    expect(convert(md)).toBe(md)
  })

  it('preserves blank lines and indentation at the edges of the block (no trimming)', () => {
    // The body is opaque: leading/trailing blank lines are the author's bytes,
    // not noise to tidy up. (A blank-only body is the one documented exception.)
    const md = '---\n\ntitle: x\n\n  indented: y\n\n---\n\nbody'
    expect(convert(md)).toBe(md)
    expect(shape(md)).toEqual(['fm', 'p:body'])
  })

  it('keeps a frontmatter value that itself contains --- (inline)', () => {
    const md = '---\ntitle: a --- b\nrule: "---"\n---\n\nafter'
    expect(shape(md)).toEqual(['fm', 'p:after'])
    expect(convert(md)).toBe(md)
  })

  it('closes the block at the first bare --- line, leaving the rest as prose', () => {
    // A LINE that is exactly `---` terminates the block — the same rule Jekyll /
    // gray-matter apply. Everything after it is document content.
    const md = '---\na: 1\n---\nb: 2\n---\n\ntail'
    const s = shape(md)
    expect(s[0]).toBe('fm')
    expect(s).not.toEqual(['fm'])
    // Idempotent: re-parsing the output yields the same output.
    expect(convert(convert(md))).toBe(convert(md))
  })

  it('does NOT claim --- that is not on line 1', () => {
    const md = 'intro\n\n---\n\nafter'
    expect(shape(md).includes('fm')).toBe(false)
  })

  it('does NOT claim an UNCLOSED --- on line 1', () => {
    const md = '---\n\njust prose, no closing fence'
    expect(shape(md).includes('fm')).toBe(false)
  })

  it('does NOT claim ---- or other thematic-break spellings on line 1', () => {
    expect(shapeWith(plugins, '----\na: 1\n----').includes('fm')).toBe(false)
    expect(shapeWith(plugins, '***\na: 1\n***').includes('fm')).toBe(false)
  })

  it('exposes the raw block as an opaque string (no YAML interpretation)', () => {
    const { editor, transformers } = editorFor(plugins)
    const body = 'title: "A: colonful"\ntags:\n  - x'
    editor.update(() => $convertFromMarkdownString(`---\n${body}\n---\n\nx`, transformers), {
      discrete: true,
    })
    expect(editor.getEditorState().read(() => $getFrontmatter())).toBe(body)
  })

  it('degrades a STRAY block (not first child) to a visible ```yaml fence, never losing it', () => {
    // Re-emitting `---` fences mid-document would re-import as a thematic break
    // and silently destroy the metadata. A block dragged/pasted out of position
    // therefore exports as a code fence: lossy in node type, lossless in text.
    const { editor, transformers } = editorFor(plugins)
    editor.update(() => $convertFromMarkdownString('---\na: 1\n---\n\n# Heading', transformers), {
      discrete: true,
    })
    editor.update(
      () => {
        const fm = $getRoot().getFirstChild()
        const heading = $getRoot().getLastChild()
        if (fm && heading) heading.insertAfter(fm)
      },
      { discrete: true },
    )
    const out = editor.getEditorState().read(() => $convertToMarkdownString(transformers))
    expect(out).toContain('a: 1')
    expect(out).toBe('# Heading\n\n```yaml\na: 1\n```')
    // And the degraded form is stable — no further drift on re-round-trip.
    expect(convert(out)).toBe(out)
  })

  it('$setFrontmatter creates, replaces and removes the block', () => {
    const { editor, transformers } = editorFor(plugins)
    const read = (): string =>
      editor.getEditorState().read(() => $convertToMarkdownString(transformers))

    editor.update(() => $convertFromMarkdownString('# Heading', transformers), { discrete: true })
    editor.update(() => $setFrontmatter('a: 1'), { discrete: true })
    expect(read()).toBe('---\na: 1\n---\n\n# Heading')

    editor.update(() => $setFrontmatter('b: 2'), { discrete: true })
    expect(read()).toBe('---\nb: 2\n---\n\n# Heading')
    expect(editor.getEditorState().read(() => $getFrontmatter())).toBe('b: 2')

    editor.update(() => $setFrontmatter(null), { discrete: true })
    expect(read()).toBe('# Heading')
    expect(editor.getEditorState().read(() => $getFrontmatter())).toBe(null)
  })
})

describe('frontmatter × hr collision', () => {
  const withBoth = [frontmatterPlugin(), hrPlugin(), corePlugin()]
  const hrOnly = [hrPlugin(), corePlugin()]

  it('REGRESSION: hrPlugin alone misparses leading frontmatter (the bug being fixed)', () => {
    // Documents the collision this plugin resolves: without frontmatterPlugin the
    // opening fence becomes an <hr> and the YAML leaks into the prose.
    expect(shapeWith(hrOnly, '---\ntitle: Hello\n---\n\nbody')[0]).toBe('hr')
  })

  it('a genuine hr AFTER frontmatter is still an hr', () => {
    const md = '---\ntitle: Hello\n---\n\nabove\n\n---\n\nbelow'
    expect(shapeWith(withBoth, md)).toEqual(['fm', 'p:above', 'hr', 'p:below'])
    expect(convertWith(withBoth, md)).toBe(md)
  })

  it('an unclosed leading --- still becomes an hr when hrPlugin is loaded', () => {
    expect(shapeWith(withBoth, '---\n\nprose')).toEqual(['hr', 'p:prose'])
  })

  it('a leading --- with hr semantics round-trips as an hr', () => {
    expect(convertWith(withBoth, '---\n\nprose')).toBe('---\n\nprose')
  })

  it('resolves identically in either plugin order', () => {
    const orders = [
      [frontmatterPlugin(), hrPlugin(), corePlugin()],
      [hrPlugin(), frontmatterPlugin(), corePlugin()],
    ]
    const docs = [
      '---\ntitle: Hello\n---\n\n# Heading',
      '---\n---',
      '---\n\nprose',
      'intro\n\n---\n\nafter',
      '---\na: 1\n---\n\n---\n\nend',
    ]
    for (const md of docs) {
      const [a, b] = orders.map((plugins) => shapeWith(plugins, md))
      expect(a).toEqual(b)
      const [x, y] = orders.map((plugins) => convertWith(plugins, md))
      expect(x).toEqual(y)
    }
  })
})
