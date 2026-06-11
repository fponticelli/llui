import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PACKAGES } from '../pages/api/@pkg/packages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const publicDir = resolve(root, 'public')
const projectRoot = resolve(root, '..')

// Read source content
function read(path: string): string {
  try {
    return readFileSync(resolve(projectRoot, path), 'utf-8')
  } catch {
    return ''
  }
}

function readLocal(path: string): string {
  try {
    return readFileSync(resolve(root, path), 'utf-8')
  } catch {
    return ''
  }
}

// Strip a leading YAML frontmatter block (`---\n…\n---\n`).
const stripFrontmatter = (md: string): string => md.replace(/^---[\s\S]*?---\n/, '')

// --- llms.txt (concise) ---

const llmsTxt = `# LLui

> A compile-time-optimized web framework built on The Elm Architecture (TEA), designed for LLM-first authoring. No virtual DOM — view() runs once at mount, builds real DOM nodes with reactive bindings. State changes drive a two-phase update with bitmask gating.

## Packages

- @llui/dom — Runtime: component, mount, scope tree, bindings, HTML/SVG/MathML element helpers
- @llui/compiler — Engine: 3-pass TypeScript transform + 41 compile-time lint rules (all error severity)
- @llui/vite-plugin — Vite adapter: wires the compiler into Vite, surfaces diagnostics via this.error()
- @llui/compiler-introspection — Opt-in: agent schemas, msg annotations, schema hash emission
- @llui/compiler-devtools — Opt-in: __componentMeta emission for source navigation
- @llui/compiler-ssr — Opt-in: 'use client' directive handling and SSR emission
- @llui/effects — Effect builders: http, cancel, debounce, websocket, retry, upload
- @llui/router — Routing: structured path matching, guards, history/hash mode
- @llui/transitions — Animation: transition(), fade, slide, scale, collapse, flip, spring
- @llui/components — 58 headless components + locale i18n + format utilities (Intl wrappers) + opt-in theme
- @llui/test — Test harness: testComponent, testView, propertyTest, replayTrace
- @llui/vike — Vike SSR/SSG adapter
- @llui/mcp — MCP server for LLM debug tools
- @llui/agent — LLM control surface: LAP server + browser client (observe/send_message with drain semantics)
- @llui/agent-bridge — MCP bridge CLI (llui-agent) translating Claude Desktop tool calls to LAP
- @llui/devmode-annotate — Dev-only HUD: annotate the running app into a shared on-disk notebook the LLM reads/writes
- @llui/markdown — Reactive Markdown rendering: markdown() parses to mdast and builds live reactive DOM (no HTML string), per-node renderer overrides, streaming-friendly keyed blocks
- @llui/lexical — Low-level Lexical ↔ signal-runtime binding: lexicalForeign seam, plugin contract, DecoratorNode ↔ LLui sub-view bridge
- @llui/lexical-collab — Opt-in collaborative editing: yjsCollab over an injected Yjs provider (CRDT sync, scoped undo, presence cursors)
- @llui/markdown-editor — WYSIWYG Markdown editor: markdownEditor() component, transformer registry, GFM/callout plugins, toolbar surface

## Documentation

- Getting Started: https://llui.dev/getting-started
- Cookbook: https://llui.dev/cookbook
- Architecture: https://llui.dev/architecture
- Debugging: https://llui.dev/debugging
- Agents: https://llui.dev/agents
- Full API Reference: https://llui.dev/llms-full.txt

## Example

\`\`\`typescript
import { component, mountApp, div, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc': return [{ ...state, count: state.count + 1 }, []]
      case 'dec': return [{ ...state, count: state.count - 1 }, []]
    }
  },
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.map((s) => String(s.count))),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
  ],
})

mountApp(document.getElementById('app')!, Counter)
\`\`\`
`

writeFileSync(resolve(publicDir, 'llms.txt'), llmsTxt)
console.log('Generated llms.txt')

// --- llms-full.txt (comprehensive) ---

const systemPrompt = read('evaluation/prompts/system-prompt.md')
const gettingStarted = stripFrontmatter(readLocal('content/getting-started.md'))
const cookbook = stripFrontmatter(readLocal('content/cookbook.md'))

// Build the API reference by concatenating the per-package pages produced by
// generate-api.ts (which runs immediately before this script). PACKAGES is the
// same canonical list that drives the `/api/<pkg>` routes, so the full reference
// always covers exactly the published pages — in the same order. (The legacy
// hand-written `docs/designs/09 API Reference.md` was removed with the
// pre-signal design docs, which previously left this section empty.)
const apiRef = PACKAGES.map(({ slug }) => {
  const md = readLocal(`content/api/${slug}.md`)
  if (!md) {
    console.warn(`  ⚠ no content/api/${slug}.md — omitted from llms-full.txt`)
    return ''
  }
  // Drop frontmatter and the auto-api injection markers (HTML comments).
  return stripFrontmatter(md)
    .replace(/<!-- auto-api:(?:start|end) -->\n?/g, '')
    .trim()
})
  .filter(Boolean)
  .join('\n\n---\n\n')

const llmsFullTxt = `# LLui — Complete LLM Reference

This document is the comprehensive reference for the LLui web framework, intended for LLMs generating LLui code. It contains the system prompt, getting started guide, cookbook, and full API reference.

---

## Part 1: System Prompt

${systemPrompt}

---

## Part 2: Getting Started

${gettingStarted}

---

## Part 3: Cookbook

${cookbook}

---

## Part 4: API Reference

${apiRef}
`

writeFileSync(resolve(publicDir, 'llms-full.txt'), llmsFullTxt)
console.log('Generated llms-full.txt')
