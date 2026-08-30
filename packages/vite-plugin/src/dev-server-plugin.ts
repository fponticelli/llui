import { existsSync, readFileSync, writeFileSync, watch as fsWatch } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { Plugin, ViteDevServer } from 'vite'
import { createCaptureRegistry } from './notes/capture-registry.js'
import { createEventBus } from './notes/event-bus.js'
import { createNotesMiddleware } from './notes/middleware.js'
import { startRouter } from './notes/router.js'
import { createTrustedTaskRegistry } from './notes/trusted-tasks.js'
import { registerAgentMiddleware } from './plugin-helpers.js'
import type { LluiPluginState } from './shared-state.js'

interface ServerResponseLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

export function createDevServerPlugin(state: LluiPluginState): Plugin {
  function readMcpMarker(): { port: number; devUrl?: string } | null {
    try {
      if (!existsSync(state.activeFilePath)) return null
      const data = JSON.parse(readFileSync(state.activeFilePath, 'utf8')) as {
        port?: number
        devUrl?: string
      }
      if (typeof data.port !== 'number') return null
      return { port: data.port, ...(data.devUrl ? { devUrl: data.devUrl } : {}) }
    } catch {
      return null
    }
  }

  function stampDevUrl(): void {
    if (state.cachedDevUrl === null || !existsSync(state.activeFilePath)) return
    try {
      const marker = JSON.parse(readFileSync(state.activeFilePath, 'utf8')) as Record<
        string,
        unknown
      >
      if (marker.devUrl === state.cachedDevUrl) return
      marker.devUrl = state.cachedDevUrl
      writeFileSync(state.activeFilePath, JSON.stringify(marker))
    } catch {
      // Best-effort: a marker update must not crash Vite.
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
    name: 'llui:dev-server',
    enforce: 'pre',

    configureServer(server) {
      if (state.options.devmodeAnnotate !== false) {
        const notesConfig =
          typeof state.options.devmodeAnnotate === 'object' ? state.options.devmodeAnnotate : {}
        const projectRoot = state.crossFileRoot ?? process.cwd()
        const notesRoot = process.env['LLUI_NOTES_DIR']
          ? resolve(process.cwd(), process.env['LLUI_NOTES_DIR'])
          : notesConfig.notesDir
            ? resolve(projectRoot, notesConfig.notesDir)
            : resolve(projectRoot, '.llui/notes')
        const envTimeout = process.env['LLUI_CAPTURE_TIMEOUT_MS']
          ? parseInt(process.env['LLUI_CAPTURE_TIMEOUT_MS'], 10)
          : undefined
        const captureTimeoutMs = Number.isFinite(envTimeout)
          ? (envTimeout as number)
          : notesConfig.captureTimeoutMs
        const notesBus = createEventBus()
        const notesRegistry = createCaptureRegistry()
        const notesTrustedTasks = createTrustedTaskRegistry()
        const notesHandler = createNotesMiddleware({
          notesRoot,
          bus: notesBus,
          registry: notesRegistry,
          trustedTasks: notesTrustedTasks,
          ...(state.solveEnabled ? { taskCapabilityToken: state.taskCapabilityToken } : {}),
          defaultCaptureTimeoutMs: captureTimeoutMs,
          ...(notesConfig.format ? { format: notesConfig.format } : {}),
        })
        server.middlewares.use(notesHandler)

        if (state.resolvedRouter && state.solveEnabled) {
          const cliName = state.resolvedRouter.command ?? state.resolvedRouter.preset ?? 'claude'
          const routerHandle = startRouter({
            notesRoot,
            projectRoot,
            bus: notesBus,
            trustedTasks: notesTrustedTasks,
            ...state.resolvedRouter,
          })
          server.httpServer?.on('close', () => routerHandle.stop())
          process.stderr.write(
            `[llui:router] attention router started — task notes will be solved by ${cliName}\n`,
          )
        }
      }

      if (state.agentServer) registerAgentMiddleware(server, state.agentServer)

      if (state.mcpPort === null) {
        if (existsSync(state.activeFilePath)) {
          console.warn(
            `[llui] @llui/mcp server is running (marker at ${state.activeFilePath}) ` +
              `but the Vite plugin is opted out (mcpPort: false, or @llui/mcp ` +
              `isn't a dep of this project). Add \`llui({ mcpPort: 5200 })\` ` +
              `to vite.config to wire them up, or remove the marker file and ` +
              `stop the MCP server if the mismatch was unintended.`,
          )
        }
        return
      }

      if (
        state.mcpMode === 'spawn' &&
        state.mcpCliPath !== null &&
        !existsSync(state.activeFilePath)
      ) {
        state.mcpChild = spawn(
          process.execPath,
          [state.mcpCliPath, '--http', String(state.mcpPort)],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, LLUI_MCP_PORT: String(state.mcpPort) },
          },
        )
        state.mcpChild.stdout?.on('data', (buffer: Buffer) => {
          process.stdout.write(`[mcp] ${buffer.toString()}`)
        })
        state.mcpChild.stderr?.on('data', (buffer: Buffer) => {
          process.stderr.write(`[mcp] ${buffer.toString()}`)
        })
        state.mcpChild.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            console.warn(`[llui] @llui/mcp child exited with code ${code}`)
          }
          state.mcpChild = null
        })
        // The child-side parent watchdog covers abnormal Vite termination (#192).
        const killChild = (): void => {
          if (state.mcpChild && !state.mcpChild.killed) state.mcpChild.kill('SIGTERM')
        }
        server.httpServer?.on('close', killChild)
        process.once('exit', killChild)
      }

      const mcpStatusHandler = (_request: unknown, response: ServerResponseLike): void => {
        const marker = readMcpMarker()
        if (marker === null) {
          response.statusCode = 404
          response.end()
          return
        }
        response.statusCode = 200
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ port: marker.port }))
      }
      server.middlewares.use('/__llui_mcp_status', mcpStatusHandler)
      server.middlewares.use('/cdn-cgi/llui_mcp_status', mcpStatusHandler)

      const directory = dirname(state.activeFilePath)
      try {
        const watchDirectory = (): void => {
          if (!existsSync(directory)) return
          state.dirWatcher = fsWatch(directory, (_event, filename) => {
            if (filename !== 'active.json') return
            if (existsSync(state.activeFilePath)) {
              stampDevUrl()
              notifyMcpReady(server)
            } else {
              notifyMcpOffline(server)
            }
          })
        }
        if (existsSync(directory)) {
          watchDirectory()
        } else {
          const poll = setInterval(() => {
            if (existsSync(directory)) {
              clearInterval(poll)
              watchDirectory()
            }
          }, 1000)
          server.httpServer?.on('close', () => clearInterval(poll))
        }
      } catch {
        // fs.watch can fail on some filesystems; the status endpoint still works.
      }

      server.ws.on('connection', () => {
        if (existsSync(state.activeFilePath)) notifyMcpReady(server)
      })
      server.httpServer?.on('close', () => {
        state.dirWatcher?.close()
        state.dirWatcher = null
      })
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address()
        if (!address || typeof address !== 'object') return
        const host =
          address.address === '::' || address.address === '0.0.0.0' ? 'localhost' : address.address
        state.cachedDevUrl = `http://${host}:${address.port}`
        stampDevUrl()
        notifyMcpReady(server)
      })
    },
  } satisfies Plugin
}
