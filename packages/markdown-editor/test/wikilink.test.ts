import { describe, it, expect, vi } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { corePlugin } from '../src/plugins/core.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import {
  $createWikiLinkNode,
  $isWikiLinkNode,
  WikiLinkNode,
  formatWikiLink,
  parseWikiLinkInner,
  wikilinkPlugin,
  type WikiLink,
} from '../src/plugins/wikilink.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'

// The recommended plugin order: wikilink BEFORE core, so that at an equal match
// start index the wikilink transformer beats `@lexical/markdown`'s LINK.
const plugins: readonly MarkdownPlugin[] = [wikilinkPlugin(), corePlugin()]
const transformers = buildTransformers(plugins)

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: 'wikilink',
    nodes: [...GFM_NODES, WikiLinkNode],
    onError: (e) => {
      throw e
    },
  })
}

/**
 * Children of the root's first block. `getFirstChild()` is typed `LexicalNode`,
 * which has no `getChildren`, so the element narrowing is required.
 */
function $firstBlockChildren(): LexicalNode[] {
  const first = $getRoot().getFirstChild()
  return $isElementNode(first) ? first.getChildren() : []
}

/**
 * A DOM-backed editor. `createHeadlessEditor` explicitly throws on
 * `setRootElement` (see `@lexical/headless`'s `unsupportedMethods`), so any test
 * that needs rendered DOM — a `data-wikilink` element to click, an attribute to
 * observe — must use the real `createEditor` against jsdom instead.
 */
function makeDomEditor(namespace: string): {
  container: HTMLDivElement
  editor: LexicalEditor
} {
  const editor = createEditor({
    namespace,
    nodes: [...GFM_NODES, WikiLinkNode],
    onError: (e) => {
      throw e
    },
  })
  const container = document.createElement('div')
  container.contentEditable = 'true'
  document.body.appendChild(container)
  editor.setRootElement(container)
  return { container, editor }
}

function importMarkdown(markdown: string): LexicalEditor {
  const editor = makeEditor()
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, transformers)
    },
    { discrete: true },
  )
  return editor
}

function exportMarkdown(editor: LexicalEditor): string {
  let out = ''
  editor.getEditorState().read(() => {
    out = $convertToMarkdownString(transformers)
  })
  return out
}

function roundtrip(markdown: string): string {
  return exportMarkdown(importMarkdown(markdown))
}

/** Every WikiLinkNode in the document, in document order. */
function wikilinks(editor: LexicalEditor): WikiLink[] {
  const found: WikiLink[] = []
  editor.getEditorState().read(() => {
    const visit = (node: LexicalNode): void => {
      if ($isWikiLinkNode(node)) {
        found.push({ target: node.getTarget(), alias: node.getAlias() })
        return
      }
      if ($isElementNode(node)) for (const child of node.getChildren()) visit(child)
    }
    visit($getRoot())
  })
  return found
}

/** Concatenated visible text of the document. */
function textContent(editor: LexicalEditor): string {
  let out = ''
  editor.getEditorState().read(() => {
    out = $getRoot().getTextContent()
  })
  return out
}

describe('parseWikiLinkInner (lance parity)', () => {
  it('parses a bare target', () => {
    expect(parseWikiLinkInner('Page')).toEqual({ target: 'Page', alias: null })
  })

  it('parses target|alias', () => {
    expect(parseWikiLinkInner('Page|the page')).toEqual({ target: 'Page', alias: 'the page' })
  })

  it('splits on the FIRST pipe only', () => {
    expect(parseWikiLinkInner('a|b|c')).toEqual({ target: 'a', alias: 'b|c' })
  })

  it('treats an empty alias as absent', () => {
    expect(parseWikiLinkInner('Page|')).toEqual({ target: 'Page', alias: null })
  })

  it('rejects empty inner content', () => {
    expect(parseWikiLinkInner('')).toBeNull()
  })

  it('rejects nested [[', () => {
    expect(parseWikiLinkInner('a[[b')).toBeNull()
  })

  it('rejects an empty target with an alias', () => {
    expect(parseWikiLinkInner('|alias')).toBeNull()
  })

  it('does not trim (round-trip fidelity beats prettiness)', () => {
    expect(parseWikiLinkInner(' a ')).toEqual({ target: ' a ', alias: null })
  })
})

