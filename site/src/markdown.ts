import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeShikiFromHighlighter from '@shikijs/rehype/core'
import matter from 'gray-matter'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { createHighlighter, type Highlighter } from 'shiki'

// Use process.cwd() — Vike runs from the project root both in dev and prerender
const contentDir = resolve(process.cwd(), 'content')

let highlighterPromise: Promise<Highlighter> | null = null

// Languages that actually appear in `content/**` fenced blocks (plus a few
// obvious extras). `ts`/`js`/`sh` are auto-registered aliases of the base
// grammars; anything not listed falls back to `text` via the rehype plugin.
const LANGS = [
  'typescript',
  'javascript',
  'bash',
  'json',
  'jsonc',
  'toml',
  'html',
  'css',
  'yaml',
  'markdown',
]

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: LANGS,
    })
  }
  return highlighterPromise
}

export interface DocData {
  title: string
  description: string
  html: string
  slug: string
  section?: string
  order?: number
}

export async function loadDoc(slug: string): Promise<DocData> {
  const filePath = resolve(contentDir, `${slug}.md`)
  const raw = readFileSync(filePath, 'utf-8')
  const { data: meta, content } = matter(raw)

  const highlighter = await getHighlighter()

  // A single unified pipeline. Syntax highlighting runs at the HAST level via
  // `@shikijs/rehype` (Shiki tokenizes the code node's real text — no hand-rolled
  // entity decoding, so a literal `&lt;` / `&amp;lt;` in a code block survives
  // intact). `rehype-slug` gives every heading a stable id, and
  // `rehype-autolink-headings` wraps the heading text in a self-link so in-page
  // `#anchor` links resolve.
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, { behavior: 'wrap' })
    .use(rehypeShikiFromHighlighter, highlighter, {
      themes: { dark: 'github-dark', light: 'github-light' },
      defaultColor: false,
      fallbackLanguage: 'text',
    })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content)

  let html = String(result)

  // Strip the first <h1> from the HTML — the component renders the title
  // separately. `rehype-autolink-headings` may have wrapped it in an <a>, so the
  // match tolerates arbitrary inner markup.
  html = html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/, '')

  return {
    title: (meta.title as string) ?? slug,
    description: (meta.description as string) ?? '',
    html,
    slug,
    section: meta.section as string | undefined,
    order: meta.order as number | undefined,
  }
}

export function listDocs(subdir?: string): string[] {
  const dir = subdir ? resolve(contentDir, subdir) : contentDir
  return readdirSync(dir)
    .filter((f: string) => f.endsWith('.md'))
    .map((f: string) => f.replace('.md', ''))
}
