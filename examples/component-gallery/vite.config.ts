/**
 * The gallery SHELL — search, categories, controls and framing — plus, in
 * dev, the composition that serves both path documents on the shell's own
 * origin (same-origin frames are what let the shell observe a document's
 * status and let a test inspect its cascade).
 *
 * Each path document keeps its OWN Vite server, config and plugin list,
 * created in middleware mode and mounted under its base; nothing about a
 * document's cascade is decided here. Production does the same with three
 * independent builds (`pnpm build`) laid out as `./`, `./baseline/`,
 * `./registry/`.
 */
import { defineConfig, createServer, type Plugin, type ViteDevServer } from 'vite'
import llui from '@llui/vite-plugin'
import { CACHE_DIRS, OUT_DIR, PATH_DOCUMENTS, SHELL_ROOT } from './gallery.config'

function servePathDocuments(): Plugin {
  return {
    name: 'llui-gallery:path-documents',
    apply: 'serve',
    async configureServer(shell) {
      const documents: ViteDevServer[] = await Promise.all(
        Object.values(PATH_DOCUMENTS).map((document) =>
          createServer({
            configFile: document.config,
            base: document.base,
            logLevel: shell.config.logLevel,
            server: {
              middlewareMode: true,
              // One HTTP server, three HMR sockets: Vite matches the upgrade
              // request's path against each server's own base.
              hmr: shell.httpServer === null ? false : { server: shell.httpServer },
            },
          }),
        ),
      )
      shell.middlewares.use((request, response, next) => {
        const url = request.url ?? '/'
        const owner = documents.find((document) => url.startsWith(document.config.base))
        if (owner === undefined) {
          // `/baseline` without its slash would otherwise fall through to the
          // shell's SPA fallback and render the shell inside its own frame.
          const bare = documents.find((document) => url === document.config.base.slice(0, -1))
          if (bare !== undefined) {
            response.statusCode = 308
            response.setHeader('Location', bare.config.base)
            response.end()
            return
          }
          next()
          return
        }
        owner.middlewares(request, response, next)
      })
      shell.httpServer?.once('close', () => {
        void Promise.all(documents.map((document) => document.close()))
      })
    },
  }
}

export default defineConfig({
  // Its own root, so the shell server can never serve a path document's HTML
  // through the shell's (Tailwind-free, alias-free) pipeline.
  root: SHELL_ROOT,
  base: './',
  cacheDir: CACHE_DIRS.shell,
  plugins: [servePathDocuments(), llui({ mcpPort: false, devmodeAnnotate: false, agent: false })],
  build: {
    target: 'es2022',
    outDir: OUT_DIR,
    // The shell builds FIRST and owns the output root; the path documents then
    // write their own `baseline/` and `registry/` subdirectories.
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
})
