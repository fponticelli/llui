/**
 * Internal-link and anchor resolution for the docs integrity test (#269).
 *
 * Two kinds of document are checked, and they resolve links differently:
 *
 *   - SITE pages (`site/content/**`) are served by llui.dev: `/styling` is `content/styling.md`,
 *     `/api/<pkg>` is `content/api/<pkg>.md`, `/apps/<slug>/` is a built example app, and
 *     `/llms.txt` or `/r/…` are files in `site/public`.
 *   - Repo documents (every tracked `README.md`) are read on GitHub and npm: a relative link is a
 *     path in the repository.
 *
 * Both may link to `https://llui.dev/…`, which resolves exactly like a site route. Component
 * Gallery links are additionally validated against the gallery's own URL contract and the
 * product contract, so a gallery link to a renamed entry is as broken as a dead page.
 *
 * Heading ids come from the site's real pipeline (remark-gfm → rehype-slug), which is also the
 * GitHub algorithm, so an anchor that passes here resolves in both places.
 */
import { readFileSync } from 'fs'
import { dirname, posix, resolve } from 'path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import type { ProductContract } from '@llui/cli'
import {
  GALLERY_PATH_SEGMENTS,
  PUBLIC_GALLERY_BASE,
  parseGalleryQuery,
  resolveGalleryEntry,
} from '@llui/cli/gallery'

export const SITE_ORIGIN = 'https://llui.dev'

/** A minimal structural view of mdast/hast nodes — enough to walk them. */
interface TreeNode {
  type: string
  url?: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  position?: { start: { line: number } }
  children?: TreeNode[]
}

export interface DocLink {
  readonly url: string
  readonly line: number
}

function walk(node: TreeNode, visit: (node: TreeNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

const HTML_HREF = /\bhref\s*=\s*["']([^"']+)["']/g
const HTML_ID = /\b(?:id|name)\s*=\s*["']([^"']+)["']/g

/** Strip a leading YAML frontmatter block, keeping line numbers aligned. */
function withoutFrontmatter(text: string): string {
  const match = /^---\n[\s\S]*?\n---\n/.exec(text)
  return match === null ? text : match[0].replace(/[^\n]/g, '') + text.slice(match[0].length)
}

/** Every link, definition, image and raw-HTML href in a Markdown document. */
export function collectLinks(text: string): DocLink[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(withoutFrontmatter(text))
  const links: DocLink[] = []
  walk(tree as TreeNode, (node) => {
    const line = node.position?.start.line ?? 0
    if ((node.type === 'link' || node.type === 'definition' || node.type === 'image') && node.url) {
      links.push({ url: node.url, line })
    } else if (node.type === 'html' && node.value !== undefined) {
      for (const match of node.value.matchAll(HTML_HREF)) links.push({ url: match[1]!, line })
    }
  })
  return links
}

/** The heading ids the site (and GitHub) generate for a document, plus explicit HTML ids. */
export function anchorIds(text: string): Set<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
  const hast = processor.runSync(processor.parse(withoutFrontmatter(text))) as TreeNode
  const ids = new Set<string>()
  walk(hast, (node) => {
    const id = node.properties?.id
    if (typeof id === 'string') ids.add(id)
    if (node.type === 'raw' && node.value !== undefined) {
      for (const match of node.value.matchAll(HTML_ID)) ids.add(match[1]!)
    }
  })
  return ids
}

export interface LinkContext {
  readonly repoRoot: string
  /** Repo-relative paths of every tracked file (and directory prefixes are derived from it). */
  readonly tracked: ReadonlySet<string>
  /** Slugs of the example apps built under `/apps/<slug>/`. */
  readonly exampleApps: ReadonlySet<string>
  readonly contract: ProductContract
}

export interface BrokenLink {
  readonly file: string
  readonly line: number
  readonly url: string
  readonly reason: string
}

const anchorCache = new Map<string, Set<string>>()

function anchorsOf(context: LinkContext, repoPath: string): Set<string> {
  let ids = anchorCache.get(repoPath)
  if (ids === undefined) {
    ids = anchorIds(readFileSync(resolve(context.repoRoot, repoPath), 'utf-8'))
    anchorCache.set(repoPath, ids)
  }
  return ids
}

function isTrackedPath(context: LinkContext, repoPath: string): boolean {
  if (repoPath === '' || repoPath === '.') return true
  if (context.tracked.has(repoPath)) return true
  const prefix = repoPath.endsWith('/') ? repoPath : `${repoPath}/`
  for (const path of context.tracked) if (path.startsWith(prefix)) return true
  return false
}

function splitUrl(url: string): { path: string; query: string; hash: string } {
  const hashAt = url.indexOf('#')
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : decodeURIComponent(url.slice(hashAt + 1))
  const queryAt = beforeHash.indexOf('?')
  return {
    path: queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt),
    query: queryAt === -1 ? '' : beforeHash.slice(queryAt),
    hash,
  }
}

