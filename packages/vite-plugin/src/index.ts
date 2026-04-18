import type { Plugin, ViteDevServer } from 'vite'
import MagicString from 'magic-string'
import { existsSync, readFileSync, writeFileSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { transformLlui } from './transform.js'
import { diagnose, type DiagnosticRule } from './diagnostics.js'

export type { DiagnosticRule } from './diagnostics.js'

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

export default function llui(options: LluiPluginOptions = {}): Plugin {
  let devMode = false
  // mcpPort is resolved lazily in `configResolved` so we can check for
  // @llui/mcp in the consuming project's node_modules. Explicit false
  // or a number always wins; `undefined` triggers auto-detect.
  let mcpPort: number | null = null
  const failOnWarning = options.failOnWarning === true
  const disabledWarnings = new Set<string>(options.disabledWarnings ?? [])
  const verbose = options.verbose === true

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

    configResolved(config) {
      devMode = config.command === 'serve' || config.mode === 'development'
      // Resolve mcpPort: explicit user value wins; otherwise auto-detect.
      if (options.mcpPort === false) {
        mcpPort = null
      } else if (typeof options.mcpPort === 'number') {
        mcpPort = options.mcpPort
      } else {
        mcpPort = hasMcpPackage(config.root) ? 5200 : null
      }
    },

    configureServer(server) {
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

      // HTTP endpoint: the browser fetches this on load to discover the
      // current MCP port. Avoids the race where HMR events sent before
      // the import.meta.hot listener registers get dropped — and lets
      // the browser connect to the actual port (which may differ from
      // the compile-time default if MCP was started with LLUI_MCP_PORT).
      server.middlewares.use('/__llui_mcp_status', (_req, res) => {
        const marker = readMcpMarker()
        if (marker === null) {
          res.statusCode = 404
          res.end()
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ port: marker.port }))
      })

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
    },

    transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return

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

      const result = transformLlui(code, id, devMode, mcpPort, verbose)
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
