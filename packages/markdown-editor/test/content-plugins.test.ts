import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { waitFor } from './wait-for'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $getRoot, type LexicalEditor } from 'lexical'
import { LLuiDecoratorNode } from '@llui/lexical'
import { mountApp } from '@llui/dom'
import { corePlugin } from '../src/plugins/core.js'
import { hrPlugin } from '../src/plugins/hr.js'
import { emojiPlugin } from '../src/plugins/emoji.js'
import { imagePlugin } from '../src/plugins/image.js'
import { mathPlugin } from '../src/plugins/math.js'
import { mermaidPlugin } from '../src/plugins/mermaid.js'
import { tablePlugin } from '../src/plugins/table.js'
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { markdownEditor } from '../src/editor.js'

const transformers = buildTransformers([
  corePlugin(),
  hrPlugin(),
  imagePlugin(),
  mathPlugin(),
  emojiPlugin(),
])
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function convert(markdown: string): string {
  const editor = createHeadlessEditor({
    namespace: 'content-rt',
    nodes: [...GFM_NODES, LLuiDecoratorNode],
    onError: (e) => {
      throw e
    },
  })
  let out = ''
  editor.update(() => $convertFromMarkdownString(markdown, transformers), { discrete: true })
  editor.getEditorState().read(() => {
    out = $convertToMarkdownString(transformers)
  })
  return out
}

describe('content plugins — markdown round-trip', () => {
  it('horizontal rule round-trips to ---', () => {
    expect(convert('---')).toBe('---')
    // `***` / `___` normalize to `---`
    expect(convert('***')).toBe('---')
  })

  it('image round-trips to ![alt](src)', () => {
    expect(convert('![a cat](https://img/cat.png)')).toBe('![a cat](https://img/cat.png)')
    expect(convert('![](https://img/x.png)')).toBe('![](https://img/x.png)')
  })

  it('emoji shortcodes import to the emoji character', () => {
    expect(convert(':smile:')).toContain('😄')
    expect(convert('ship it :rocket:')).toContain('🚀')
  })

  it('an unknown shortcode is left untouched', () => {
    expect(convert(':nope:')).toContain(':nope:')
  })

  it('a divider survives amid other blocks', () => {
    const doc = ['# Title', '', '---', '', 'After'].join('\n')
    expect(convert(doc)).toBe(doc)
  })

  it('math block round-trips to $$tex$$', () => {
    expect(convert('$$e = mc^2$$')).toBe('$$e = mc^2$$')
    expect(convert('$$\\int_0^1 x\\,dx$$')).toBe('$$\\int_0^1 x\\,dx$$')
  })

  it('mermaid fence round-trips (ordered before the code-block transformer)', () => {
    // mermaidPlugin BEFORE corePlugin so its multiline transformer wins over CODE.
    const t = buildTransformers([mermaidPlugin(), corePlugin()])
    const editor = createHeadlessEditor({
      namespace: 'mer',
      nodes: [...GFM_NODES, LLuiDecoratorNode],
      onError: (e) => {
        throw e
      },
    })
    const md = '```mermaid\ngraph TD\n  A --> B\n```'
    let out = ''
    editor.update(() => $convertFromMarkdownString(md, t), { discrete: true })
    editor.getEditorState().read(() => {
      out = $convertToMarkdownString(t)
    })
    expect(out).toBe(md)
  })

  it('GFM table round-trips', () => {
    const t = buildTransformers([tablePlugin(), corePlugin()])
    const editor = createHeadlessEditor({
      namespace: 'tbl',
      nodes: [...GFM_NODES, TableNode, TableRowNode, TableCellNode],
      onError: (e) => {
        throw e
      },
    })
    const md = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n')
    let out = ''
    editor.update(() => $convertFromMarkdownString(md, t), { discrete: true })
    editor.getEditorState().read(() => {
      out = $convertToMarkdownString(t)
    })
    expect(out).toBe(md)
  })

  it('round-trips a table cell that contains an escaped pipe', () => {
    const t = buildTransformers([tablePlugin(), corePlugin()])
    const editor = createHeadlessEditor({
      namespace: 'tbl-pipe',
      nodes: [...GFM_NODES, TableNode, TableRowNode, TableCellNode],
      onError: (e) => {
        throw e
      },
    })
    // `a \| b` is ONE cell whose text is `a | b`; the escaped pipe must not split
    // it into two cells (which corrupted the round-trip before the splitRow fix).
    const md = ['| A | B |', '| --- | --- |', '| a \\| b | c |'].join('\n')
    let out = ''
    let cellCount = 0
    editor.update(() => $convertFromMarkdownString(md, t), { discrete: true })
    editor.getEditorState().read(() => {
      out = $convertToMarkdownString(t)
      const table = $getRoot().getChildren()[0]
      const bodyRow = (table as TableNode).getChildren()[1]
      cellCount = (bodyRow as TableRowNode).getChildren().length
    })
    expect(cellCount).toBe(2) // two cells, not three
    expect(out).toBe(md)
  })
})

describe('image plugin (jsdom)', () => {
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

  it('inserts an image through its dialog (state → DOM + markdown)', async () => {
    let editor!: LexicalEditor
    const changes: string[] = []
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), imagePlugin()],
        defaultValue: 'intro',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
        onChange: (md) => changes.push(md),
      }),
    )
    editor.update(() => $getRoot().selectEnd(), { discrete: true })
    app.send({ type: 'runCommand', id: 'image' })
    await wait(0)
    expect(document.querySelector('[data-md-link="box"]')).not.toBeNull()

    app.send({ type: 'plugin', name: 'image', msg: { type: 'setSrc', src: 'https://img/p.png' } })
    app.send({ type: 'plugin', name: 'image', msg: { type: 'setAlt', alt: 'pic' } })
    app.send({ type: 'plugin', name: 'image', msg: { type: 'submit' } })
    // wait for the debounced onChange itself, not a fixed delay (load-proof)
    await waitFor(() => changes.some((m) => m.includes('![pic](https://img/p.png)')))

    const image = container.querySelector('[data-scope="md-image"] img') as HTMLImageElement | null
    expect(image).not.toBeNull()
    expect(image?.getAttribute('src')).toBe('https://img/p.png')
    expect(changes.at(-1)).toContain('![pic](https://img/p.png)')
  })
})
