// Composition tests: every plugin loaded TOGETHER, not in isolation.
//
// Each plugin's own suite proves it works alone. This file exists to catch what
// only appears when they share one transformer array — chiefly transformer
// ORDER, which `buildTransformers` governs and which is the single place
// markdown round-trip fidelity can silently break.
//
// The load-bearing property asserted throughout is ORDER INDEPENDENCE: a
// consumer must not be able to corrupt their document by listing plugins in an
// unlucky sequence. Where two contributions really do collide, the collision is
// resolved structurally (one shared transformer reference, de-duplicated by the
// registry) rather than by documenting a required order.

import { describe, it, expect } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { CODE, LINK } from '@lexical/markdown'
import { $getRoot, type LexicalEditor, type LexicalNodeConfig } from 'lexical'
import { $isCodeNode } from '@lexical/code-core'
import { corePlugin } from '../src/plugins/core.js'
import { hrPlugin } from '../src/plugins/hr.js'
import { linkPlugin } from '../src/plugins/link.js'
import { tablePlugin } from '../src/plugins/table.js'
import { mathPlugin } from '../src/plugins/math.js'
import { mermaidPlugin } from '../src/plugins/mermaid.js'
import { calloutPlugin } from '../src/plugins/callout.js'
import { imagePlugin } from '../src/plugins/image.js'
import { codeLanguagePlugin } from '../src/plugins/code-language.js'
import { blockDragPlugin } from '../src/plugins/block-drag.js'
import { wikilinkPlugin } from '../src/plugins/wikilink.js'
import { frontmatterPlugin } from '../src/plugins/frontmatter.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES, GFM_TRANSFORMERS } from '../src/transformers/gfm.js'
import { CODE_INFO_TRANSFORMER } from '../src/transformers/code.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'

/** Every plugin that contributes markdown syntax, in the documented order. */
function allPlugins(): MarkdownPlugin[] {
  return [
    frontmatterPlugin(),
    wikilinkPlugin(),
    codeLanguagePlugin(),
    corePlugin(),
    linkPlugin(),
    hrPlugin(),
    tablePlugin(),
    mathPlugin(),
    mermaidPlugin(),
    calloutPlugin(),
    imagePlugin(),
    blockDragPlugin(),
  ]
}

/** The same set, deliberately listed "wrong": the two plugins that replace a
 * built-in transformer come LAST, after `corePlugin()` has contributed its. */
function allPluginsReversedPrecedence(): MarkdownPlugin[] {
  return [
    corePlugin(),
    linkPlugin(),
    hrPlugin(),
    tablePlugin(),
    mathPlugin(),
    mermaidPlugin(),
    calloutPlugin(),
    imagePlugin(),
    blockDragPlugin(),
    codeLanguagePlugin(),
    wikilinkPlugin(),
    frontmatterPlugin(),
  ]
}

function editorFor(plugins: readonly MarkdownPlugin[]): LexicalEditor {
  const nodes = new Set<LexicalNodeConfig>([...GFM_NODES])
  for (const plugin of plugins) for (const node of plugin.nodes ?? []) nodes.add(node)
  return createHeadlessEditor({
    namespace: 'composition',
    nodes: [...nodes],
    onError: (e) => {
      throw e
    },
  })
}

/** Import `markdown` under `plugins`, then export it again. */
function roundtrip(plugins: readonly MarkdownPlugin[], markdown: string): string {
  const transformers = buildTransformers(plugins)
  const editor = editorFor(plugins)
  editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  return editor.getEditorState().read(() => $convertToMarkdownString(transformers))
}

// ── Registry-level composition ──────────────────────────────────────────────

