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

export function onBeforePrerenderStart() {
  return PACKAGES.map((pkg) => `/api/${pkg}`)
}