function checkAnchor(context: LinkContext, repoPath: string, hash: string): string | undefined {
  if (hash === '' || !repoPath.endsWith('.md')) return undefined
  return anchorsOf(context, repoPath).has(hash) ? undefined : `no heading #${hash} in ${repoPath}`
}

function checkGallery(context: LinkContext, rest: string, query: string): string | undefined {
  const segment = rest.replace(/\/$/, '')
  if (
    segment !== '' &&
    segment !== GALLERY_PATH_SEGMENTS.baseline &&
    segment !== GALLERY_PATH_SEGMENTS.registryTailwind
  ) {
    return `unknown gallery document "${segment}"`
  }
  const { location, issues } = parseGalleryQuery(query)
  if (issues.length > 0) return `invalid gallery query: ${issues.join('; ')}`
  if (
    location.entry !== undefined &&
    resolveGalleryEntry(context.contract, location.entry) === undefined
  ) {
    return `gallery entry "${location.entry}" is not in the product contract`
  }
  if (location.copiedArtifact !== undefined) {
    const owner = context.contract.entries.find(({ copiedArtifacts }) =>
      copiedArtifacts.some(({ name }) => name === location.copiedArtifact),
    )
    if (owner === undefined || owner.name !== location.entry) {
      return `gallery artifact "${location.copiedArtifact}" does not belong to "${location.entry}"`
    }
  }
  return undefined
}

/** Resolve a site route (`/styling#x`, `/api/dom`, `/apps/…`) — `undefined` means it resolves. */
export function checkSiteRoute(context: LinkContext, url: string): string | undefined {
  const { path, query, hash } = splitUrl(url)
  if (path.startsWith(PUBLIC_GALLERY_BASE)) {
    return checkGallery(context, path.slice(PUBLIC_GALLERY_BASE.length), query)
  }
  const app = /^\/apps\/([^/]+)\/?/.exec(path)
  if (app !== null) {
    return context.exampleApps.has(app[1]!) ? undefined : `no example app "${app[1]}"`
  }
  const route = path.replace(/\/$/, '')
  const page = route === '' ? 'index' : route.slice(1)
  const content = `site/content/${page}.md`
  if (isTrackedPath(context, content)) return checkAnchor(context, content, hash)
  const asset = `site/public/${page}`
  if (isTrackedPath(context, asset)) return undefined
  return `no site page or public file for ${path === '' ? '/' : path}`
}

/** Check one link found in `file` (repo-relative). */
export function checkLink(context: LinkContext, file: string, url: string): string | undefined {
  const isSite = file.startsWith('site/content/')
  if (url.startsWith(`${SITE_ORIGIN}/`) || url === SITE_ORIGIN) {
    return checkSiteRoute(context, url.slice(SITE_ORIGIN.length) || '/')
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return undefined // external
  if (url.startsWith('#')) return checkAnchor(context, file, decodeURIComponent(url.slice(1)))

  if (isSite) {
    if (url.startsWith('/')) return checkSiteRoute(context, url)
    return `relative link "${url}" on a site page: write a site route ("/…") instead`
  }

  const { path, hash } = splitUrl(url)
  const target = url.startsWith('/')
    ? posix.normalize(path.slice(1))
    : posix.normalize(posix.join(dirname(file), path))
  if (target.startsWith('..')) return `link escapes the repository: ${url}`
  if (!isTrackedPath(context, target)) {
    return `no tracked file or directory ${target}`
  }
  return checkAnchor(context, target, hash)
}