describe('formatWikiLink', () => {
  it('serializes a bare target', () => {
    expect(formatWikiLink({ target: 'Page', alias: null })).toBe('[[Page]]')
  })

  it('serializes target|alias', () => {
    expect(formatWikiLink({ target: 'Page', alias: 'the page' })).toBe('[[Page|the page]]')
  })

  it('is the inverse of parseWikiLinkInner', () => {
    for (const inner of ['a', 'a|b', 'a|b|c', ' spaced ', 'a]b']) {
      const link = parseWikiLinkInner(inner)
      expect(link).not.toBeNull()
      if (link) expect(parseWikiLinkInner(formatWikiLink(link).slice(2, -2))).toEqual(link)
    }
  })
})

describe('wikilink markdown round-trip (in === out)', () => {
  const cases: Array<[string, string]> = [
    ['bare target', '[[Page]]'],
    ['target with alias', '[[Page|the page]]'],
    ['inside a sentence', 'See [[Page]] for details'],
    ['two on one line', '[[a]] and [[b|bee]]'],
    ['alias containing a pipe', '[[a|b|c]]'],
    ['target with spaces', '[[My Long Page]]'],
    ['target with a slash', '[[folder/Page|alias]]'],
    ['single closing bracket inside', '[[a]b]]'],
    ['alongside a regular link', '[[Page]] and [link](https://example.com)'],
    ['inside a heading', '# See [[Page]]'],
    ['inside a list item', '- [[Page|alias]]'],
    ['inside a blockquote', '> [[Page]]'],
  ]

  for (const [name, md] of cases) {
    it(name, () => {
      expect(roundtrip(md)).toBe(md)
    })
  }

  it('normalizes an empty alias away', () => {
    expect(roundtrip('[[Page|]]')).toBe('[[Page]]')
  })
})

describe('wikilink import', () => {
  it('builds a WikiLinkNode with target and alias', () => {
    const editor = importMarkdown('[[Page|the page]]')
    expect(wikilinks(editor)).toEqual([{ target: 'Page', alias: 'the page' }])
  })

  it('renders the alias as the visible text', () => {
    expect(textContent(importMarkdown('[[Page|the page]]'))).toBe('the page')
  })

  it('renders the target when there is no alias', () => {
    expect(textContent(importMarkdown('[[Page]]'))).toBe('Page')
  })

  it('leaves empty inner content untouched', () => {
    const editor = importMarkdown('[[]]')
    expect(wikilinks(editor)).toEqual([])
    expect(textContent(editor)).toBe('[[]]')
  })

  it('rejects a nested [[ and matches the INNER wikilink instead', () => {
    // Lance's markdown-it rule rejects at pos 0 then retries further along,
    // finding `[[b]]`. The regex reproduces that by failing to match at 0.
    const editor = importMarkdown('[[a[[b]]')
    expect(wikilinks(editor)).toEqual([{ target: 'b', alias: null }])
    expect(textContent(editor)).toBe('[[ab')
  })

  it('does not treat a plain markdown link as a wikilink', () => {
    const editor = importMarkdown('[text](https://example.com)')
    expect(wikilinks(editor)).toEqual([])
  })

  it('does not consume a single-bracket link label', () => {
    const editor = importMarkdown('[[Page]] [text](https://example.com)')
    expect(wikilinks(editor)).toEqual([{ target: 'Page', alias: null }])
    expect(roundtrip('[[Page]] [text](https://example.com)')).toBe(
      '[[Page]] [text](https://example.com)',
    )
  })

  it('beats the LINK transformer at an equal start index when ordered first', () => {
    // `[[a|b]](c)` is ambiguous: CommonMark reads a link with text `[a|b]`,
    // Obsidian reads a wikilink followed by literal `(c)`. Plugin order decides;
    // wikilink-before-core selects the wikilink reading.
    const editor = importMarkdown('[[a|b]](c)')
    expect(wikilinks(editor)).toEqual([{ target: 'a', alias: 'b' }])
  })

  it('keeps wikilinks out of code spans', () => {
    const editor = importMarkdown('`[[Page]]`')
    expect(wikilinks(editor)).toEqual([])
  })

  it('keeps wikilinks out of fenced code blocks', () => {
    const editor = importMarkdown('```\n[[Page]]\n```')
    expect(wikilinks(editor)).toEqual([])
    expect(roundtrip('```\n[[Page]]\n```')).toBe('```\n[[Page]]\n```')
  })
})

