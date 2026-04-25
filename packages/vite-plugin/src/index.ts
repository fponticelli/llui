import type { Plugin, ViteDevServer } from 'vite'

// Minimal subset of `http.ServerResponse` we use in the MCP-status
// handler. Avoids a heavy `node:http` import at the top of the file.
interface ServerResponseLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}
import MagicString from 'magic-string'
import { existsSync, readFileSync, writeFileSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  transformLlui,
  transformUseClientSsr,
  hasUseClientDirective,
  type ExternalTypeSources,
  type PreExtractedSchemas,
} from './transform.js'
import { diagnose, type DiagnosticRule } from './diagnostics.js'
import {
  findTypeSource,
  readComponentTypeArgNames,
  extractMsgAnnotationsCrossFile,
  extractDiscriminatedUnionSchemaCrossFile,
  type ResolveContext,
} from './cross-file-resolver.js'
import ts from 'typescript'

export type { DiagnosticRule } from './diagnostics.js'

/**
 * Pre-resolution step run before `transformLlui`. Scans the source for
 * `component<State, Msg, Effect>(...)` calls; for each type argument that
 * is an identifier (the common case), walks imports and re-exports to
 * find the source file declaring that alias. The result is plumbed into
 * `transformLlui` so the schema/annotation extractors operate on the
 * declaring file's source instead of silently returning `null` when the
 * type lives in a separate file.
 *
 * Returns `undefined` (no external sources) when:
 *   - No `component<...>()` call is in the file
 *   - No type arguments are identifiers we can chase
 *   - All type arguments are declared locally (the resolver returns the
 *     same source we already have, so external sources are redundant)
 *
 * `resolveModule` comes from Rollup's `this.resolve()`; we wrap it to
 * return the absolute id (or null when unresolved) and read the source
 * via `fs/promises.readFile`.
 */
async function preResolveTypeSources(
  source: string,
  filePath: string,
  rollupResolve: (
    spec: string,
    importer: string,
  ) => Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>,
): Promise<ExternalTypeSources | undefined> {
  // Cheap filter: nothing to resolve unless the file contains a
  // component<...>() call. Avoids parsing every TS file in the project.
  if (!/\bcomponent\s*</.test(source)) return undefined

  // Find the first component<...>() call and read its type arg names.
  // Multiple component() calls in one file would each technically need
  // their own type-arg lookup; we resolve based on the first call and
  // accept the (rare) edge case where two component() calls in one file
  // use different non-local Msg types. The lint rule catches divergence.
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const args = findFirstComponentTypeArgs(sf)
  if (!args) return undefined

  const ctx: ResolveContext = {
    resolveModule: async (spec, importer) => {
      const result = await rollupResolve(spec, importer)
      if (!result || result.external) return null
      // Rollup ids can include query/hash suffixes for virtual modules;
      // strip those so fs.readFile sees a real path. Also skip files
      // outside our control (node_modules) — we don't want to follow
      // imports into third-party packages just to scrape types.
      const idStripped = result.id.split('?')[0]?.split('#')[0]
      if (!idStripped) return null
      if (idStripped.includes('/node_modules/')) return null
      return idStripped
    },
    readSource: async (p) => {
      return await readFile(p, 'utf8')
    },
  }

  // Helper to resolve one type-arg name into an external source if it
  // isn't declared locally (or if the resolver chases through imports).
  const resolve = async (
    typeName: string | null,
  ): Promise<{ source: string; typeName: string } | undefined> => {
    if (!typeName) return undefined
    const found = await findTypeSource(typeName, source, filePath, ctx)
    if (!found) return undefined
    // If the alias was declared locally, the existing extractor path
    // already handles it — no need to populate external sources.
    if (found.filePath === filePath) return undefined
    return { source: found.source, typeName: found.localName }
  }

  const [state, msg, effect] = await Promise.all([
    resolve(args.state),
    resolve(args.msg),
    resolve(args.effect),
  ])

  if (!state && !msg && !effect) return undefined
  return { state, msg, effect }
}

