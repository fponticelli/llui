import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { ViteDevServer } from 'vite'
import type { LlmPreset, LlmRouterConfig } from './notes/router.js'
import type { AgentPluginConfig } from './plugin-options.js'
import type { AgentServerInstance } from './shared-state.js'

/** Locate the workspace root shared with @llui/mcp. */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start)
  let lastPackageJson: string | null = null
  while (true) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    if (existsSync(resolve(dir, '.git'))) return dir
    if (existsSync(resolve(dir, 'package.json'))) lastPackageJson = dir
    const parent = dirname(dir)
    if (parent === dir) return lastPackageJson ?? start
    dir = parent
  }
}

/** Directory holding the MCP handshake marker. */
export function mcpStateDir(start: string = process.cwd()): string {
  const override = process.env['LLUI_MCP_STATE_DIR']
  if (override) return resolve(override)
  return resolve(findWorkspaceRoot(start), 'node_modules/.cache/llui-mcp')
}

export function hasMcpPackage(root: string): boolean {
  try {
    createRequire(resolve(root, 'package.json')).resolve('@llui/mcp/package.json')
    return true
  } catch {
    return false
  }
}

function resolvePackageImportEntry(root: string, packageName: string): string | null {
  let dir = resolve(root)
  for (;;) {
    const pkgDir = resolve(dir, 'node_modules', ...packageName.split('/'))
    const pkgJsonPath = resolve(pkgDir, 'package.json')
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
          exports?: { '.'?: { import?: string } }
        }
        const entry = pkg.exports?.['.']?.import
        return entry ? resolve(pkgDir, entry) : null
      } catch {
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function resolveDevmodeAnnotateEntry(root: string): string | null {
  return resolvePackageImportEntry(root, '@llui/devmode-annotate')
}

export function resolveDevmodeAnnotateEditorEntry(root: string): string | null {
  return resolvePackageImportEntry(root, '@llui/devmode-annotate-editor')
}

/**
 * Normalize the user's `router` setting into the public `LlmRouterConfig`
 * shape (or null when disabled). Accepts `false`, a preset string, or
 * a full config object. Used in `configResolved` so the rest of the
 * plugin (router startup + HUD bootstrap) sees one canonical shape.
 *
 * OPT-IN by default: an unset `router` resolves to `null` (disabled). The
 * attention router auto-spawns an LLM CLI (with tool access) in the project
 * root, so it must never turn on implicitly — a forgeable same-origin/loopback
 * task note reaching a default-on router is a local-RCE path. Enabling it
 * requires an explicit `router: 'claude'` (or a full config object).
 */
export function resolveRouterInput(
  router: false | LlmPreset | LlmRouterConfig | undefined,
  legacyTimeoutMs: number | undefined,
): LlmRouterConfig | null {
  if (router === false || router === undefined) return null
  if (typeof router === 'string') {
    const base: LlmRouterConfig = { preset: router }
    return legacyTimeoutMs ? { ...base, timeoutMs: legacyTimeoutMs } : base
  }
  if (legacyTimeoutMs && router.timeoutMs === undefined) {
    return { ...router, timeoutMs: legacyTimeoutMs }
  }
  return router
}

export function resolveMcpCliPath(root: string): string | null {
  try {
    const req = createRequire(resolve(root, 'package.json'))
    const pkgJsonPath = req.resolve('@llui/mcp/package.json')
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>
    }
    const binEntry = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.['llui-mcp']
    if (!binEntry) return null
    return resolve(dirname(pkgJsonPath), binEntry)
  } catch {
    return null
  }
}

function findPackageDir(start: string, pkgName: string): string | null {
  let dir = resolve(start)
  while (true) {
    const candidate = resolve(dir, 'node_modules', pkgName)
    if (existsSync(resolve(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export async function loadAgentServer(
  appRoot: string,
  _config: AgentPluginConfig,
): Promise<AgentServerInstance | null> {
  let serverModule: {
    createLluiAgentServer: (opts: {
      identityResolver?: (req: Request) => Promise<string | null>
    }) => AgentServerInstance
  }
  try {
    const pkgDir = findPackageDir(appRoot, '@llui/agent')
    if (!pkgDir) throw new Error('not found in any ancestor node_modules')
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, { import?: string } | string>
    }
    const serverExport = pkg.exports?.['./server']
    const rel = typeof serverExport === 'string' ? serverExport : serverExport?.import
    if (!rel) throw new Error('missing ./server export in package.json')
    const modUrl = new URL(`file://${resolve(pkgDir, rel)}`).href
    serverModule = (await import(modUrl)) as typeof serverModule
  } catch (error) {
    console.warn(
      '[llui] agent: true is set but `@llui/agent` could not be loaded: ' +
        (error instanceof Error ? error.message : String(error)),
    )
    return null
  }
  return serverModule.createLluiAgentServer({ identityResolver: async () => 'dev-user' })
}

export function registerAgentMiddleware(server: ViteDevServer, agent: AgentServerInstance): void {
  server.middlewares.use((req, res, next) => {
    const url = req.url ?? '/'
    let stripped: string | null = null
    if (url.startsWith('/agent/') || url === '/agent') stripped = url
    else if (url.startsWith('/cdn-cgi/agent/') || url === '/cdn-cgi/agent') {
      stripped = url.slice('/cdn-cgi'.length)
    }
    if (stripped === null) {
      next()
      return
    }
    req.url = stripped
    void handleAgentRequest(req, res, agent.router).catch((error) => {
      console.error('[llui] agent middleware error:', error)
      next(error)
    })
  })

  server.httpServer?.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/agent/ws' || url.pathname === '/cdn-cgi/agent/ws') {
      agent.wsUpgrade(req, socket, head)
    }
  })

  console.info(
    '[llui] agent dev endpoints active: POST /agent/mint, WS /agent/ws, LAP /agent/lap/v1/* (also reachable under /cdn-cgi/agent/* for cloudflare-vite parity)',
  )
}

async function handleAgentRequest(
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  router: (req: Request) => Promise<Response | null>,
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = req.url ?? '/'
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  let body: BodyInit | undefined
  if (!['GET', 'HEAD'].includes(method)) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    if (chunks.length > 0) body = new Uint8Array(Buffer.concat(chunks))
  }
  const origin = `http://${req.headers.host ?? 'localhost'}`
  const webResponse = await router(new Request(`${origin}${url}`, { method, headers, body }))
  if (!webResponse) {
    res.statusCode = 404
    res.end()
    return
  }
  res.statusCode = webResponse.status
  webResponse.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await webResponse.arrayBuffer()))
}