/** Mount a live (root-element-bearing) editor holding one wikilink node. */
function mountWith(
  target: string,
  alias: string | null,
): { container: HTMLDivElement; editor: LexicalEditor } {
  const { container, editor } = makeDomEditor('wikilink-dom')
  editor.update(
    () => {
      // A freshly-created editor's root is empty, so unlike the markdown-import
      // path there is no paragraph to append to yet.
      const root = $getRoot()
      const existing = root.getFirstChild()
      const paragraph = $isElementNode(existing) ? existing : $createParagraphNode()
      if (paragraph.getParent() === null) root.append(paragraph)
      paragraph.append($createWikiLinkNode(target, alias))
    },
    { discrete: true },
  )
  return { container, editor }
}

describe('WikiLinkNode', () => {
  it('is a token-mode text node (atomic)', () => {
    const editor = importMarkdown('[[Page|alias]]')
    editor.getEditorState().read(() => {
      const [node] = $firstBlockChildren()
      expect($isWikiLinkNode(node)).toBe(true)
      if ($isWikiLinkNode(node)) {
        expect(node.isToken()).toBe(true)
        expect(node.canInsertTextBefore()).toBe(false)
        expect(node.canInsertTextAfter()).toBe(false)
      }
    })
  })

  it('survives a JSON serialization round-trip', () => {
    const editor = importMarkdown('[[Page|alias]]')
    const json = JSON.stringify(editor.getEditorState().toJSON())
    const restored = makeEditor()
    restored.setEditorState(restored.parseEditorState(JSON.parse(json)))
    expect(wikilinks(restored)).toEqual([{ target: 'Page', alias: 'alias' }])
    expect(exportMarkdown(restored)).toBe('[[Page|alias]]')
  })

  it('exposes target/alias setters that keep the display text in sync', () => {
    const editor = importMarkdown('[[Page]]')
    editor.update(
      () => {
        const [node] = $firstBlockChildren()
        if ($isWikiLinkNode(node)) node.setAlias('renamed')
      },
      { discrete: true },
    )
    expect(textContent(editor)).toBe('renamed')
    expect(exportMarkdown(editor)).toBe('[[Page|renamed]]')
  })

  it('falls back to the target when the alias is cleared', () => {
    const editor = importMarkdown('[[Page|alias]]')
    editor.update(
      () => {
        const [node] = $firstBlockChildren()
        if ($isWikiLinkNode(node)) node.setAlias(null)
      },
      { discrete: true },
    )
    expect(textContent(editor)).toBe('Page')
    expect(exportMarkdown(editor)).toBe('[[Page]]')
  })

  it('renders a DOM element carrying the target', () => {
    const { container } = mountWith('Page', 'alias')
    const el = container.querySelector('[data-wikilink]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('data-wikilink')).toBe('Page')
    expect(el?.getAttribute('data-scope')).toBe('md-wikilink')
    expect(el?.textContent).toBe('alias')
    container.remove()
  })

  it('updates the DOM attribute when the target changes', () => {
    const { container, editor } = mountWith('Page', null)
    editor.update(
      () => {
        const [node] = $firstBlockChildren()
        if ($isWikiLinkNode(node)) node.setTarget('Other')
      },
      { discrete: true },
    )
    expect(container.querySelector('[data-wikilink]')?.getAttribute('data-wikilink')).toBe('Other')
    container.remove()
  })
})

describe('wikilink plugin wiring', () => {
  it('contributes the node and exactly one text-match transformer', () => {
    const plugin = wikilinkPlugin()
    expect(plugin.name).toBe('wikilink')
    expect(plugin.nodes).toEqual([WikiLinkNode])
    expect(plugin.transformers).toHaveLength(1)
    expect(plugin.transformers?.[0]?.type).toBe('text-match')
  })

  it('uses a `]` typing trigger, so it never collides with LINK (`)`)', () => {
    const [transformer] = wikilinkPlugin().transformers ?? []
    expect(transformer && 'trigger' in transformer ? transformer.trigger : null).toBe(']')
  })

  it('is ordered before the LINK transformer when listed first', () => {
    const ordered = buildTransformers([wikilinkPlugin(), corePlugin()])
    const textMatch = ordered.filter((t) => t.type === 'text-match')
    const [own] = wikilinkPlugin().transformers ?? []
    expect(textMatch[0]?.trigger).toBe(own && 'trigger' in own ? own.trigger : undefined)
  })

  it('surfaces an insert command item', () => {
    const items = wikilinkPlugin().items ?? []
    expect(items.map((i) => i.id)).toContain('wikilink')
  })
})

describe('wikilink click → host notification', () => {
  /** Drive the plugin's TEA slice the way the editor host does. */
  function runPlugin(plugin: MarkdownPlugin, editor: LexicalEditor): Array<unknown> {
    const ui = plugin.ui
    if (!ui) throw new Error('plugin has no ui')
    let slice = ui.init()
    const emitted: unknown[] = []
    const send = (msg: unknown): void => {
      const result = ui.update?.(slice, msg)
      if (Array.isArray(result)) {
        slice = result[0]
        for (const effect of result[1]) {
          emitted.push(effect)
          ui.onEffect?.(effect, { editor: () => editor, send, emit: () => {} })
        }
      } else if (result !== undefined) {
        slice = result
      }
    }
    const dispose = plugin.register?.(editor, {
      emit: (msg) => {
        const m = msg as { type: string; name: string; msg: unknown }
        if (m.type === 'plugin' && m.name === 'wikilink') send(m.msg)
      },
    })
    void dispose
    return emitted
  }

  function mountWithWikilink(onNavigate: (link: WikiLink) => void): {
    container: HTMLDivElement
    editor: LexicalEditor
  } {
    const plugin = wikilinkPlugin({ onNavigate })
    const { container, editor } = makeDomEditor('wikilink-click')
    editor.update(
      () => {
        $convertFromMarkdownString('[[Page|alias]]', transformers)
      },
      { discrete: true },
    )
    runPlugin(plugin, editor)
    return { container, editor }
  }

  it('notifies the host with target and alias on click', () => {
    const onNavigate = vi.fn()
    const { container } = mountWithWikilink(onNavigate)
    const el = container.querySelector('[data-wikilink]')
    expect(el).not.toBeNull()
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith({ target: 'Page', alias: 'alias' })
    container.remove()
  })

  it('ignores clicks outside a wikilink', () => {
    const onNavigate = vi.fn()
    const { container } = mountWithWikilink(onNavigate)
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onNavigate).not.toHaveBeenCalled()
    container.remove()
  })

  it('records the last activated link in its state slice', () => {
    const plugin = wikilinkPlugin()
    const ui = plugin.ui
    expect(ui).toBeDefined()
    if (!ui) return
    const next = ui.update?.(ui.init(), { type: 'activate', target: 'Page', alias: 'alias' })
    const slice = Array.isArray(next) ? next[0] : next
    expect(slice).toEqual({ last: { target: 'Page', alias: 'alias' } })
  })
})