/**
 * Cross-file + composition-aware schema extraction. The extractors
 * follow imports/re-exports AND walk into TypeReferences inside Msg /
 * Effect unions, so a developer who organises types as
 * `type Msg = ImportedFoo | { type: 'extra' }` gets every variant in
 * `__msgAnnotations` and `__msgSchema`. Without this step the
 * file-local sync extractors would silently emit half-annotations
 * (only the inline TypeLiteral members) — the worst kind of failure
 * mode because the build appears to succeed.
 *
 * Returns `undefined` (no pre-extraction) when there's no
 * `component()` call to resolve types for.
 */
async function preExtractCompositional(
  source: string,
  filePath: string,
  rollupResolve: (
    spec: string,
    importer: string,
  ) => Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>,
): Promise<PreExtractedSchemas | undefined> {
  if (!/\bcomponent\s*</.test(source)) return undefined
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const args = findFirstComponentTypeArgs(sf)
  if (!args) return undefined
  // No identifier type args at all → nothing for the resolver to chase.
  if (!args.msg && !args.effect && !args.state) return undefined

  const ctx: ResolveContext = {
    resolveModule: async (spec, importer) => {
      const result = await rollupResolve(spec, importer)
      if (!result || result.external) return null
      const idStripped = result.id.split('?')[0]?.split('#')[0]
      if (!idStripped) return null
      if (idStripped.includes('/node_modules/')) return null
      return idStripped
    },
    readSource: async (p) => readFile(p, 'utf8'),
  }

  const [msgAnnotations, msgSchema, effectSchema] = await Promise.all([
    args.msg
      ? extractMsgAnnotationsCrossFile(source, args.msg, filePath, ctx)
      : Promise.resolve(null),
    args.msg
      ? extractDiscriminatedUnionSchemaCrossFile(source, args.msg, filePath, ctx)
      : Promise.resolve(null),
    args.effect
      ? extractDiscriminatedUnionSchemaCrossFile(source, args.effect, filePath, ctx)
      : Promise.resolve(null),
  ])

  // Only return a populated payload when we actually extracted
  // something useful. Returning `undefined` lets transformLlui fall
  // back to its file-local extractors, which is the right behavior
  // for the (rare) case where every type the resolver sees is
  // unreachable.
  if (msgAnnotations === null && msgSchema === null && effectSchema === null) return undefined

  // Note: state schema isn't a discriminated union, so composition
  // doesn't apply. We leave state on the simpler `typeSources` path
  // (already plumbed through preResolveTypeSources) which the
  // file-local `extractStateSchema` consumes.
  const out: PreExtractedSchemas = {}
  if (msgAnnotations !== null) out.msgAnnotations = msgAnnotations
  if (msgSchema !== null) out.msgSchema = msgSchema
  if (effectSchema !== null) out.effectSchema = effectSchema
  return out
}

function findFirstComponentTypeArgs(
  sf: ts.SourceFile,
): { state: string | null; msg: string | null; effect: string | null } | null {
  let result: ReturnType<typeof readComponentTypeArgNames> | null = null
  const visit = (node: ts.Node): boolean => {
    if (result) return true
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'component' &&
      node.typeArguments
    ) {
      result = readComponentTypeArgNames(node)
      return true
    }
    let stopped = false
    ts.forEachChild(node, (child) => {
      if (stopped) return
      if (visit(child)) stopped = true
    })
    return stopped
  }
  ts.forEachChild(sf, (child) => {
    visit(child)
  })
  return result
}

/**
 * Locate the workspace root so we share the MCP active marker file
 * with @llui/mcp regardless of which subdirectory the dev server runs in.
 * Mirrors `findWorkspaceRoot` from @llui/mcp — duplicated to avoid a
 * vite-plugin → mcp dependency cycle. The contract must stay in sync.
 */
