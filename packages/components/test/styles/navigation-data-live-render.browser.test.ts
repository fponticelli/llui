// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type Alias, type ViteDevServer } from 'vite'
import { resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../../../scripts/lib/vite-source-aliases.mjs'
import { loadProductContract } from './navigation-data-contract-source'

/**
 * Closes the #264 review gap explicitly: density/closing-phase claims must be
 * measured against the REAL scenario renderer's output, in real Chromium —
 * never hand-written HTML standing in for it (that was the pre-existing
 * `navigation-data.browser.test.ts` fixture's "compact scenario geometry"
 * test, which is a real regression guard for the STYLESHEET but was never
 * evidence for the RENDERER). This file mounts
 * `mountBaselineNavigationDataScenarios` / `mountRegistryNavigationDataScenarios`
 * through a real Vite dev server for each example app and measures real
 * `getBoundingClientRect()` geometry and real `data-state`/`aria-hidden`/
 * `inert` on the live DOM those renderers produce.
 */

const repoRoot = resolve(import.meta.dirname, '../../../..')
const contract = loadProductContract()

const sourceAliases: Alias[] = [
  ...sourceAliasesFromExports({
    packageName: '@llui/components',
    packageJsonPath: resolve(repoRoot, 'packages/components/package.json'),
    srcDir: resolve(repoRoot, 'packages/components/src'),
  }),
  ...sourceAliasesFromExports({
    packageName: '@llui/dom',
    packageJsonPath: resolve(repoRoot, 'packages/dom/package.json'),
    srcDir: resolve(repoRoot, 'packages/dom/src'),
  }),
  ...sourceAliasesFromExports({
    packageName: '@llui/interactions',
    packageJsonPath: resolve(repoRoot, 'packages/interactions/package.json'),
    srcDir: resolve(repoRoot, 'packages/interactions/src'),
  }),
  ...sourceAliasesFromExports({
    packageName: '@llui/cli',
    packageJsonPath: resolve(repoRoot, 'packages/cli/package.json'),
    srcDir: resolve(repoRoot, 'packages/cli/src'),
  }),
  // The registry-demo example app's OWN `@/` alias points at ITS copied
  // `src/components/ui` / `src/lib`, not the registry SOURCE this test loads
  // directly (`registry/test/navigation-data-scenario-renderer.ts` imports
  // `registry/llui/ui/*.ts`, whose files import `@/lib/utils` / `@/ui/*`
  // exactly as a real `llui add` consumer's copy would).
  { find: '@/lib', replacement: resolve(repoRoot, 'registry/llui/lib') },
  { find: '@/ui', replacement: resolve(repoRoot, 'registry/llui/ui') },
]

async function startExample(directory: string): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    root: resolve(repoRoot, directory),
    logLevel: 'error',
    resolve: { alias: sourceAliases },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error(`Vite did not bind ${directory} to a TCP port`)
  }
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

interface Fixture {
  readonly path: 'baseline' | 'registryTailwind'
  readonly url: string
  readonly mountFn: '__mountNavigationDataBaseline' | '__mountNavigationDataRegistry'
}

declare global {
  interface Window {
    __mountNavigationDataBaseline?: (contract: unknown) => void
    __mountNavigationDataRegistry?: (contract: unknown) => void
  }
}

