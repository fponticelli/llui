// The image surface: CommonMark-correct `![alt](src "title")` parsing, the
// render-time `resolveSrc` seam, the sanitize-then-resolve order on the render
// path, and the consumer bridge-override contract.
//
// The parsing cases are not hypothetical: every ❌ below is a document a regex
// of the shape `^!\[([^\]]*)\]\(([^)]+)\)$` silently mangles — a title swallowed
// into the src, an angle-bracket destination kept verbatim, a filename with
// parentheses declined outright — while a markdown round-trip test stays green
// because the export re-emits the corrupt value unchanged.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import {
  $createLLuiDecoratorNode,
  $isLLuiDecoratorNode,
  LLuiDecoratorNode,
  decoratorBridge,
} from '@llui/lexical'
import { mountApp, div, img, type Signal } from '@llui/dom'
import { corePlugin } from '../src/plugins/core.js'
import { imagePlugin } from '../src/plugins/image.js'
import {
  IMAGE_BRIDGE_TYPE,
  formatImageLine,
  parseImageLine,
  type ImageData,
} from '../src/transformers/image.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { markdownEditor } from '../src/editor.js'
import { waitFor } from './wait-for'

const transformers = buildTransformers([corePlugin(), imagePlugin()])

function newEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: 'image',
    nodes: [...GFM_NODES, LLuiDecoratorNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

/** Import `markdown`, returning the image nodes' data plus the re-exported markdown. */
function roundTrip(markdown: string): { images: ImageData[]; out: string } {
  const editor = newEditor()
  editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  const images: ImageData[] = []
  let out = ''
  editor.getEditorState().read(() => {
    const visit = (node: LexicalNode): void => {
      if ($isLLuiDecoratorNode(node) && node.getBridgeType() === IMAGE_BRIDGE_TYPE) {
        images.push(node.getData() as ImageData)
      }
      if ('getChildren' in node) {
        for (const child of (node as import('lexical').ElementNode).getChildren()) visit(child)
      }
    }
    visit($getRoot())
    out = $convertToMarkdownString(transformers)
  })
  return { images, out }
}

describe('parseImageLine — CommonMark destinations', () => {
  it('reads a double-quoted title as a title, not as part of the src', () => {
    expect(parseImageLine('![a](img.png "Title")')).toEqual({
      src: 'img.png',
      alt: 'a',
      title: 'Title',
    })
  })

  it('accepts the single-quoted and parenthesized title forms', () => {
    expect(parseImageLine("![a](img.png 'T')")?.title).toBe('T')
    expect(parseImageLine('![a](img.png (T))')?.title).toBe('T')
  })

  it('unwraps an angle-bracket destination (the only way to spell a space)', () => {
    expect(parseImageLine('![a](<my file.png>)')).toEqual({ src: 'my file.png', alt: 'a' })
  })

  it('keeps balanced parentheses inside a destination', () => {
    expect(parseImageLine('![a](attachments/img(1).png)')?.src).toBe('attachments/img(1).png')
  })

  it('preserves percent-encoding verbatim', () => {
    expect(parseImageLine('![a](attachments/my%20file.png)')?.src).toBe('attachments/my%20file.png')
  })

  it('tolerates trailing whitespace (a hard-break line is still an image)', () => {
    expect(parseImageLine('![a](x.png)  ')).toEqual({ src: 'x.png', alt: 'a' })
  })

  it('decodes escapes and entities in the alt text', () => {
    expect(parseImageLine('![a\\[b\\]](x.png)')?.alt).toBe('a[b]')
    expect(parseImageLine('![a &amp; b](x.png)')?.alt).toBe('a & b')
  })

  it('reads an empty alt and an empty destination', () => {
    expect(parseImageLine('![](x.png)')).toEqual({ src: 'x.png', alt: '' })
    expect(parseImageLine('![a](<>)')).toEqual({ src: '', alt: 'a' })
  })

  it('declines anything that is not exactly one image on the line', () => {
    expect(parseImageLine('here ![a](x.png) there')).toBeNull() // inline image
    expect(parseImageLine('![a](x.png) ![b](y.png)')).toBeNull() // two images
    expect(parseImageLine('[![a](x.png)](https://e.com)')).toBeNull() // linked image
    expect(parseImageLine('- ![a](x.png)')).toBeNull() // list item
    expect(parseImageLine('> ![a](x.png)')).toBeNull() // blockquote
    expect(parseImageLine('plain text')).toBeNull()
    expect(parseImageLine('')).toBeNull()
  })
})

describe('formatImageLine — the exact inverse of parseImageLine', () => {
  const corpus: ImageData[] = [
    { src: 'attachments/a.png', alt: 'a cat' },
    { src: 'attachments/a.png', alt: '' },
    { src: 'img.png', alt: 'a', title: 'Title' },
    { src: 'my file.png', alt: 'spaces' }, // needs the angle form
    { src: 'attachments/img(1).png', alt: 'balanced parens' },
    { src: 'attachments/img(1.png', alt: 'unbalanced paren' }, // needs the angle form
    { src: 'a<b>c.png', alt: 'angle chars' },
    { src: 'back\\slash.png', alt: 'backslash' },
    { src: 'attachments/my%20file.png', alt: 'percent' },
    { src: '', alt: 'empty destination' },
    { src: 'x.png', alt: 'a [b] *c* _d_ `e` &f& \\g' },
    { src: 'x.png', alt: 'quoted', title: 'has "quotes" and \\ backslash' },
    { src: 'https://example.com/a.png?q=1&r=2#frag', alt: 'query' },
  ]

  for (const data of corpus) {
    it(`round-trips ${JSON.stringify(data)}`, () => {
      const line = formatImageLine(data)
      expect(parseImageLine(line)).toEqual(data)
    })
  }

  it('emits the canonical spellings', () => {
    expect(formatImageLine({ src: 'a.png', alt: 'x' })).toBe('![x](a.png)')
    expect(formatImageLine({ src: 'a.png', alt: 'x', title: 'T' })).toBe('![x](a.png "T")')
    expect(formatImageLine({ src: 'my file.png', alt: '' })).toBe('![](<my file.png>)')
  })

  it('percent-encodes a control character rather than emitting a broken line', () => {
    const line = formatImageLine({ src: 'a\nb.png', alt: 'x' })
    expect(line).not.toContain('\n')
    expect(parseImageLine(line)?.src).toBe('a%0Ab.png')
  })
})

describe('image import/export through the editor', () => {
  it('round-trips a titled image byte-identically', () => {
    const { images, out } = roundTrip('![a cat](img.png "Title")')
    expect(images).toEqual([{ src: 'img.png', alt: 'a cat', title: 'Title' }])
    expect(out).toBe('![a cat](img.png "Title")')
  })

  it('round-trips an angle-bracket destination and a parenthesized filename', () => {
    expect(roundTrip('![a](<my file.png>)').images[0]?.src).toBe('my file.png')
    expect(roundTrip('![a](<my file.png>)').out).toBe('![a](<my file.png>)')
    expect(roundTrip('![a](attachments/img(1).png)').images[0]?.src).toBe('attachments/img(1).png')
    expect(roundTrip('![a](attachments/img(1).png)').out).toBe('![a](attachments/img(1).png)')
  })

  it('imports a line with trailing whitespace, normalizing it away on export', () => {
    const { images, out } = roundTrip('![a](x.png)  ')
    expect(images).toEqual([{ src: 'x.png', alt: 'a' }])
    expect(out).toBe('![a](x.png)')
  })

  it('leaves a non-conforming line as text instead of mangling it', () => {
    // Declined by the transformer → falls through and survives as literal text,
    // so no content is lost even though it is not (yet) a block image.
    for (const src of ['here ![a](x.png) there', '[![a](x.png)](https://e.com)']) {
      const { images, out } = roundTrip(src)
      expect(images).toEqual([])
      expect(out).toBe(src)
    }
  })

  it('refuses an unsafe scheme at import WITHOUT deleting the line', () => {
    // Regression: the line used to vanish. `$importBlocks` truncates the text
    // node before calling `replace`, so refusing the image after a full-line
    // match left an empty paragraph — a document opened and saved back lost the
    // line outright. (`javascript:alert(1)` never even matched the old regex,
    // because of the parentheses, which is why nothing caught this.)
    for (const line of ['![x](javascript:boom)', '![x](javascript:alert(1))']) {
      const { images, out } = roundTrip(`before\n\n${line}\n\nafter`)
      expect(images).toEqual([])
      expect(out).toBe(`before\n\n${line}\n\nafter`)
    }
  })

  it('keeps a line that matches loosely but is not one image', () => {
    // Matches IMAGE_LINE (`![…](…)`) yet parses as an image plus trailing text,
    // so it is declined — and must come back intact rather than as an empty line.
    const { images, out } = roundTrip('![a](x.png) ![b](y.png)')
    expect(images).toEqual([])
    expect(out).toBe('![a](x.png) ![b](y.png)')
  })
})

describe('resolveSrc — render-time only', () => {
  let container: HTMLElement
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  interface Mounted {
    editor: LexicalEditor
    changes: string[]
  }

  function mount(plugins: readonly MarkdownPlugin[], defaultValue: string): Mounted {
    let editor!: LexicalEditor
    const changes: string[] = []
    app = mountApp(
      container,
      markdownEditor({
        plugins,
        defaultValue,
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
        onChange: (md) => changes.push(md),
      }),
    )
    return { editor, changes }
  }

  const renderedImage = (): HTMLImageElement | null =>
    container.querySelector('[data-scope="md-image"] img')

  it('renders the stored src unchanged when the option is absent', async () => {
    mount([corePlugin(), imagePlugin()], '![a](attachments/a.png)')
    await waitFor(() => renderedImage() !== null)
    expect(renderedImage()?.getAttribute('src')).toBe('attachments/a.png')
    expect(renderedImage()?.hasAttribute('data-blocked')).toBe(false)
  })

  it('resolves the <img> src while the document keeps the stored path', async () => {
    const resolveSrc = vi.fn((src: string) => `asset://localhost/vault/${src}`)
    const { editor, changes } = mount(
      [corePlugin(), imagePlugin({ resolveSrc })],
      '![a](attachments/a.png)',
    )
    await waitFor(() => renderedImage() !== null)

    expect(renderedImage()?.getAttribute('src')).toBe('asset://localhost/vault/attachments/a.png')
    expect(resolveSrc).toHaveBeenCalledWith('attachments/a.png')

    // The node data — and therefore the markdown file of record — is untouched.
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)).toBe('![a](attachments/a.png)')
  })

  it('re-resolves when the node data changes (no remount)', async () => {
    const { editor } = mount(
      [corePlugin(), imagePlugin({ resolveSrc: (src) => `asset://localhost/vault/${src}` })],
      '![a](attachments/a.png)',
    )
    await waitFor(() => renderedImage() !== null)
    const before = renderedImage()

    editor.update(
      () => {
        const node = $getRoot().getFirstChild()
        if ($isLLuiDecoratorNode(node)) node.setData({ src: 'attachments/b.png', alt: 'b' })
      },
      { discrete: true },
    )

    await waitFor(
      () => renderedImage()?.getAttribute('src') === 'asset://localhost/vault/attachments/b.png',
    )
    expect(renderedImage()).toBe(before) // same element — pushed, not remounted
    expect(renderedImage()?.getAttribute('alt')).toBe('b')
  })

  it('renders a title when the document carries one, and omits the attribute otherwise', async () => {
    mount([corePlugin(), imagePlugin()], '![a](x.png "Tooltip")')
    await waitFor(() => renderedImage() !== null)
    expect(renderedImage()?.getAttribute('title')).toBe('Tooltip')

    app?.dispose()
    app = null
    container.replaceChildren()
    mount([corePlugin(), imagePlugin()], '![a](x.png)')
    await waitFor(() => renderedImage() !== null)
    expect(renderedImage()?.hasAttribute('title')).toBe(false)
  })

  it('sanitizes the stored src BEFORE resolving: an unsafe one renders no request and never reaches the resolver', async () => {
    const resolveSrc = vi.fn((src: string) => `asset://localhost/vault/${src}`)
    const { editor } = mount([corePlugin(), imagePlugin({ resolveSrc })], 'intro')

    // The ingress sanitizers cannot reach this path: `importJSON`/`updateFromJSON`
    // (collab, undo, an editor-state swap, a decorator paste) write node data raw.
    editor.update(
      () => {
        $getRoot().append(
          $createLLuiDecoratorNode(IMAGE_BRIDGE_TYPE, {
            src: 'javascript:alert(1)',
            alt: 'blocked one',
          }),
        )
      },
      { discrete: true },
    )

    await waitFor(() => renderedImage() !== null)
    expect(renderedImage()?.hasAttribute('src')).toBe(false)
    expect(renderedImage()?.getAttribute('data-blocked')).toBe('true')
    expect(renderedImage()?.getAttribute('alt')).toBe('blocked one')
    expect(resolveSrc).not.toHaveBeenCalled()
  })

  it('recovers when a blocked src is corrected in place', async () => {
    // The blocked state is a render of the data, not a latch: a remote peer (or an
    // undo) fixing the src must clear `data-blocked` and restore the attribute.
    const { editor } = mount(
      [corePlugin(), imagePlugin({ resolveSrc: (src) => `asset://localhost/vault/${src}` })],
      'intro',
    )
    editor.update(
      () => {
        $getRoot().append(
          $createLLuiDecoratorNode(IMAGE_BRIDGE_TYPE, { src: 'javascript:boom', alt: 'x' }),
        )
      },
      { discrete: true },
    )
    await waitFor(() => renderedImage()?.getAttribute('data-blocked') === 'true')

    editor.update(
      () => {
        const node = $getRoot().getLastChild()
        if ($isLLuiDecoratorNode(node)) node.setData({ src: 'attachments/a.png', alt: 'x' })
      },
      { discrete: true },
    )

    await waitFor(() => renderedImage()?.hasAttribute('data-blocked') === false)
    expect(renderedImage()?.getAttribute('src')).toBe('asset://localhost/vault/attachments/a.png')
  })

  it('is never consulted at ingress — an unsafe insert is refused, not resolved into safety', async () => {
    const resolveSrc = vi.fn(() => 'https://safe.example/ok.png')
    mount([corePlugin(), imagePlugin({ resolveSrc })], 'intro')

    app?.send({ type: 'runCommand', id: 'image' })
    await waitFor(() => document.querySelector('[data-md-link="box"]') !== null)
    app?.send({
      type: 'plugin',
      name: 'image',
      msg: { type: 'setSrc', src: 'javascript:alert(1)' },
    })
    app?.send({ type: 'plugin', name: 'image', msg: { type: 'submit' } })
    await new Promise((r) => setTimeout(r, 20))

    expect(renderedImage()).toBeNull()
    expect(resolveSrc).not.toHaveBeenCalled()
  })

  it('CHARACTERIZES: typing an image live yields a link, not an image', async () => {
    // Not what this change is about, but worth pinning so it is not rediscovered
    // as a regression: the element transformer never sees a typed image line,
    // because upstream's LINK text-match transformer fires on the closing `)` of
    // `[a](x.png)` first and converts it, leaving a stray `!` in front. Images
    // arrive as blocks on IMPORT, which is the path this suite covers.
    //
    // The real fix is an inline image node (LLuiDecoratorNode.isInline() is
    // hardcoded false), tracked separately — when it lands, this test's
    // expectation flips.
    const { editor } = mount([corePlugin(), imagePlugin()], '')
    for (const ch of '![a](x.png) ') {
      editor.update(
        () => {
          const root = $getRoot()
          let sel = $getSelection()
          if (!$isRangeSelection(sel)) sel = root.selectEnd()
          if ($isRangeSelection(sel)) sel.insertText(ch)
        },
        { discrete: true },
      )
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(renderedImage()).toBeNull()
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('!a ')
  })

  it('a later plugin contributing the image bridge type wins (the deep escape hatch)', async () => {
    const override: MarkdownPlugin = {
      name: 'image-override',
      nodes: [LLuiDecoratorNode],
      decorators: [
        decoratorBridge<ImageData>(IMAGE_BRIDGE_TYPE, (data) => [
          div({ 'data-scope': 'md-image', 'data-part': 'root', contenteditable: 'false' }, [
            img({
              src: data.at('src') as Signal<string>,
              alt: data.at('alt') as Signal<string>,
              'data-override': 'yes',
            }),
          ]),
        ]),
      ],
    }
    mount(
      [corePlugin(), imagePlugin({ resolveSrc: (s) => `ignored://${s}` }), override],
      '![a](attachments/a.png)',
    )
    await waitFor(() => renderedImage() !== null)
    expect(renderedImage()?.getAttribute('data-override')).toBe('yes')
    expect(renderedImage()?.getAttribute('src')).toBe('attachments/a.png')
  })

  it('keeps two mounts with different resolvers independent', async () => {
    const second = document.createElement('div')
    document.body.appendChild(second)
    mount([corePlugin(), imagePlugin({ resolveSrc: (s) => `one://${s}` })], '![a](a.png)')
    const appTwo = mountApp(
      second,
      markdownEditor({
        plugins: [corePlugin(), imagePlugin({ resolveSrc: (s) => `two://${s}` })],
        defaultValue: '![a](a.png)',
      }),
    )
    try {
      await waitFor(
        () =>
          container.querySelector('[data-scope="md-image"] img') !== null &&
          second.querySelector('[data-scope="md-image"] img') !== null,
      )
      expect(container.querySelector('[data-scope="md-image"] img')?.getAttribute('src')).toBe(
        'one://a.png',
      )
      expect(second.querySelector('[data-scope="md-image"] img')?.getAttribute('src')).toBe(
        'two://a.png',
      )
    } finally {
      appTwo.dispose()
      second.remove()
    }
  })
})