// ── Review findings (adversarial pass) ───────────────────────────────────────

describe('a formatted wikilink keeps its format (review finding: CRITICAL)', () => {
  const cases: Array<[string, string]> = [
    ['bold', '**[[Page]]**'],
    ['italic', '*[[Page]]*'],
    ['strikethrough', '~~[[Page]]~~'],
    ['bold with alias', '**[[Page|shown]]**'],
  ]

  for (const [label, markdown] of cases) {
    it(`round-trips a ${label} wikilink`, () => {
      expect(roundtrip(markdown)).toBe(markdown)
    })
  }

  it('does not tear a bold run that contains a wikilink', () => {
    const markdown = 'a **b [[Page]] c** d'
    expect(roundtrip(markdown)).toBe(markdown)
  })

  it('carries the format onto the WikiLinkNode itself', () => {
    const editor = importMarkdown('**[[Page]]**')
    editor.getEditorState().read(() => {
      const node = $firstBlockChildren().find($isWikiLinkNode)
      expect(node).toBeDefined()
      expect(node?.hasFormat('bold')).toBe(true)
    })
  })
})

describe('unrepresentable target/alias values cannot be created (review finding: MAJOR)', () => {
  it('formatWikiLink is injective over sanitized values', () => {
    for (const raw of ['a|b', 'a]]b', 'a[[b', 'a\nb', 'plain', 'a]b']) {
      const editor = makeEditor()
      let link: WikiLink | null = null
      editor.update(
        () => {
          const node = $createWikiLinkNode(raw, null)
          link = node.getLink()
        },
        { discrete: true },
      )
      expect(link).not.toBeNull()
      if (!link) continue
      const emitted = formatWikiLink(link)
      const reparsed = parseWikiLinkInner(emitted.slice(2, -2))
      expect(reparsed).toEqual(link)
    }
  })

  it('strips a pipe from a target so the alias cannot be forged', () => {
    const editor = makeEditor()
    let link: WikiLink | null = null
    editor.update(
      () => {
        link = $createWikiLinkNode('a|b', null).getLink()
      },
      { discrete: true },
    )
    expect(link).toEqual({ target: 'ab', alias: null })
  })

  it('collapses a newline in a target to a space', () => {
    const editor = makeEditor()
    let link: WikiLink | null = null
    editor.update(
      () => {
        link = $createWikiLinkNode('one\ntwo', null).getLink()
      },
      { discrete: true },
    )
    expect(link).toEqual({ target: 'one two', alias: null })
  })

  it('rejects a whitespace-only target on import', () => {
    expect(parseWikiLinkInner(' ')).toBeNull()
    expect(parseWikiLinkInner('\t')).toBeNull()
  })

  it('treats a whitespace-only alias as absent', () => {
    expect(parseWikiLinkInner('Page| ')).toEqual({ target: 'Page', alias: null })
  })
})