describe('navigation/data scenario renderer, mounted live in Chromium (#264 item C)', () => {
  let browser: Browser
  let servers: ViteDevServer[] = []
  let fixtures: Fixture[] = []

  beforeAll(async () => {
    const [baseline, registryTailwind] = await Promise.all([
      startExample('examples/components-demo'),
      startExample('examples/registry-demo'),
    ])
    servers = [baseline.server, registryTailwind.server]
    fixtures = [
      {
        path: 'baseline',
        url: `${baseline.url}src/test-fixtures/navigation-data-live-render.html`,
        mountFn: '__mountNavigationDataBaseline',
      },
      {
        path: 'registryTailwind',
        url: `${registryTailwind.url}src/test-fixtures/navigation-data-live-render.html`,
        mountFn: '__mountNavigationDataRegistry',
      },
    ]
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(servers.map((server) => server.close()))
  })

  async function openMounted(fixture: Fixture): Promise<Page> {
    const page = await browser.newPage()
    await page.goto(fixture.url)
    await page.waitForFunction(
      (fn) => typeof (window as unknown as Record<string, unknown>)[fn] === 'function',
      fixture.mountFn,
    )
    await page.evaluate(
      ({ fn, contract }) => {
        const mount = (window as unknown as Record<string, (c: unknown) => void>)[fn]
        if (mount === undefined) throw new Error(`Missing window.${fn}`)
        mount(contract)
      },
      { fn: fixture.mountFn, contract },
    )
    await page
      .locator('[data-scenario-id="component:avatar"][data-scenario-case="compact"]')
      .waitFor({ state: 'attached' })
    return page
  }

  it.each(['baseline', 'registryTailwind'] as const)(
    '%s renders a genuinely denser, still-usable compact avatar/table against the real renderer output',
    async (path) => {
      const fixture = fixtures.find((candidate) => candidate.path === path)!
      const page = await openMounted(fixture)
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)
          if (element === null) throw new Error(`Missing element for ${selector}`)
          return element.getBoundingClientRect()
        }
        const avatarComfortable = rect(
          '[data-scenario-id="component:avatar"][data-scenario-case="loaded"] [data-scope="avatar"][data-part="root"]',
        )
        const avatarCompact = rect(
          '[data-scenario-id="component:avatar"][data-scenario-case="compact"] [data-scope="avatar"][data-part="root"]',
        )
        const tableComfortableHeader = rect(
          '[data-scenario-id="component:table"][data-scenario-case="default"] [data-part="column-header"]',
        )
        const tableCompactHeader = rect(
          '[data-scenario-id="component:table"][data-scenario-case="compact"] [data-part="column-header"]',
        )
        return { avatarComfortable, avatarCompact, tableComfortableHeader, tableCompactHeader }
      })
      await page.close()

      expect(geometry.avatarCompact.width).toBeLessThan(geometry.avatarComfortable.width)
      expect(geometry.avatarCompact.height).toBeLessThan(geometry.avatarComfortable.height)
      expect(geometry.avatarCompact.height).toBeGreaterThanOrEqual(16)
      expect(geometry.tableCompactHeader.height).toBeLessThan(
        geometry.tableComfortableHeader.height,
      )
      expect(geometry.tableCompactHeader.height).toBeGreaterThanOrEqual(16)
    },
  )

  it.each(['baseline', 'registryTailwind'] as const)(
    '%s retains the accordion/collapsible closing case visibly, driven by the real reducer',
    async (path) => {
      const fixture = fixtures.find((candidate) => candidate.path === path)!
      const page = await openMounted(fixture)
      const closing = await page.evaluate(() => {
        const read = (scenarioId: string) => {
          const root = document.querySelector<HTMLElement>(
            `[data-scenario-id="${scenarioId}"][data-scenario-case="closing"]`,
          )
          if (root === null) throw new Error(`Missing closing case for ${scenarioId}`)
          const content = root.querySelector<HTMLElement>('[data-state="closing"]')
          if (content === null) throw new Error(`Missing [data-state="closing"] for ${scenarioId}`)
          const style = getComputedStyle(content)
          return {
            display: style.display,
            ariaHidden: content.getAttribute('aria-hidden'),
            inert: content.hasAttribute('inert'),
            height: content.getBoundingClientRect().height,
          }
        }
        return {
          accordion: read('component:accordion'),
          collapsible: read('component:collapsible'),
        }
      })
      await page.close()

      for (const [name, result] of Object.entries(closing)) {
        expect(result.display, name).not.toBe('none')
        expect(result.ariaHidden, name).toBe('true')
        expect(result.inert, name).toBe(true)
        expect(result.height, name).toBeGreaterThan(0)
      }
    },
  )
})
