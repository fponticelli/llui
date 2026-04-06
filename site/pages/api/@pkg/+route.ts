const PACKAGES = [
  'dom',
  'vite-plugin',
  'effects',
  'test',
  'components',
  'router',
  'transitions',
  'vike',
  'mcp',
  'lint-idiomatic',
]

export default (pageContext: { urlPathname: string }) => {
  const match = pageContext.urlPathname.match(/^\/api\/(.+?)(?:\/)?$/)
  if (!match) return false
  const pkg = match[1]
  if (!PACKAGES.includes(pkg!)) return false
  return { routeParams: { pkg } }
}
