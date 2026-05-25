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
  'devmode-annotate',
]

export default (pageContext: { urlPathname: string }) => {
  const match = pageContext.urlPathname.match(/^\/api\/(.+?)(?:\/)?$/)
  if (!match) return false
  const pkg = match[1]
  if (!PACKAGES.includes(pkg!)) return false
  return { routeParams: { pkg } }
}
