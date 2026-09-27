// @vitest-environment node

/**
 * #265 finding 6, in both actual demos: `dir="rtl"` on the APP CONTAINER
 * (`#app`), never on `<html>`. The dropdown menu portals its content to
 * `<body>`, OUTSIDE that container, so every direction consumer must resolve
 * from the menu's ANCHOR rather than from where the portal landed:
 *
 *  - the portaled content computes `rtl` (CSS logical properties mirror);
 *  - `bottom-start` aligns the content to the trigger's inline-START edge,
 *    which under rtl is its physical RIGHT;
 *  - real keys: ArrowRight does NOT open the submenu, ArrowLeft does, and
 *    ArrowRight closes it again;
 *  - the submenu opens to the physical LEFT of its subtrigger.
 *
 * An LTR run of the same steps is the control arm. Real pointer and keyboard
 * input only (`locator.click()`, `page.keyboard`) — never a synthetic
 * `dispatchEvent`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

interface Demo {
  readonly name: string
  readonly dir: string
  readonly menuId: string
  readonly subValue: string
}

const DEMOS: readonly Demo[] = [
  { name: 'baseline', dir: 'examples/components-demo', menuId: 'menu-demo', subValue: 'Share' },
  { name: 'registry', dir: 'examples/registry-demo', menuId: 'demo-dropdown', subValue: 'team' },
]

async function startExample(directory: string): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    root: resolve(repoRoot, directory),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error(`Vite did not bind ${directory} to a TCP port`)
  }
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

describe('menus under an RTL APP CONTAINER, in both demos (#265 finding 6)', () => {
  let browser: Browser
  const servers: ViteDevServer[] = []
  const urls: Record<string, string> = {}

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    for (const demo of DEMOS) {
      const { server, url } = await startExample(demo.dir)
      servers.push(server)
      urls[demo.name] = url
      // Warm the cold dev server (dependency pre-bundling) HERE, under the
      // hook's own budget, so no test pays for it against its 30 s timeout.
      const warm = await browser.newPage()
      await warm.goto(url)
      await warm.locator('#app').waitFor({ state: 'attached', timeout: 90_000 })
      await warm.close()
    }
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await Promise.all(servers.map((server) => server.close()))
  })

  async function open(demo: Demo, dir: 'ltr' | 'rtl'): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(urls[demo.name]!)
    await page.locator(`#${demo.menuId}\\:trigger`).waitFor({ state: 'attached' })
    await page.evaluate((value) => {
      document.getElementById('app')!.setAttribute('dir', value)
    }, dir)
    return page
  }

  /** Resolve once `id` is floating-attached (the engine writes `data-side`
   * with its first computed position) and two more frames have painted. */
  const attached = async (page: Page, id: string): Promise<void> => {
    await page.locator(`[id="${id}"][data-side]`).waitFor({ state: 'visible' })
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    )
  }

  const box = async (page: Page, id: string) => {
    const rect = await page.locator(`[id="${id}"]`).boundingBox()
    if (rect === null) throw new Error(`${id} has no box`)
    return rect
  }

  for (const demo of DEMOS) {
    for (const dir of ['ltr', 'rtl'] as const) {
      it(`${demo.name}: a portaled dropdown and its submenu follow a ${dir} app container`, async () => {
        const page = await open(demo, dir)
        const ids = {
          trigger: `${demo.menuId}:trigger`,
          content: `${demo.menuId}:content`,
          subTrigger: `${demo.menuId}:sub:${demo.subValue}:trigger`,
          subContent: `${demo.menuId}:sub:${demo.subValue}:content`,
        }
        const [forward, back] =
          dir === 'rtl' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft']
        try {
          await page.locator(`[id="${ids.trigger}"]`).scrollIntoViewIfNeeded()
          await page.locator(`[id="${ids.trigger}"]`).click()
          const content = page.locator(`[id="${ids.content}"]`)
          await attached(page, ids.content)

          // Portaled OUT of the container, yet resolved from the anchor.
          const facts = await content.evaluate((node) => ({
            insideApp: node.closest('#app') !== null,
            direction: getComputedStyle(node).direction,
          }))
          expect(facts).toEqual({ insideApp: false, direction: dir })

          // bottom-start → the inline-START edges line up.
          const [t, c] = await Promise.all([box(page, ids.trigger), box(page, ids.content)])
          const startGap = dir === 'rtl' ? c.x + c.width - (t.x + t.width) : c.x - t.x
          expect(Math.abs(startGap), 'inline-start alignment').toBeLessThanOrEqual(1.5)

          // Walk the real highlight down to the submenu's trigger.
          const subTrigger = page.locator(`[id="${ids.subTrigger}"]`)
          for (let step = 0; step < 8; step++) {
            if ((await subTrigger.getAttribute('data-highlighted')) !== null) break
            await page.keyboard.press('ArrowDown')
          }
          expect(await subTrigger.getAttribute('data-highlighted')).not.toBeNull()

          // The BACKWARD arrow must not open it; the forward one must.
          await page.keyboard.press(back)
          expect(await subTrigger.getAttribute('aria-expanded')).toBe('false')
          await page.keyboard.press(forward)
          const subContent = page.locator(`[id="${ids.subContent}"]`)
          await attached(page, ids.subContent)
          expect(await subTrigger.getAttribute('aria-expanded')).toBe('true')

          // It opens away from the inline-start edge: physical LEFT under rtl.
          const [st, sc] = await Promise.all([box(page, ids.subTrigger), box(page, ids.subContent)])
          if (dir === 'rtl') expect(sc.x + sc.width).toBeLessThanOrEqual(st.x + 0.5)
          else expect(sc.x).toBeGreaterThanOrEqual(st.x + st.width - 0.5)
          expect(await subContent.evaluate((node) => getComputedStyle(node).direction)).toBe(dir)

          // And the backward arrow closes it again.
          await page.keyboard.press(back)
          await subContent.waitFor({ state: 'detached' })
          expect(await subTrigger.getAttribute('aria-expanded')).toBe('false')
        } finally {
          await page.close()
        }
      })
    }
  }
})
