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
import { resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'
import { EXAMPLES, type ExampleMeta } from './examples-data'
import { PACKAGE_SLUGS } from '../pages/api/@pkg/packages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const projectRoot = resolve(root, '..')
const examplesDir = resolve(projectRoot, 'examples')
const contentDir = resolve(root, 'content')

const REPO = 'https://github.com/fponticelli/llui'
const REPO_TREE = `${REPO}/tree/main/examples`

/**
 * README files use links relative to `examples/<slug>/` (e.g.
 * `../../packages/markdown`). Those paths 404 once the prose is served from
 * `/examples/<slug>` on the site, so rewrite every in-repo relative link to a
 * stable absolute target: a documented `packages/<pkg>` folder becomes its
 * on-site `/api/<pkg>` page; everything else becomes a GitHub `blob`/`tree` URL.
 * Links that escape the repo (or are already absolute) are left untouched.
 */
function rewriteReadmeLinks(md: string, slug: string): string {
  const exampleDir = resolve(examplesDir, slug)
  return md.replace(/\]\((\.[^)\s]*)\)/g, (whole, target: string) => {
    const hashIdx = target.indexOf('#')
    const pathPart = hashIdx >= 0 ? target.slice(0, hashIdx) : target
    const frag = hashIdx >= 0 ? target.slice(hashIdx) : ''
    const repoRel = relative(projectRoot, resolve(exampleDir, pathPart))
    if (repoRel.startsWith('..')) return whole // escapes the repo — leave as-is

    const pkgMatch = /^packages\/([^/]+)$/.exec(repoRel)
    if (pkgMatch && PACKAGE_SLUGS.includes(pkgMatch[1]!)) return `](/api/${pkgMatch[1]}${frag})`

    const kind = /\.[a-zA-Z0-9]+$/.test(repoRel) ? 'blob' : 'tree'
    return `](${REPO}/${kind}/main/${repoRel}${frag})`
  })
}

/** Read a README, drop its leading `# Title`, and fix repo-relative links. */
function readmeBody(slug: string): string {
  const raw = readFileSync(resolve(examplesDir, slug, 'README.md'), 'utf-8')
  const body = raw.replace(/^\s*#\s+.*(?:\r?\n)+/, '').trimStart()
  return rewriteReadmeLinks(body, slug)
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
