const PACKAGES = [
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
]

export function onBeforePrerenderStart() {
  return PACKAGES.map((pkg) => `/api/${pkg}`)
}
