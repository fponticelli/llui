import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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

// --- llms.txt (concise) ---

const llmsTxt = `# LLui

> A compile-time-optimized web framework built on The Elm Architecture (TEA), designed for LLM-first authoring. No virtual DOM — view() runs once at mount, builds real DOM nodes with reactive bindings. State changes drive a two-phase update with bitmask gating.

## Packages

- @llui/dom — Runtime: component, mount, scope tree, bindings, HTML/SVG/MathML element helpers
- @llui/vite-plugin — Compiler: 3-pass TypeScript transform, bitmask injection
- @llui/effects — Effect builders: http, cancel, debounce, websocket, retry, upload
- @llui/router — Routing: structured path matching, guards, history/hash mode
- @llui/transitions — Animation: transition(), fade, slide, scale, collapse, flip, spring
- @llui/components — 55 headless components + locale i18n + format utilities (Intl wrappers) + opt-in theme
- @llui/test — Test harness: testComponent, testView, propertyTest, replayTrace
- @llui/vike — Vike SSR/SSG adapter
- @llui/mcp — MCP server for LLM debug tools
- @llui/agent — LLM control surface: LAP server + browser client (observe/send_message with drain semantics)
- @llui/agent-bridge — MCP bridge CLI (llui-agent) translating Claude Desktop tool calls to LAP
- @llui/eslint-plugin — 20 anti-pattern rules

## Documentation

- Getting Started: https://llui.dev/getting-started
- Cookbook: https://llui.dev/cookbook
- Architecture: https://llui.dev/architecture
- LLM Guide: https://llui.dev/llm-guide
- Full API Reference: https://llui.dev/llms-full.txt

## Example

\`\`\`typescript
import { component, mountApp, div, button } from '@llui/dom'

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
  view: ({ send, text }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s) => String(s.count)),
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
const gettingStarted = readLocal('content/getting-started.md').replace(/^---[\s\S]*?---\n/, '')
const cookbook = readLocal('content/cookbook.md').replace(/^---[\s\S]*?---\n/, '')
const apiRef = read('docs/designs/09 API Reference.md')

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
