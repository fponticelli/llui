// @vitest-environment node
/**
 * The per-case gate (#268). Every rendered case of every canonical entry, on
 * every path that draws it, is opened as its OWN isolated path document in
 * real Chromium (`gates/matrix.ts` `gateCases()` — derived, never listed) and
 * must
 *
 *   1. settle `ready` — rendered coverage in a real browser, one test per
 *      case (the jsdom half is `coverage.test.ts`);
 *   2. have intact markup: no duplicate ids, no broken idrefs, no content
 *      model violations (`gates/markup-probe.ts`);
 *   3. produce no console error, uncaught exception, failed or off-origin
 *      request (`gates/document-page.ts`);
 *   4. [audit cases] have no `serious`/`critical` axe violation (WCAG 2.2
 *      A/AA + best practice) — every case, and its dark rendering wherever it
 *      declares the theme axis (`gates/a11y-exemptions.ts` is closed at both
 *      ends);
 *   5. [visual cases] match its per-path screenshot baseline, or — where the
 *      baselines cannot be compared — render deterministically
 *      (`gates/visual.ts` has the rule, the tolerance and the workflow).
 *
 * One test per (entry, path, case, environment), titled
 * `<entry> › <path> › <case> › <env>`, and every problem of every kind is
 * collected before it fails, so one red case lists everything wrong with it.
 */
import { join, relative } from 'node:path'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { galleryDocumentHref, GALLERY_PATH_SEGMENTS } from '@llui/cli/gallery'
import { DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT } from '@llui/cli/presentation-scenarios'
import { formatAxeFinding, runAxe } from './gates/axe'
import { applyExemptions } from './gates/a11y-exemptions'
import { DocumentPool, settleAnimations } from './gates/document-page'
import { probeMarkup } from './gates/markup-probe'
import {
  auditCases,
  caseKey,
  caseTitle,
  gateCases,
  notRenderedPaths,
  renderedCases,
  visualCases,
  type GateCase,
  type NotRenderedPath,
} from './gates/matrix'
import {
  BASELINE_DIR,
  MANIFEST_PATH,
  baselinePath,
  captureStable,
  comparePngs,
  describeEnvironment,
  readManifest,
  sameEnvironment,
  visualOutputDir,
  withinTolerance,
  writeFileEnsuringDir,
  type VisualEnvironment,
  type VisualManifest,
} from './gates/visual'

const base = inject('galleryBase')
const CASES = gateCases()
const VISUAL_KEYS = visualCases().map(caseKey).sort()
const UPDATE = process.env['LLUI_VISUAL_UPDATE'] === '1'
const REQUIRED = process.env['LLUI_VISUAL_REQUIRED'] === '1'
const manifest = readManifest()

let browser: Browser
let pool: DocumentPool
let environment: VisualEnvironment
/** Captures recorded this run, for a baseline (update) or a candidate set (CI). */
const recorded = new Map<string, { width: number; height: number }>()

type VisualMode = 'update' | 'compare' | 'determinism' | 'unavailable'
let visualMode: VisualMode

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  pool = new DocumentPool(browser, base, 4)
  environment = { browser: browser.version(), platform: process.platform, arch: process.arch }
  visualMode = UPDATE
    ? 'update'
    : manifest !== undefined && sameEnvironment(manifest.environment, environment)
      ? 'compare'
      : REQUIRED
        ? 'unavailable'
        : 'determinism'
  if (UPDATE) rmSync(BASELINE_DIR, { recursive: true, force: true })
  if (writesCandidates()) rmSync(candidateDir(), { recursive: true, force: true })
})

afterAll(async () => {
  await pool?.close()
  await browser?.close()
  if (visualMode === 'update' || writesCandidates()) {
    // Only a COMPLETE capture may become a manifest: a filtered run must never
    // truncate the baseline set.
    if (recorded.size !== VISUAL_KEYS.length) return
    const next: VisualManifest = {
      version: 1,
      environment,
      cases: Object.fromEntries([...recorded].sort(([a], [b]) => a.localeCompare(b))),
    }
    const target = visualMode === 'update' ? MANIFEST_PATH : join(candidateDir(), 'manifest.json')
    writeFileEnsuringDir(target, `${JSON.stringify(next, null, 2)}\n`)
  }
})

/** CI writes every capture as a complete, CI-environment candidate baseline set. */
function writesCandidates(): boolean {
  return REQUIRED && (visualMode === 'compare' || visualMode === 'unavailable')
}

function candidateDir(): string {
  return join(visualOutputDir(), 'visual-baselines')
}

function unavailableReason(): string {
  const where =
    manifest === undefined
      ? 'no baselines are recorded yet'
      : `the baselines were recorded on ${describeEnvironment(manifest.environment)}`
  return (
    `visual baselines cannot be compared on ${describeEnvironment(environment)} (${where}). ` +
    'This run wrote a complete candidate set, captured in THIS environment, to ' +
    `${relative(process.cwd(), candidateDir())} (the CI job uploads it as the ` +
    '`visual-baselines` artifact): review it and commit it as ' +
    'examples/component-gallery/test/visual-baselines/.'
  )
}

async function reRender(page: Page): Promise<void> {
  await page.reload()
  await page.waitForSelector('html[data-gallery-status="ready"]', { state: 'attached' })
  await settleAnimations(page)
}

