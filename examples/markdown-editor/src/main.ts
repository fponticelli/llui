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
  blockDragPlugin,
  wikilinkPlugin,
  mathPlugin,
  mermaidPlugin,
  tablePlugin,
  mentionPlugin,
  emojiPlugin,
  calloutPlugin,
  singleBlockPlugin,
  type DocCandidate,
  type EditorState,
} from '@llui/markdown-editor'
import '@llui/markdown-editor/styles/editor.css'
import '@llui/markdown-editor/styles/block-drag.css'
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
  '',
  'Type `/` for the command menu, `@` to mention someone, select text for the',
  'bubble bar, or right-click for the context menu.',
  '',
  '$$E = mc^2$$',
  '',
  '```mermaid',
  'graph TD',
  '  A[Plugin] --> B[state slice]',
  '  A --> C[view]',
  '```',
  '',
  '| Plugin | Kind |',
  '| --- | --- |',
  '| slash / mention | typeahead |',
  '| callout / math / table | decorator |',
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
      mermaidPlugin(),
      tablePlugin(),
      corePlugin(),
      linkPlugin({
        onFollow: (url) => {
          // eslint-disable-next-line no-console
          console.log('[link] follow →', url)
        },
      }),
      imagePlugin(),
      hrPlugin(),
      slashPlugin(),
      contextMenuPlugin(),
      floatingToolbarPlugin(),
      blockDragPlugin(),
      wikilinkPlugin({
        onNavigate: (link) => {
          // eslint-disable-next-line no-console
          console.log('[wikilink] navigate →', link.target)
        },
        search: (query: string): DocCandidate[] => {
          const docs: DocCandidate[] = [
            {
              target: 'Getting Started',
              title: 'Getting Started',
              snippet: 'intro',
              preview: 'How to get going with LLui.',
            },
            {
              target: 'Roadmap',
              title: 'Roadmap',
              snippet: 'plan',
              preview: 'Q3 goals and milestones.',
            },
            {
              target: 'Architecture',
              title: 'Architecture',
              snippet: 'design',
              preview: 'The signal runtime and reconciler.',
            },
            {
              target: 'Cookbook',
              title: 'Cookbook',
              snippet: 'recipes',
              preview: 'Common patterns and how-tos.',
            },
          ]
          const q = query.trim().toLowerCase()
          return q.length === 0 ? docs : docs.filter((d) => d.title!.toLowerCase().includes(q))
        },
      }),
      mathPlugin(),
      mentionPlugin(),
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
  stats.textContent = `${s.wordCount} words · ${s.charCount} chars${s.dirty ? ' · edited' : ''}${s.readonly ? ' · read-only' : ''}`
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

let readonly = false
const roButton = el('button', { className: 'ctl ctl-toggle', textContent: 'Read-only' })
roButton.addEventListener('click', () => {
  readonly = !readonly
  roButton.setAttribute('aria-pressed', String(readonly))
  fullApp.send({ type: 'setReadOnly', readonly })
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

// ── 3. Single block (inline-only) — a title field and a comment box ───────────
// `singleBlockPlugin()` replaces the default plugin set: one paragraph, inline
// styles only. Block Markdown stays literal and pasted blocks collapse to a line.
const titleApp = mountApp(
  byId('single-title'),
  markdownEditor({
    toolbar: true,
    plugins: [singleBlockPlugin()],
    defaultValue: 'A **bold** title — try pressing Enter or pasting a heading',
    changeDebounceMs: 100,
  }),
)
const titleOut = byId('single-title-out')
const renderTitle = (s: EditorState): void => {
  titleOut.textContent = s.value
}
renderTitle(titleApp.getState() as EditorState)
titleApp.subscribe((s) => renderTitle(s as EditorState))

const commentApp = mountApp(
  byId('single-comment'),
  markdownEditor({
    toolbar: true,
    // allowLineBreaks → Enter inserts a soft break (never a new paragraph);
    // link:true registers the link node/transformer, linkPlugin() adds the dialog.
    plugins: [singleBlockPlugin({ allowLineBreaks: true, link: true }), linkPlugin()],
    defaultValue: 'Inline only — **bold**, *italic*, `code`, and [links](https://llui.dev).',
    changeDebounceMs: 100,
  }),
)
const commentOut = byId('single-comment-out')
const renderComment = (s: EditorState): void => {
  commentOut.textContent = s.value
}
renderComment(commentApp.getState() as EditorState)
commentApp.subscribe((s) => renderComment(s as EditorState))

// ── 4. Two-way Markdown source binding (textarea ⇄ editor via the handle) ─────
const textarea = byId('source-textarea') as HTMLTextAreaElement
const sourceApp = mountApp(
  byId('source-editor'),
  markdownEditor({
    toolbar: true,
    plugins: [
      mermaidPlugin(),
      tablePlugin(),
      corePlugin(),
      linkPlugin(),
      imagePlugin(),
      hrPlugin(),
      slashPlugin(),
      contextMenuPlugin(),
      floatingToolbarPlugin(),
      mathPlugin(),
      mentionPlugin(),
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
