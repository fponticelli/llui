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
      // A document's FIRST dev request compiles its whole family renderer on
      // demand; under a full `turbo test` that has been measured past 60 s.
      await frame!.waitForSelector('html[data-gallery-status="ready"]', { timeout: 150_000 })
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
  }, 330_000)
})
