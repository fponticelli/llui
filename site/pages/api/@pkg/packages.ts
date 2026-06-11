// Single source of truth for which `/api/<pkg>` pages exist AND how they are
// presented. Consumed by the route guard (+route.ts), the prerender enumerator
// (+onBeforePrerenderStart.ts), the llms.txt generator (src/generate-llms.ts),
// and the sidebar nav (src/components/site-layout.ts) so all four can never
// drift apart — a new package added here gets its route, its place in the LLM
// reference, and its sidebar link automatically.

export type PackageCategory = 'core' | 'compiler' | 'libraries' | 'ai' | 'rich-text'

export interface PackageMeta {
  /** Route segment (`/api/<slug>`) and the part after the `@llui/` scope. */
  slug: string
  /** Family used to group + color-accent the sidebar nav. */
  category: PackageCategory
  /** One-line description shown under the name in the sidebar. */
  blurb: string
}

/** Display order + label for each family in the sidebar (and grouping order). */
export const PACKAGE_CATEGORIES: { id: PackageCategory; label: string }[] = [
  { id: 'core', label: 'Core' },
  { id: 'compiler', label: 'Compiler add-ons' },
  { id: 'libraries', label: 'Libraries' },
  { id: 'ai', label: 'AI & Agents' },
  { id: 'rich-text', label: 'Rich text' },
]

// Ordered by category (matching PACKAGE_CATEGORIES) so the generated llms.txt
// reference and the prerendered routes read in the same grouped order as the nav.
export const PACKAGES: PackageMeta[] = [
  {
    slug: 'dom',
    category: 'core',
    blurb: 'Runtime — components, scopes, bindings, element & structural helpers',
  },
  { slug: 'compiler', category: 'core', blurb: 'Signal transform + compile-time lint rules' },
  { slug: 'vite-plugin', category: 'core', blurb: 'Wires the compiler into Vite' },
  {
    slug: 'compiler-introspection',
    category: 'compiler',
    blurb: 'Opt-in — agent schemas & msg annotations',
  },
  {
    slug: 'compiler-devtools',
    category: 'compiler',
    blurb: 'Opt-in — __componentMeta for source navigation',
  },
  {
    slug: 'compiler-ssr',
    category: 'compiler',
    blurb: "Opt-in — 'use client' directive handling",
  },
  {
    slug: 'effects',
    category: 'libraries',
    blurb: 'http, debounce, race, websocket, retry, upload',
  },
  { slug: 'components', category: 'libraries', blurb: '58 headless components + opt-in theme' },
  { slug: 'router', category: 'libraries', blurb: 'Path matching, history/hash, guards, links' },
  {
    slug: 'transitions',
    category: 'libraries',
    blurb: 'fade, slide, scale, collapse, flip, spring',
  },
  { slug: 'test', category: 'libraries', blurb: 'testComponent, propertyTest, replayTrace' },
  { slug: 'vike', category: 'libraries', blurb: 'Vike SSR/SSG adapter' },
  { slug: 'mcp', category: 'ai', blurb: 'MCP server — LLM debug tools' },
  { slug: 'agent', category: 'ai', blurb: 'LLM control surface — LAP server + client' },
  { slug: 'agent-bridge', category: 'ai', blurb: 'MCP bridge CLI for Claude Desktop' },
  {
    slug: 'devmode-annotate',
    category: 'ai',
    blurb: 'Dev HUD — annotate into a shared notebook',
  },
  {
    slug: 'markdown',
    category: 'rich-text',
    blurb: 'Reactive markdown() — live DOM, streaming',
  },
  {
    slug: 'markdown-editor',
    category: 'rich-text',
    blurb: 'WYSIWYG editor — toolbar, GFM, callouts',
  },
  {
    slug: 'lexical',
    category: 'rich-text',
    blurb: 'Low-level Lexical ↔ signal-runtime binding',
  },
  { slug: 'lexical-collab', category: 'rich-text', blurb: 'Opt-in collab — yjsCollab over Yjs' },
]

/** Just the route slugs — convenience for membership/enumeration checks. */
export const PACKAGE_SLUGS: string[] = PACKAGES.map((p) => p.slug)
