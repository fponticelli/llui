/**
 * Generate the Examples section of the site from `examples/<slug>/README.md`.
 *
 * Produces:
 *  - `content/examples.md`          — the index page (a card grid)
 *  - `content/examples/<slug>.md`   — one page per example: a live <iframe>
 *                                     embed of the app plus the README prose
 *
 * The live apps themselves are built + copied separately by `build-examples.ts`.
 * Run as part of the build: `tsx src/generate-examples.ts`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { EXAMPLES, type ExampleMeta } from './examples-data'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const projectRoot = resolve(root, '..')
const examplesDir = resolve(projectRoot, 'examples')
const contentDir = resolve(root, 'content')

const REPO_TREE = 'https://github.com/fponticelli/llui/tree/main/examples'

/** Read a README and drop its leading `# Title` (the page renders a title itself). */
function readmeBody(slug: string): string {
  const raw = readFileSync(resolve(examplesDir, slug, 'README.md'), 'utf-8')
  return raw.replace(/^\s*#\s+.*(?:\r?\n)+/, '').trimStart()
}

/** A framed, lazy-loaded iframe embed of the live app at `/apps/<slug>/`. */
function embed(ex: ExampleMeta): string {
  const src = `/apps/${ex.slug}/`
  const title = `${ex.title} — live demo`
  return [
    `<div class="example-embed">`,
    `  <div class="example-embed-bar">`,
    `    <span class="example-embed-dots"><i></i><i></i><i></i></span>`,
    `    <span class="example-embed-url">${src}</span>`,
    `    <a class="example-embed-open" href="${src}" target="_blank" rel="noopener">Open ↗</a>`,
    `  </div>`,
    `  <iframe class="example-embed-frame" src="${src}" title="${title}" loading="lazy"></iframe>`,
    `</div>`,
  ].join('\n')
}

function examplePage(ex: ExampleMeta): string {
  const frontmatter = `---\ntitle: ${JSON.stringify(ex.title)}\ndescription: ${JSON.stringify(
    ex.blurb,
  )}\n---`
  const sourceLink = `<p class="example-source"><a href="${REPO_TREE}/${ex.slug}" target="_blank" rel="noopener">View source on GitHub ↗</a></p>`
  return `${frontmatter}\n\n${embed(ex)}\n\n${sourceLink}\n\n${readmeBody(ex.slug)}\n`
}

function indexPage(): string {
  const cards = EXAMPLES.map(
    (ex) =>
      `  <a class="example-card" href="/examples/${ex.slug}">\n` +
      `    <h3>${ex.title}</h3>\n` +
      `    <p>${ex.blurb}</p>\n` +
      `  </a>`,
  ).join('\n')
  return `---
title: Examples
description: "Live, runnable LLui example apps — each one embedded and described."
---

Every example below is a real LLui app, built from source and embedded live. Open one to see it running, read what it demonstrates, and jump to its source on GitHub.

<div class="example-grid">
${cards}
</div>
`
}

// Per-example pages
mkdirSync(resolve(contentDir, 'examples'), { recursive: true })
for (const ex of EXAMPLES) {
  writeFileSync(resolve(contentDir, 'examples', `${ex.slug}.md`), examplePage(ex))
}

// Index page
writeFileSync(resolve(contentDir, 'examples.md'), indexPage())

console.log(`Generated examples.md + ${EXAMPLES.length} example pages`)
