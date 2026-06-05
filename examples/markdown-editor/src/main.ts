/**
 * LLui Markdown Editor — showcase demo.
 *
 * Every editor below is a `markdownEditor(...)` component mounted with the
 * runtime's `mountApp`. The chrome (live-markdown panel, command buttons,
 * read-only toggle, two-way source binding) is wired entirely through the
 * component's PUBLIC handle — `send` (drive TEA messages), `subscribe` (react to
 * state), `getState` — so it doubles as a demonstration of external/agent
 * control. Markdown is the only data crossing the boundary; Lexical's editor
 * state stays hidden behind the widget.
 */
import { mountApp } from '@llui/dom'
import {
  markdownEditor,
  corePlugin,
  linkPlugin,
  imagePlugin,
  hrPlugin,
  slashPlugin,
  contextMenuPlugin,
  floatingToolbarPlugin,
  emojiPlugin,
  calloutPlugin,
  type EditorState,
} from '@llui/markdown-editor'
import '@llui/markdown-editor/styles/editor.css'
import './main.css'

const WELCOME_MD = [
  '# LLui Markdown Editor',
  '',
  'A **WYSIWYG** editor that hides Markdown behind a rich widget. Type',
  '`**bold**`, `# heading`, or `- list` and watch it format live.',
  '',
  ':::tip Click this badge to cycle the callout kind — it round-trips to Markdown',
  '',
  '## Features',
  '',
  '- Inline **bold**, *italic*, ~~strike~~, and `code`',
  '- Headings, > quotes, and lists',
  '- [Links](https://github.com/fponticelli/llui)',
  '- Task lists:',
  '',
  '- [x] pluggable architecture',
  '- [ ] your custom node',
  '',
  '```ts',
  'const editor = markdownEditor({ toolbar: true })',
  '```',
  '',
  '---',
  '',
  'Pluggable to the core — links, images, dividers, emoji :rocket:, and callouts',
  'are all plugins. Type `:heart:` or `:tada:` and watch them swap. :sparkles:',
].join('\n')

const SOURCE_MD = [
  '# Two-way binding',
  '',
  'Edit *either* side — the raw Markdown and the',
  'WYSIWYG view stay in sync.',
].join('\n')

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node
}

// ── 1. Full editor + live Markdown panel + external command controls ──────────
const fullApp = mountApp(
  byId('full-editor'),
  markdownEditor({
    toolbar: true,
    plugins: [
      corePlugin(),
      linkPlugin(),
      imagePlugin(),
      hrPlugin(),
      slashPlugin(),
      contextMenuPlugin(),
      floatingToolbarPlugin(),
      emojiPlugin(),
      calloutPlugin(),
    ],
    defaultValue: WELCOME_MD,
    changeDebounceMs: 150,
  }),
)

const output = byId('markdown-output')
const stats = byId('stats')
const renderPanel = (s: EditorState): void => {
  output.textContent = s.value
  stats.textContent = `${s.wordCount} words · ${s.charCount} chars${s.dirty ? ' · edited' : ''}${s.readOnly ? ' · read-only' : ''}`
}
renderPanel(fullApp.getState() as EditorState)
fullApp.subscribe((s) => renderPanel(s as EditorState))

const controls = byId('controls')
const commandButtons: ReadonlyArray<[string, string]> = [
  ['bold', 'Bold'],
  ['italic', 'Italic'],
  ['h1', 'H1'],
  ['quote', 'Quote'],
  ['bulletList', '• List'],
  ['callout', '+ Callout'],
  ['image', 'Image'],
  ['horizontalRule', '— Divider'],
  ['undo', 'Undo'],
  ['redo', 'Redo'],
]
for (const [id, label] of commandButtons) {
  const button = el('button', { className: 'ctl', textContent: label })
  button.addEventListener('click', () => fullApp.send({ type: 'runCommand', id }))
  controls.appendChild(button)
}

let readOnly = false
const roButton = el('button', { className: 'ctl ctl-toggle', textContent: 'Read-only' })
roButton.addEventListener('click', () => {
  readOnly = !readOnly
  roButton.setAttribute('aria-pressed', String(readOnly))
  fullApp.send({ type: 'setReadOnly', readOnly })
})
controls.appendChild(roButton)

// ── 2. Minimal editor (keyboard-only, no chrome, with a placeholder) ──────────
mountApp(
  byId('minimal-editor'),
  markdownEditor({
    defaultValue: '',
    placeholder: 'Type Markdown — **bold**, # heading, - list, > quote…',
  }),
)

// ── 3. Two-way Markdown source binding (textarea ⇄ editor via the handle) ─────
const textarea = byId('source-textarea') as HTMLTextAreaElement
const sourceApp = mountApp(
  byId('source-editor'),
  markdownEditor({
    toolbar: true,
    plugins: [
      corePlugin(),
      linkPlugin(),
      imagePlugin(),
      hrPlugin(),
      slashPlugin(),
      contextMenuPlugin(),
      floatingToolbarPlugin(),
      emojiPlugin(),
      calloutPlugin(),
    ],
    defaultValue: SOURCE_MD,
    changeDebounceMs: 150,
    onChange: (md) => {
      if (textarea.value !== md) textarea.value = md
    },
  }),
)
textarea.value = (sourceApp.getState() as EditorState).value
textarea.addEventListener('input', () =>
  sourceApp.send({ type: 'setValue', value: textarea.value }),
)
