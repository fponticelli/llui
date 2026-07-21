// @vitest-environment jsdom
//
// The document-link search/reference panel on `wikilinkPlugin({ search })`: the
// panel opens while typing `[[query`, lists candidates (title + snippet) with a
// content-preview pane, and choosing one inserts a `[[target]]` wikilink.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical'
import { mountApp } from '@llui/dom'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { wikilinkPlugin, type DocCandidate } from '../src/plugins/wikilink.js'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let container: HTMLElement
let app: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.dispose()
  app = null
  container.remove()
})

const CANDIDATES: DocCandidate[] = [
  {
    target: 'Welcome',
    title: 'Welcome',
    snippet: 'getting started',
    preview: 'Welcome to the vault.',
  },
  { target: 'Roadmap', title: 'Roadmap', snippet: 'the plan', preview: 'Q3 roadmap and goals.' },
  { target: 'Notes', title: 'Daily Notes', snippet: 'journal', preview: 'A running journal.' },
]

async function mount(
  search?: (q: string) => readonly DocCandidate[] | Promise<readonly DocCandidate[]>,
): Promise<LexicalEditor> {
  let editor!: LexicalEditor
  app = mountApp(
    container,
    markdownEditor({
      plugins: [corePlugin(), search ? wikilinkPlugin({ search }) : wikilinkPlugin()],
      defaultValue: 'start',
      onReady: (e) => {
        editor = e
      },
    }),
  )
  await wait(0)
  return editor
}

const send = (msg: unknown): void => {
  app?.send({ type: 'plugin', name: 'wikilink', msg })
}

const panelEl = (): HTMLElement | null =>
  document.querySelector('[data-scope="md-wikilink"][data-part="panel"]')
const resultEls = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-scope="md-wikilink"][data-part="result"]'),
]
const previewText = (): string =>
  document.querySelector('[data-scope="md-wikilink"][data-part="preview"]')?.textContent ?? ''

/** Put `text` in the (only) paragraph and drop the caret at its end. Focus the
 *  editor so the mounted contenteditable retains the Lexical selection (an
 *  unfocused mounted editor reconciles the selection to null, and the plugin's
 *  update listener reads the selection to find the `[[` query). */
function setText(editor: LexicalEditor, text: string): void {
  editor.focus()
  editor.update(
    () => {
      const p = $createParagraphNode()
      p.append($createTextNode(text))
      $getRoot().clear().append(p)
      p.selectEnd()
    },
    { discrete: true },
  )
}

const bodyMarkdown = (editor: LexicalEditor): string =>
  editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((n) => n.getTextContent())
      .join('\n'),
  )

describe('document-link search panel', () => {
  it('shows results (title + snippet) and previews the active candidate', async () => {
    await mount((q) => CANDIDATES.filter((c) => c.title!.toLowerCase().includes(q.toLowerCase())))
    expect(panelEl()).toBeNull()

    send({ type: 'searchShow', query: '', items: CANDIDATES, x: 10, y: 20 })
    await wait(0)
    expect(panelEl()).not.toBeNull()
    const rows = resultEls()
    expect(rows).toHaveLength(3)
    expect(rows[0]!.textContent).toContain('Welcome')
    expect(rows[0]!.textContent).toContain('getting started')
    // Reference pane previews the first (active) candidate.
    expect(previewText()).toBe('Welcome to the vault.')
  })

  it('arrow navigation moves the active row and its preview', async () => {
    await mount(() => CANDIDATES)
    send({ type: 'searchShow', query: '', items: CANDIDATES, x: 10, y: 20 })
    await wait(0)
    send({ type: 'searchMove', delta: 1 })
    await wait(0)
    expect(resultEls()[1]!.getAttribute('data-active')).toBe('')
    expect(previewText()).toBe('Q3 roadmap and goals.')
  })

  it('choosing a candidate replaces [[query with a wikilink', async () => {
    const editor = await mount(() => CANDIDATES)
    setText(editor, 'see [[Wel')
    send({ type: 'searchShow', query: 'Wel', items: [CANDIDATES[0]!], x: 10, y: 20 })
    await wait(0)
    send({ type: 'searchChoose' })
    await wait(0)
    // The `[[Wel` typed prefix is gone; a [[Welcome]] wikilink is in its place.
    const md = bodyMarkdown(editor)
    expect(md).toContain('Welcome')
    expect(md).not.toContain('[[Wel')
    expect(panelEl()).toBeNull()
  })

  it('clicking a result inserts that document link', async () => {
    const editor = await mount(() => CANDIDATES)
    setText(editor, '[[Road')
    send({ type: 'searchShow', query: 'Road', items: CANDIDATES, x: 10, y: 20 })
    await wait(0)
    resultEls()[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await wait(0)
    expect(bodyMarkdown(editor)).toContain('Roadmap')
  })

  it('typing [[query invokes the search seam with the extracted query', async () => {
    // The register→update-listener→$readWikiQuery→debounced-search wiring. (The
    // panel then opening from the result is covered by the `searchShow` view test
    // above; a mounted jsdom editor drops its selection after the debounce, so the
    // staleness guard would suppress the emit here — a test-env limitation, not a
    // product one.)
    const queries: string[] = []
    const editor = await mount((q) => {
      queries.push(q)
      return CANDIDATES.filter((c) => c.title!.toLowerCase().includes(q.toLowerCase()))
    })
    setText(editor, '[[Road')
    await wait(200)
    expect(queries).toContain('Road')
  })

  it('a query with no `[[` open does not invoke search', async () => {
    const queries: string[] = []
    const editor = await mount((q) => {
      queries.push(q)
      return []
    })
    setText(editor, 'just prose, no link')
    await wait(200)
    expect(queries).toHaveLength(0)
  })

  it('without a search seam the panel never opens', async () => {
    const editor = await mount() // no search
    setText(editor, '[[Road')
    await wait(200)
    expect(panelEl()).toBeNull()
  })
})
