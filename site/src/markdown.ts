import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import matter from 'gray-matter'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { createHighlighter } from 'shiki'

// Use process.cwd() — Vike runs from the project root both in dev and prerender
const contentDir = resolve(process.cwd(), 'content')

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['typescript', 'bash', 'html', 'css', 'json', 'yaml', 'markdown'],
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

  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content)

  // Apply syntax highlighting to code blocks
  let html = String(result)
  html = html.replace(
    /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang: string, code: string) => {
      const decoded = code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
      try {
        return highlighter.codeToHtml(decoded, {
          lang,
          themes: { dark: 'github-dark', light: 'github-light' },
        })
      } catch {
        return `<pre><code class="language-${lang}">${code}</code></pre>`
      }
    },
  )

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
