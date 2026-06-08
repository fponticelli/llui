import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  $isLineBreakNode,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { mountApp } from '@llui/dom'
import { registerRichText } from '@lexical/rich-text'
import { mergeRegister } from '@lexical/utils'
import { singleBlockPlugin } from '../src/plugins/single-block.js'
import { corePlugin } from '../src/plugins/core.js'
import { linkPlugin } from '../src/plugins/link.js'
import type { CommandItem } from '../src/plugins/types.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { markdownEditor } from '../src/editor.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Boot a headless editor with the plugin's transform + Enter guard wired (as
 * the live editor would), seed markdown, then return the serialized round-trip. */
function roundTrip(markdown: string, plugin = singleBlockPlugin()): string {
  const transformers = buildTransformers([plugin])
  const editor = createHeadlessEditor({
    namespace: 'single-block-rt',
    nodes: [...(plugin.nodes ?? [])],
    onError: (e: Error) => {
      throw e
    },
  })
  const dispose = mergeRegister(
    registerRichText(editor),
    plugin.register!(editor, { emit: () => {} }),
  )
  editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  let out = ''
  editor.getEditorState().read(() => {
    out = $convertToMarkdownString(transformers)
  })
  dispose()
  return out
}

/** Count the top-level children of the document root. `editor.read` flushes any
 * pending (non-discrete) update first, so it reflects a just-dispatched command. */
function rootChildCount(editor: LexicalEditor): number {
  return editor.read(() => $getRoot().getChildrenSize())
}

describe('singleBlockPlugin — structural constraint (headless)', () => {
  it('keeps inline-formatted text and round-trips it', () => {
    expect(roundTrip('Hello **bold** and *italic* and `code`')).toBe(
      'Hello **bold** and *italic* and `code`',
    )
  })

  it('does NOT create a heading — `# x` stays literal paragraph text', () => {
    // No HEADING transformer is registered, so the leading `#` is plain text.
    expect(roundTrip('# Not a heading')).toBe('# Not a heading')
  })

  it('collapses multiple paragraphs into one (space-joined) by default', () => {
    expect(roundTrip('one\n\ntwo\n\nthree')).toBe('one two three')
  })

  it('flattens a list seed into a single inline paragraph', () => {
    // `- a` etc. have no list transformer, so they arrive as literal text lines,
    // but even genuine blocks would be merged by the root transform.
    expect(roundTrip('- a\n- b')).toBe('- a - b')
  })

  it('flattens REAL block nodes (heading + paragraph + list) into one separator-joined paragraph', () => {
    // Build genuine block nodes programmatically (not via inline-only markdown),
    // exercising the recursive blockLines() path: each leaf block — including
    // each list item — becomes its own space-joined line, never mashed together.
    const plugin = singleBlockPlugin()
    const editor = createHeadlessEditor({
      namespace: 'blocks',
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
      onError: (e: Error) => throwErr(e),
    })
    const dispose = mergeRegister(
      registerRichText(editor),
      plugin.register!(editor, { emit: () => {} }),
    )
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        root.append(
          $createHeadingNode('h1').append($createTextNode('Title')),
          $createParagraphNode().append($createTextNode('body')),
          $createQuoteNode().append($createTextNode('quote')),
          $createListNode('bullet').append(
            $createListItemNode().append($createTextNode('a')),
            $createListItemNode().append($createTextNode('b')),
          ),
        )
      },
      { discrete: true },
    )
    const { count, text } = editor.read(() => ({
      count: $getRoot().getChildrenSize(),
      text: $getRoot().getTextContent(),
    }))
    expect(count).toBe(1)
    expect(text).toBe('Title body quote a b')
    dispose()
  })

  it('keeps a single paragraph as a single paragraph (fast path)', () => {
    const transformers = buildTransformers([singleBlockPlugin()])
    const editor = createHeadlessEditor({ namespace: 's', onError: (e: Error) => throwErr(e) })
    const dispose = mergeRegister(
      registerRichText(editor),
      singleBlockPlugin().register!(editor, { emit: () => {} }),
    )
    editor.update(() => $convertFromMarkdownString('just text', transformers), { discrete: true })
    expect(rootChildCount(editor)).toBe(1)
    dispose()
  })
})

function throwErr(e: Error): never {
  throw e
}

