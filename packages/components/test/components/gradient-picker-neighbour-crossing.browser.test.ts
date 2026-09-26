// @vitest-environment node
//
// Review finding #9: a stop dragged (real PointerEvents) or keyboard-moved
// (real KeyboardEvents) PAST its neighbour must not lose focus or pointer
// capture when the keyed `each` reorders the DOM to match the new sort
// order. `docs/agents/runtime.md`'s "keyed each/virtualEach rows are STABLE
// elements" is the framework invariant this exercises for gradient-picker's
// OWN usage — jsdom has no real pointer-capture implementation, so this
// needs a real browser (same Vite-dev-server + Playwright pattern as
// `dialog-nested-focus.browser.test.ts`).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../browser')

describe('gradient-picker: focus + pointer capture survive a neighbour-crossing reorder (finding #9)', () => {
  let browser: Browser
  let page: Page
  let server: ViteDevServer
  let fixtureUrl: string

  beforeAll(async () => {
    server = await createServer({
      root: fixtureRoot,
      logLevel: 'error',
      resolve: {
        alias: {
          '@llui/dom': resolve(fixtureRoot, '../../../dom/src/index.ts'),
          '@llui/interactions': resolve(fixtureRoot, '../../../interactions/src/index.ts'),
        },
      },
      server: { host: '127.0.0.1', port: 0 },
      define: {
        __LLUI_AGENT__: 'true',
        __LLUI_TRANSITIONS__: 'true',
      },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port')
    fixtureUrl = `http://127.0.0.1:${address.port}/gradient-picker.fixture.html`

    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  })

  beforeEach(async () => {
    await page.goto(fixtureUrl)
    await page.waitForFunction(() => window.__gpReady === true)
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  })

  it('keyboard: nudging the middle stop past the last stop keeps focus on the SAME DOM node', async () => {
    // Mark the initial middle stop (position 50) with a unique attribute so
    // we can tell "same node, moved" from "new node, replaced".
    const stopId = await page.evaluate(() => {
      const stops = Array.from(
        document.querySelectorAll('[data-scope="gradient-picker"][data-part="stop"]'),
      )
      const middle = stops.find((el) => el.getAttribute('aria-valuenow') === '50')!
      middle.setAttribute('data-test-marker', 'tracked')
      ;(middle as HTMLElement).focus()
      return middle.getAttribute('data-value')!
    })
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-test-marker')),
    ).toBe('tracked')

    // PageUp = +10 (default coarseStep) per press. 50 -> 60 -> 70 -> 80 -> 90:
    // the 4th press crosses the ORIGINAL last stop (80), forcing a re-sort.
    for (let i = 0; i < 4; i++) await page.keyboard.press('PageUp')

    const after = await page.evaluate(() => {
      const marked = document.querySelector('[data-test-marker="tracked"]')
      const stops = Array.from(
        document.querySelectorAll('[data-scope="gradient-picker"][data-part="stop"]'),
      )
      return {
        stillPresent: marked !== null,
        valueNow: marked?.getAttribute('aria-valuenow'),
        isActiveElement: document.activeElement === marked,
        markedIsLast: marked === stops[stops.length - 1],
        domOrder: stops.map((s) => s.getAttribute('data-value')),
      }
    })

    expect(after.stillPresent).toBe(true)
    expect(after.valueNow).toBe('90')
    expect(after.isActiveElement).toBe(true) // focus survived the reorder
    expect(after.markedIsLast).toBe(true) // the DOM actually reordered
    expect(after.domOrder).toContain(stopId)
  })

  it('pointer drag: dragging the middle stop past its neighbour keeps dispatching (capture survives the reorder)', async () => {
    const trackBox = await page.locator('[data-part="track"]').boundingBox()
    if (!trackBox) throw new Error('track not found')

    const middleHandle = await page.evaluateHandle(() => {
      const stops = Array.from(
        document.querySelectorAll('[data-scope="gradient-picker"][data-part="stop"]'),
      )
      const middle = stops.find((el) => el.getAttribute('aria-valuenow') === '50') as HTMLElement
      middle.setAttribute('data-test-marker', 'dragged')
      return middle
    })
    const middleBox = await (
      middleHandle.asElement() as import('playwright').ElementHandle<HTMLElement>
    ).boundingBox()
    if (!middleBox) throw new Error('middle stop not found')

    const startX = middleBox.x + middleBox.width / 2
    const startY = middleBox.y + middleBox.height / 2
    // The track spans 20%..80% at present (stops at 20/50/80 of 400px width,
    // i.e. physical x 80/200/320); drag well past the original 80% stop.
    const endX = trackBox.x + trackBox.width * 0.95
    const endY = startY

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Several intermediate moves — a real drag, not a single teleport — so
    // the reorder happens WHILE pointer capture is held, not before it.
    for (let i = 1; i <= 5; i++) {
      const x = startX + ((endX - startX) * i) / 5
      await page.mouse.move(x, endY)
    }

    const duringDrag = await page.evaluate(() => {
      const marked = document.querySelector('[data-test-marker="dragged"]')
      return {
        stillPresent: marked !== null,
        valueNow: marked ? Number(marked.getAttribute('aria-valuenow')) : null,
      }
    })
    expect(duringDrag.stillPresent).toBe(true)
    // Crossed well past the original last stop (80) — proof the drag kept
    // dispatching pointermove for THIS element after the reorder, which is
    // only possible if pointer capture (and DOM node identity) survived it;
    // a lost capture or a replaced node would freeze `valueNow` at ~80 or
    // stop updating entirely.
    expect(duringDrag.valueNow!).toBeGreaterThan(80)

    await page.mouse.up()

    const after = await page.evaluate(() => {
      const marked = document.querySelector('[data-test-marker="dragged"]')
      const stops = Array.from(
        document.querySelectorAll('[data-scope="gradient-picker"][data-part="stop"]'),
      )
      return {
        stillPresent: marked !== null,
        markedIsLast: marked === stops[stops.length - 1],
      }
    })
    expect(after.stillPresent).toBe(true)
    expect(after.markedIsLast).toBe(true)
  })
})
