// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, BrowserContext, Page } from 'playwright'
import * as accordionMachine from '../../src/components/accordion'
import * as carouselMachine from '../../src/components/carousel'
import * as chartMachine from '../../src/components/chart'
import * as collapsibleMachine from '../../src/components/collapsible'
import { read, rootSignal } from '../_signal'
import {
  probeDarkStateHierarchy,
  probeEffectiveMotion,
  probeForcedColorCues,
  probeNarrowProduct,
  type NarrowProbe,
} from './navigation-data-browser-probes'
import { paintedColors, selfCheckPixelHarness } from './pixel-probe'
import { contrast, srgb8ToLinear } from '../../../../scripts/lib/oklch.mjs'
import { loadProductContract } from './navigation-data-contract-source'
import {
  applicableNavigationDataScenarios,
  compileNavigationDataCatalog,
  forcedColorScenarios,
  joinNavigationDataScenarios,
  scenarioEnvironmentProductIds,
} from './navigation-data-scenarios'
import { useHermeticBrowser } from '../../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const STYLES = resolve(import.meta.dirname, '../../src/styles')
const contract = loadProductContract()
const catalog = compileNavigationDataCatalog(contract)
const joined = joinNavigationDataScenarios(catalog, contract)
const baselineScenarios = applicableNavigationDataScenarios(joined, 'baseline')
const baselineProductIds = baselineScenarios.map(({ productId }) => productId).sort()
const carouselParts = carouselMachine.connect(rootSignal(), () => {}, { id: 'browser-carousel' })
const publishedDragOffset = (deltaX: number): string =>
  read(carouselParts.viewport['style.--carousel-drag-offset'], {
    ...carouselMachine.init({ count: 2 }),
    dragging: { startX: 100, deltaX },
  })!

// The `closing` disclosure phase is driven from the REAL reducer (#264
// review item 5), never a hand-typed `data-state="closing"` literal: opening
// with `animated: true` and then sending `close` is a real, observable
// reducer transition — the same construction the baseline scenario renderer
// uses — so a drift in the real machine's status vocabulary or its
// `aria-hidden`/`inert` pairing breaks this fixture instead of silently
// leaving it correct-looking.
const accordionClosingParts = accordionMachine.connect(rootSignal(), () => {}, {
  id: 'browser-accordion',
})
const accordionOpened = accordionMachine.init({
  items: ['item'],
  value: ['item'],
  animated: true,
})
// `closing` only retains when the message carries `retain: true` (#264
// review-264j) — a real trigger click stamps this from the runtime
// registry; this fixture stamps it directly, exactly as a real click would.
const accordionClosingState = accordionMachine.update(accordionOpened, {
  type: 'close',
  value: 'item',
  retain: true,
})[0]
const accordionClosingContent = accordionClosingParts.item('item').content
const accordionClosingAttrs = {
  dataState: read(accordionClosingContent['data-state'], accordionClosingState),
  ariaHidden: read(accordionClosingContent['aria-hidden'], accordionClosingState),
  inert: read(accordionClosingContent.inert, accordionClosingState),
}

const collapsibleClosingParts = collapsibleMachine.connect(rootSignal(), () => {}, {
  id: 'browser-collapsible',
})
const collapsibleOpened = collapsibleMachine.init({ open: true, animated: true })
// See the identical note above (#264 review-264j).
const collapsibleClosingState = collapsibleMachine.update(collapsibleOpened, {
  type: 'close',
  retain: true,
})[0]
const collapsibleClosingContent = collapsibleClosingParts.content
const collapsibleClosingAttrs = {
  dataState: read(collapsibleClosingContent['data-state'], collapsibleClosingState),
  ariaHidden: read(collapsibleClosingContent['aria-hidden'], collapsibleClosingState),
  inert: read(collapsibleClosingContent.inert, collapsibleClosingState),
}

// The bar/line marks' `data-series-cue` values are driven from the REAL
// `seriesCue()` assignment inside chart.ts's `connect()` (#264 review item
// 5), never hand-typed 'solid'/'short-dash' literals: a mutation that
// changed how the machine assigns cues (e.g. collapsing every series onto
// the same cue) would otherwise leave this fixture looking correct while no
// longer describing what the real machine emits.
const chartCueState = chartMachine.init({
  series: [
    { key: 'revenue', label: 'Revenue', mark: 'bar' },
    { key: 'cost', label: 'Cost', mark: 'line' },
  ],
  rows: [{ label: 'Q1', values: { revenue: 120, cost: 80 } }],
})
const chartCueParts = chartMachine.connect(rootSignal(), () => {}, { id: 'browser-chart' })
const chartMarkCue = (seriesKey: string): string => {
  const mark = chartMachine.geometry(chartCueState).marks.find((m) => m.seriesKey === seriesKey)
  if (mark === undefined) throw new Error(`no mark for series ${seriesKey}`)
  return read(chartCueParts.markProps(mark)['data-series-cue'], chartCueState)
}
const revenueCue = chartMarkCue('revenue')
const costCue = chartMarkCue('cost')
const css = [
  'semantic-tokens.css',
  'semantic-tokens-dark.css',
  'foundation.css',
  'disclosure-navigation.css',
  'data-display.css',
  'motion.css',
]
  .map((file) => readFileSync(resolve(STYLES, file), 'utf8'))
  .join('\n')

