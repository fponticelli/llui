// @vitest-environment node
/**
 * `pnpm dev` (#267): ONE origin serving the shell plus both path documents,
 * each document through its OWN Vite server and config (middleware mode,
 * mounted under its base). This is the contributor's entry point, so it is
 * driven for real: both documents render, each with only its own cascade.
 */
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { collectCascade, type CascadeInventory } from './cascade-probe'

const GALLERY = resolve(import.meta.dirname, '..')
let server: ViteDevServer
let browser: Browser
let base: string

beforeAll(async () => {
  server = await createServer({
    configFile: resolve(GALLERY, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('dev server bound no port')
  }
  base = `http://127.0.0.1:${address.port}/`
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe('the composed dev server (#267)', () => {
  it('redirects a bare document base to its directory', async () => {
    const response = await fetch(`${base}registry`, { redirect: 'manual' })
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('/registry/')
  })

  it('serves both path documents on the shell origin, each with only its own cascade', async () => {
    const page = await browser.newPage()
    await page.goto(`${base}?entry=switch&view=compare&case=checked`)
    const cascades: CascadeInventory[] = []
    for (const path of ['baseline', 'registryTailwind']) {
      const frame = await (
        await page.waitForSelector(`.frame-panel[data-path="${path}"] iframe`)
      ).contentFrame()
      // Wait for the document to SETTLE, then require `ready`: waiting for
      // `ready` alone turned a document that settled `error` into a silent
      // full-budget wait. That is exactly how #268 found the real cause of
      // this test's "load timeouts": the three dev servers shared ONE Vite
      // dependency cache, overwrote each other's optimizer hash, and a
      // document's dependency requests came back `504 Outdated Optimize Dep`
      // (`CACHE_DIRS` in gallery.config.ts). Measured after the fix: ~4 s
      // cold, so the test runs on the workspace budget again.
      await frame!.waitForSelector(
        'html[data-gallery-status="ready"], html[data-gallery-status="error"]',
        { state: 'attached' },
      )
      const status = await frame!.evaluate(() => [
        document.documentElement.getAttribute('data-gallery-status'),
        document.documentElement.getAttribute('data-gallery-error'),
        document.body.textContent?.trim().slice(0, 300),
      ])
      expect(status, path).toEqual(['ready', null, expect.any(String)])
      cascades.push(await frame!.evaluate(collectCascade))
    }
    const [baseline, registry] = cascades as [CascadeInventory, CascadeInventory]
    const tailwind = (rules: CascadeInventory['rules']) =>
      rules.filter(({ properties }) => properties.some((name) => name.startsWith('--tw-')))
    const parts = (rules: CascadeInventory['rules']) =>
      rules.filter(({ selector }) => selector.includes('[data-scope='))
    expect(parts(baseline.rules).length).toBeGreaterThan(100)
    expect(tailwind(baseline.rules)).toEqual([])
    expect(tailwind(registry.rules).length).toBeGreaterThan(20)
    expect(parts(registry.rules)).toEqual([])
    await page.close()
  })
})
