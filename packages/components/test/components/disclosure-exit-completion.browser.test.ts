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

  it('sibling-instance isolation: a fast accordion sharing a container never settles a slow sibling early (#264 review item 1)', async () => {
    // Both siblings start with item 'x' OPEN; close both at (nearly) the
    // same time. A's exit is 60ms, B's is 500ms. If either watcher resolved
    // content by a container-wide `[data-scope][data-part]` query instead of
    // its own `opts.id`-scoped content id, A's watcher (or B's) could pick up
    // the WRONG sibling's DOM node and settle B's still-animating exit the
    // moment A's short animation ends.
    await page.evaluate(() => {
      window.__sibASend!({ type: 'close', value: 'x' })
      window.__sibBSend!({ type: 'close', value: 'x' })
    })
    const stateOf = (rootId: string): Promise<string> =>
      page.evaluate(
        (id) =>
          document.querySelector(`#${id} [data-part='content']`)?.getAttribute('data-state') ?? '',
        rootId,
      )

    expect(await stateOf('sib-a-root')).toBe('closing')
    expect(await stateOf('sib-b-root')).toBe('closing')

    // Wait past A's fast (60ms) animation, but well before B's slow (500ms)
    // one — this is exactly the window where a cross-contaminated watcher
    // would wrongly settle B.
    await page.waitForFunction(
      () =>
        document.querySelector("#sib-a-root [data-part='content']")?.getAttribute('data-state') ===
        'closed',
      { timeout: 2000 },
    )
    // Give any (buggy) MutationObserver-driven cross-settle a full microtask
    // turn to have taken effect.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 30)))
    expect(await stateOf('sib-b-root')).toBe('closing')

    await page.waitForFunction(
      () =>
        document.querySelector("#sib-b-root [data-part='content']")?.getAttribute('data-state') ===
        'closed',
      { timeout: 2000 },
    )
    expect(await stateOf('sib-b-root')).toBe('closed')
  })

  it('sibling isolation: closing A (fast) then reopening it never leaks a stray settle onto B (slow, still animating)', async () => {
    // Fresh page: both start open. Close B first (slow, 500ms exit), then
    // close AND reopen A (fast, 60ms exit) — A's own settle/reopen cycle
    // must never be mistaken for B's, and B must still be genuinely
    // `closing` (not prematurely `closed`) until its own slow animation ends.
    await page.evaluate(() => window.__sibBSend!({ type: 'close', value: 'x' }))
    await page.evaluate(() => {
      window.__sibASend!({ type: 'close', value: 'x' })
    })
    await page.waitForFunction(
      () =>
        document.querySelector("#sib-a-root [data-part='content']")?.getAttribute('data-state') ===
        'closed',
      { timeout: 2000 },
    )
    await page.evaluate(() => window.__sibASend!({ type: 'open', value: 'x' }))
    await page.waitForFunction(
      () =>
        document.querySelector("#sib-a-root [data-part='content']")?.getAttribute('data-state') ===
        'open',
      { timeout: 2000 },
    )
    // B's slow (500ms) exit is still running at this point.
    expect(
      await page.evaluate(() =>
        document.querySelector("#sib-b-root [data-part='content']")?.getAttribute('data-state'),
      ),
    ).toBe('closing')
  })

  it('closes instantly, with a DEV warning, when `exitCompletion` is NOT placed at all (#264 item F1)', async () => {
    // #264 item F1 supersedes review item 4's accepted trade-off: a
    // forgotten `exitCompletion` placement no longer hangs `closing` +
    // `inert` forever. `state.exitWatchers` holds a mount COUNT keyed by a
    // per-realm session token (#264 review-264i), incremented/decremented
    // only by `exitWatcherAttach`/`exitWatcherDetach` — sent only by a real
    // `exitCompletion` mount/cleanup — so with `exitCompletion` never
    // placed the count stays 0 and the reducer's `animated &&
    // isExitWatched(exitWatchers)` gate never engages retention at all —
    // the close is instant, exactly as `animated: false` would be. The dev
    // warning lives
    // at the `connect()` boundary (a closure flag), never inside the
    // reducer, so it fires only for the CLICK-driven path it can actually
    // observe — a real trigger click, not a raw programmatic `send`,
    // matching `completeIfUnanimatedAfterToggle`'s identical scope.
    const warnings: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text())
    })

    await clickTrigger('host-no-part', 'x') // open -> closed, instantly

    const settled = await contentState('host-no-part', 'x')
    expect(settled).toEqual({ state: 'closed', hidden: true, inert: true })
    expect(warnings.some((w) => w.includes('exitCompletion'))).toBe(true)
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