/** Screenshot checks for one case; returns problems, writes artifacts. */
async function visualProblems(page: Page, galleryCase: GateCase): Promise<string[]> {
  const key = caseKey(galleryCase)
  const actual = await captureStable(page)
  if (visualMode === 'compare') {
    if (writesCandidates()) writeFileEnsuringDir(join(candidateDir(), `${key}.png`), actual)
    const comparison = await comparePngs(page, actual, readFileSync(baselinePath(key)))
    if (writesCandidates() || !withinTolerance(comparison)) {
      recorded.set(key, { width: comparison.width, height: comparison.height })
    }
    if (withinTolerance(comparison)) return []
    const out = visualOutputDir()
    writeFileEnsuringDir(join(out, 'actual', `${key}.png`), actual)
    if (comparison.diffPng !== undefined) {
      writeFileEnsuringDir(join(out, 'diff', `${key}.png`), comparison.diffPng)
    }
    return [
      comparison.sameSize
        ? `visual: ${comparison.differing} pixels differ from the baseline (diff: ${relative(process.cwd(), join(out, 'diff', `${key}.png`))})`
        : `visual: rendered ${comparison.width}x${comparison.height}, the baseline has a different size`,
    ]
  }
  // update / determinism / unavailable: a second, INDEPENDENT render of the
  // same case must be pixel-identical — no clock, randomness, network or
  // animation state may reach a capture — and only then is it recorded.
  await reRender(page)
  const second = await captureStable(page)
  const comparison = await comparePngs(page, actual, second)
  if (!comparison.sameSize || comparison.differing !== 0) {
    return [
      `visual: two renders of the same case differ (${comparison.sameSize ? `${comparison.differing} pixels` : 'in size'}) — it is not deterministic, so it cannot be baselined`,
    ]
  }
  if (visualMode === 'update') writeFileEnsuringDir(baselinePath(key), actual)
  if (visualMode === 'unavailable') writeFileEnsuringDir(join(candidateDir(), `${key}.png`), actual)
  if (visualMode === 'update' || visualMode === 'unavailable') {
    recorded.set(key, { width: comparison.width, height: comparison.height })
  }
  return visualMode === 'unavailable' ? [`visual: ${unavailableReason()}`] : []
}

describe('the gate matrix', () => {
  it('opens every rendered case, the audit and visual variants, each once', () => {
    const keys = CASES.map(caseKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      CASES.filter(({ audit }) => audit)
        .map(caseKey)
        .sort(),
    ).toEqual(auditCases().map(caseKey).sort())
    expect(
      CASES.filter(({ visual }) => visual)
        .map(caseKey)
        .sort(),
    ).toEqual(VISUAL_KEYS)
    for (const rendered of renderedCases()) expect(keys).toContain(caseKey(rendered))
    // Vacuity: the contract really does render hundreds of cases on both paths.
    expect(renderedCases().filter(({ path }) => path === 'baseline').length).toBeGreaterThan(300)
    expect(
      renderedCases().filter(({ path }) => path === 'registryTailwind').length,
    ).toBeGreaterThan(300)
  })

  it('has a baseline for exactly the visual matrix — none missing, none orphaned', (ctx) => {
    if (UPDATE) ctx.skip()
    if (manifest === undefined) {
      if (REQUIRED) throw new Error(unavailableReason())
      return ctx.skip()
    }
    expect(Object.keys(manifest.cases).sort()).toEqual(VISUAL_KEYS)
    const onDisk: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const file = join(dir, name)
        if (statSync(file).isDirectory()) walk(file)
        else if (name.endsWith('.png')) onDisk.push(relative(BASELINE_DIR, file).slice(0, -4))
      }
    }
    if (existsSync(BASELINE_DIR)) walk(BASELINE_DIR)
    expect(onDisk.sort()).toEqual(VISUAL_KEYS)
  })
})

describe.concurrent('every rendered case (#268)', () => {
  it.each(CASES.map((galleryCase): [string, GateCase] => [caseTitle(galleryCase), galleryCase]))(
    '%s',
    async (title, galleryCase) => {
      const problems = await pool.with(galleryCase, async (opened) => {
        const found: string[] = []
        if (opened.status !== 'ready') {
          found.push(
            `document settled "${opened.status}" (${opened.error ?? 'no code'}), not ready`,
          )
        }
        const markup = await opened.page.evaluate(probeMarkup)
        expect(markup.elements, `${title}: markup probe saw no DOM`).toBeGreaterThan(5)
        found.push(...markup.findings)
        if (galleryCase.audit) {
          const axe = await runAxe(opened.page)
          expect(axe.passedRules, `${title}: axe judged nothing`).toBeGreaterThan(5)
          const { remaining, obsolete } = applyExemptions(galleryCase, axe.findings)
          found.push(...remaining.map(formatAxeFinding))
          found.push(...obsolete.map((key) => `obsolete a11y exemption (no longer occurs): ${key}`))
        }
        // Faults are read BEFORE the visual pass re-renders the page.
        found.push(...opened.faultLines())
        if (galleryCase.visual && opened.status === 'ready') {
          found.push(...(await visualProblems(opened.page, galleryCase)))
        }
        return found
      })
      expect(problems, title).toEqual([])
    },
  )
})

describe.concurrent('every path that draws nothing says why (#268)', () => {
  it.each(
    notRenderedPaths().map((item): [string, NotRenderedPath] => [
      `${item.entry} › ${GALLERY_PATH_SEGMENTS[item.path]} › ${item.coverage.mode}`,
      item,
    ]),
  )('%s', async (_title, item) => {
    const href = galleryDocumentHref({ path: item.path, entry: item.entry }, { base: '' })
    const seen = await pool.withHref(
      href,
      { environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT },
      async (opened) => ({
        status: opened.status,
        error: opened.error,
        alert: await opened.page.locator('[role="alert"][data-gallery-error]').textContent(),
        faults: opened.faultLines(),
      }),
    )
    expect(seen.status).toBe('error')
    expect(seen.error).toBe('not-rendered')
    // The contract's own rationale is what the reader is shown.
    expect(seen.alert).toContain(item.coverage.rationale)
    expect(seen.faults).toEqual([])
  })
})