const navigationFixture = `
  <div id="tabs" data-product="tabs" data-scope="tabs" data-part="root" data-orientation="horizontal">
    <div id="tab-list" data-scope="tabs" data-part="list" role="tablist" aria-orientation="horizontal">
      <button id="tab-inactive" data-forced-state="regular" data-scope="tabs" data-part="trigger" data-state="inactive">Summary</button>
      <button id="tab-active" data-forced-state="selected" data-scope="tabs" data-part="trigger" data-state="active" aria-selected="true">Details</button>
      <button data-scope="tabs" data-part="trigger" data-state="inactive" data-disabled>History</button>
    </div>
    <div data-scope="tabs" data-part="panel" data-state="active">Tab content</div>
  </div>

  <div data-product="accordion" data-scope="accordion" data-part="root">
    <div id="accordion-item" data-scope="accordion" data-part="item">
      <button id="accordion-closed" data-scope="accordion" data-part="trigger" data-state="closed">Closed <svg></svg></button>
      <button id="accordion-open" data-scope="accordion" data-part="trigger" data-state="open">Open <svg id="accordion-chevron"></svg></button>
      <div id="accordion-content" data-motion-state data-scope="accordion" data-part="content" data-state="open">Details</div>
      <div id="accordion-content-closing" data-scope="accordion" data-part="content" data-state="${accordionClosingAttrs.dataState}" ${accordionClosingAttrs.ariaHidden === undefined ? '' : `aria-hidden="${accordionClosingAttrs.ariaHidden}"`} ${accordionClosingAttrs.inert ? 'inert' : ''}>Closing details</div>
    </div>
    <div data-scope="accordion" data-part="item"></div>
  </div>

  <div id="collapsible" data-product="collapsible" data-scope="collapsible" data-part="root">
    <button data-scope="collapsible" data-part="trigger" data-state="closed">Toggle</button>
    <div id="collapsible-closed" data-scope="collapsible" data-part="content" data-state="closed">Closed content</div>
    <div id="collapsible-open" data-motion-state data-scope="collapsible" data-part="content" data-state="open">Open content</div>
    <div id="collapsible-closing" data-scope="collapsible" data-part="content" data-state="${collapsibleClosingAttrs.dataState}" ${collapsibleClosingAttrs.ariaHidden === undefined ? '' : `aria-hidden="${collapsibleClosingAttrs.ariaHidden}"`} ${collapsibleClosingAttrs.inert ? 'inert' : ''}>Closing content</div>
  </div>

  <nav data-product="breadcrumbs" data-scope="breadcrumbs" data-part="root" aria-label="Breadcrumb">
    <ol id="breadcrumb-list" data-scope="breadcrumbs" data-part="list">
      <li data-scope="breadcrumbs" data-part="item"><a id="breadcrumb-link" data-forced-state="regular" data-scope="breadcrumbs" data-part="link">Projects</a></li>
      <li data-scope="breadcrumbs" data-part="separator"><svg id="breadcrumb-chevron"></svg></li>
      <li data-scope="breadcrumbs" data-part="item"><a id="breadcrumb-current" data-forced-state="current" data-scope="breadcrumbs" data-part="link" data-current aria-current="page">Alignment</a></li>
      <li><button id="breadcrumb-ellipsis" data-scope="breadcrumbs" data-part="ellipsis-trigger">…</button></li>
    </ol>
  </nav>

  <nav id="pagination" data-product="pagination" data-scope="pagination" data-part="root" aria-label="Pages">
    <button id="pagination-previous" data-scope="pagination" data-part="prev-trigger"><svg></svg>Previous</button>
    <button id="page-regular" data-forced-state="regular" data-scope="pagination" data-part="item">1</button>
    <button id="page-current" data-forced-state="current" data-scope="pagination" data-part="item" aria-current="page">2</button>
    <button data-scope="pagination" data-part="item">3</button>
    <button data-scope="pagination" data-part="item">4</button>
    <button data-scope="pagination" data-part="item">5</button>
    <button data-scope="pagination" data-part="item">6</button>
    <button data-scope="pagination" data-part="item">7</button>
    <button data-scope="pagination" data-part="item">8</button>
    <button data-scope="pagination" data-part="item">9</button>
    <button data-narrow-probe data-scope="pagination" data-part="item">10</button>
    <span data-scope="pagination" data-part="ellipsis">…</span>
    <button id="pagination-next" data-scope="pagination" data-part="next-trigger">Next<svg></svg></button>
  </nav>

  <div id="steps" data-product="steps" data-scope="steps" data-part="root" role="group">
    <div data-scope="steps" data-part="item" data-status="completed"><button id="step-completed" data-scope="steps" data-part="trigger" data-status="completed">1</button><span id="step-separator" data-scope="steps" data-part="separator" data-status="completed"></span></div>
    <div data-scope="steps" data-part="item" data-status="current"><button id="step-current" data-forced-state="current" data-scope="steps" data-part="trigger" data-status="current" aria-current="step">2</button><span data-scope="steps" data-part="separator" data-status="current"></span></div>
    <div data-scope="steps" data-part="item" data-status="error"><button id="step-error" data-forced-state="error" data-scope="steps" data-part="trigger" data-status="error">3</button></div>
  </div>

  <nav data-product="toc" data-scope="toc" data-part="root">
    <ul id="toc-list" data-scope="toc" data-part="list">
      <li data-scope="toc" data-part="item"><a id="toc-link" data-forced-state="regular" data-scope="toc" data-part="link">Overview</a></li>
      <li data-scope="toc" data-part="item"><button id="toc-open" data-scope="toc" data-part="expand-trigger" data-state="open">›</button><a id="toc-current" data-forced-state="current" data-scope="toc" data-part="link" data-active aria-current="location">API</a></li>
    </ul>
  </nav>

  <div data-product="tree-view" data-scope="tree-view" data-part="root" role="tree">
    <div id="tree-selected" data-forced-state="selected" data-scope="tree-view" data-part="item" data-depth="0" data-selected role="treeitem"><button id="tree-open" data-scope="tree-view" data-part="branch-trigger" data-state="open">›</button>src</div>
    <div id="tree-regular" data-forced-state="regular" data-scope="tree-view" data-part="item" data-depth="1" role="treeitem">index.ts</div>
  </div>

  <section id="carousel" data-product="carousel" data-scope="carousel" data-part="root">
    <div id="carousel-viewport" data-scope="carousel" data-part="viewport"><div id="carousel-track" data-motion-state data-scope="carousel" data-part="track"><div data-scope="carousel" data-part="slide" data-active>Slide</div></div></div>
    <button id="carousel-previous" data-narrow-probe data-narrow-affordance data-logical-side="start" data-scope="carousel" data-part="prev-trigger"><svg></svg></button>
    <button id="carousel-next" data-narrow-affordance data-logical-side="end" data-scope="carousel" data-part="next-trigger"><svg></svg></button>
    <div data-scope="carousel" data-part="indicator-group"><button id="carousel-dot" data-narrow-affordance data-logical-side="flow" data-scope="carousel" data-part="indicator" tabindex="-1"></button><button id="carousel-dot-active" data-narrow-affordance data-logical-side="flow" data-scope="carousel" data-part="indicator" data-active aria-selected="true" tabindex="0"></button></div>
  </section>
`