describe('buildTransformers with every plugin loaded', () => {
  it('emits transformers in Lexical rank order', () => {
    const types = buildTransformers(allPlugins()).map((t) => t.type)
    const rank = { 'multiline-element': 0, element: 1, 'text-format': 2, 'text-match': 3 }
    const ranks = types.map((t) => rank[t as keyof typeof rank])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('never ships `@lexical/markdown`’s CODE, whose info-string capture corrupts documents', () => {
    expect(buildTransformers(allPlugins())).not.toContain(CODE)
    expect(GFM_TRANSFORMERS).not.toContain(CODE)
  })

  it('de-duplicates the code transformer contributed by both core and codeLanguage', () => {
    // Both plugins contribute the SAME reference, so the registry's identity
    // Set collapses them. If either ever contributes a distinct copy, two
    // multiline transformers race and plugin order decides the parse.
    const all = buildTransformers(allPlugins())
    expect(all.filter((t) => t === CODE_INFO_TRANSFORMER)).toHaveLength(1)
  })

  it('contributes no duplicate transformer references at all', () => {
    const all = buildTransformers(allPlugins())
    expect(new Set(all).size).toBe(all.length)
  })

  it('produces the same transformer set regardless of plugin order', () => {
    // The SAME plugin instances, listed two ways. Constructing the plugins
    // twice would not work: several build their transformers per call (closing
    // over options), so the two sets would differ by reference for reasons that
    // have nothing to do with ordering.
    const instances = allPlugins()
    const forward = new Set(buildTransformers(instances))
    const reversed = new Set(buildTransformers([...instances].reverse()))
    expect(reversed.size).toBe(forward.size)
    expect([...forward].every((t) => reversed.has(t))).toBe(true)
  })
})

// ── Fenced code: the info string ────────────────────────────────────────────

describe('fenced code info strings survive full composition', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['a multi-token info string', '```lance table\nsum(x)\n```'],
    ['punctuation upstream CODE truncates', '```c++\nint main()\n```'],
    ['a hyphenated language', '```objective-c\nid x;\n```'],
    ['an ordinary language', '```ts\nconst a = 1\n```'],
    ['a bare fence', '```\nplain\n```'],
    ['an attribute-style info string', '```{.foo #bar}\nx\n```'],
  ]

  for (const [label, markdown] of cases) {
    it(`round-trips ${label} with all plugins loaded`, () => {
      expect(roundtrip(allPlugins(), markdown)).toBe(markdown)
    })

    // The regression that motivated moving CODE_INFO_TRANSFORMER into
    // GFM_TRANSFORMERS: when it was merely contributed by `codeLanguagePlugin()`,
    // listing that plugin after `corePlugin()` silently reinstated upstream
    // `CODE` and pushed the rest of the fence line into the code body.
    it(`round-trips ${label} even with plugins listed in the opposite order`, () => {
      expect(roundtrip(allPluginsReversedPrecedence(), markdown)).toBe(markdown)
    })
  }

  it('does not leak fence-line text into the code body', () => {
    const plugins = allPluginsReversedPrecedence()
    const transformers = buildTransformers(plugins)
    const editor = editorFor(plugins)
    editor.update(() => $convertFromMarkdownString('```lance table\nsum(x)\n```', transformers), {
      discrete: true,
    })
    const { language, text } = editor.getEditorState().read(() => {
      const first = $getRoot().getFirstChild()
      return {
        language: $isCodeNode(first) ? first.getLanguage() : null,
        text: first?.getTextContent() ?? '',
      }
    })
    expect(language).toBe('lance table')
    expect(text).toBe('sum(x)')
    expect(text).not.toContain('table')
  })
})

// ── Brackets: wikilink vs LINK ──────────────────────────────────────────────

describe('wikilink and LINK coexist', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['a bare wikilink', '[[Page]]'],
    ['an aliased wikilink', '[[Page|alias]]'],
    ['a markdown link', '[text](https://example.com)'],
    ['both in one paragraph', '[[Page]] and [text](https://example.com)'],
    ['a wikilink adjacent to a link', '[[A]][b](https://example.com)'],
    ['a link whose text looks like a wikilink', '[[not a wikilink]](https://example.com)'],
    // Formatted wikilinks: the export path must go through `exportFormat`, and
    // the import path must carry the format onto the replacement node. Broken,
    // this silently drops the format AND tears the surrounding run in two.
    ['a bold wikilink', '**[[Page]]**'],
    ['an italic wikilink', '*[[Page]]*'],
    ['a wikilink inside a bold run', 'a **b [[Page]] c** d'],
  ]

  // Not an `in === out` case: upstream LINK exports a bold link as
  // `[**b**](url)` rather than `**[b](url)**` — a normalization we do not fight.
  // The property that matters is that BOTH orders agree and the bold SURVIVES.
  // Before wikilink declared its transformer precedence, listing it after
  // `corePlugin()` let LINK's lazy label regex span from the wikilink's own `[`
  // all the way to the later `](`, swallowing the `**` delimiters and
  // re-exporting them escaped (`\*\*[[A]]\*\*`) — the bold was silently lost.
  it('keeps bold on a wikilink that shares a line with a bold link, in either order', () => {
    const markdown = '**[[A]]** and **[b](https://example.com)**'
    const forward = roundtrip(allPlugins(), markdown)
    const reversed = roundtrip(allPluginsReversedPrecedence(), markdown)
    expect(forward).toBe(reversed)
    expect(forward).toContain('**[[A]]**')
    expect(forward).not.toContain('\\*')
    // …and a fixed point from there.
    expect(roundtrip(allPlugins(), forward)).toBe(forward)
  })

  for (const [label, markdown] of cases) {
    it(`round-trips ${label}`, () => {
      expect(roundtrip(allPlugins(), markdown)).toBe(markdown)
    })

    it(`round-trips ${label} regardless of plugin order`, () => {
      expect(roundtrip(allPluginsReversedPrecedence(), markdown)).toBe(markdown)
    })
  }

  it('keeps LINK available — wikilink does not displace it', () => {
    expect(buildTransformers(allPlugins())).toContain(LINK)
  })

  it('does not create wikilinks inside fenced code', () => {
    const markdown = '```\n[[Page]]\n```'
    expect(roundtrip(allPlugins(), markdown)).toBe(markdown)
  })
})

