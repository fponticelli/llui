// Single source of truth for which `/api/<pkg>` pages exist. Consumed by the
// route guard (+route.ts) and the prerender enumerator
// (+onBeforePrerenderStart.ts) so the two can never drift apart.
export const PACKAGES = [
  'dom',
  'compiler',
  'vite-plugin',
  'compiler-introspection',
  'compiler-devtools',
  'compiler-ssr',
  'effects',
  'test',
  'components',
  'router',
  'transitions',
  'vike',
  'mcp',
  'agent',
  'agent-bridge',
  'devmode-annotate',
  'lexical',
  'markdown-editor',
]
