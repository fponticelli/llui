// @vitest-environment node
/**
 * The gallery SHELL gets the same gate as the path documents (#268): no
 * `serious`/`critical` axe violation, intact markup, and no runtime fault —
 * across its distinct surfaces: the index, a single-path entry, the compare
 * view, a path that draws nothing, an unknown entry, a corrected link, the
 * narrow layout with its navigation open, and the dark shell theme.
 *
 * The framed documents are audited as their own cases
 * (`audit.browser.test.ts`); here axe runs with `iframes: false`.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  type PresentationScenarioEnvironment,
} from '@llui/cli/presentation-scenarios'
import { formatAxeFinding, runAxe } from './gates/axe'
import { DocumentPool } from './gates/document-page'
import { probeMarkup } from './gates/markup-probe'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const base = inject('galleryBase')
let browser: Browser
let pool: DocumentPool

beforeAll(async () => {
  browser = await hermetic.launch({ headless: true })
  pool = new DocumentPool(browser, base, 4)
})
afterAll(async () => {
  await pool?.close()
  await browser?.close()
})

interface ShellSurface {
  readonly name: string
  readonly query: string
  readonly frames: number
  readonly environment?: Partial<PresentationScenarioEnvironment>
  /** Bring the surface into the state under audit. */
  readonly prepare?: (page: Page) => Promise<void>
}

const SURFACES: readonly ShellSurface[] = [
  { name: 'index', query: '', frames: 0 },
  { name: 'index, dark', query: '', frames: 0, environment: { theme: 'dark' } },
  { name: 'single-path entry', query: '?entry=checkbox', frames: 1 },
  { name: 'compare view', query: '?entry=dialog&view=compare&case=modal', frames: 2 },
  { name: 'a path that draws nothing', query: '?entry=button&path=baseline', frames: 0 },
  { name: 'unknown entry', query: '?entry=date-pickr', frames: 0 },
  { name: 'corrected link', query: '?entry=accordion&case=exploded', frames: 1 },
  {
    name: 'narrow layout, navigation open',
    query: '?entry=tabs',
    frames: 1,
    environment: { viewport: 'narrow' },
    async prepare(page) {
      await page.getByRole('button', { name: 'Components' }).click()
      await page.locator('#gallery-nav').waitFor({ state: 'visible' })
    },
  },
]

describe.concurrent('the gallery shell (#268)', () => {
  it.each(SURFACES.map((surface): [string, ShellSurface] => [`shell › ${surface.name}`, surface]))(
    '%s',
    async (title, surface) => {
      const problems = await pool.withHref(
        surface.query === '' ? './' : surface.query,
        { environment: { ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT, ...surface.environment } },
        async (opened) => {
          await surface.prepare?.(opened.page)
          const axe = await runAxe(opened.page)
          const markup = await opened.page.evaluate(probeMarkup)
          expect(axe.passedRules, `${title}: axe judged nothing`).toBeGreaterThan(5)
          expect(markup.elements, `${title}: markup probe saw no DOM`).toBeGreaterThan(20)
          return [...axe.findings.map(formatAxeFinding), ...markup.findings, ...opened.faultLines()]
        },
        { shell: { frames: surface.frames } },
      )
      expect(problems, title).toEqual([])
    },
  )
})
