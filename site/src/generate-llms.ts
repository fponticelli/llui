import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PACKAGES } from '../pages/api/@pkg/packages.js'
import { FRAMEWORK_TAGLINE } from './framework-meta.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const publicDir = resolve(root, 'public')
const projectRoot = resolve(root, '..')

// Read a REQUIRED source file. A missing input here means the generated
// llms-full.txt would silently ship with a hole (empty system prompt / missing
// guide), so fail loudly instead of returning ''.
function read(path: string): string {
  try {
    return readFileSync(resolve(projectRoot, path), 'utf-8')
  } catch {
    throw new Error(`generate-llms: required source file not found: ${path}`)
  }
}

function readLocal(path: string): string {
  try {
    return readFileSync(resolve(root, path), 'utf-8')
  } catch {
    throw new Error(`generate-llms: required site file not found: ${path}`)
  }
}

// Strip a leading YAML frontmatter block (`---\n…\n---\n`).
const stripFrontmatter = (md: string): string => md.replace(/^---[\s\S]*?---\n/, '')

// --- llms.txt (concise) ---

// Build the package list from the canonical registry (PACKAGES) + each package's
// REAL npm `name` and `description` from its package.json — so the list can never
// drift from what actually ships (the hand-maintained version named the wrong npm
// name for the bridge and omitted packages). `agent-bridge` is the slug; its npm
// name is `llui-agent`, which this picks up automatically.
const packageList = PACKAGES.map(({ slug }) => {
  const pkg = JSON.parse(read(`packages/${slug}/package.json`)) as {
    name: string
    description?: string
  }
  const desc = (pkg.description ?? '').trim()
  return `- ${pkg.name}${desc ? ` — ${desc}` : ''}`
}).join('\n')

const llmsTxt = `# LLui

> ${FRAMEWORK_TAGLINE}

## Packages

${packageList}

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
  // `readLocal` throws if the seed page is missing — every registry package MUST
  // have one (generate-api.ts enforces the same invariant), so a hole here is a
  // hard error rather than a silently-omitted section.
  const md = readLocal(`content/api/${slug}.md`)
  // Drop frontmatter and the auto-api injection markers (HTML comments).
  return stripFrontmatter(md)
    .replace(/<!-- auto-api:(?:start|end) -->\n?/g, '')
    .trim()
}).join('\n\n---\n\n')

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