describe('the insert command produces a representable link (review finding: MAJOR)', () => {
  function runInsert(seed: string, select: (editor: LexicalEditor) => void): WikiLink[] {
    const plugin = wikilinkPlugin()
    const editor = makeEditor()
    editor.update(
      () => {
        $convertFromMarkdownString(seed, transformers)
        select(editor)
      },
      { discrete: true },
    )
    const item = plugin.items?.[0]
    expect(item).toBeDefined()
    item?.run(editor, { send: () => {} })
    // `run` uses a plain (async) `editor.update`; force it to land before we read.
    editor.update(() => {}, { discrete: true })
    return wikilinks(editor)
  }

  it('escapes nothing but sanitizes a pipe-bearing selection', () => {
    const links = runInsert('a|b', () => {
      const first = $getRoot().getFirstChild()
      if ($isElementNode(first)) first.select(0, first.getChildrenSize())
    })
    expect(links).toHaveLength(1)
    expect(links[0]?.target).not.toContain('|')
  })

  it('does not produce a multi-line target from a multi-block selection', () => {
    const links = runInsert('one\n\ntwo', () => {
      $getRoot().select(0, $getRoot().getChildrenSize())
    })
    expect(links).toHaveLength(1)
    expect(links[0]?.target).not.toContain('\n')
  })

  it('falls back to the placeholder for a selection with nothing usable', () => {
    const plugin = wikilinkPlugin({ placeholderTarget: 'Fallback' })
    const editor = makeEditor()
    editor.update(
      () => {
        const p = $createParagraphNode()
        $getRoot().clear().append(p)
        p.select(0, 0)
      },
      { discrete: true },
    )
    plugin.items?.[0]?.run(editor, { send: () => {} })
    editor.update(() => {}, { discrete: true })
    expect(wikilinks(editor)).toEqual([{ target: 'Fallback', alias: null }])
  })
})