const dataFixture = `
  <span data-product="chip" data-scope="chip" data-part="chip" style="--chip-hue:188.5">Lab</span>
  <div data-product="avatar">
    <div id="avatar" data-density="comfortable" data-scope="avatar" data-part="root"><span id="avatar-fallback" data-scope="avatar" data-part="fallback">LL</span></div>
    <div id="avatar-compact" data-density="compact" data-scope="avatar" data-part="root"><span data-scope="avatar" data-part="fallback">LL</span></div>
  </div>

  <div data-product="progress" data-scope="progress" data-part="root"><span id="progress-label" data-scope="progress" data-part="label">Uploading</span><div id="progress-track" data-scope="progress" data-part="track"><div id="progress-range" data-motion-state data-scope="progress" data-part="range" data-state="loading" style="width:60%"></div></div></div>
  <div data-scope="progress" data-part="root"><div id="progress-track-indeterminate" data-scope="progress" data-part="track"><div id="progress-indeterminate" data-motion-state data-scope="progress" data-part="range" data-state="indeterminate"></div></div></div>
  <div data-scope="progress" data-part="root" data-orientation="vertical" style="height:128px"><div id="progress-track-vertical" data-scope="progress" data-part="track" data-orientation="vertical"><div id="progress-range-vertical" data-scope="progress" data-part="range" data-orientation="vertical" data-state="loading" style="height:60%"></div></div></div>
  <div data-scope="progress" data-part="root" data-orientation="vertical" style="height:128px"><div id="progress-track-vertical-indeterminate" data-scope="progress" data-part="track" data-orientation="vertical"><div id="progress-vertical-indeterminate" data-scope="progress" data-part="range" data-orientation="vertical" data-state="indeterminate"></div></div></div>

  <div data-product="meter" data-scope="meter" data-part="root" data-state="critical">
    <span id="meter-label" data-scope="meter" data-part="label">Quota</span>
    <div id="meter-track" data-scope="meter" data-part="track">
      <div id="meter-critical" data-scope="meter" data-part="range" data-state="critical" style="inline-size:82%"></div>
      <div id="meter-optimal" data-forced-state="optimal" data-scope="meter" data-part="band" data-state="optimal" style="inset-inline-start:0;inline-size:34%"></div>
      <div id="meter-suboptimal" data-forced-state="suboptimal" data-scope="meter" data-part="band" data-state="suboptimal" style="inset-inline-start:34%;inline-size:33%"></div>
      <div id="meter-critical-band" data-forced-state="critical" data-scope="meter" data-part="band" data-state="critical" style="inset-inline-start:67%;inline-size:33%"></div>
      <div id="meter-marker" data-scope="meter" data-part="marker" data-state="critical" style="inset-inline-start:82%"></div>
    </div>
    <span data-forced-label="optimal">Optimal range</span>
    <span data-forced-label="suboptimal">Caution range</span>
    <span data-forced-label="critical">Critical range</span>
  </div>

  <div data-product="chart" data-forced-required-modes="cartesian polar">
  <div id="chart" data-forced-mode="cartesian" data-scope="chart" data-part="root" data-coord="cartesian" data-domain="value">
    <svg id="chart-svg" data-scope="chart" data-part="svg" role="img" tabindex="0" viewBox="0 0 300 150">
      <path id="chart-grid" data-scope="chart" data-part="grid" d="M20 40H280"></path>
      <path id="chart-bar" data-forced-state="bar" data-scope="chart" data-part="mark" data-mark="bar" data-series="revenue" data-series-cue="${revenueCue}" style="--mark-color:var(--chart-1)" d="M30 40H80V130H30Z"></path>
      <path id="chart-line" data-forced-state="line" data-scope="chart" data-part="mark" data-mark="line" data-series="cost" data-series-cue="${costCue}" style="--mark-color:var(--chart-2)" d="M30 100L150 50L270 80"></path>
      <path id="chart-dimmed" data-scope="chart" data-part="mark" data-mark="line" data-series="forecast" data-dimmed style="--mark-color:var(--chart-3)" d="M30 110L150 70L270 90"></path>
      <text id="chart-axis" data-scope="chart" data-part="axis-label">Q1</text>
    </svg>
    <span data-forced-label="revenue">Revenue, bar series</span>
    <span data-forced-label="cost">Cost, dashed line series</span>
    <button id="chart-legend" data-scope="chart" data-part="legend-item" data-dimmed><span id="chart-legend-swatch" data-scope="chart" data-part="legend-swatch"></span>Forecast</button>
    <div id="chart-tooltip" data-scope="chart" data-part="tooltip" role="status">Q1 · 120</div>
    <table id="chart-table" data-scope="chart" data-part="table"><caption>Chart data</caption></table>
  </div>

  <div data-forced-mode="polar" data-scope="chart" data-part="root" data-coord="polar" data-domain="value">
    <svg data-scope="chart" data-part="svg" role="img" tabindex="0" viewBox="0 0 300 150">
      <path data-forced-state="bar" data-forced-mode="polar" data-scope="chart" data-part="mark" data-mark="bar" data-series="revenue" data-series-cue="${revenueCue}" d="M150 75L150 15A60 60 0 0 1 210 75Z"></path>
      <path data-forced-state="line" data-forced-mode="polar" data-scope="chart" data-part="mark" data-mark="line" data-series="cost" data-series-cue="${costCue}" d="M150 15L210 75L150 135L90 75Z"></path>
    </svg>
    <span data-forced-label="revenue">Revenue, polar bar series</span>
    <span data-forced-label="cost">Cost, dashed polar line series</span>
  </div>
  </div>

  <div id="sparkline" data-product="sparkline" data-scope="sparkline" data-part="root">
    <svg id="sparkline-svg" data-scope="sparkline" data-part="svg" role="img" tabindex="0" viewBox="0 0 120 32">
      <path data-scope="sparkline" data-part="line" d="M0 20L40 10L80 18L120 4"></path>
      <circle id="spark-above" data-forced-state="above" data-scope="sparkline" data-part="dot" data-tone="above" cx="80" cy="18" r="2"></circle>
      <circle id="spark-below" data-forced-state="below" data-scope="sparkline" data-part="dot" data-tone="below" data-last cx="120" cy="4" r="2"></circle>
    </svg>
    <span data-forced-label="above">Above reference range</span>
    <span data-forced-label="below">Below reference range</span>
    <table id="spark-table" data-scope="sparkline" data-part="table"><caption>Trend data</caption></table>
  </div>

  <div data-product="table">
    <div id="table-scrollport" data-scope="table" data-part="viewport" style="width:240px">
    <table id="table" data-density="comfortable" data-scope="table" data-part="root" role="grid">
      <thead><tr><th id="table-sort" data-scope="table" data-part="column-header" aria-sort="ascending">Name</th><th data-scope="table" data-part="column-header">Status</th><th data-scope="table" data-part="column-header">Owner with a long heading</th></tr></thead>
      <tbody><tr id="table-row" data-forced-state="selected" data-scope="table" data-part="row" data-selected aria-selected="true"><td data-narrow-probe data-scope="table" data-part="cell">A very long project name</td><td data-scope="table" data-part="cell">Active</td><td data-scope="table" data-part="cell"><span id="row-check" data-scope="table" data-part="row-checkbox" data-state="checked" role="checkbox">✓</span>Platform</td></tr><tr id="table-row-regular" data-forced-state="regular" data-scope="table" data-part="row"><td data-scope="table" data-part="cell">Short</td><td data-scope="table" data-part="cell">Paused</td><td data-scope="table" data-part="cell">Web</td></tr></tbody>
    </table>
    </div>
    <div data-scope="table" data-part="viewport">
      <table data-density="compact" data-scope="table" data-part="root" role="grid"><thead><tr><th id="table-compact-head" data-scope="table" data-part="column-header">Name</th></tr></thead><tbody><tr data-scope="table" data-part="row"><td id="table-compact-cell" data-scope="table" data-part="cell">Alpha</td></tr></tbody></table>
    </div>
  </div>

  <div id="data-table-host" data-product="data-table" style="position:relative;height:120px">
    <div id="data-loading" data-scope="data-table" data-part="loading-overlay" aria-busy="true" aria-live="polite">Loading</div>
    <div id="data-empty" data-forced-state="empty" data-scope="data-table" data-part="empty-state" role="status" aria-live="polite">No results</div>
    <div id="data-error" data-forced-state="error" data-narrow-probe data-scope="data-table" data-part="error-state" role="alert" aria-live="polite">Could not load</div>
    <div data-scope="table" data-part="viewport"><table data-density="compact" data-scope="table" data-part="root"><thead><tr><th id="data-table-compact-head" data-scope="table" data-part="column-header">Name</th></tr></thead><tbody><tr data-scope="table" data-part="row"><td id="data-table-compact-cell" data-scope="table" data-part="cell">Alpha</td></tr></tbody></table></div>
  </div>

  <div id="marquee" data-product="marquee" data-scope="marquee" data-part="root" data-axis="horizontal" data-direction="right" data-running style="--marquee-duration:20s;--marquee-direction:reverse;--marquee-playstate:running"><div id="marquee-content" data-motion-state data-scope="marquee" data-part="content">One · Two · Three · One · Two · Three</div></div>
  <div id="marquee-vertical" data-scope="marquee" data-part="root" data-axis="vertical"><div id="marquee-content-vertical" data-scope="marquee" data-part="content">One · Two · One · Two</div></div>
`

