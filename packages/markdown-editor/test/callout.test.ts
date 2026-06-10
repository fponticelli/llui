import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { waitFor } from './wait-for'
import { createHeadlessEditor } from '@lexical/headless'
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { $getRoot, type LexicalEditor } from 'lexical'
import { LLuiDecoratorNode } from '@llui/lexical'
import { mountApp } from '@llui/dom'
import { corePlugin } from '../src/plugins/core.js'
import { calloutPlugin } from '../src/plugins/callout.js'
import { buildTransformers } from '../src/transformers/registry.js'
import { GFM_NODES } from '../src/transformers/gfm.js'
import { markdownEditor } from '../src/editor.js'

const transformers = buildTransformers([corePlugin(), calloutPlugin()])
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function roundtrip(markdown: string): string {
  const editor = createHeadlessEditor({
    namespace: 'callout-rt',
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

describe('callout markdown round-trip', () => {
  it('round-trips a note callout', () => {
    expect(roundtrip(':::note Be careful here')).toBe(':::note Be careful here')
  })

  it('round-trips each kind', () => {
    for (const kind of ['note', 'tip', 'warning', 'danger']) {
      expect(roundtrip(`:::${kind} Something`)).toBe(`:::${kind} Something`)
    }
  })

  it('round-trips a callout amid other blocks', () => {
    const doc = ['# Title', '', ':::warning Watch out', '', 'A paragraph.'].join('\n')
    expect(roundtrip(doc)).toBe(doc)
  })
})

describe('callout decorator (jsdom)', () => {
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

  it('renders a callout present in the seed document', async () => {
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), calloutPlugin()],
        defaultValue: ':::warning Seeded admonition',
      }),
    )
    await wait(0)
    const callout = container.querySelector('[data-scope="md-callout"]')
    expect(callout).not.toBeNull()
    expect(callout?.getAttribute('data-kind')).toBe('warning')
    expect(callout?.textContent).toContain('Seeded admonition')
  })

  it('inserts a callout and cycles its kind, reflecting into markdown', async () => {
    let editor!: LexicalEditor
    const changes: string[] = []
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), calloutPlugin()],
        defaultValue: 'intro',
        changeDebounceMs: 5,
        onReady: (e) => {
          editor = e
        },
        onChange: (md) => changes.push(md),
      }),
    )
    // Place a selection, then insert via the command intent.
    editor.update(
      () => {
        $getRoot().selectEnd()
      },
      { discrete: true },
    )
    app.send({ type: 'runCommand', id: 'callout' })
    // Wait for the CONDITIONS (DOM + debounced onChange), not a fixed delay —
    // a fixed wait races the debounce timer under parallel-suite CPU load.
    await waitFor(() => container.querySelector('[data-scope="md-callout"]') !== null)
    await waitFor(() => changes.some((m) => m.includes(':::note New callout')))

    const callout = container.querySelector('[data-scope="md-callout"]')
    expect(callout?.getAttribute('data-kind')).toBe('note')
    expect(container.querySelector('[data-part="badge"]')?.textContent).toBe('Note')
    expect(changes.at(-1)).toContain(':::note New callout')

    // Clicking the badge cycles the kind and updates the markdown.
    const badge = container.querySelector<HTMLButtonElement>('[data-part="badge"]')!
    badge.click()
    await waitFor(() => changes.some((m) => m.includes(':::tip New callout')))
    const cycledCallout = container.querySelector('[data-scope="md-callout"]')
    expect(cycledCallout?.getAttribute('data-kind')).toBe('tip')
    expect(changes.at(-1)).toContain(':::tip New callout')
  })
})
