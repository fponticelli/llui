/**
 * ONE production build of the gallery, served once, for every browser suite
 * in the `browser` project (#268). Each suite used to build the three
 * documents itself in `beforeAll` — ~12 s of CPU per file that bought nothing
 * but contention — and every gate added here would have multiplied it.
 *
 * Runs only when the `browser` project has files to run (vitest initialises a
 * project's globalSetup lazily), so `vitest run test/route.test.ts` never
 * pays for it. The build's module graph is gated separately
 * (`test/build-graph.test.ts`); this build exists to be driven.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TestProject } from 'vitest/node'
import { build, preview } from 'vite'

declare module 'vitest' {
  export interface ProvidedContext {
    /** `http://127.0.0.1:<port>/` — the built gallery root (shell at `/`). */
    galleryBase: string
  }
}

const GALLERY = resolve(import.meta.dirname, '../..')
const CONFIGS = ['vite.config.ts', 'vite.baseline.config.ts', 'vite.registry.config.ts'] as const

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const outDir = mkdtempSync(join(tmpdir(), 'llui-gallery-gates-'))
  const previous = process.env['LLUI_GALLERY_OUT']
  process.env['LLUI_GALLERY_OUT'] = outDir
  try {
    // Sequential: the shell owns (and empties) the output root first.
    for (const config of CONFIGS) {
      await build({ configFile: resolve(GALLERY, config), logLevel: 'error' })
    }
  } finally {
    if (previous === undefined) delete process.env['LLUI_GALLERY_OUT']
    else process.env['LLUI_GALLERY_OUT'] = previous
  }
  const server = await preview({
    root: outDir,
    configFile: false,
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'error',
  })
  const address = server.httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('preview bound no port')
  project.provide('galleryBase', `http://127.0.0.1:${address.port}/`)
  return async () => {
    // Keep-alive connections from the browsers would hold `close()` open
    // (vitest.shared.ts, #191): drop them first.
    const http = server.httpServer
    if ('closeAllConnections' in http) http.closeAllConnections()
    await new Promise<void>((done) => http.close(() => done()))
    rmSync(outDir, { recursive: true, force: true })
  }
}
