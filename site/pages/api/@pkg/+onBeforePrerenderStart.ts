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
  'agent',
  'agent-bridge',
  'eslint-plugin-llui',
]

export function onBeforePrerenderStart() {
  return PACKAGES.map((pkg) => `/api/${pkg}`)
}
