import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Bundle host.ts for delivery to the browser.
 *
 * Design note: the vite-plugin transform (which would emit __msgAnnotations,
 * __bindingDescriptors, __schemaHash at compile time) is skipped here for
 * e2e simplicity — esbuild doesn't speak the LLui 3-pass transform. Instead,
 * host.ts attaches that metadata at runtime directly on the App component
 * definition after `component(...)` returns. This is the "pragmatic fallback"
 * described in Plan 10 Task 2.
 *
 * The bundle is returned as a string so the test harness can serve it from
 * an in-process Node http server without touching the filesystem.
 */
export async function bundleHost(): Promise<string> {
  const result = await build({
    entryPoints: [resolve(here, 'host.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    // Silence "use of eval" warnings from MCP SDK or other deps.
    logLevel: 'error',
    // @llui/dom and @llui/agent are browser-compatible; bundle them in.
    // Node-only packages (node:http etc.) are not imported by host.ts.
    define: {
      // esbuild replaces process.env.NODE_ENV for any deps that check it
      'process.env.NODE_ENV': '"development"',
      // The host's App component is authored as a raw `ComponentDef`
      // literal — the LLui compiler transform isn't part of esbuild's
      // pipeline, so `__view` is never emitted. @llui/dom's
      // `getInstanceViewBag` gates the `createView` fallback for
      // hand-rolled components behind `import.meta.env?.DEV`; without
      // the define below the fallback dead-codes and `mountApp` throws
      // a "missing __view — recompile with @llui/vite-plugin" error at
      // page load. Setting `import.meta.env.DEV = true` opts this
      // bundle into the dev path so hand-rolled defs mount correctly.
      'import.meta.env.DEV': 'true',
    },
  })

  if (result.outputFiles.length === 0) {
    throw new Error('bundleHost: esbuild produced no output')
  }

  return result.outputFiles[0]!.text
}