function findWorkspaceRoot(start: string = process.cwd()): string {
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

export interface LluiPluginOptions {
  /**
   * Port for the MCP debug bridge. In dev mode, the runtime relay connects
   * to `ws://127.0.0.1:<port>` so an external `llui-mcp` server can forward
   * tool calls into the running app.
   *
   * When omitted, the plugin checks whether `@llui/mcp` is resolvable from
   * the Vite project root. If yes → defaults to `5200`. If no → stays
   * disabled. This means installing `@llui/mcp` (+ starting its server)
   * Just Works without an explicit config entry. Pass an explicit `false`
   * to opt out even when `@llui/mcp` is installed; pass a number to use
   * a non-default port. When enabled but the MCP server isn't running,
   * the plugin returns 404 from its discovery endpoint and the browser
   * silently skips the connection — no retry noise.
   */
  mcpPort?: number | false

  /**
   * Treat every compiler diagnostic as a build error.
   *
   * Default `false` — diagnostics are emitted via rollup's `this.warn` and
   * can be ignored. Set to `true` in CI so lint-style regressions (namespace
   * imports, bitmask overflow, spread-in-children, `.map()` on state, etc.)
   * fail the build without requiring a custom `build.rollupOptions.onwarn`
   * handler.
   */
  failOnWarning?: boolean

  /**
   * Silence specific diagnostic rules without disabling the whole lint
   * pass. Each message is tagged with a rule name (shown in brackets at
   * the start of every warning, e.g. `[spread-in-children]`). Listing
   * a rule here drops all diagnostics with that tag before rollup sees
   * them — so they don't fire via `this.warn` and don't fail the build
   * even when `failOnWarning` is enabled.
   *
   * The valid rule names are enumerated by the `DiagnosticRule` type
   * re-exported from this module. Unknown rule names are ignored.
   */
  disabledWarnings?: readonly DiagnosticRule[]

  /**
   * Emit `[llui]`-prefixed `console.info` logs for every transformed
   * component file — state-path bit assignments, mask injections, and
   * helper compile/bail counts. Useful when diagnosing why a binding
   * isn't gated the way you expect, or why a call fell back from
   * template-clone to `elSplit`. Off by default.
   */
  verbose?: boolean

  /**
   * Enables two things together when set:
   *
   *   1. Emits schemas + binding descriptors in prod builds so the
   *      @llui/agent runtime has metadata to advertise over its WS hello
   *      frame (see agent spec §7.4).
   *   2. Auto-mounts `@llui/agent/server`'s router at `/agent/*` and its
   *      WS upgrade handler at `/agent/ws` on the Vite dev server — so
   *      plain `vite dev` has working agent endpoints with no extra
   *      server.ts wiring. Requires `@llui/agent` installed; if it isn't,
   *      the plugin warns and skips dev mounting (prod emission still
   *      works from Plan 3b).
   *
   * Pass `true` for defaults (random signing key per dev session;
   * `identityResolver` returns `'dev-user'`). Pass an object to customize.
   * Default `false` — metadata is dev-only, no agent endpoints.
   */
  agent?: boolean | AgentPluginConfig
}

export type AgentPluginConfig = {
  /**
   * HMAC signing key for tokens. ≥32 bytes. Rotation invalidates all
   * tokens. Falls back to `process.env.AGENT_SIGNING_KEY`, then to a
   * per-session random key (dev-only).
   */
  signingKey?: string
}

/**
 * Does `@llui/mcp` resolve from `root`'s node_modules? Uses
 * `require.resolve` so monorepo workspaces and hoisted installs both
 * work. Catches failures silently — the only consequence is that we
 * leave `mcpPort` disabled, which is the safe default.
 */
function hasMcpPackage(root: string): boolean {
  try {
    const req = createRequire(resolve(root, 'package.json'))
    req.resolve('@llui/mcp/package.json')
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the path to the llui-mcp CLI entry. Reads `bin.llui-mcp`
 * from @llui/mcp's package.json and joins it against the package
 * directory. Returns null if @llui/mcp isn't resolvable.
 */
function resolveMcpCliPath(root: string): string | null {
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

type AgentServerInstance = {
  router: (req: Request) => Promise<Response | null>
  wsUpgrade: (
    req: import('http').IncomingMessage,
    socket: import('stream').Duplex,
    head: Buffer,
  ) => void
}

/**
 * Dynamically load @llui/agent/server relative to the app root and
 * construct an agent server instance. Returns null if @llui/agent isn't
 * installed — the plugin degrades to "prod schema emission only" mode.
 */
async function loadAgentServer(
  appRoot: string,
  cfg: AgentPluginConfig,
): Promise<AgentServerInstance | null> {
  let serverModule: {
    createLluiAgentServer: (opts: {
      signingKey: string
      identityResolver?: (req: Request) => Promise<string | null>
    }) => AgentServerInstance
  }
  try {
    // Walk up from the app root to find node_modules/@llui/agent. Works
    // for both pnpm workspace and regular npm installs. Direct file-system
    // walk avoids "exports" / "subpath './package.json'" gymnastics that
    // require.resolve and Node's module resolver disagree on.
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
  } catch (e) {
    console.warn(
      '[llui] agent: true is set but `@llui/agent` could not be loaded: ' +
        (e instanceof Error ? e.message : String(e)),
    )
    return null
  }

  const { randomBytes } = await import('node:crypto')
  const signingKey: string =
    cfg.signingKey ?? process.env['AGENT_SIGNING_KEY'] ?? randomBytes(32).toString('base64url')

  return serverModule.createLluiAgentServer({
    signingKey,
    identityResolver: async () => 'dev-user',
  })
}

/**
 * Register the agent middleware + WS upgrade on the Vite dev server.
 * Must be called synchronously from configureServer so registration
 * happens BEFORE Vite installs its catch-all SPA fallback.
 */
function registerAgentMiddleware(server: ViteDevServer, agent: AgentServerInstance): void {
  // Connect-style middleware. Vite's middleware chain runs in order, so
  // synchronous registration during configureServer places us ahead of
  // Vite's catch-all fallback.
  //
  // Dual-path: handle the canonical `/agent/*` (every project) AND
  // `/cdn-cgi/agent/*` (defensive — Cloudflare's `@cloudflare/vite-plugin`
  // routes everything except `/cdn-cgi/*` to the worker, which means
  // canonical `/agent/*` paths are shadowed in cloudflare-vite projects).
  // The cdn-cgi prefix is stripped before forwarding so the agent
  // server's router sees its own canonical paths regardless of which
  // public URL the client used. This matches the dual-path strategy
  // used for `/__llui_mcp_status`.
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
    // Rewrite the request URL in-place so handleAgentRequest's path
    // matching sees `/agent/*`. Connect middleware can mutate req.url
    // for downstream handlers; we own the request from here.
    req.url = stripped
    void handleAgentRequest(req, res, agent.router).catch((e) => {
      console.error('[llui] agent middleware error:', e)
      next(e)
    })
  })

  // WS upgrade: only /agent/ws goes to the agent. Vite's own HMR upgrade
  // uses a different path and runs as a separate listener on the same
  // event, so this filter keeps both coexisting. Same dual-path
  // accommodation as the HTTP middleware — the WS-upgrade path doesn't
  // actually matter to most cloudflare setups (the worker handles WS
  // upgrades natively), but keeping the parity simplifies the mental
  // model for ops.
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

/**
 * Walk up from `start` looking for `node_modules/<pkgName>`. Returns the
 * absolute path to the package directory, or null if not found.
 */
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

/** Convert a Node http req → Web Request, call router, write the response. */
async function handleAgentRequest(
  req: import('http').IncomingMessage,
  res: import('http').ServerResponse,
  router: (req: Request) => Promise<Response | null>,
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = req.url ?? '/'
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    headers[k] = Array.isArray(v) ? v.join(', ') : v
  }
  let body: BodyInit | undefined
  if (!['GET', 'HEAD'].includes(method)) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    if (chunks.length > 0) body = new Uint8Array(Buffer.concat(chunks))
  }
  const origin = `http://${req.headers.host ?? 'localhost'}`
  const webReq = new Request(`${origin}${url}`, { method, headers, body })
  const webRes = await router(webReq)
  if (!webRes) {
    res.statusCode = 404
    res.end()
    return
  }
  res.statusCode = webRes.status
  webRes.headers.forEach((v, k) => res.setHeader(k, v))
  const buf = Buffer.from(await webRes.arrayBuffer())
  res.end(buf)
}

export default function llui(options: LluiPluginOptions = {}): Plugin {
  let devMode = false
  // `mcpPort` + `mcpMode` are resolved lazily in `configResolved` so we
  // can check for @llui/mcp in the consuming project's node_modules.
  //   - `options.mcpPort === false`  → disabled
  //   - explicit number              → wire-only (user manages the server)
  //   - undefined + @llui/mcp found  → spawn (plugin starts llui-mcp --http)
  //   - undefined + no @llui/mcp     → disabled
  let mcpPort: number | null = null
  let mcpMode: 'disabled' | 'wire' | 'spawn' = 'disabled'
  let mcpCliPath: string | null = null
  let mcpChild: ChildProcess | null = null
  const failOnWarning = options.failOnWarning === true
  const disabledWarnings = new Set<string>(options.disabledWarnings ?? [])
  const verbose = options.verbose === true
  const agent = options.agent ?? false
  const agentConfig: AgentPluginConfig = typeof agent === 'object' ? agent : {}
  // Agent server instance — loaded in configResolved (async), registered
  // in configureServer (sync). Null until loaded, or if @llui/agent isn't
  // installed.
  let agentServer: {
    router: (req: Request) => Promise<Response | null>
    wsUpgrade: (
      req: import('http').IncomingMessage,
      socket: import('stream').Duplex,
      head: Buffer,
    ) => void
  } | null = null

  // File-based handshake with @llui/mcp. The MCP server writes a marker
  // file when its bridge starts; we watch it and send a Vite HMR custom
  // event so the browser can call __lluiConnect() automatically — without
  // retry spam, regardless of whether MCP or Vite started first.
  const activeFilePath = resolve(findWorkspaceRoot(), 'node_modules/.cache/llui-mcp/active.json')
  let mcpWatcher: FSWatcher | null = null
  let dirWatcher: FSWatcher | null = null
  // Cached once Vite's HTTP server emits `listening`. `stampDevUrl()`
  // uses this to write the URL into the marker file — either immediately
  // (if MCP already started and wrote one) or later when the marker
  // appears via the directory watcher (MCP-starts-after-Vite path).
  let cachedDevUrl: string | null = null

  function readMcpMarker(): { port: number; devUrl?: string } | null {
    try {
      if (!existsSync(activeFilePath)) return null
      const data = JSON.parse(readFileSync(activeFilePath, 'utf8')) as {
        port?: number
        devUrl?: string
      }
      if (typeof data.port !== 'number') return null
      return { port: data.port, ...(data.devUrl ? { devUrl: data.devUrl } : {}) }
    } catch {
      return null
    }
  }

  /**
   * Idempotently write `cachedDevUrl` into the marker file. No-op if the
   * URL hasn't been captured yet (Vite hasn't emitted `listening`) or if
   * the marker file doesn't exist (MCP hasn't started yet). Covers both
   * orderings — the listening hook calls this after caching, and the
   * directory watcher calls it when the marker appears later.
   */
  function stampDevUrl(): void {
    if (cachedDevUrl === null) return
    if (!existsSync(activeFilePath)) return
    try {
      const marker = JSON.parse(readFileSync(activeFilePath, 'utf8')) as Record<string, unknown>
      if (marker.devUrl === cachedDevUrl) return
      marker.devUrl = cachedDevUrl
      writeFileSync(activeFilePath, JSON.stringify(marker))
    } catch {
      // Best-effort — failure to update the marker should not crash Vite
    }
  }

  function notifyMcpReady(server: ViteDevServer): void {
    const marker = readMcpMarker()
    if (marker === null) return
    server.ws.send({ type: 'custom', event: 'llui:mcp-ready', data: marker })
  }

  function notifyMcpOffline(server: ViteDevServer): void {
    server.ws.send({ type: 'custom', event: 'llui:mcp-offline', data: {} })
  }

  return {
    name: 'llui',
    enforce: 'pre',

    async configResolved(config) {
      devMode = config.command === 'serve' || config.mode === 'development'
      // Load @llui/agent here (async) so we can register middleware
      // synchronously in configureServer — which must happen BEFORE Vite
      // installs its catch-all SPA/fallback middleware.
      if (agent && devMode) {
        agentServer = await loadAgentServer(config.root, agentConfig)
      }
      if (options.mcpPort === false) {
        mcpMode = 'disabled'
        mcpPort = null
      } else if (typeof options.mcpPort === 'number') {
        mcpMode = 'wire'
        mcpPort = options.mcpPort
      } else if (hasMcpPackage(config.root)) {
        mcpCliPath = resolveMcpCliPath(config.root)
        if (mcpCliPath) {
          mcpMode = 'spawn'
          mcpPort = 5200
        } else {
          mcpMode = 'wire'
          mcpPort = 5200
        }
      } else {
        mcpMode = 'disabled'
        mcpPort = null
      }
    },

    configureServer(server) {
      // Agent dev endpoints — runs regardless of mcp state. Must be before
      // any early-returns below. Registration is synchronous because
      // agentServer was preloaded in configResolved.
      if (agentServer) {
        registerAgentMiddleware(server, agentServer)
      }

      if (mcpPort === null) {
        // #3 diagnostic: MCP server is running but the plugin is opted
        // out. Users in this state usually don't realize the mismatch —
        // loud-and-early log saves the "why isn't my MCP attached" hunt.
        if (existsSync(activeFilePath)) {
          console.warn(
            `[llui] @llui/mcp server is running (marker at ${activeFilePath}) ` +
              `but the Vite plugin is opted out (mcpPort: false, or @llui/mcp ` +
              `isn't a dep of this project). Add \`llui({ mcpPort: 5200 })\` ` +
              `to vite.config to wire them up, or remove the marker file and ` +
              `stop the MCP server if the mismatch was unintended.`,
          )
        }
        return
      }

      // Spawn mode: plugin launches llui-mcp as a child process so
      // `pnpm dev` handles the whole stack. Skip spawning when a marker
      // already exists — something (usually a separate llui-mcp process
      // started before Vite) is already listening. The existing wire
      // behavior takes over from there.
      if (mcpMode === 'spawn' && mcpCliPath !== null && !existsSync(activeFilePath)) {
        mcpChild = spawn(process.execPath, [mcpCliPath, '--http', String(mcpPort)], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, LLUI_MCP_PORT: String(mcpPort) },
        })
        mcpChild.stdout?.on('data', (buf: Buffer) => {
          process.stdout.write(`[mcp] ${buf.toString()}`)
        })
        mcpChild.stderr?.on('data', (buf: Buffer) => {
          process.stderr.write(`[mcp] ${buf.toString()}`)
        })
        mcpChild.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            console.warn(`[llui] @llui/mcp child exited with code ${code}`)
          }
          mcpChild = null
        })
        const killChild = (): void => {
          if (mcpChild && !mcpChild.killed) mcpChild.kill('SIGTERM')
        }
        server.httpServer?.on('close', killChild)
        process.once('exit', killChild)
      }

      // HTTP endpoint: the browser fetches this on load to discover the
      // current MCP port. Avoids the race where HMR events sent before
      // the import.meta.hot listener registers get dropped — and lets
      // the browser connect to the actual port (which may differ from
      // the compile-time default if MCP was started with LLUI_MCP_PORT).
      //
      // Two paths register the same handler:
      //  * `/__llui_mcp_status` — canonical, served from any Vite
      //    project.
      //  * `/cdn-cgi/llui_mcp_status` — fallback for projects that
      //    bundle `@cloudflare/vite-plugin`. The cloudflare plugin
      //    intercepts every HTTP request in `configureServer` and
      //    routes it to the worker, except `/cdn-cgi/*` which it
      //    explicitly lets through. Without this fallback, MCP
      //    auto-discovery silently fails under workerd.
      const mcpStatusHandler = (_req: unknown, res: ServerResponseLike): void => {
        const marker = readMcpMarker()
        if (marker === null) {
          res.statusCode = 404
          res.end()
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ port: marker.port }))
      }
      server.middlewares.use('/__llui_mcp_status', mcpStatusHandler)
      server.middlewares.use('/cdn-cgi/llui_mcp_status', mcpStatusHandler)

      // Watch the marker file for create/delete. fs.watch on the parent
      // directory catches both events; the file itself may not exist
      // when we start watching.
      const dir = dirname(activeFilePath)
      try {
        // Watch the parent directory for the marker file appearing/disappearing
        const watchDir = (): void => {
          if (!existsSync(dir)) return
          dirWatcher = fsWatch(dir, (_event, filename) => {
            if (filename !== 'active.json') return
            if (existsSync(activeFilePath)) {
              // Stamp BEFORE notifying so the `llui:mcp-ready` payload
              // carries the cached devUrl. This is the MCP-after-Vite
              // path: listening already fired and cached the URL; the
              // marker is only now appearing.
              stampDevUrl()
              notifyMcpReady(server)
            } else {
              notifyMcpOffline(server)
            }
          })
        }
        if (existsSync(dir)) {
          watchDir()
        } else {
          // Parent directory doesn't exist yet — poll for it briefly
          const poll = setInterval(() => {
            if (existsSync(dir)) {
              clearInterval(poll)
              watchDir()
            }
          }, 1000)
          // Clean up the poller if vite shuts down before MCP starts
          server.httpServer?.on('close', () => clearInterval(poll))
        }
      } catch {
        // fs.watch can fail on some filesystems — degrade silently
      }

      // Re-send the ready event when a new HMR client connects, in case
      // the page loads while MCP is already running.
      server.ws.on('connection', () => {
        if (existsSync(activeFilePath)) notifyMcpReady(server)
      })

      server.httpServer?.on('close', () => {
        mcpWatcher?.close()
        dirWatcher?.close()
        mcpWatcher = null
        dirWatcher = null
      })

      // Once Vite's HTTP server is listening, cache our dev URL and stamp
      // it into the marker file. Two orderings are possible:
      //   (a) MCP started FIRST → marker exists now → stampDevUrl() writes
      //       it, and we broadcast llui:mcp-ready so the browser picks up
      //       the devUrl without relying on an incidental fs.watch tick
      //       (which can miss on NFS/SMB).
      //   (b) MCP will start LATER → marker doesn't exist yet → stamp is a
      //       no-op. When MCP eventually writes the marker, the directory
      //       watcher fires, calls stampDevUrl(), and notifies.
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        if (!address || typeof address !== 'object') return
        const host =
          address.address === '::' || address.address === '0.0.0.0' ? 'localhost' : address.address
        cachedDevUrl = `http://${host}:${address.port}`
        stampDevUrl()
        // Broadcast after stamping so the payload carries devUrl. Only
        // fires in case (a) — notifyMcpReady no-ops when the marker is
        // absent.
        notifyMcpReady(server)
      })

      // ── Agent dev endpoints ──────────────────────────────────────
      // When `agent: true` (or `agent: {...}`), auto-mount /agent/* on
      // the Vite dev server so `pnpm dev` has working agent endpoints.
      // Users with a custom server.ts (SSR apps) mount createLluiAgentServer
      // themselves — configureServer also fires in middleware mode, but
      // there server.httpServer is null so the upgrade hook is a no-op.
    },

    async transform(code, id, options) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return

      // `'use client'` directive — SSR builds replace the module with a
      // stub so top-level imports and side effects never run on the
      // server. Client builds pass through to the normal transform; the
      // directive is effectively a no-op on the client.
      if (options?.ssr && hasUseClientDirective(code)) {
        const result = transformUseClientSsr(code, id)
        if (result) {
          const cwd = process.cwd()
          const rel = relative(cwd, id)
          const display = rel.startsWith('..') ? id : rel
          for (const warning of result.warnings) {
            this.warn(`${display}: ${warning}`)
          }
          return { code: result.output, map: { mappings: '' } }
        }
      }

      const diagnostics = diagnose(code)
      if (diagnostics.length > 0) {
        // Prefix every diagnostic with `<file>:<line>:<col>` plus the
        // `[rule-name]` tag so consumers logging `warning.message` in a
        // custom onwarn handler see both the location and the rule they
        // could silence via `disabledWarnings`.
        const cwd = process.cwd()
        const rel = relative(cwd, id)
        const display = rel.startsWith('..') ? id : rel
        for (const d of diagnostics) {
          if (disabledWarnings.has(d.rule)) continue
          const message = `${display}:${d.line}:${d.column}: [${d.rule}] ${d.message}`
          if (failOnWarning) {
            this.error({ message, loc: { line: d.line, column: d.column, file: id } })
          } else {
            this.warn(message, { line: d.line, column: d.column })
          }
        }
      }

      // Pre-resolve cross-file type sources for any `component<S, M, E>()`
      // call in this file. The extractors look for `type Msg = ...` etc.
      // in a single source string; if the user keeps `Msg` in a sibling
      // file, the local extraction returns null and the plugin emits no
      // annotations. Pre-resolution chases imports and re-exports to
      // find the declaring file, so the schema/annotation extractors run
      // against the right source. See cross-file-resolver.ts.
      //
      // `this.resolve` may be undefined in test harnesses that call the
      // hook directly without going through Rollup; in that case skip
      // pre-resolution and the local extractors handle whatever's in
      // the source string.
      const resolverAvailable = typeof this.resolve === 'function'
      const [typeSources, preExtracted] = resolverAvailable
        ? await Promise.all([
            preResolveTypeSources(code, id, this.resolve.bind(this)),
            // Cross-file + composition-aware extraction. Replaces the
            // file-local sync extractors when active. Without this step
            // a `type Msg = ImportedFoo | { type: 'extra' }`
            // composition would only see the inline `'extra'` variant
            // and silently emit half-annotations.
            preExtractCompositional(code, id, this.resolve.bind(this)),
          ])
        : [undefined, undefined]

      const result = transformLlui(
        code,
        id,
        devMode,
        Boolean(agent),
        mcpPort,
        verbose,
        typeSources,
        preExtracted,
      )
      if (!result) return undefined

      // Apply per-statement edits via MagicString for accurate source maps.
      // Untouched statements keep their original positions.
      const s = new MagicString(code)
      for (const edit of result.edits) {
        if (edit.start === edit.end) {
          // Insert at position — appendRight for middle, append for end-of-file
          if (edit.start === code.length) s.append(edit.replacement)
          else s.appendRight(edit.start, edit.replacement)
        } else {
          s.overwrite(edit.start, edit.end, edit.replacement)
        }
      }

      return {
        code: s.toString(),
        map: s.generateMap({ source: id, includeContent: true, hires: true }),
      }
    },
  }
}
