// @vitest-environment node

// #265 finding 4 (baseline modal stacking): the backdrop and the content it
// sits behind used to be a genuine stacking hazard rather than a cosmetic
// one — `backdrop` carried an explicit `z-index` while `content` carried
// none (`z-index: auto`), and a POSITIVE explicit z-index always outranks
// `auto` in the same stacking context regardless of DOM order. Once a
// consumer actually rendered `backdrop` (which the baseline demo did not,
// until this issue), the scrim would have painted ABOVE the dialog it is
// meant to sit behind — breaking hit-testing (a click meant for the dialog
// lands on the scrim instead) and visually hiding the dialog.
//
// This proves the fix with REAL rendering rather than a CSS string
// assertion: real Chromium, `document.elementFromPoint` for hit-testing (a
// computed-style read alone cannot see PAINT order), and forced-colors
// emulation for contrast. See CLAUDE.md's styling rules: verify interaction
// state and stacking by rendering, never by reading CSS.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STYLES = resolve(import.meta.dirname, '../../src/styles')
const baselineCss = [
  'semantic-tokens.css',
  'semantic-tokens-dark.css',
  'foundation.css',
  'menus-overlays.css',
]
  .map((file) => readFileSync(resolve(STYLES, file), 'utf8'))
  .join('\n')

/** One modal surface, shaped exactly as the baseline demo now renders it
 * (`backdrop` BEFORE `content`, both under a `positioner`) — see
 * `examples/components-demo/src/sections/overlays.ts`. */
const modal = (scope: 'dialog' | 'drawer', id: string, extraContentAttrs = ''): string => `
  <div data-scope="${scope}" data-part="positioner">
    <div id="${id}-backdrop" data-scope="${scope}" data-part="backdrop" data-state="open"></div>
    <div id="${id}-content" data-scope="${scope}" data-part="content" data-state="open" tabindex="-1" ${extraContentAttrs}>
      <button id="${id}-button">Inside ${id}</button>
    </div>
  </div>`

const fixture = `<!doctype html><html><head><style>${baselineCss}</style></head><body>
  ${modal('dialog', 'dialog-a')}
</body></html>`

