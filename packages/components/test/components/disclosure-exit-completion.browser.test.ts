// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../browser')

/**
 * #264 review item 4: disclosure exit must never hang stuck `closing` +
 * `inert`. Each scenario below is a real Chromium reproduction of one of the
 * required shapes: a custom (unnamed) CSS animation skin, a transition-only
 * skin, a no-motion skin, `prefers-reduced-motion: reduce`, single-mode
 * switching between two items, a PROGRAMMATIC close (a message sent directly,
 * bypassing the trigger's click handler), a shadow-DOM-mounted instance, and
 * rapid open/close (a canceled enter must never complete an unrelated exit).
 */
describe('#264 — disclosure exit completion in Chromium', () => {
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
    fixtureUrl = `http://127.0.0.1:${address.port}/disclosure-exit.fixture.html`

    browser = await chromium.launch({ headless: true })
  })

  beforeEach(async () => {
    page = await browser.newPage()
    await page.goto(fixtureUrl)
    await page.waitForFunction(() => window.__disclosureReady === true)
  })

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  const contentState = (
    hostId: string,
    value: string,
  ): Promise<{ state: string; hidden: boolean; inert: boolean }> =>
    page.evaluate(
      ({ hostId, value }) => {
        const host = document.getElementById(hostId)!
        const content = host.querySelector<HTMLElement>(
          `[data-part='content'][data-value='${value}']`,
        )!
        return {
          state: content.dataset.state!,
          hidden: content.hidden === true,
          inert: content.hasAttribute('inert'),
        }
      },
      { hostId, value },
    )

  const clickTrigger = (hostId: string, value: string): Promise<void> =>
    page.evaluate(
      ({ hostId, value }) => {
        const host = document.getElementById(hostId)!
        const trigger = host.querySelector<HTMLElement>(
          `[data-part='trigger'][data-value='${value}']`,
        )!
        trigger.click()
      },
      { hostId, value },
    )

  it('completes a custom animation skin that never publishes --llui-disclosure-exit-animation', async () => {
    await clickTrigger('host-anim', 'x') // closed -> open (enter)
    expect((await contentState('host-anim', 'x')).state).toBe('open')
    await clickTrigger('host-anim', 'x') // open -> closing (exit)
    await page.waitForFunction(
      () =>
        document
          .querySelector("#host-anim [data-part='content'][data-value='x']")
          ?.getAttribute('data-state') === 'closed',
      { timeout: 2000 },
    )
    const final = await contentState('host-anim', 'x')
    expect(final).toEqual({ state: 'closed', hidden: true, inert: true })
  })

  it('completes a transition-only skin (#264 item 4a)', async () => {
    await clickTrigger('host-transition', 'x') // closed -> open (enter)
    await page.waitForFunction(
      () =>
        document
          .querySelector("#host-transition [data-part='content'][data-value='x']")
          ?.getAttribute('data-state') === 'open',
      { timeout: 2000 },
    )
    await clickTrigger('host-transition', 'x') // open -> closing (exit)
    await page.waitForFunction(
      () =>
        document
          .querySelector("#host-transition [data-part='content'][data-value='x']")
          ?.getAttribute('data-state') === 'closed',
      { timeout: 2000 },
    )
    const final = await contentState('host-transition', 'x')
    expect(final).toEqual({ state: 'closed', hidden: true, inert: true })
  })

  it('completes a no-motion skin immediately, synchronously with the click', async () => {
    await clickTrigger('host-none', 'x') // closed -> open (enter)
    expect((await contentState('host-none', 'x')).state).toBe('open')
    await clickTrigger('host-none', 'x') // open -> closing -> closed, same tick
    const state = await contentState('host-none', 'x')
    expect(state).toEqual({ state: 'closed', hidden: true, inert: true })
  })

  it('completes under prefers-reduced-motion: reduce (the skin genuinely runs no motion)', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await clickTrigger('host-reduced', 'x') // closed -> open (enter)
    expect((await contentState('host-reduced', 'x')).state).toBe('open')
    await clickTrigger('host-reduced', 'x') // open -> closing -> closed, same tick
    const state = await contentState('host-reduced', 'x')
    expect(state).toEqual({ state: 'closed', hidden: true, inert: true })
  })

  it('settles BOTH items when single mode switches x -> y, not only the clicked one', async () => {
    await clickTrigger('host-anim', 'x')
    await page.waitForFunction(
      () =>
        document
          .querySelector("#host-anim [data-part='content'][data-value='x']")
          ?.getAttribute('data-state') === 'open',
      { timeout: 2000 },
    )
    // Opening y closes x as a side effect of the SAME message; x must settle
    // through its own exit animation without a second click on it.
    await clickTrigger('host-anim', 'y')
    await page.waitForFunction(
      () => {
        const x = document.querySelector("#host-anim [data-part='content'][data-value='x']")
        const y = document.querySelector("#host-anim [data-part='content'][data-value='y']")
        return (
          x?.getAttribute('data-state') === 'closed' && y?.getAttribute('data-state') === 'open'
        )
      },
      { timeout: 2000 },
    )
    const x = await contentState('host-anim', 'x')
    expect(x).toEqual({ state: 'closed', hidden: true, inert: true })
  })

  it('settles a PROGRAMMATIC close sent directly, bypassing the trigger click handler (#264 item 4b)', async () => {
    const before = await page.evaluate(() => {
      const content = document.querySelector("#host-collapsible [data-part='content']")!
      return content.getAttribute('data-state')
    })
    expect(before).toBe('open')

    await page.evaluate(() => window.__collapsibleSend!({ type: 'close' }))

    await page.waitForFunction(
      () =>
        document
          .querySelector("#host-collapsible [data-part='content']")
          ?.getAttribute('data-state') === 'closed',
      { timeout: 2000 },
    )
    const content = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("#host-collapsible [data-part='content']")!
      return {
        state: el.dataset.state,
        hidden: el.hidden === true,
        inert: el.hasAttribute('inert'),
      }
    })
    expect(content).toEqual({ state: 'closed', hidden: true, inert: true })
  })

  it('settles a disclosure mounted inside a shadow root (getElementByIdInScope / root-scoped watcher)', async () => {
    const before = await page.evaluate(() => {
      const shadow = document.getElementById('host-shadow')!.shadowRoot!
      return shadow.querySelector("[data-part='content']")?.getAttribute('data-state')
    })
    expect(before).toBe('open')

    await page.evaluate(() => {
      const shadow = document.getElementById('host-shadow')!.shadowRoot!
      ;(shadow.querySelector("[data-part='trigger']") as HTMLElement).click()
    })

    const after = await page.evaluate(() => {
      const shadow = document.getElementById('host-shadow')!.shadowRoot!
      const el = shadow.querySelector<HTMLElement>("[data-part='content']")!
      return {
        state: el.dataset.state,
        hidden: el.hidden === true,
        inert: el.hasAttribute('inert'),
      }
    })
    expect(after).toEqual({ state: 'closed', hidden: true, inert: true })
  })

  it('never lets a canceled enter animation complete an unrelated exit under rapid open/close', async () => {
    // Open x (starts the enter animation), then immediately close it again
    // before the enter finishes — canceling it. The exit that starts as a
    // result must settle on its OWN generation, and must not be mistaken for
    // complete by a stray cancel/end event belonging to the interrupted enter.
    await clickTrigger('host-anim', 'x')
    await clickTrigger('host-anim', 'x')
    expect((await contentState('host-anim', 'x')).state).toBe('closing')

    await page.waitForFunction(
      () =>
        document
          .querySelector("#host-anim [data-part='content'][data-value='x']")
          ?.getAttribute('data-state') === 'closed',
      { timeout: 2000 },
    )
    const final = await contentState('host-anim', 'x')
    expect(final).toEqual({ state: 'closed', hidden: true, inert: true })
  })
})