describe('singleBlockPlugin — Enter handling (headless)', () => {
  it('swallows Enter (no new paragraph) by default', () => {
    const plugin = singleBlockPlugin()
    const transformers = buildTransformers([plugin])
    const editor = createHeadlessEditor({ namespace: 'enter', onError: (e: Error) => throwErr(e) })
    const dispose = mergeRegister(
      registerRichText(editor),
      plugin.register!(editor, { emit: () => {} }),
    )
    editor.update(() => $convertFromMarkdownString('text', transformers), { discrete: true })
    editor.update(
      () => {
        $getRoot().selectEnd()
      },
      { discrete: true },
    )
    editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    expect(rootChildCount(editor)).toBe(1)
    dispose()
  })

  it('inserts a soft line break (not a new paragraph) when allowLineBreaks', () => {
    const plugin = singleBlockPlugin({ allowLineBreaks: true })
    const transformers = buildTransformers([plugin])
    const editor = createHeadlessEditor({
      namespace: 'enter-lb',
      onError: (e: Error) => throwErr(e),
    })
    const dispose = mergeRegister(
      registerRichText(editor),
      plugin.register!(editor, { emit: () => {} }),
    )
    editor.update(() => $convertFromMarkdownString('before', transformers), { discrete: true })
    editor.update(
      () => {
        $getRoot().selectEnd()
      },
      { discrete: true },
    )
    editor.dispatchCommand(KEY_ENTER_COMMAND, null)
    const { children, hasBreak } = editor.read(() => {
      const root = $getRoot()
      const para = root.getFirstChild()
      const hasBreak =
        para !== null && $isParagraphNode(para) && para.getChildren().some($isLineBreakNode)
      return { children: root.getChildrenSize(), hasBreak }
    })
    expect(children).toBe(1)
    expect(hasBreak).toBe(true)
    dispose()
  })

  it('preserves line breaks across the markdown round-trip when allowLineBreaks', () => {
    expect(roundTrip('one\n\ntwo', singleBlockPlugin({ allowLineBreaks: true }))).toBe('one\ntwo')
  })
})

describe('singleBlockPlugin — link option', () => {
  it('registers LinkNode and round-trips a link when link: true', () => {
    expect(roundTrip('see [docs](https://x.dev)', singleBlockPlugin({ link: true }))).toBe(
      'see [docs](https://x.dev)',
    )
  })

  it('exposes LinkNode in its node set only when link: true', () => {
    expect(singleBlockPlugin().nodes ?? []).not.toContain(LinkNode)
    expect(singleBlockPlugin({ link: true }).nodes ?? []).toContain(LinkNode)
  })
})

describe('singleBlockPlugin — toolbar items', () => {
  it('exposes only inline command items (no block/list groups)', () => {
    const items: readonly CommandItem[] = singleBlockPlugin().items ?? []
    expect(items.map((i) => i.id).sort()).toEqual(['bold', 'code', 'italic', 'strikethrough'])
    expect(items.every((i) => i.group === 'inline')).toBe(true)
  })

  it('honors a custom `formats` list', () => {
    const items: readonly CommandItem[] =
      singleBlockPlugin({ formats: ['bold', 'italic'] }).items ?? []
    expect(items.map((i) => i.id)).toEqual(['bold', 'italic'])
  })
})

describe('singleBlockPlugin — dev guard against misuse', () => {
  it('warns when composed with corePlugin (block items would reappear)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    markdownEditor({ plugins: [corePlugin(), singleBlockPlugin()] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('singleBlockPlugin')
    warn.mockRestore()
  })

  it('does NOT warn for a valid inline-only composition (single-block + link)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    markdownEditor({ plugins: [singleBlockPlugin({ link: true }), linkPlugin()] })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('singleBlockPlugin — in markdownEditor (jsdom)', () => {
  let container: HTMLElement
  let app: ReturnType<typeof mountApp> | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    app?.dispose()
    app = undefined
    container.remove()
  })

  it('seeds a block-heavy document as a single paragraph (no h1)', async () => {
    app = mountApp(
      container,
      markdownEditor({
        plugins: [singleBlockPlugin()],
        defaultValue: '# Title\n\nbody text',
      }),
    )
    await wait(0)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelectorAll('p').length).toBe(1)
    expect(container.textContent).toContain('# Title')
    expect(container.textContent).toContain('body text')
  })

  it('renders a toolbar with inline buttons and no block-type select', async () => {
    app = mountApp(container, markdownEditor({ plugins: [singleBlockPlugin()], toolbar: true }))
    await wait(0)
    expect(container.querySelector('[data-part="block-select"]')).toBeNull()
    expect(container.querySelector('[data-id="bold"]')).not.toBeNull()
    expect(container.querySelector('[data-id="h1"]')).toBeNull()
  })
})