async function pageWith(context: BrowserContext, body: string): Promise<Page> {
  const page = await context.newPage()
  await page.setContent(
    `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`,
  )
  return page
}

describe('navigation/data baseline presentation in Chromium', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await hermetic.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('renders every canonical product with an applicable baseline presentation', async () => {
    const context = await browser.newContext()
    const page = await pageWith(context, navigationFixture + dataFixture)
    const rendered = await page
      .locator('[data-product]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-product')).filter((value) => value !== null),
      )
    await context.close()

    expect(rendered.sort()).toEqual(baselineProductIds)
  })

  it('turns applicable compact scenario inputs into denser, still-usable geometry', async () => {
    const context = await browser.newContext()
    const page = await pageWith(context, navigationFixture + dataFixture)
    const geometry = await page.evaluate(() => {
      const size = (id: string) => {
        const rect = document.getElementById(id)!.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }
      return {
        avatar: { comfortable: size('avatar'), compact: size('avatar-compact') },
        table: { comfortable: size('table-sort'), compact: size('table-compact-head') },
        dataTable: { compact: size('data-table-compact-head') },
      }
    })
    await context.close()

    expect(geometry.avatar.compact.width).toBeLessThan(geometry.avatar.comfortable.width)
    expect(geometry.avatar.compact.height).toBeGreaterThanOrEqual(24)
    expect(geometry.table.compact.height).toBeLessThan(geometry.table.comfortable.height)
    expect(geometry.table.compact.height).toBeGreaterThanOrEqual(24)
    expect(geometry.dataTable.compact.height).toBe(geometry.table.compact.height)
  })

  it('contains a wide native table only through the official viewport part', async () => {
    const context = await browser.newContext({ viewport: { width: 280, height: 480 } })
    const raw = await pageWith(
      context,
      '<table data-scope="table" data-part="root"><tbody><tr><td>wide</td></tr></tbody></table>',
    )
    const rawOverflow = await raw.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    await raw.close()

    const official = await pageWith(
      context,
      '<div id="owned" data-scope="table" data-part="viewport"><table data-scope="table" data-part="root"><tbody><tr><td>wide</td></tr></tbody></table></div>',
    )
    const contained = await official.evaluate(() => {
      const viewport = document.getElementById('owned')!
      return {
        pageContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        localOverflow: viewport.scrollWidth > viewport.clientWidth,
        overflowX: getComputedStyle(viewport).overflowX,
      }
    })
    await context.close()

    expect(rawOverflow).toBe(true)
    expect(contained).toEqual({ pageContained: true, localOverflow: true, overflowX: 'auto' })
  })

  it('makes navigation and disclosure states visible through their semantic attributes', async () => {
    const context = await browser.newContext()
    const page = await pageWith(context, navigationFixture)
    await page.locator('#accordion-content').evaluate((content) => {
      for (const animation of content.getAnimations()) animation.finish()
    })
    const got = await page.evaluate(() => {
      const style = (id: string, pseudo?: string): CSSStyleDeclaration =>
        getComputedStyle(document.getElementById(id)!, pseudo)
      return {
        tabs: {
          listHeight: style('tab-list').height,
          listBackground: style('tab-list').backgroundColor,
          inactiveBackground: style('tab-inactive').backgroundColor,
          activeBackground: style('tab-active').backgroundColor,
          activeShadow: style('tab-active').boxShadow,
        },
        accordion: {
          itemBorder: style('accordion-item').borderBottomWidth,
          chevronTransform: style('accordion-chevron').transform,
          contentPaddingEnd: style('accordion-content').paddingBottom,
          contentAnimation: style('accordion-content').animationName,
          keyframes: [...document.styleSheets].flatMap((sheet) =>
            [...sheet.cssRules]
              .filter((rule): rule is CSSKeyframesRule => rule instanceof CSSKeyframesRule)
              .map((rule) => rule.name),
          ),
        },
        collapsible: {
          gap: style('collapsible').gap,
          closedDisplay: style('collapsible-closed').display,
          openDisplay: style('collapsible-open').display,
        },
        breadcrumbs: {
          listDisplay: style('breadcrumb-list').display,
          regularColor: style('breadcrumb-link').color,
          currentColor: style('breadcrumb-current').color,
          currentPointerEvents: style('breadcrumb-current').pointerEvents,
          ellipsisSize: [style('breadcrumb-ellipsis').width, style('breadcrumb-ellipsis').height],
        },
        pagination: {
          regularBackground: style('page-regular').backgroundColor,
          currentBackground: style('page-current').backgroundColor,
          wraps: style('pagination').flexWrap,
        },
        steps: {
          currentColor: style('step-current').color,
          errorColor: style('step-error').color,
          separatorColor: style('step-separator').backgroundColor,
          foreground: style('step-current').getPropertyValue('--foreground').trim(),
          primary: style('step-current').getPropertyValue('--primary').trim(),
          destructive: style('step-error').getPropertyValue('--destructive').trim(),
        },
        toc: {
          currentWeight: style('toc-current').fontWeight,
          currentBorder: style('toc-current').borderInlineStartWidth,
          openTransform: style('toc-open').transform,
        },
        tree: {
          regularBackground: style('tree-regular').backgroundColor,
          selectedBackground: style('tree-selected').backgroundColor,
          openTransform: style('tree-open').transform,
        },
        carousel: {
          overflow: style('carousel-viewport').overflow,
          regularDot: style('carousel-dot', '::before').backgroundColor,
          activeDot: style('carousel-dot-active', '::before').backgroundColor,
          targets: [
            'carousel-previous',
            'carousel-next',
            'carousel-dot',
            'carousel-dot-active',
          ].map((id): [number, number] => {
            const rect = document.getElementById(id)!.getBoundingClientRect()
            return [rect.width, rect.height]
          }),
          visuals: ['carousel-dot', 'carousel-dot-active'].map((id) => [
            style(id, '::before').width,
            style(id, '::before').height,
          ]),
        },
      }
    })
    await context.close()

    expect(got.tabs.listHeight).toBe('36px')
    expect(got.tabs.listBackground).not.toBe('rgba(0, 0, 0, 0)')
    expect(got.tabs.activeBackground).not.toBe(got.tabs.inactiveBackground)
    expect(got.tabs.activeShadow).not.toBe('none')
    expect(got.accordion.itemBorder).toBe('1px')
    expect(got.accordion.chevronTransform).not.toBe('none')
    expect(got.accordion.contentPaddingEnd).toBe('16px')
    expect(got.accordion.contentAnimation).toBe('accordion-down')
    expect(got.accordion.keyframes).toEqual(
      expect.arrayContaining(['accordion-down', 'accordion-up']),
    )
    expect(got.collapsible).toEqual({ gap: '8px', closedDisplay: 'none', openDisplay: 'block' })
    expect(got.breadcrumbs.listDisplay).toBe('flex')
    expect(got.breadcrumbs.currentColor).not.toBe(got.breadcrumbs.regularColor)
    expect(got.breadcrumbs.currentPointerEvents).toBe('none')
    expect(got.breadcrumbs.ellipsisSize).toEqual(['36px', '36px'])
    expect(got.pagination.currentBackground).not.toBe(got.pagination.regularBackground)
    expect(got.pagination.wraps).toBe('wrap')
    expect(got.steps.currentColor).toBe(got.steps.foreground)
    expect(got.steps.errorColor).toBe(got.steps.destructive)
    expect(got.steps.separatorColor).toBe(got.steps.primary)
    expect(got.toc.currentWeight).toBe('500')
    expect(got.toc.currentBorder).toBe('1px')
    expect(got.toc.openTransform).not.toBe('none')
    expect(got.tree.selectedBackground).not.toBe(got.tree.regularBackground)
    expect(got.tree.openTransform).not.toBe('none')
    expect(got.carousel.overflow).toBe('hidden')
    expect(got.carousel.activeDot).not.toBe(got.carousel.regularDot)
    expect(got.carousel.targets.every(([width, height]) => width >= 24 && height >= 24)).toBe(true)
    expect(got.carousel.visuals).toEqual([
      ['8px', '8px'],
      ['8px', '8px'],
    ])
  })

  it('gives dense data, status, measurement, and visualization surfaces usable defaults', async () => {
    const context = await browser.newContext()
    const page = await pageWith(context, dataFixture)
    const got = await page.evaluate(() => {
      const style = (id: string, pseudo?: string): CSSStyleDeclaration =>
        getComputedStyle(document.getElementById(id)!, pseudo)
      const tableScrollport = document.getElementById('table-scrollport')!
      return {
        avatar: [style('avatar').width, style('avatar').height, style('avatar-fallback').fontSize],
        progress: {
          labelWeight: style('progress-label').fontWeight,
          track: style('progress-track').backgroundColor,
          range: style('progress-range').backgroundColor,
          transitionedProperties: style('progress-range').transitionProperty.split(', '),
          verticalTrack: [
            style('progress-track-vertical').width,
            style('progress-track-vertical').height,
          ],
          verticalRangeWidth: style('progress-range-vertical').width,
          horizontalIndeterminate: {
            animation: style('progress-indeterminate').animationName,
            ratio:
              document.getElementById('progress-indeterminate')!.getBoundingClientRect().width /
              document.getElementById('progress-track-indeterminate')!.getBoundingClientRect()
                .width,
          },
          verticalIndeterminate: {
            animation: style('progress-vertical-indeterminate').animationName,
            width: style('progress-vertical-indeterminate').width,
            ratio:
              document.getElementById('progress-vertical-indeterminate')!.getBoundingClientRect()
                .height /
              document
                .getElementById('progress-track-vertical-indeterminate')!
                .getBoundingClientRect().height,
          },
        },
        meter: {
          labelWeight: style('meter-label').fontWeight,
          trackHeight: style('meter-track').height,
          optimal: style('meter-optimal').backgroundColor,
          criticalBand: style('meter-critical-band').backgroundColor,
          criticalRange: style('meter-critical').backgroundColor,
          markerWidth: style('meter-marker').width,
        },
        chart: {
          rootPosition: style('chart').position,
          svgHeight: Number.parseFloat(style('chart-svg').height),
          gridStroke: style('chart-grid').stroke,
          barFill: style('chart-bar').fill,
          lineFill: style('chart-line').fill,
          lineStroke: style('chart-line').stroke,
          dimmedOpacity: style('chart-dimmed').opacity,
          axisFill: style('chart-axis').fill,
          legendOpacity: style('chart-legend').opacity,
          legendDecoration: style('chart-legend').textDecorationLine,
          legendSwatchOpacity: style('chart-legend-swatch').opacity,
          tooltipPosition: style('chart-tooltip').position,
          fallbackClip: style('chart-table').clipPath,
        },
        sparkline: {
          aboveFill: style('spark-above').fill,
          belowFill: style('spark-below').fill,
          belowStroke: style('spark-below').stroke,
          fallbackClip: style('spark-table').clipPath,
        },
        table: {
          display: style('table').display,
          clientWidth: tableScrollport.clientWidth,
          scrollWidth: tableScrollport.scrollWidth,
          overflowX: style('table-scrollport').overflowX,
          regularRow: style('table-row-regular').backgroundColor,
          selectedRow: style('table-row').backgroundColor,
          sortGlyph: style('table-sort', '::after').content,
          checkboxBorder: style('row-check').borderWidth,
        },
        dataTable: {
          loadingPosition: style('data-loading').position,
          loadingBackdrop: style('data-loading').backdropFilter,
          emptyAlign: style('data-empty').textAlign,
          errorBorder: style('data-error').borderWidth,
        },
        marquee: {
          rootOverflow: style('marquee').overflow,
          contentDisplay: style('marquee-content').display,
          animationName: style('marquee-content').animationName,
          animationDirection: style('marquee-content').animationDirection,
          mask: style('marquee').maskImage,
          verticalDirection: style('marquee-content-vertical').flexDirection,
          verticalAnimation: style('marquee-content-vertical').animationName,
          verticalMask: style('marquee-vertical').maskImage,
        },
      }
    })
    await context.close()

    expect(got.avatar).toEqual(['32px', '32px', '14px'])
    expect(got.progress.labelWeight).toBe('500')
    expect(got.progress.track).not.toBe(got.progress.range)
    expect(got.progress.transitionedProperties).toContain('width')
    expect(got.progress.verticalTrack).toEqual(['8px', '128px'])
    expect(got.progress.verticalRangeWidth).toBe('8px')
    expect(got.progress.horizontalIndeterminate.animation).toBe('llui-progress-indeterminate')
    expect(got.progress.horizontalIndeterminate.ratio).toBeCloseTo(0.33, 2)
    expect(got.progress.verticalIndeterminate.animation).toBe(
      'llui-progress-indeterminate-vertical',
    )
    expect(got.progress.verticalIndeterminate.width).toBe('8px')
    expect(got.progress.verticalIndeterminate.ratio).toBeCloseTo(0.33, 2)
    expect(got.meter.labelWeight).toBe('500')
    expect(got.meter.trackHeight).toBe('8px')
    expect(new Set([got.meter.optimal, got.meter.criticalBand, got.meter.criticalRange]).size).toBe(
      3,
    )
    expect(got.meter.markerWidth).toBe('2px')
    expect(got.chart.rootPosition).toBe('relative')
    expect(got.chart.svgHeight).toBeGreaterThan(100)
    expect(got.chart.gridStroke).not.toBe('none')
    expect(got.chart.barFill).not.toBe(got.chart.lineStroke)
    expect(got.chart.lineFill).toBe('none')
    expect(Number(got.chart.dimmedOpacity)).toBeLessThan(0.5)
    expect(got.chart.axisFill).not.toBe('rgb(0, 0, 0)')
    // A dimmed series fades its SWATCH and strikes its label; the label is a
    // live toggle's text and keeps full opacity (#268 audit: an item-wide
    // opacity took it to 1.7:1).
    expect(Number(got.chart.legendOpacity)).toBe(1)
    expect(got.chart.legendDecoration).toBe('line-through')
    expect(Number(got.chart.legendSwatchOpacity)).toBeLessThan(0.5)
    expect(got.chart.tooltipPosition).toBe('absolute')
    expect(got.chart.fallbackClip).toBe('inset(50%)')
    expect(got.sparkline.aboveFill).not.toBe(got.sparkline.belowFill)
    expect(got.sparkline.belowStroke).not.toBe('none')
    expect(got.sparkline.fallbackClip).toBe('inset(50%)')
    expect(got.table.display).toBe('table')
    expect(got.table.clientWidth).toBe(240)
    expect(got.table.scrollWidth).toBeGreaterThan(got.table.clientWidth)
    expect(got.table.overflowX).toBe('auto')
    expect(got.table.selectedRow).not.toBe(got.table.regularRow)
    expect(got.table.sortGlyph).toMatch(/[↑▲]/)
    expect(got.table.checkboxBorder).toBe('1px')
    expect(got.dataTable.loadingPosition).toBe('absolute')
    expect(got.dataTable.loadingBackdrop).not.toBe('none')
    expect(got.dataTable.emptyAlign).toBe('center')
    expect(got.dataTable.errorBorder).toBe('1px')
    expect(got.marquee.rootOverflow).toBe('hidden')
    expect(got.marquee.contentDisplay).toBe('flex')
    expect(got.marquee.animationName).toBe('llui-marquee-scroll')
    expect(got.marquee.animationDirection).toBe('reverse')
    expect(got.marquee.mask).toContain('to right')
    expect(got.marquee.verticalDirection).toBe('column')
    expect(got.marquee.verticalAnimation).toBe('llui-marquee-scroll-vertical')
    expect(got.marquee.verticalMask).not.toContain('to right')
    expect(got.marquee.verticalMask).not.toBe(got.marquee.mask)
  })

  it('gives retained accordion and collapsible surfaces real enter/exit motion', async () => {
    const context = await browser.newContext({ reducedMotion: 'no-preference' })
    const page = await pageWith(context, navigationFixture)
    const motion = await page.evaluate(() => {
      const read = (id: string) => {
        const element = document.getElementById(id)!
        const style = getComputedStyle(element)
        return {
          animation: style.animationName,
          duration: style.animationDuration,
          display: style.display,
          pointerEvents: style.pointerEvents,
          ariaHidden: element.getAttribute('aria-hidden'),
          inert: element.hasAttribute('inert'),
        }
      }
      return {
        accordionOpen: read('accordion-content'),
        accordionClosing: read('accordion-content-closing'),
        collapsibleOpen: read('collapsible-open'),
        collapsibleClosing: read('collapsible-closing'),
      }
    })
    await context.close()

    expect(motion.accordionOpen.animation).toBe('accordion-down')
    expect(motion.accordionClosing.animation).toBe('accordion-up')
    expect(motion.collapsibleOpen.animation).toBe('collapse-down')
    expect(motion.collapsibleClosing.animation).toBe('collapse-up')
    for (const surface of [motion.accordionClosing, motion.collapsibleClosing]) {
      expect(Number.parseFloat(surface.duration)).toBeGreaterThan(0.001)
      expect(surface.display).not.toBe('none')
      expect(surface.pointerEvents).toBe('none')
      expect(surface.ariaHidden).toBe('true')
      expect(surface.inert).toBe(true)
    }

    const reduced = await browser.newContext({ reducedMotion: 'reduce' })
    const reducedPage = await pageWith(reduced, navigationFixture)
    const durations = await reducedPage.evaluate(() =>
      [
        'accordion-content',
        'accordion-content-closing',
        'collapsible-open',
        'collapsible-closing',
      ].map((id) =>
        Number.parseFloat(getComputedStyle(document.getElementById(id)!).animationDuration),
      ),
    )
    await reduced.close()
    expect(durations.every((duration) => duration <= 0.001)).toBe(true)
  })

  it('contains every narrow and responsive-affordance scenario at full width', async () => {
    // The protocol's `viewport` axis is canonically two-valued
    // (`wide`/`narrow`, see PRESENTATION_SCENARIO_ENVIRONMENT_VALUES) rather
    // than a specific breakpoint list, so a case declaring the axis is
    // exercised at one representative pixel width per side.
    const directions = ['ltr', 'rtl'] as const
    const products: Record<string, NarrowProbe> = {}
    const widths = [280, 1024] as const
    const productsSupportingViewport = scenarioEnvironmentProductIds(baselineScenarios, 'viewport')
    for (const width of widths) {
      for (const direction of directions) {
        const context = await browser.newContext({ viewport: { width, height: 720 } })
        for (const productId of productsSupportingViewport) {
          const page = await pageWith(context, navigationFixture + dataFixture)
          await page.evaluate((dir) => {
            document.documentElement.dir = dir
          }, direction)
          products[`${width}:${direction}:${productId}`] = await probeNarrowProduct(page, productId)
          await page.close()
        }
        await context.close()
      }
    }

    expect(Object.keys(products).sort()).toEqual(
      widths
        .flatMap((width) =>
          directions.flatMap((direction) =>
            productsSupportingViewport.map((productId) => `${width}:${direction}:${productId}`),
          ),
        )
        .sort(),
    )
    expect(
      Object.entries(products).filter(
        ([, result]) =>
          !result.pageContained ||
          !result.contained ||
          result.unusableOverflow.length > 0 ||
          result.affordances.some(
            ({ containedByRoot, containedByViewport, logicalPlacement, minimumTarget, usable }) =>
              !containedByRoot ||
              !containedByViewport ||
              !logicalPlacement ||
              !minimumTarget ||
              !usable,
          ),
      ),
    ).toEqual([])
    for (const width of widths) {
      expect(products[`${width}:ltr:carousel`]?.affordances).toHaveLength(4)
      expect(products[`${width}:rtl:carousel`]?.affordances).toHaveLength(4)
    }
  })

  it('shows a tokenized keyboard focus cue on a bare carousel indicator', async () => {
    const context = await browser.newContext()
    const page = await pageWith(context, navigationFixture)
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>('button,[tabindex]')) {
        element.tabIndex = -1
      }
      document.getElementById('carousel-dot-active')!.tabIndex = 0
    })
    await page.keyboard.press('Tab')
    const focus = await page.locator('#carousel-dot-active').evaluate((element) => {
      const style = getComputedStyle(element)
      return { outline: style.outlineStyle, width: style.outlineWidth, shadow: style.boxShadow }
    })
    await context.close()

    expect(focus.outline !== 'none' || focus.shadow !== 'none').toBe(true)
    expect(Number.parseFloat(focus.width) >= 2 || focus.shadow !== 'none').toBe(true)
  })

  it('turns the machine-published pointer delta into physical track geometry and snaps to rest', async () => {
    const context = await browser.newContext()
    for (const direction of ['ltr', 'rtl'] as const) {
      for (const deltaX of [-60, 60]) {
        const offset = publishedDragOffset(deltaX)
        const page = await pageWith(
          context,
          `<section data-scope="carousel" data-part="root"><div id="drag-viewport" data-scope="carousel" data-part="viewport" data-dragging style="--carousel-drag-offset:${offset}"><div id="drag-track" data-scope="carousel" data-part="track"><div data-scope="carousel" data-part="slide">Slide</div></div></div></section>`,
        )
        await page.locator('html').evaluate((html, dir) => {
          html.setAttribute('dir', dir)
        }, direction)
        const dragging = await page.locator('#drag-track').evaluate((track) => {
          const style = getComputedStyle(track)
          return {
            x: new DOMMatrixReadOnly(style.transform).m41,
            transitionDuration: style.transitionDuration,
          }
        })
        expect(dragging.x).toBe(deltaX)
        expect(Number.parseFloat(dragging.transitionDuration)).toBe(0)

        await page.locator('#drag-viewport').evaluate((viewport) => {
          viewport.removeAttribute('data-dragging')
          viewport.style.removeProperty('--carousel-drag-offset')
        })
        await page.waitForTimeout(250)
        const restingX = await page
          .locator('#drag-track')
          .evaluate((track) => new DOMMatrixReadOnly(getComputedStyle(track).transform).m41)
        expect(restingX).toBe(0)
        await page.close()
      }
    }
    await context.close()

    const reduced = await browser.newContext({ reducedMotion: 'reduce' })
    const reducedPage = await pageWith(
      reduced,
      '<section data-scope="carousel" data-part="root"><div data-scope="carousel" data-part="viewport"><div id="reduced-track" data-scope="carousel" data-part="track">Slide</div></div></section>',
    )
    const duration = await reducedPage
      .locator('#reduced-track')
      .evaluate((track) => Number.parseFloat(getComputedStyle(track).transitionDuration))
    await reduced.close()
    expect(duration).toBeLessThanOrEqual(0.001)
  })

  it('preserves every declared state hierarchy in dark mode', async () => {
    const expected = scenarioEnvironmentProductIds(baselineScenarios, 'theme')
    const capture = async (dark: boolean) => {
      const context = await browser.newContext({ colorScheme: dark ? 'dark' : 'light' })
      const page = await pageWith(context, navigationFixture + dataFixture)
      await page.evaluate((isDark) => {
        document.documentElement.className = isDark ? 'dark' : 'light'
        document.documentElement.dataset['theme'] = isDark ? 'dark' : 'light'
      }, dark)
      const result = await probeDarkStateHierarchy(page, expected)
      await context.close()
      return result
    }
    const light = await capture(false)
    const dark = await capture(true)

    expect(Object.keys(dark).sort()).toEqual(expected)
    expect(
      expected.filter(
        (productId) =>
          new Set(dark[productId]!.signatures).size < 2 ||
          dark[productId]!.backgroundToken === light[productId]!.backgroundToken ||
          dark[productId]!.signatures.join('\n') === light[productId]!.signatures.join('\n'),
      ),
    ).toEqual([])
  })

  it('uses logical geometry for every declared RTL scenario', async () => {
    const context = await browser.newContext()
    const page = await pageWith(context, navigationFixture + dataFixture)
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl'
    })
    const got = await page.evaluate(() => {
      const style = (id: string): CSSStyleDeclaration =>
        getComputedStyle(document.getElementById(id)!)
      const carousel = document.getElementById('carousel')!.getBoundingClientRect()
      const previous = document.getElementById('carousel-previous')!.getBoundingClientRect()
      const next = document.getElementById('carousel-next')!.getBoundingClientRect()
      return {
        accordion: { textAlign: style('accordion-open').textAlign },
        breadcrumbs: { separator: style('breadcrumb-chevron').transform },
        carousel: {
          previousAtStart:
            previous.left >= carousel.left &&
            previous.right <= carousel.right &&
            previous.left > next.left,
          nextAtEnd:
            next.left >= carousel.left &&
            next.right <= carousel.right &&
            next.right < previous.right,
          icons: [
            getComputedStyle(document.querySelector('#carousel-previous svg')!).transform,
            getComputedStyle(document.querySelector('#carousel-next svg')!).transform,
          ],
        },
        marquee: { direction: style('marquee').direction, overflow: style('marquee').overflow },
        meter: {
          markerMovesTowardStart: new DOMMatrix(style('meter-marker').transform).e > 0,
        },
        pagination: {
          icons: [
            getComputedStyle(document.querySelector('#pagination-previous svg')!).transform,
            getComputedStyle(document.querySelector('#pagination-next svg')!).transform,
          ],
        },
        steps: {
          direction: style('steps').direction,
          current: style('step-current').color,
          error: style('step-error').color,
        },
        table: { textAlign: style('table-sort').textAlign },
        tabs: {
          firstToRight:
            document.getElementById('tab-inactive')!.getBoundingClientRect().left >
            document.getElementById('tab-active')!.getBoundingClientRect().left,
        },
        toc: { borders: [style('toc-list').borderLeftWidth, style('toc-list').borderRightWidth] },
        'tree-view': {
          transform: style('tree-open').transform,
          opensDownward: new DOMMatrix(style('tree-open').transform).b > 0,
          selectorMatches: document
            .getElementById('tree-open')!
            .matches(
              "[dir='rtl'] [data-scope='tree-view'][data-part='branch-trigger'][data-state='open']",
            ),
          documentDirection: document.documentElement.dir,
        },
      }
    })
    await context.close()

    const expected = scenarioEnvironmentProductIds(baselineScenarios, 'direction')
    expect(Object.keys(got).sort()).toEqual(expected)
    expect(got.accordion.textAlign).toBe('start')
    expect(got.breadcrumbs.separator).not.toBe('none')
    expect(got.carousel).toMatchObject({ previousAtStart: true, nextAtEnd: true })
    expect(got.carousel.icons.every((transform) => transform !== 'none')).toBe(true)
    expect(got.marquee).toEqual({ direction: 'rtl', overflow: 'hidden' })
    expect(got.meter.markerMovesTowardStart).toBe(true)
    expect(got.pagination.icons.every((transform) => transform !== 'none')).toBe(true)
    expect(got.steps.direction).toBe('rtl')
    expect(got.steps.current).not.toBe(got.steps.error)
    expect(got.table.textAlign).toBe('start')
    expect(got.tabs.firstToRight).toBe(true)
    expect(got.toc.borders).toEqual(['0px', '1px'])
    expect(got['tree-view']).toMatchObject({ selectorMatches: true, documentDirection: 'rtl' })
    expect(got['tree-view'].opensDownward, got['tree-view'].transform).toBe(true)
  })

  it('suppresses decorative motion and preserves essential data colours in user modes', async () => {
    const reducedExpected = scenarioEnvironmentProductIds(baselineScenarios, 'motion')
    const motion = await browser.newContext({ reducedMotion: 'no-preference' })
    const motionPage = await pageWith(motion, navigationFixture + dataFixture)
    const motionResult = await probeEffectiveMotion(motionPage, reducedExpected)
    await motion.close()

    expect(
      Object.entries(motionResult).filter(
        ([, maxDuration]) => !Number.isFinite(maxDuration) || maxDuration <= 0.001,
      ),
    ).toEqual([])

    const reduced = await browser.newContext({ reducedMotion: 'reduce' })
    const reducedPage = await pageWith(reduced, navigationFixture + dataFixture)
    const reducedResult = await probeEffectiveMotion(reducedPage, reducedExpected)
    await reduced.close()

    expect(Object.keys(reducedResult).sort()).toEqual(reducedExpected)
    expect(
      Object.entries(reducedResult).filter(
        ([, maxDuration]) =>
          !Number.isFinite(maxDuration) || maxDuration < 0 || maxDuration > 0.001,
      ),
    ).toEqual([])

    const forced = await browser.newContext({ forcedColors: 'active' })
    const forcedPage = await pageWith(forced, navigationFixture + dataFixture)

    // The pixel harness is self-checked BEFORE it is trusted (#264 review
    // item 5): both directions of the two-tone/solid discriminator every
    // `probeForcedColorCues` verdict now relies on, plus the repo's two
    // standard contrast canaries read through the SAME real paint+readback
    // path the verdict uses — never arithmetic on hand-typed constants.
    await selfCheckPixelHarness(forcedPage)
    const [black, white, midTone] = await paintedColors(forcedPage, [
      '#000000',
      '#ffffff',
      'rgb(0 0 0 / 25%)',
    ])
    expect(
      contrast(
        srgb8ToLinear([black!.r, black!.g, black!.b]),
        srgb8ToLinear([white!.r, white!.g, white!.b]),
      ),
    ).toBeCloseTo(21, 1)
    // rgb(0 0 0 / 25%) painted over the page's white background composites to
    // rgb(191,191,191) at 1.838893:1 (0.75 * 255 = 191.25, rounding
    // unambiguously — the repo's own reason for 25%, not 50%, as this canary).
    expect(
      contrast(
        srgb8ToLinear([midTone!.r, midTone!.g, midTone!.b]),
        srgb8ToLinear([white!.r, white!.g, white!.b]),
      ),
    ).toBeCloseTo(1.838893, 5)

    const forcedCases = forcedColorScenarios(baselineScenarios)
    const forcedResult = await probeForcedColorCues(forcedPage, forcedCases)
    await forced.close()

    const forcedExpected = scenarioEnvironmentProductIds(baselineScenarios, 'forcedColors')
    expect(forcedCases.map(({ productId }) => productId)).toEqual(forcedExpected)
    expect(Object.keys(forcedResult).sort()).toEqual(forcedExpected)
    expect(Object.entries(forcedResult).filter(([, result]) => !result.passes)).toEqual([])
  })
})