// ── Thematic breaks: frontmatter vs hr ──────────────────────────────────────
//
// BOTH plugins claim a `---` line. The collision is resolved STRUCTURALLY, not
// by ordering: frontmatter contributes a `multiline-element` transformer, and
// `@lexical/markdown` runs every multiline transformer ahead of every element
// transformer (`$importMultiline` before `$importBlocks` on import;
// `[...byType.multilineElement, ...byType.element]` on export). So frontmatter
// is consulted first no matter where either plugin sits in the array — and it
// DECLINES (returns null, falling through to hr) unless the fence is on line 0
// and a closing `---` exists.
//
// Every assertion below therefore runs in BOTH plugin orders.

describe('thematic breaks vs frontmatter', () => {
  const orders: ReadonlyArray<readonly [string, () => MarkdownPlugin[]]> = [
    ['frontmatter first', allPlugins],
    ['frontmatter last', allPluginsReversedPrecedence],
  ]

  for (const [label, plugins] of orders) {
    describe(label, () => {
      it('round-trips a leading `---` as a horizontal rule when nothing closes it', () => {
        expect(roundtrip(plugins(), '---')).toBe('---')
      })

      it('round-trips a mid-document `---` as a horizontal rule', () => {
        const markdown = 'intro\n\n---\n\nafter'
        expect(roundtrip(plugins(), markdown)).toBe(markdown)
      })

      it('round-trips a real frontmatter block', () => {
        const markdown = '---\ntitle: Hello\ntags: [a, b]\n---\n\nbody'
        expect(roundtrip(plugins(), markdown)).toBe(markdown)
      })

      it('keeps frontmatter and a later thematic break distinct', () => {
        const markdown = '---\ntitle: Hello\n---\n\nbefore\n\n---\n\nafter'
        expect(roundtrip(plugins(), markdown)).toBe(markdown)
      })

      it('does not claim a `---` block that starts below line 0', () => {
        // hr claims both fences and the middle line stays a paragraph, so the
        // output is re-spaced (blank lines around block elements) — that is
        // normalization, not loss. The property under test is that frontmatter
        // DECLINED: no frontmatter node, and the text survives.
        const out = roundtrip(plugins(), 'lead\n\n---\nnot: frontmatter\n---')
        expect(out).toContain('not: frontmatter')
        expect(out.split('---').length - 1).toBe(2)
        // …and it is a fixed point from there on.
        expect(roundtrip(plugins(), out)).toBe(out)
      })

      it('does not treat `---` as a rule inside fenced code', () => {
        const markdown = '```\n---\n```'
        expect(roundtrip(plugins(), markdown)).toBe(markdown)
      })

      it('is stable under a second round-trip', () => {
        const markdown = '---\ntitle: Hello\n---\n\nbody\n\n---\n\ntail'
        const once = roundtrip(plugins(), markdown)
        expect(roundtrip(plugins(), once)).toBe(once)
      })
    })
  }

  it('resolves the collision by transformer RANK, not by array order', () => {
    // The structural guarantee: frontmatter's transformer is consulted before
    // hr's in both orders, because multiline-element outranks element.
    for (const plugins of [allPlugins(), allPluginsReversedPrecedence()]) {
      const all = buildTransformers(plugins)
      const frontmatterIndex = all.findIndex(
        (t) => t.type === 'multiline-element' && 'regExpStart' in t && t.regExpStart.test('---'),
      )
      const hrIndex = all.findIndex(
        (t) => t.type === 'element' && 'regExp' in t && t.regExp.test('---'),
      )
      expect(frontmatterIndex).toBeGreaterThanOrEqual(0)
      expect(hrIndex).toBeGreaterThanOrEqual(0)
      expect(frontmatterIndex).toBeLessThan(hrIndex)
    }
  })

  it('leaves exactly one ELEMENT transformer claiming `---`', () => {
    const claimants = buildTransformers(allPlugins()).filter(
      (t) => t.type === 'element' && 'regExp' in t && t.regExp.test('---'),
    )
    expect(claimants).toHaveLength(1)
  })
})

// ── Whole-document composition ──────────────────────────────────────────────

describe('a document exercising every plugin at once', () => {
  const document = [
    '---',
    'title: Everything',
    'tags: [a, b]',
    '---',
    '',
    '# Title',
    '',
    'Prose with **bold**, `code`, [[Wiki Page]] and [a link](https://example.com).',
    '',
    '```lance table',
    'sum(x)',
    '```',
    '',
    '---',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
    '> quoted',
  ].join('\n')

  it('round-trips unchanged', () => {
    expect(roundtrip(allPlugins(), document)).toBe(document)
  })

  it('round-trips unchanged regardless of plugin order', () => {
    expect(roundtrip(allPluginsReversedPrecedence(), document)).toBe(document)
  })

  it('is stable under a second round-trip', () => {
    const once = roundtrip(allPlugins(), document)
    expect(roundtrip(allPlugins(), once)).toBe(once)
  })
})

// ── Plugin identity ─────────────────────────────────────────────────────────

describe('plugin registry hygiene', () => {
  it('gives every plugin a unique name', () => {
    const names = allPlugins().map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('registers no node class twice across plugins', () => {
    for (const plugin of allPlugins()) {
      const nodes = plugin.nodes ?? []
      expect(new Set(nodes).size).toBe(nodes.length)
    }
  })
})
