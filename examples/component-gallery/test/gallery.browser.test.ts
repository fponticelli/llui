// @vitest-environment node
/**
 * The Component Gallery, built for production and driven in real Chromium
 * (#267). Covers the acceptance criteria end to end: the two styling systems
 * never share a document cascade (measured on the built CSSOM, both ways),
 * deep links and aliases, path switching that keeps the scenario, history,
 * missing entries, a failing document, declared-only environment controls,
 * narrow layouts and the keyboard.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Browser, Frame, Page } from 'playwright'
import { collectCascade, type CascadeInventory } from './cascade-probe'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

// The production build and its preview server are the browser project's
// shared fixture (`test/gates/global-setup.ts`, #268): built once for every
// browser suite instead of once per file.
const base = inject('galleryBase')
let browser: Browser

beforeAll(async () => {
  browser = await hermetic.launch({ headless: true })
})

afterAll(async () => {
  await browser?.close()
})

async function open(query: string, viewport = { width: 1400, height: 1000 }): Promise<Page> {
  const page = await browser.newPage({ viewport })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  ;(page as Page & { errors: string[] }).errors = errors
  await page.goto(`${base}${query}`)
  return page
}

function pageErrors(page: Page): string[] {
  return (page as Page & { errors: string[] }).errors
}

async function readyFrame(page: Page, path: 'baseline' | 'registry'): Promise<Frame> {
  const handle = await page.waitForSelector(
    `.frame-panel[data-path="${path === 'baseline' ? 'baseline' : 'registryTailwind'}"] iframe`,
  )
  const frame = await handle.contentFrame()
  if (frame === null) throw new Error(`no ${path} frame`)
  await frame.waitForSelector('html[data-gallery-status="ready"]')
  return frame
}

const TAILWIND_SIGNATURE = (inventory: CascadeInventory) =>
  inventory.rules.filter(({ properties }) => properties.some((name) => name.startsWith('--tw-')))
const BASELINE_PART_RULES = (inventory: CascadeInventory) =>
  inventory.rules.filter(({ selector }) => selector.includes('[data-scope='))
const TOKEN_ONLY = (properties: readonly string[]) =>
  properties.every((name) => name.startsWith('--') || name === 'color-scheme')

describe('the two path documents never share a cascade (#267)', () => {
  // One entry per family on both paths, plus the shell itself.
  const ENTRIES = ['checkbox', 'tabs', 'dialog', 'color-picker']

  it.each(ENTRIES)('%s: each document carries only its own styling system', async (entry) => {
    const page = await open(`?entry=${entry}&view=compare`)
    const baseline = await (await readyFrame(page, 'baseline')).evaluate(collectCascade)
    const registry = await (await readyFrame(page, 'registry')).evaluate(collectCascade)
    const shell = await page.evaluate(collectCascade)

    // Vacuity: each probe saw a real cascade of the kind it should.
    expect(baseline.ruleCount).toBeGreaterThan(200)
    expect(BASELINE_PART_RULES(baseline).length).toBeGreaterThan(100)
    expect(registry.layerNames).toContain('utilities')
    expect(TAILWIND_SIGNATURE(registry).length).toBeGreaterThan(20)

    // Baseline: no Tailwind output of any kind.
    expect(TAILWIND_SIGNATURE(baseline)).toEqual([])
    // Registry: not one baseline part selector.
    expect(BASELINE_PART_RULES(registry)).toEqual([])
    // Baseline rules are UNLAYERED — which is exactly why they would beat
    // every utility if they ever reached the registry cascade. So the
    // registry document may not carry an unlayered rule of the baseline's
    // own (anything but token definitions and each document's frame
    // chrome), and the baseline document carries no cascade layer at all.
    const frameChrome = /^(html, body|#gallery-document|html\[data-|\[data-gallery-)/
    const baselineStyles = new Set(
      baseline.rules
        .filter(
          ({ layers, properties, selector }) =>
            layers.length === 0 && !TOKEN_ONLY(properties) && !frameChrome.test(selector),
        )
        .map(({ selector }) => selector),
    )
    expect(baselineStyles.size).toBeGreaterThan(200)
    expect(
      registry.rules
        .filter(({ layers, selector }) => layers.length === 0 && baselineStyles.has(selector))
        .map(({ selector }) => selector),
    ).toEqual([])
    expect(baseline.layerNames).toEqual([])
    // Every stylesheet a document applies is its own build's.
    expect(baseline.sheets.every((href) => href === null || href.includes('/baseline/'))).toBe(true)
    expect(registry.sheets.every((href) => href === null || href.includes('/registry/'))).toBe(true)

    // The shell loads neither system.
    expect(TAILWIND_SIGNATURE(shell)).toEqual([])
    expect(BASELINE_PART_RULES(shell)).toEqual([])
    expect(shell.rules.some(({ properties }) => properties.includes('--primary'))).toBe(false)
    expect(pageErrors(page)).toEqual([])
    await page.close()
  })
})

describe('navigation', () => {
  it('deep-links an entry, case and path, and renders both documents', async () => {
    const page = await open('?entry=checkbox&view=compare&case=checked')
    await page.locator('main h1', { hasText: /^Checkbox$/ }).waitFor()
    for (const path of ['baseline', 'registry'] as const) {
      const frame = await readyFrame(page, path)
      await expect(
        frame.locator('#gallery-scenario').getAttribute('data-scenario-case'),
      ).resolves.toBe('checked')
    }
    expect(await page.title()).toBe('Checkbox — Checked · Component Gallery · LLui')
    await page.close()
  })

  it('finds an alias from the search field and lands on its canonical entry', async () => {
    const page = await open('')
    await page.keyboard.press('/')
    await expect(page.evaluate(() => document.activeElement?.id)).resolves.toBe('gallery-search')
    await page.keyboard.type('dropdown')
    await page.locator('.entry-list li').first().filter({ hasText: /^Menu/ }).waitFor()
    await page.keyboard.press('Enter')
    await page.waitForURL(/entry=menu/)
    await page.locator('main h1', { hasText: /^Menu$/ }).waitFor()
    await expect(page.evaluate(() => document.activeElement?.id)).resolves.toBe('gallery-main')
    await page.close()
  })

  it('switches path keeping the scenario and environment, and history walks back', async () => {
    const page = await open('?entry=accordion&case=closed&dir=rtl')
    const baselineFrame = await readyFrame(page, 'baseline')
    expect(await baselineFrame.evaluate(() => document.documentElement.dir)).toBe('rtl')
    await page.getByRole('radio', { name: 'Registry skins' }).check()
    await page.waitForURL(/path=registry/)
    expect(new URL(page.url()).search).toBe('?entry=accordion&path=registry&case=closed&dir=rtl')
    const registryFrame = await readyFrame(page, 'registry')
    expect(await registryFrame.evaluate(() => document.documentElement.dir)).toBe('rtl')
    await page.goBack()
    expect(new URL(page.url()).search).toBe('?entry=accordion&case=closed&dir=rtl')
    await readyFrame(page, 'baseline')
    await page.goForward()
    await readyFrame(page, 'registry')
    await page.reload()
    await readyFrame(page, 'registry')
    expect(new URL(page.url()).search).toBe('?entry=accordion&path=registry&case=closed&dir=rtl')
    await page.close()
  })

  it('enables only the environment axes the scenario declares', async () => {
    const page = await open('?entry=accordion&case=closed')
    const firstRadio = (name: string) =>
      page
        .locator('fieldset.segmented', { has: page.locator(`legend:text-is("${name}")`) })
        .getByRole('radio')
        .first()
    expect(await firstRadio('Direction').isDisabled()).toBe(false)
    expect(await firstRadio('Theme').isDisabled()).toBe(true)
    expect(await firstRadio('Motion').isDisabled()).toBe(true)
    await page.close()
  })

  it('applies a declared dark theme and reduced motion inside the document, not the shell', async () => {
    // dialog/modal declares theme, direction, motion and forced colors.
    const probe = async (query: string) => {
      const page = await open(query)
      const frame = await readyFrame(page, 'baseline')
      const facts = await frame.evaluate(() => {
        const seconds = (value: string) =>
          Math.max(...value.split(',').map((part) => parseFloat(part) || 0))
        let longest = 0
        for (const element of Array.from(document.querySelectorAll('*'))) {
          const style = getComputedStyle(element)
          longest = Math.max(
            longest,
            seconds(style.transitionDuration),
            seconds(style.animationDuration),
          )
        }
        // Tokens are oklch()/color-mix(), which computed style returns
        // VERBATIM (docs/agents/styling.md): paint the colour and read the
        // pixel back instead of parsing the string.
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const context = canvas.getContext('2d')!
        context.fillStyle = getComputedStyle(document.body).backgroundColor
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
        return {
          theme: document.documentElement.dataset.theme,
          motion: document.documentElement.dataset.motion,
          background: [red!, green!, blue!],
          longestMotionSeconds: longest,
        }
      })
      const shellTheme = await page.locator('.gallery').getAttribute('data-theme')
      await page.close()
      return { ...facts, shellTheme }
    }
    const full = await probe('?entry=dialog&case=modal')
    const reduced = await probe('?entry=dialog&case=modal&theme=dark&motion=reduced')

    expect(full).toMatchObject({ theme: 'light', motion: 'full' })
    expect(reduced).toMatchObject({ theme: 'dark', motion: 'reduced' })
    // Dark tokens reached the document's own surface.
    expect(Math.min(...full.background)).toBeGreaterThan(200)
    expect(Math.max(...reduced.background)).toBeLessThan(80)
    // The scenario really animates at full motion, and the axis collapses it.
    expect(full.longestMotionSeconds).toBeGreaterThan(0.05)
    expect(reduced.longestMotionSeconds).toBeLessThanOrEqual(0.001)
    // The shell's own scheme is independent of the scenario's.
    expect(reduced.shellTheme).toBe('system')
  })

  it('pins a narrow viewport into the framed document', async () => {
    // table/default declares the viewport axis.
    const page = await open('?entry=table&case=default&viewport=narrow')
    const frame = await readyFrame(page, 'baseline')
    expect(await frame.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(390)
    expect(await frame.evaluate(() => document.documentElement.dataset.viewport)).toBe('narrow')
    await page.close()
  })

  it('explains a path that draws nothing instead of framing it', async () => {
    const page = await open('?entry=button&path=baseline')
    await page
      .locator('.frame-panel[data-path="baseline"] [role="note"]', { hasText: 'Not applicable' })
      .waitFor()
    expect(await page.locator('iframe').count()).toBe(0)
    await page.close()
  })

  it('handles an unknown entry with suggestions', async () => {
    const page = await open('?entry=date-pickr')
    expect(await page.locator('.not-found h1').textContent()).toBe(
      'No component named “date-pickr”',
    )
    await page.locator('.suggestions a', { hasText: 'Date Picker' }).click()
    await page.waitForURL(/entry=date-picker/)
    await page.close()
  })

  it('corrects an invalid link and says so', async () => {
    const page = await open('?entry=accordion&case=exploded')
    expect(await page.locator('.notices').textContent()).toContain('has no “exploded” scenario')
    expect(new URL(page.url()).search).toBe('?entry=accordion')
    await page.close()
  })

  it('reports a document that fails to load, and recovers on retry', async () => {
    const page = await browser.newPage()
    const failing = (url: URL) =>
      url.pathname.endsWith('/registry/') && url.searchParams.get('entry') === 'switch'
    await page.route(failing, (route) =>
      route.fulfill({ status: 500, contentType: 'text/html', body: '<h1>boom</h1>' }),
    )
    await page.goto(`${base}?entry=switch&path=registry`)
    const alert = page.locator('.frame-error[role="alert"]')
    await alert.filter({ hasText: 'could not render' }).waitFor()
    await page.unroute(failing)
    await alert.getByRole('button', { name: 'Retry' }).click()
    await readyFrame(page, 'registry')
    await alert.waitFor({ state: 'detached' })
    await page.close()
  })
})

describe('layout and keyboard', () => {
  it('collapses navigation behind a toggle on a narrow screen', async () => {
    const page = await open('?entry=tabs', { width: 390, height: 800 })
    const nav = page.locator('#gallery-nav')
    const toggle = page.getByRole('button', { name: 'Components' })
    await nav.waitFor({ state: 'hidden' })
    expect(await toggle.getAttribute('aria-expanded')).toBe('false')
    await toggle.click()
    expect(await toggle.getAttribute('aria-expanded')).toBe('true')
    await nav.waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await nav.waitFor({ state: 'hidden' })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await page.close()
  })

  it('offers a skip link and keyboard-reachable entry links with visible focus', async () => {
    const page = await open('')
    await page.keyboard.press('Tab')
    await expect(page.evaluate(() => document.activeElement?.className)).resolves.toBe('skip-link')
    const link = page.locator('.entry-link').first()
    await link.focus()
    const outline = await link.evaluate((element) => getComputedStyle(element).outlineStyle)
    expect(outline).toBe('solid')
    await page.keyboard.press('Enter')
    await page.waitForURL(/entry=/)
    await page.close()
  })
})