describe('baseline modal stacking (dialog / alert-dialog / drawer) in Chromium', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
  })

  beforeEach(async () => {
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' })
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.setContent(fixture)
  })

  afterAll(async () => {
    await page?.close()
    await browser?.close()
  })

  it('gives backdrop and content the SAME explicit z-index (never content: auto)', async () => {
    const [backdropZ, contentZ] = await Promise.all([
      page.locator('#dialog-a-backdrop').evaluate((n) => getComputedStyle(n).zIndex),
      page.locator('#dialog-a-content').evaluate((n) => getComputedStyle(n).zIndex),
    ])
    expect(backdropZ).toBe('100')
    // The regression this guards: `content` at `auto` loses to ANY positive
    // z-index on `backdrop` regardless of DOM order.
    expect(contentZ).not.toBe('auto')
    expect(contentZ).toBe(backdropZ)
  })

  it('hit-tests: a point over the dialog content resolves to content or a descendant, never the backdrop', async () => {
    const hit = await page.evaluate((id) => {
      const content = document.getElementById(`${id}-content`)!
      const rect = content.getBoundingClientRect()
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return { id: el?.id ?? null, isContentOrDescendant: content.contains(el) }
    }, 'dialog-a')
    expect(hit.isContentOrDescendant).toBe(true)
    expect(hit.id).not.toBe('dialog-a-backdrop')
  })

  it('clicking a button inside the dialog reaches the button, not the backdrop', async () => {
    await page.evaluate(() => {
      document.getElementById('dialog-a-backdrop')!.addEventListener('click', () => {
        ;(window as unknown as { __backdropClicked: boolean }).__backdropClicked = true
      })
      document.getElementById('dialog-a-button')!.addEventListener('click', () => {
        ;(window as unknown as { __buttonClicked: boolean }).__buttonClicked = true
      })
    })
    await page.locator('#dialog-a-button').click()
    const [backdropClicked, buttonClicked] = await page.evaluate(() => [
      Boolean((window as unknown as { __backdropClicked?: boolean }).__backdropClicked),
      Boolean((window as unknown as { __buttonClicked?: boolean }).__buttonClicked),
    ])
    expect(buttonClicked).toBe(true)
    expect(backdropClicked).toBe(false)
  })

  it('hit-tests a point OUTSIDE the content still resolves to the backdrop (click-outside stays dismissable)', async () => {
    const hit = await page.evaluate(() => document.elementFromPoint(5, 5)?.id ?? null)
    expect(hit).toBe('dialog-a-backdrop')
  })

  it('repeats the same z-index and hit-test guarantees for drawer and alert-dialog', async () => {
    await page.setContent(`<!doctype html><html><head><style>${baselineCss}</style></head><body>
      ${modal('drawer', 'drawer-a', 'data-side="right"')}
    </body></html>`)
    const [backdropZ, contentZ] = await Promise.all([
      page.locator('#drawer-a-backdrop').evaluate((n) => getComputedStyle(n).zIndex),
      page.locator('#drawer-a-content').evaluate((n) => getComputedStyle(n).zIndex),
    ])
    expect(contentZ).not.toBe('auto')
    expect(contentZ).toBe(backdropZ)
    const hit = await page.evaluate(() => {
      const content = document.getElementById('drawer-a-content')!
      const rect = content.getBoundingClientRect()
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return content.contains(el)
    })
    expect(hit).toBe(true)

    // alert-dialog shares the SAME `[data-scope='dialog']` CSS as dialog —
    // this pins that the shared selector actually reaches an alertdialog
    // role'd content node identically.
    await page.setContent(`<!doctype html><html><head><style>${baselineCss}</style></head><body>
      <div data-scope="dialog" data-part="positioner">
        <div id="adlg-backdrop" data-scope="dialog" data-part="backdrop" data-state="open"></div>
        <div id="adlg-content" role="alertdialog" data-scope="dialog" data-part="content" data-state="open" tabindex="-1">
          <button id="adlg-button">Confirm</button>
        </div>
      </div>
    </body></html>`)
    const adlgHit = await page.evaluate(() => {
      const content = document.getElementById('adlg-content')!
      const rect = content.getBoundingClientRect()
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return content.contains(el)
    })
    expect(adlgHit).toBe(true)
  })

  it('keeps a NESTED modal (opened over another) topmost via append order at equal z-index', async () => {
    // Two independent modals, both portalled to <body> in sequence — the
    // second (opened later) is appended AFTER the first, so at equal
    // z-index the tie breaks by DOM order and the newer modal stays on top,
    // exactly the ordering a modal STACK needs.
    await page.setContent(`<!doctype html><html><head><style>${baselineCss}</style></head><body>
      ${modal('dialog', 'outer')}
      ${modal('dialog', 'inner')}
    </body></html>`)
    const hit = await page.evaluate(() => {
      const inner = document.getElementById('inner-content')!
      const outerRect = document.getElementById('outer-content')!.getBoundingClientRect()
      // Both dialogs are centered full-viewport positioners, so they overlap;
      // sample the outer dialog's center and confirm the INNER (later, on
      // top) resolves there instead.
      const el = document.elementFromPoint(
        outerRect.left + outerRect.width / 2,
        outerRect.top + outerRect.height / 2,
      )
      return inner.contains(el)
    })
    expect(hit).toBe(true)
  })

  it('gives the backdrop a distinct, opaque forced-colors treatment behind Canvas content', async () => {
    await page.emulateMedia({ forcedColors: 'active' })
    await page.setContent(fixture)
    const [backdrop, content] = await Promise.all([
      page.locator('#dialog-a-backdrop').evaluate((n) => {
        const s = getComputedStyle(n)
        return { background: s.backgroundColor, opacity: s.opacity }
      }),
      page.locator('#dialog-a-content').evaluate((n) => {
        const s = getComputedStyle(n)
        return { background: s.backgroundColor, color: s.color, borderColor: s.borderColor }
      }),
    ])
    // Forced-colors maps both to system keywords, but they must NOT collapse
    // to the same value — that would make the dialog surface indistinguishable
    // from the page it is scrimming.
    expect(backdrop.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(backdrop.background).not.toBe(content.background)
    expect(content.background).not.toBe('rgba(0, 0, 0, 0)')
    // The backdrop is intentionally translucent (opacity 0.5) even under
    // forced-colors, so the page behind it is legible as "still there,
    // dimmed" rather than fully occluded.
    expect(Number(backdrop.opacity)).toBeCloseTo(0.5, 5)
  })
})
