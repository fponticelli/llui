import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ProductContractSchema } from '../../packages/cli/src/product-contract'
import { compileCandidates, markerName } from '../../scripts/lib/tailwind-compile.mjs'
import {
  registryMenusOverlaysRenderers,
  renderRegistryMenusOverlays,
} from './menus-overlays.fixture'
import {
  menusOverlaysScenarios,
  type MenusOverlaysCaseInput,
  type MenusOverlaysScenario,
} from '../../scripts/lib/menus-overlays-scenarios'
import {
  baselineMenusOverlaysRenderers,
  renderBaselineMenusOverlays,
} from './menus-overlays-baseline.fixture'
import type { MotionProduct } from '../../packages/components/test/browser/overlay-motion.fixture.js'

const ROOT = resolve(import.meta.dirname, '../..')
const motionFixtureRoot = resolve(ROOT, 'packages/components/test/browser')
const registry = JSON.parse(readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8')) as {
  productContract?: unknown
}
const contract = ProductContractSchema.parse(registry.productContract)
const canonicalIds = contract.entries
  .filter((entry) => entry.presentation.family === 'menus-overlays')
  .map((entry) => entry.name)
const scenarioSet = menusOverlaysScenarios(contract)
const canonicalScenarios = scenarioSet.scenarios
const canonicalCaseKeys = canonicalScenarios.flatMap((scenario) =>
  scenario.cases.map((scenarioCase) => `${scenario.scenarioId}:${scenarioCase.id}`),
)

const baselineCss = [
  'semantic-tokens.css',
  'semantic-tokens-dark.css',
  'foundation.css',
  'menus-overlays.css',
  'motion.css',
]
  .map((file) => readFileSync(resolve(ROOT, 'packages/components/src/styles', file), 'utf8'))
  .join('\n')

const supportHtml = `
  <span id="system-canvas" style="background:Canvas;color:CanvasText;border-color:CanvasText"></span>
  <span id="system-canvas-text" style="background:CanvasText;color:Canvas"></span>
  <span id="system-highlight" style="background:Highlight;color:HighlightText;outline:2px solid Highlight"></span>
  <span id="system-disabled" style="color:GrayText"></span>
  <span id="system-destructive" style="color:LinkText"></span>
`

function candidates(html: string): string[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return [
    ...new Set(
      [...template.content.querySelectorAll<HTMLElement>('[class]')]
        .flatMap((element) => [...element.classList])
        .filter((candidate) => markerName(candidate) === null),
    ),
  ]
}

const seconds = (value: string): number => {
  const first = value.split(',')[0]?.trim() ?? '0s'
  return first.endsWith('ms') ? Number.parseFloat(first) / 1_000 : Number.parseFloat(first)
}

type JsonObject = { [key: string]: JsonValue }
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

function leafPaths(value: JsonValue, prefix: readonly string[] = []): string[][] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leafPaths(item, [...prefix, String(index)]))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, key]))
  }
  return [[...prefix]]
}

function oppositeLeaf(path: readonly string[], value: JsonValue): JsonValue {
  if (typeof value === 'boolean') return !value
  const key = path.join('.')
  const enums: Record<string, Record<string, JsonValue>> = {
    presence: { opening: 'closing', open: 'closed', closing: 'opening', closed: 'open' },
    side: { top: 'bottom', right: 'left', bottom: 'top', left: 'right' },
    edge: { top: 'bottom', right: 'left', bottom: 'top', left: 'right' },
    asyncStatus: { loading: 'empty', empty: 'error', error: 'loading' },
    toastType: {
      info: 'success',
      success: 'warning',
      warning: 'error',
      error: 'loading',
      loading: 'custom',
      custom: 'info',
    },
    toastPlacement: {
      top: 'top-start',
      'top-start': 'top-end',
      'top-end': 'bottom',
      bottom: 'bottom-start',
      'bottom-start': 'bottom-end',
      'bottom-end': 'top',
    },
    orientation: { horizontal: 'vertical', vertical: 'horizontal' },
  }
  if (typeof value === 'string') return enums[key]?.[value] ?? `${value} [mutated]`
  if (typeof value === 'number') return value + 1
  return value
}

function mutateLeaf(
  input: MenusOverlaysCaseInput,
  path: readonly string[],
): MenusOverlaysCaseInput {
  const next = structuredClone(input) as unknown as JsonObject
  let target = next
  for (const segment of path.slice(0, -1)) target = target[segment] as JsonObject
  const leaf = path.at(-1)!
  target[leaf] = oppositeLeaf(path, target[leaf]!)
  return next as unknown as MenusOverlaysCaseInput
}

function semanticLeafEvidence(html: string, path: readonly string[]): string {
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content.querySelector<HTMLElement>('[data-scenario-id]')!
  const records = (selector: string) =>
    [...root.querySelectorAll<HTMLElement>(selector)].map((element) => ({
      tag: element.tagName,
      part: element.dataset['part'] ?? null,
      role: element.getAttribute('role'),
      state: element.dataset['state'] ?? null,
      side: element.dataset['side'] ?? null,
      hidden: element.hidden,
      ariaExpanded: element.getAttribute('aria-expanded'),
      ariaModal: element.getAttribute('aria-modal'),
      ariaSelected: element.getAttribute('aria-selected'),
      ariaChecked: element.getAttribute('aria-checked'),
      ariaDisabled: element.getAttribute('aria-disabled'),
      ariaBusy: element.getAttribute('aria-busy'),
      ariaLive: element.getAttribute('aria-live'),
      type: element.dataset['type'] ?? null,
      placement: element.dataset['placement'] ?? null,
      orientation: element.dataset['orientation'] ?? null,
      text: element.textContent,
    }))
  const key = path.join('.')
  switch (key) {
    case 'presence':
      return JSON.stringify(records('[data-state], [aria-expanded]'))
    case 'modal':
      return JSON.stringify(records('[role="dialog"], [role="alertdialog"]'))
    case 'side':
    case 'edge':
      return JSON.stringify(records('[data-side]'))
    case 'items.highlighted':
      return JSON.stringify(records('[data-highlighted]'))
    case 'items.selected':
      return JSON.stringify(
        records('[aria-selected="true"], [data-active="true"], [data-state="selected"]'),
      )
    case 'items.checked':
      return JSON.stringify(records('[aria-checked="true"]'))
    case 'items.disabled':
      return JSON.stringify(records('[data-disabled], [aria-disabled="true"]'))
    case 'items.destructive':
      return JSON.stringify(
        records('[data-variant="destructive"], .menu-item-destructive, .btn-danger'),
      )
    case 'items.nested':
      return JSON.stringify(records('[aria-haspopup="menu"], [role="menu"], a[href]'))
    case 'asyncStatus':
      return JSON.stringify(records('[data-status], [aria-busy], [role="status"], [role="alert"]'))
    case 'toastType':
      return JSON.stringify(records('[data-type]'))
    case 'toastPlacement':
      return JSON.stringify(records('[data-placement]'))
    case 'orientation':
      return JSON.stringify(records('[data-orientation]'))
    case 'overflow.itemCount':
      return JSON.stringify({
        items: root.querySelectorAll('[data-overflow-item]').length,
        token: root.querySelector('[data-overflow-token]')?.textContent ?? null,
      })
    case 'content.label':
      return JSON.stringify({
        visible: records('[data-scenario-label]'),
        accessible: records('[aria-label]'),
      })
    case 'content.detail':
      return JSON.stringify({
        visible: records('[data-scenario-detail]'),
        live: records('[aria-live], [aria-describedby]'),
      })
    default:
      throw new Error(`No semantic evidence reader for ${key}`)
  }
}

describe('canonical menus/overlays registry presentation in Chromium', () => {
  let browser: Browser
  let registryHtml: string
  let baselineHtml: string
  let tailwind: string
  let disposeFixture: () => void
  let motionServer: ViteDevServer
  let motionFixtureUrl: string

  beforeAll(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          prefix: 'lucide',
          width: 24,
          height: 24,
          icons: {
            check: { body: '<path d="m5 12 4 4L19 6" />' },
            'chevron-down': { body: '<path d="m6 9 6 6 6-6" />' },
            'chevron-right': { body: '<path d="m9 18 6-6-6-6" />' },
            search: { body: '<circle cx="11" cy="11" r="8" />' },
            x: { body: '<path d="M18 6 6 18M6 6l12 12" />' },
          },
        }),
      }),
    )
    expect(Object.keys(registryMenusOverlaysRenderers).sort()).toEqual(
      canonicalScenarios.map(({ scenarioId }) => scenarioId).sort(),
    )
    const rendered = await renderRegistryMenusOverlays(canonicalScenarios)
    registryHtml = rendered.html
    disposeFixture = rendered.dispose
    expect(rendered.renderedProductIds).toEqual(canonicalIds)
    expect(rendered.renderedCaseKeys).toEqual(canonicalCaseKeys)
    expect(Object.keys(baselineMenusOverlaysRenderers).sort()).toEqual(
      canonicalScenarios.map(({ scenarioId }) => scenarioId).sort(),
    )
    const baselineRendered = renderBaselineMenusOverlays(canonicalScenarios)
    baselineHtml = baselineRendered.html
    expect(baselineRendered.renderedProductIds).toEqual(canonicalIds)
    expect(baselineRendered.renderedCaseKeys).toEqual(canonicalCaseKeys)
    const compiled = await compileCandidates(candidates(registryHtml))
    expect(compiled.dead).toEqual([])
    tailwind = compiled.css
    motionServer = await createServer({
      root: motionFixtureRoot,
      logLevel: 'error',
      resolve: {
        alias: {
          '@llui/dom': resolve(ROOT, 'packages/dom/src/index.ts'),
          '@llui/interactions': resolve(ROOT, 'packages/interactions/src/index.ts'),
        },
      },
      server: { host: '127.0.0.1', port: 0 },
      define: {
        __LLUI_AGENT__: 'true',
        __LLUI_TRANSITIONS__: 'true',
      },
    })
    await motionServer.listen()
    const address = motionServer.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not bind a TCP port')
    motionFixtureUrl = `http://127.0.0.1:${address.port}/overlay-motion.fixture.html`
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    disposeFixture?.()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    await browser?.close()
    await motionServer?.close()
  })

  type PresentationPath = 'baseline' | 'registry'

  const openPage = async (
    path: PresentationPath,
    context?: BrowserContext,
    options: {
      direction?: 'ltr' | 'rtl'
      theme?: 'light' | 'dark'
      viewport?: { width: number; height: number }
    } = {},
  ): Promise<Page> => {
    const page = await (context ?? browser).newPage({ viewport: options.viewport })
    const theme = options.theme
      ? ` class="${options.theme === 'dark' ? 'dark' : 'light'}" data-theme="${options.theme}"`
      : ''
    const css = path === 'registry' ? tailwind : baselineCss
    const html = path === 'registry' ? registryHtml : baselineHtml
    await page.setContent(
      `<!doctype html><html dir="${options.direction ?? 'ltr'}"${theme}><style>${css}</style><body>${html}${supportHtml}</body></html>`,
    )
    return page
  }

  const idleFixtureMotion = async (page: Page): Promise<void> => {
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.finish()
    })
  }

  it('renders the exact canonical scenarios in independent style and DOM universes', async () => {
    for (const path of ['baseline', 'registry'] as const) {
      const page = await openPage(path)
      const got = await page.evaluate((selectedPath) => {
        const ownAttribute =
          selectedPath === 'registry' ? 'data-registry-product' : 'data-baseline-product'
        const foreignAttribute =
          selectedPath === 'registry' ? 'data-baseline-product' : 'data-registry-product'
        const sections = [...document.querySelectorAll<HTMLElement>(`[${ownAttribute}]`)]
        const styleText = [...document.styleSheets]
          .flatMap((sheet) => [...sheet.cssRules])
          .map((rule) => rule.cssText)
          .join('\n')
        return {
          caseRecords: sections.map((section) => ({
            productId: section.getAttribute(ownAttribute),
            scenarioId: section.dataset['scenarioId'],
            caseId: section.dataset['caseId'],
          })),
          foreignProducts: document.querySelectorAll(`[${foreignAttribute}]`).length,
          scopeParts: document.querySelectorAll('[data-scope][data-part]').length,
          fabricatedMotionMarkers: document.querySelectorAll(
            '[data-registry-motion], [data-baseline-motion]',
          ).length,
          hasBaselineSelectors: styleText.includes('[data-scope='),
          hasTailwindVariables: styleText.includes('--tw-'),
        }
      }, path)
      await page.close()

      expect(
        got.caseRecords.map(({ scenarioId, caseId }) => `${scenarioId}:${caseId}`),
        `${path}/cases`,
      ).toEqual(canonicalCaseKeys)
      expect(
        [...new Set(got.caseRecords.map(({ productId }) => productId))],
        `${path}/products`,
      ).toEqual(canonicalIds)
      expect(got.foreignProducts, `${path}/foreign DOM`).toBe(0)
      expect(got.fabricatedMotionMarkers, `${path}/fabricated motion`).toBe(0)
      if (path === 'baseline') {
        expect(got.scopeParts).toBeGreaterThan(0)
        expect(got.hasBaselineSelectors).toBe(true)
        expect(got.hasTailwindVariables).toBe(false)
      } else {
        expect(got.scopeParts).toBe(0)
        expect(got.hasBaselineSelectors).toBe(false)
        expect(got.hasTailwindVariables).toBe(true)
      }
    }
  })

  it('feeds shared semantic content and presence state into both renderer adapters', async () => {
    const canonicalMenu = scenarioSet.byScenarioId['component:menu']
    const canonicalCase = canonicalMenu.cases.find(
      (scenarioCase) => scenarioCase.id === canonicalMenu.defaultCaseId,
    )!
    const mutatedScenario: MenusOverlaysScenario = {
      ...canonicalMenu,
      cases: [
        {
          ...canonicalCase,
          input: {
            ...canonicalCase.input,
            presence: 'opening',
            content: {
              ...canonicalCase.input.content,
              detail: 'renderer-input-sentinel',
            },
          },
        },
      ],
    }
    const baseline = renderBaselineMenusOverlays([mutatedScenario])
    const registryRendered = await renderRegistryMenusOverlays([mutatedScenario])
    const read = (html: string, contentId: string) => {
      const template = document.createElement('template')
      template.innerHTML = html
      const content = template.content.querySelector<HTMLElement>(`#${contentId}`)!
      return {
        state: content.dataset['state'],
        text: content.textContent,
        scenarioId:
          template.content.querySelector<HTMLElement>('[data-scenario-id]')?.dataset['scenarioId'],
      }
    }

    expect(read(baseline.html, 'baseline-menu-content')).toEqual({
      state: mutatedScenario.cases[0]!.input.presence,
      text: expect.stringContaining(mutatedScenario.cases[0]!.input.content.detail),
      scenarioId: mutatedScenario.scenarioId,
    })
    expect(read(registryRendered.html, 'registry-menu-content')).toEqual({
      state: mutatedScenario.cases[0]!.input.presence,
      text: expect.stringContaining(mutatedScenario.cases[0]!.input.content.detail),
      scenarioId: mutatedScenario.scenarioId,
    })
    registryRendered.dispose()
  })

  it('makes every declared case-input leaf drive semantic descendant evidence in both isolated adapters', async () => {
    const failures: string[] = []
    for (const scenario of canonicalScenarios) {
      for (const scenarioCase of scenario.cases) {
        const singleCaseScenario: MenusOverlaysScenario = {
          ...scenario,
          defaultCaseId: scenarioCase.id,
          cases: [scenarioCase],
        }
        const baselineOriginal = renderBaselineMenusOverlays([singleCaseScenario]).html
        const registryOriginalRendered = await renderRegistryMenusOverlays([singleCaseScenario])
        const registryOriginal = registryOriginalRendered.html
        registryOriginalRendered.dispose()

        for (const path of leafPaths(scenarioCase.input as unknown as JsonValue)) {
          const mutatedCase = {
            ...scenarioCase,
            input: mutateLeaf(scenarioCase.input, path),
          }
          const mutatedScenario: MenusOverlaysScenario = {
            ...singleCaseScenario,
            cases: [mutatedCase],
          }
          const baselineMutated = renderBaselineMenusOverlays([mutatedScenario]).html
          if (
            semanticLeafEvidence(baselineMutated, path) ===
            semanticLeafEvidence(baselineOriginal, path)
          ) {
            failures.push(`baseline:${scenario.scenarioId}:${scenarioCase.id}:${path.join('.')}`)
          }
          const registryMutatedRendered = await renderRegistryMenusOverlays([mutatedScenario])
          const registryMutated = registryMutatedRendered.html
          registryMutatedRendered.dispose()
          if (
            semanticLeafEvidence(registryMutated, path) ===
            semanticLeafEvidence(registryOriginal, path)
          ) {
            failures.push(`registry:${scenario.scenarioId}:${scenarioCase.id}:${path.join('.')}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('drives every declared visual environment axis through both isolated style universes', async () => {
    const axes = ['theme', 'direction', 'viewport', 'forcedColors'] as const
    type Axis = (typeof axes)[number]
    const declared = (axis: Axis) =>
      canonicalScenarios.flatMap((scenario) =>
        scenario.cases
          .filter(({ environmentAxes }) => environmentAxes.includes(axis))
          .map((scenarioCase) => ({
            key: `${scenario.scenarioId}:${scenarioCase.id}`,
            scenarioId: scenario.scenarioId,
            caseId: scenarioCase.id,
          })),
      )

    const openAxisPage = async (
      path: PresentationPath,
      axis: Axis,
      opposite: boolean,
    ): Promise<{ page: Page; context: BrowserContext }> => {
      const context = await browser.newContext({
        forcedColors: axis === 'forcedColors' && opposite ? 'active' : 'none',
      })
      const viewport =
        axis === 'viewport' && opposite ? { width: 280, height: 240 } : { width: 800, height: 600 }
      const page = await openPage(path, context, {
        theme: axis === 'theme' && opposite ? 'dark' : 'light',
        direction: axis === 'direction' && opposite ? 'rtl' : 'ltr',
        viewport,
      })
      await page.setViewportSize(viewport)
      await idleFixtureMotion(page)
      return { page, context }
    }

    const fingerprints = async (
      page: Page,
      cases: ReturnType<typeof declared>,
    ): Promise<Record<string, string>> =>
      page.evaluate((records) => {
        const result: Record<string, string> = {}
        for (const record of records) {
          const section = [...document.querySelectorAll<HTMLElement>('[data-scenario-id]')].find(
            (candidate) =>
              candidate.dataset['scenarioId'] === record.scenarioId &&
              candidate.dataset['caseId'] === record.caseId,
          )!
          result[record.key] = JSON.stringify(
            [...section.querySelectorAll<HTMLElement>('*')].map((element) => {
              const style = getComputedStyle(element)
              const rect = element.getBoundingClientRect()
              const textNode = [...element.childNodes].find(
                (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '',
              )
              const textRect = (() => {
                if (textNode === undefined) return null
                const range = document.createRange()
                range.selectNodeContents(textNode)
                const measured = range.getBoundingClientRect()
                return [measured.left, measured.right]
              })()
              return {
                tag: element.tagName,
                role: element.getAttribute('role'),
                ariaModal: element.getAttribute('aria-modal'),
                ariaLive: element.getAttribute('aria-live'),
                background: style.backgroundColor,
                color: style.color,
                borderColor: style.borderColor,
                borderStyle: style.borderStyle,
                outline: style.outline,
                shadow: style.boxShadow,
                textAlign: style.textAlign,
                padding: [
                  style.paddingTop,
                  style.paddingRight,
                  style.paddingBottom,
                  style.paddingLeft,
                ],
                margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
                inset: [style.top, style.right, style.bottom, style.left],
                animationDuration: style.animationDuration,
                transitionDuration: style.transitionDuration,
                rect: [rect.left, rect.top, rect.width, rect.height],
                textRect,
                scroll: [
                  element.clientWidth,
                  element.scrollWidth,
                  element.clientHeight,
                  element.scrollHeight,
                ],
              }
            }),
          )
        }
        return result
      }, cases)

    for (const axis of axes) {
      const cases = declared(axis)
      expect(cases.length, `${axis}/declared`).toBeGreaterThan(0)
      for (const path of ['baseline', 'registry'] as const) {
        const first = await openAxisPage(path, axis, false)
        const second = await openAxisPage(path, axis, true)
        const defaultValues = await fingerprints(first.page, cases)
        const oppositeValues = await fingerprints(second.page, cases)
        await first.context.close()
        await second.context.close()
        const unchanged = cases
          .filter(({ key }) => defaultValues[key] === oppositeValues[key])
          .map(({ key }) => key)
        expect(unchanged, `${path}/${axis}`).toEqual([])
      }
    }
  })

  it('aligns normal menu density, elevation, and highlighted-state hierarchy', async () => {
    const read = async (path: PresentationPath) => {
      const page = await openPage(path, undefined, { theme: 'light' })
      await idleFixtureMotion(page)
      const result = await page.evaluate((selectedPath) => {
        const metrics = (id: string) => {
          const element = document.getElementById(id)!
          const style = getComputedStyle(element)
          return {
            background: style.backgroundColor,
            color: style.color,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
            paddingBlock: style.paddingBlock,
            paddingInline: style.paddingInline,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            height: element.getBoundingClientRect().height,
          }
        }
        const prefix = selectedPath === 'registry' ? 'registry' : 'baseline'
        return {
          surface: metrics(`${prefix}-menu-content`),
          item: metrics(`${prefix}-menu-highlighted`),
        }
      }, path)
      await page.close()
      return result
    }
    const got = { baseline: await read('baseline'), registry: await read('registry') }

    const {
      boxShadow: baselineShadow,
      height: _baselineHeight,
      ...baselineSurface
    } = got.baseline.surface
    const {
      boxShadow: registryShadow,
      height: _registryHeight,
      ...registrySurface
    } = got.registry.surface
    expect(registrySurface).toEqual(baselineSurface)
    expect(registryShadow.endsWith(baselineShadow)).toBe(true)
    expect(got.registry.item).toEqual(got.baseline.item)
    expect(baselineShadow).not.toBe('none')
    expect(got.registry.item.background).not.toBe(got.registry.surface.background)
    expect(got.registry.item.height).toBeGreaterThanOrEqual(32)
  })

  it('aligns the reachable entry animation for synchronous select and combobox machines', async () => {
    const animations = []
    for (const path of ['baseline', 'registry'] as const) {
      const page = await openPage(path)
      animations.push(
        ...(await page.evaluate(
          (prefix) =>
            [`${prefix}-select-content`, `${prefix}-combobox-content`].map((id) => {
              const element = document.getElementById(id)!
              const style = getComputedStyle(element)
              return {
                id,
                state: element.getAttribute('data-state'),
                name: style.animationName,
                duration: style.animationDuration,
              }
            }),
          path,
        )),
      )
      await page.close()
    }

    expect(animations.map(({ state }) => state)).toEqual(['open', 'open', 'open', 'open'])
    for (const animation of animations) {
      expect(animation.name, animation.id).not.toBe('none')
      expect(seconds(animation.duration), animation.id).toBeGreaterThan(0)
    }
  })

  it('keeps the actual registry arrow centered and edge-anchored through both collision axes', async () => {
    const template = document.createElement('template')
    template.innerHTML = registryHtml
    const contentClass = template.content.querySelector<HTMLElement>(
      '#registry-popover-content',
    )!.className
    const arrowClass =
      template.content.querySelector<HTMLElement>('#registry-popover-arrow')!.className
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    await page.goto(motionFixtureUrl)
    await page.addStyleTag({ content: tailwind })
    await page.waitForFunction(() => window.__motionReady === true)
    await page.evaluate((skin) => window.__setMotionSkin(skin), { contentClass, arrowClass })

    const waitForStatus = async (status: 'open' | 'closed'): Promise<void> => {
      await page.waitForFunction(
        (expected) => window.__motionSnapshot().status === expected,
        status,
        { timeout: 2_000 },
      )
    }
    const waitForSide = async (side: 'top' | 'right' | 'bottom' | 'left'): Promise<void> => {
      await page.waitForFunction((expected) => window.__motionSnapshot().side === expected, side, {
        timeout: 2_000,
      })
    }
    const center = (start: number, end: number): number => (start + end) / 2
    const expectContact = async (side: 'top' | 'right' | 'bottom' | 'left'): Promise<void> => {
      const snapshot = await page.evaluate(() => window.__motionSnapshot())
      expect(snapshot.side).toBe(side)
      expect(snapshot.arrow?.position).toBe('absolute')
      const arrow = snapshot.arrow!
      const content = snapshot.contentRect!
      const trigger = snapshot.triggerRect!
      if (side === 'top' || side === 'bottom') {
        expect(
          Math.abs(center(arrow.rect.left, arrow.rect.right) - center(trigger.left, trigger.right)),
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(
            center(arrow.rect.top, arrow.rect.bottom) -
              (side === 'bottom' ? content.top : content.bottom),
          ),
        ).toBeLessThanOrEqual(1)
        expect(Number.parseFloat(side === 'bottom' ? arrow.top : arrow.bottom)).toBeLessThan(0)
        expect(side === 'bottom' ? arrow.bottom : arrow.top).toBe('')
      } else {
        expect(
          Math.abs(center(arrow.rect.top, arrow.rect.bottom) - center(trigger.top, trigger.bottom)),
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(
            center(arrow.rect.left, arrow.rect.right) -
              (side === 'right' ? content.left : content.right),
          ),
        ).toBeLessThanOrEqual(1)
        expect(Number.parseFloat(side === 'right' ? arrow.left : arrow.right)).toBeLessThan(0)
        expect(side === 'right' ? arrow.right : arrow.left).toBe('')
      }
    }
    const mount = async (placement: 'bottom' | 'right', rect: Record<string, number>) => {
      await page.evaluate(
        ({ selectedPlacement, anchorRect }) => {
          window.__mountMotion('popover' satisfies MotionProduct, true, selectedPlacement)
          window.__setMotionAnchorRect(anchorRect)
          window.__openMotion()
        },
        { selectedPlacement: placement, anchorRect: rect },
      )
      await waitForStatus('open')
      await waitForSide(placement)
      await expectContact(placement)
    }

    await mount('bottom', {
      top: 80,
      right: 380,
      bottom: 100,
      left: 300,
      width: 80,
      height: 20,
    })
    await page.evaluate(() =>
      window.__setMotionAnchorRect({
        top: 570,
        right: 380,
        bottom: 590,
        left: 300,
        width: 80,
        height: 20,
      }),
    )
    await waitForSide('top')
    await expectContact('top')
    await page.evaluate(() => window.__closeMotion())
    await waitForStatus('closed')

    await mount('right', {
      top: 280,
      right: 120,
      bottom: 320,
      left: 100,
      width: 20,
      height: 40,
    })
    await page.evaluate(() =>
      window.__setMotionAnchorRect({
        top: 280,
        right: 795,
        bottom: 320,
        left: 775,
        width: 20,
        height: 40,
      }),
    )
    await waitForSide('left')
    await expectContact('left')
    await page.evaluate(() => window.__closeMotion())
    await waitForStatus('closed')
    await page.close()
  })

  it('preserves dark surface elevation and state hierarchy across both paths', async () => {
    const read = async (path: PresentationPath, theme: 'light' | 'dark') => {
      const page = await openPage(path, undefined, { theme })
      await idleFixtureMotion(page)
      const result = await page.evaluate((selectedPath) => {
        const metrics = (id: string) => {
          const style = getComputedStyle(document.getElementById(id)!)
          return {
            background: style.backgroundColor,
            color: style.color,
            boxShadow: style.boxShadow,
          }
        }
        const ids =
          selectedPath === 'registry'
            ? {
                menu: 'registry-menu-content',
                dialog: 'registry-dialog-content',
                drawer: 'registry-drawer-content',
                confirm: 'registry-confirm-dialog-content',
                highlighted: 'registry-menu-highlighted',
                destructive: 'registry-menu-destructive',
                tooltip: 'registry-tooltip-content',
              }
            : {
                menu: 'baseline-menu-content',
                dialog: 'baseline-dialog',
                drawer: 'baseline-drawer',
                confirm: 'baseline-confirm-dialog',
                highlighted: 'baseline-menu-highlighted',
                destructive: 'baseline-menu-destructive',
                tooltip: 'baseline-tooltip',
              }
        return {
          menu: metrics(ids.menu),
          dialog: metrics(ids.dialog),
          drawer: metrics(ids.drawer),
          confirm: metrics(ids.confirm),
          highlighted: metrics(ids.highlighted),
          destructive: metrics(ids.destructive),
          tooltip: metrics(ids.tooltip),
        }
      }, path)
      await page.close()
      return result
    }

    const light = {
      baseline: await read('baseline', 'light'),
      registry: await read('registry', 'light'),
    }
    const dark = {
      baseline: await read('baseline', 'dark'),
      registry: await read('registry', 'dark'),
    }
    for (const key of [
      'menu',
      'dialog',
      'drawer',
      'confirm',
      'highlighted',
      'destructive',
      'tooltip',
    ] as const) {
      expect(dark.registry[key].background, `${key}/background`).toBe(dark.baseline[key].background)
      expect(dark.registry[key].color, `${key}/color`).toBe(dark.baseline[key].color)
    }
    expect(dark.registry.menu.boxShadow.endsWith(dark.baseline.menu.boxShadow)).toBe(true)
    expect(dark.registry.menu.background).not.toBe(light.registry.menu.background)
    expect(dark.registry.menu.boxShadow).not.toBe(light.registry.menu.boxShadow)
    expect(dark.registry.menu.background).not.toBe(dark.registry.dialog.background)
    expect(dark.registry.highlighted.background).not.toBe(dark.registry.menu.background)
    expect(dark.registry.destructive.color).not.toBe(dark.registry.menu.color)
    expect(dark.registry.tooltip.background).not.toBe(dark.registry.dialog.background)
  })

  it('settles every real four-phase machine through registry CSS events under reduced motion', async () => {
    const motionIds = {
      dialog: 'registry-dialog-content',
      'alert-dialog': 'registry-alert-dialog-content',
      drawer: 'registry-drawer-content',
      menu: 'registry-menu-content',
      'context-menu': 'registry-context-menu-content',
      popover: 'registry-popover-content',
      'hover-card': 'registry-hover-card-content',
      tooltip: 'registry-tooltip-content',
    } as const satisfies Record<MotionProduct, string>
    const declaredFourPhase = canonicalScenarios
      .filter(
        ({ cases }) =>
          cases.some(
            ({ input, environmentAxes }) =>
              input.presence === 'opening' && environmentAxes.includes('motion'),
          ) &&
          cases.some(
            ({ input, environmentAxes }) =>
              input.presence === 'closing' && environmentAxes.includes('motion'),
          ),
      )
      .map(({ productId }) => productId)
      .sort()
    expect(declaredFourPhase).toEqual(Object.keys(motionIds).sort())
    const template = document.createElement('template')
    template.innerHTML = registryHtml
    const classes = Object.fromEntries(
      Object.entries(motionIds).map(([product, id]) => [
        product,
        template.content.querySelector<HTMLElement>(`#${id}`)!.className,
      ]),
    ) as Record<MotionProduct, string>

    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto(motionFixtureUrl)
    await page.addStyleTag({ content: tailwind })
    await page.waitForFunction(() => window.__motionReady === true)

    for (const [product, contentClass] of Object.entries(classes) as [MotionProduct, string][]) {
      await page.evaluate((skin) => window.__setMotionSkin(skin), { contentClass })
      expect(
        await page.evaluate((selected) => window.__mountMotion(selected, true), product),
      ).toMatchObject({
        status: 'closed',
        mounted: false,
      })
      const openedPhase = await page.evaluate((selected) => {
        window.__resetMotionTrace()
        const snapshot = window.__openMotion()
        const node = document.querySelector<HTMLElement>(`[data-motion-product="${selected}"]`)!
        return { snapshot, duration: getComputedStyle(node).animationDuration }
      }, product)
      const opening = openedPhase.snapshot
      expect(opening).toMatchObject({ status: 'opening', mounted: true, contentState: 'opening' })
      expect(opening.animationName, `${product}/opening`).not.toBe('none')
      expect(seconds(openedPhase.duration), `${product}/opening`).toBeGreaterThan(0)
      expect(seconds(openedPhase.duration), `${product}/opening`).toBeLessThanOrEqual(0.001)
      await page.waitForFunction(() => window.__motionSnapshot().status === 'open', undefined, {
        timeout: 2_000,
      })

      const closedPhase = await page.evaluate((selected) => {
        const snapshot = window.__closeMotion()
        const node = document.querySelector<HTMLElement>(`[data-motion-product="${selected}"]`)!
        return { snapshot, duration: getComputedStyle(node).animationDuration }
      }, product)
      const closing = closedPhase.snapshot
      expect(closing).toMatchObject({ status: 'closing', mounted: true, contentState: 'closing' })
      expect(closing.animationName, `${product}/closing`).not.toBe('none')
      expect(seconds(closedPhase.duration), `${product}/closing`).toBeGreaterThan(0)
      expect(seconds(closedPhase.duration), `${product}/closing`).toBeLessThanOrEqual(0.001)
      await page.waitForFunction(
        () => {
          const snapshot = window.__motionSnapshot()
          return snapshot.status === 'closed' && !snapshot.mounted
        },
        undefined,
        { timeout: 2_000 },
      )
      const trace = await page.evaluate(() => window.__motionTrace)
      expect(
        trace.some(({ event }) => event === 'animationstart'),
        `${product}/start`,
      ).toBe(true)
      expect(
        trace.some(({ event }) => event === 'animationend'),
        `${product}/end`,
      ).toBe(true)
    }
    await context.close()
  })

  it('settles the real toast queue through registry closing CSS in full and reduced motion', async () => {
    const toastScenario = scenarioSet.byScenarioId['component:toast']
    expect(
      toastScenario.cases
        .filter(({ environmentAxes }) => environmentAxes.includes('motion'))
        .map(({ id, input }) => [id, input.presence]),
    ).toContainEqual(['closing', 'closing'])
    expect(toastScenario.unsupportedCases.map(({ id }) => id)).toEqual(['opening', 'closed'])
    const template = document.createElement('template')
    template.innerHTML = registryHtml
    const regionClass =
      template.content.querySelector<HTMLElement>('#registry-toast-region')!.className
    const toastClass = template.content.querySelector<HTMLElement>(
      '#registry-toast-info--closing',
    )!.className

    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const context = await browser.newContext({ reducedMotion })
      const page = await context.newPage()
      await page.goto(motionFixtureUrl)
      await page.addStyleTag({ content: tailwind })
      await page.waitForFunction(() => window.__motionReady === true)
      await page.evaluate((skin) => window.__setToastMotionSkin(skin), {
        regionClass,
        toastClass,
      })
      expect(
        await page.evaluate(() => window.__mountToastMotion(true, 'bottom-end')),
      ).toMatchObject({
        count: 0,
        mounted: false,
        placement: 'bottom-end',
      })
      expect(await page.evaluate(() => window.__createToastMotion('error'))).toMatchObject({
        count: 1,
        mounted: true,
        status: 'open',
        type: 'error',
        role: 'alert',
        ariaLive: 'assertive',
      })
      const closing = await page.evaluate(() => {
        window.__resetMotionTrace()
        return window.__dismissToastMotion()
      })
      expect(closing).toMatchObject({ count: 1, mounted: true, status: 'closing' })
      expect(closing.animationName, reducedMotion).not.toBe('none')
      expect(seconds(closing.animationDuration!), reducedMotion).toBeGreaterThan(0)
      if (reducedMotion === 'reduce') {
        expect(seconds(closing.animationDuration!), reducedMotion).toBeLessThanOrEqual(0.001)
      }
      await page.waitForFunction(
        () => {
          const snapshot = window.__toastMotionSnapshot()
          return snapshot.count === 0 && !snapshot.mounted && snapshot.status === null
        },
        undefined,
        { timeout: 2_000 },
      )
      const trace = await page.evaluate(() =>
        window.__motionTrace.filter(({ product }) => product === 'toast'),
      )
      expect(
        trace.some(({ event }) => event === 'animationstart'),
        reducedMotion,
      ).toBe(true)
      expect(
        trace.some(({ event }) => event === 'animationend'),
        reducedMotion,
      ).toBe(true)
      await context.close()
    }
  })

  it('places the real ToastRegion at all six logical viewport edges in LTR and RTL', async () => {
    const placements = [
      'top',
      'top-start',
      'top-end',
      'bottom',
      'bottom-start',
      'bottom-end',
    ] as const
    const template = document.createElement('template')
    template.innerHTML = registryHtml
    const registrySkin = {
      regionClass: template.content.querySelector<HTMLElement>('#registry-toast-region')!.className,
      toastClass: template.content.querySelector<HTMLElement>('#registry-toast-info--info')!
        .className,
    }

    for (const path of ['baseline', 'registry'] as const) {
      for (const direction of ['ltr', 'rtl'] as const) {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        await page.goto(motionFixtureUrl)
        await page.addStyleTag({ content: path === 'baseline' ? baselineCss : tailwind })
        await page.waitForFunction(() => window.__motionReady === true)
        await page.evaluate(
          ({ dir, skin }) => {
            document.documentElement.dir = dir
            if (skin !== null) window.__setToastMotionSkin(skin)
          },
          { dir: direction, skin: path === 'registry' ? registrySkin : null },
        )

        for (const placement of placements) {
          await page.evaluate((selected) => {
            window.__mountToastMotion(false, selected)
            window.__createToastMotion('info')
          }, placement)
          const snapshot = await page.evaluate(() => window.__toastMotionSnapshot())
          expect(snapshot.placement).toBe(placement)
          expect(
            snapshot.regionRect.width,
            `${path}/${direction}/${placement}/width`,
          ).toBeLessThanOrEqual(320)
          if (placement.startsWith('top')) {
            expect(
              snapshot.regionRect.top,
              `${path}/${direction}/${placement}/block-start`,
            ).toBeCloseTo(16, 0)
          } else {
            expect(
              600 - snapshot.regionRect.bottom,
              `${path}/${direction}/${placement}/block-end`,
            ).toBeCloseTo(16, 0)
          }
          if (!placement.includes('-')) {
            expect(
              (snapshot.regionRect.left + snapshot.regionRect.right) / 2,
              `${path}/${direction}/${placement}/center`,
            ).toBeCloseTo(400, 0)
          } else {
            const logicalEdge = placement.endsWith('start') ? 'start' : 'end'
            const physicalLeft =
              (logicalEdge === 'start' && direction === 'ltr') ||
              (logicalEdge === 'end' && direction === 'rtl')
            const margin = physicalLeft ? snapshot.regionRect.left : 800 - snapshot.regionRect.right
            expect(margin, `${path}/${direction}/${placement}/inline`).toBeCloseTo(16, 0)
          }
        }
        await page.close()
      }
    }
  })

  it('uses system colors and non-color cues for forced-color states on both paths', async () => {
    const context = await browser.newContext({ forcedColors: 'active' })
    const read = async (path: PresentationPath) => {
      const page = await openPage(path, context)
      await idleFixtureMotion(page)
      const got = await page.evaluate((selectedPath) => {
        const style = (id: string): CSSStyleDeclaration =>
          getComputedStyle(document.getElementById(id)!)
        const state = (id: string) => ({
          background: style(id).backgroundColor,
          color: style(id).color,
          fontWeight: style(id).fontWeight,
          opacity: style(id).opacity,
          outline: style(id).outlineStyle,
          decoration: style(id).textDecorationLine,
        })
        const toast = (id: string) => ({
          background: style(id).backgroundColor,
          borderInlineStartStyle: style(id).borderInlineStartStyle,
          borderInlineStartWidth: style(id).borderInlineStartWidth,
        })
        const ids =
          selectedPath === 'registry'
            ? {
                surface: 'registry-menu-content',
                highlighted: 'registry-menu-highlighted',
                selected: 'registry-select-selected',
                checked: 'registry-menu-checked',
                disabled: 'registry-menu-disabled',
                destructive: 'registry-menu-destructive',
                tooltip: 'registry-tooltip-content',
                toasts: [
                  'registry-toast-success',
                  'registry-toast-warning--warning',
                  'registry-toast-error--error',
                ],
                modals: [
                  ['registry-dialog-backdrop', 'registry-dialog-content'],
                  ['registry-drawer-backdrop', 'registry-drawer-content'],
                ],
              }
            : {
                surface: 'baseline-menu-content',
                highlighted: 'baseline-menu-highlighted',
                selected: 'baseline-select-selected',
                checked: 'baseline-menu-checked',
                disabled: 'baseline-menu-disabled',
                destructive: 'baseline-menu-destructive',
                tooltip: 'baseline-tooltip',
                toasts: [
                  'baseline-toast-success',
                  'baseline-toast-warning--warning',
                  'baseline-toast-error--error',
                ],
                modals: [
                  ['baseline-dialog-positioner', 'baseline-dialog'],
                  ['baseline-drawer-positioner', 'baseline-drawer'],
                ],
              }
        return {
          system: {
            canvas: style('system-canvas').backgroundColor,
            canvasText: style('system-canvas').color,
            highlight: style('system-highlight').backgroundColor,
            highlightText: style('system-highlight').color,
            grayText: style('system-disabled').color,
            linkText: style('system-destructive').color,
          },
          states: {
            surface: state(ids.surface),
            highlighted: state(ids.highlighted),
            selected: state(ids.selected),
            checked: state(ids.checked),
            disabled: state(ids.disabled),
            destructive: state(ids.destructive),
            tooltip: state(ids.tooltip),
            toasts: ids.toasts.map(toast),
          },
          modals: ids.modals.map(([backdropId, contentId]) => ({
            backdrop: style(backdropId!).backgroundColor,
            backdropOpacity: style(backdropId!).opacity,
            content: style(contentId!).backgroundColor,
          })),
        }
      }, path)
      await page.close()
      return got
    }
    const got = { baseline: await read('baseline'), registry: await read('registry') }
    await context.close()

    for (const [label, result] of [
      ['baseline', got.baseline],
      ['registry', got.registry],
    ] as const) {
      const path = result.states
      expect(path.surface.background).toBe(result.system.canvas)
      expect(path.surface.color).toBe(result.system.canvasText)
      expect(path.highlighted.background).toBe(result.system.highlight)
      expect(path.highlighted.color).toBe(result.system.highlightText)
      expect(path.highlighted.outline, `${label}/highlighted`).not.toBe('none')
      for (const selected of [path.selected, path.checked]) {
        expect(selected.outline, `${label}/selected`).not.toBe('none')
        expect(Number(selected.fontWeight), `${label}/selected`).toBeGreaterThanOrEqual(500)
      }
      expect(path.disabled.color).toBe(result.system.grayText)
      expect(Number(path.disabled.opacity)).toBeLessThan(1)
      expect(path.destructive.color).toBe(result.system.linkText)
      expect(path.destructive.decoration).toContain('underline')
      expect(path.tooltip.background).toBe(result.system.canvasText)
      expect(path.tooltip.color).toBe(result.system.canvas)
      expect(path.toasts.map(({ background }) => background)).toEqual([
        result.system.canvas,
        result.system.canvas,
        result.system.canvas,
      ])
      expect(
        new Set(path.toasts.map(({ borderInlineStartStyle }) => borderInlineStartStyle)).size,
      ).toBe(3)
      expect(
        path.toasts.every(
          ({ borderInlineStartWidth }) => Number.parseFloat(borderInlineStartWidth) >= 3,
        ),
      ).toBe(true)
      for (const modal of result.modals) {
        expect(modal.backdrop, `${label}/backdrop`).toBe(result.system.canvasText)
        expect(modal.content, `${label}/content`).toBe(result.system.canvas)
        expect(modal.backdrop, `${label}/contrast`).not.toBe(modal.content)
        expect(Number(modal.backdropOpacity), `${label}/opacity`).toBeGreaterThan(0)
      }
    }
  })

  it('contains long and tall content within a narrow viewport on both paths', async () => {
    const surfaces = {
      baseline: {
        margin: [
          'baseline-menu-content',
          'baseline-select-content',
          'baseline-combobox-content',
          'baseline-popover',
          'baseline-hover-card',
          'baseline-tooltip',
          'baseline-dialog',
          'baseline-confirm-dialog',
          'baseline-toast-region',
        ],
        edge: ['baseline-drawer'],
        scroll: [
          'baseline-menu-content',
          'baseline-select-content',
          'baseline-combobox-content',
          'baseline-toast-region',
        ],
      },
      registry: {
        margin: [
          'registry-menu-content',
          'registry-menu-subcontent',
          'registry-context-menu-content',
          'registry-menubar-content',
          'registry-select-content',
          'registry-combobox-content',
          'registry-popover-content',
          'registry-hover-card-content',
          'registry-tooltip-content',
          'registry-dialog-content',
          'registry-confirm-dialog-content',
          'registry-alert-dialog-content',
          'registry-command-surface',
          'registry-command-list',
          'registry-searchable-select-content',
          'registry-navigation-content',
          'registry-navigation-viewport',
          'registry-toast-region',
        ],
        edge: ['registry-drawer-content', 'registry-sheet-content'],
        scroll: [
          'registry-menu-content',
          'registry-menu-subcontent',
          'registry-context-menu-content',
          'registry-menubar-content',
          'registry-select-content',
          'registry-combobox-content',
          'registry-command-list',
          'registry-navigation-content',
          'registry-navigation-viewport',
          'registry-toast-region',
        ],
      },
    } as const

    for (const path of ['baseline', 'registry'] as const) {
      const page = await openPage(path, undefined, { viewport: { width: 280, height: 240 } })
      await idleFixtureMotion(page)
      const selected = {
        margin: surfaces[path].margin.map((id) => `${id}--overflow`),
        edge: surfaces[path].edge.map((id) => `${id}--overflow`),
        scroll: surfaces[path].scroll.map((id) => `${id}--overflow`),
      }
      const ids = [...selected.margin, ...selected.edge]
      expect(
        await page.evaluate(
          (surfaceIds) => surfaceIds.filter((id) => document.getElementById(id) === null),
          ids,
        ),
        `${path}/missing overflow surfaces`,
      ).toEqual([])
      const boxes = await page.evaluate(
        (surfaceIds) =>
          Object.fromEntries(
            surfaceIds.map((id) => {
              const element = document.getElementById(id)!
              const rect = element.getBoundingClientRect()
              const style = getComputedStyle(element)
              return [
                id,
                {
                  left: rect.left,
                  right: rect.right,
                  width: rect.width,
                  height: rect.height,
                  overflowY: style.overflowY,
                  overscroll: style.overscrollBehavior,
                  wrap: style.overflowWrap,
                },
              ]
            }),
          ),
        ids,
      )
      await page.close()

      for (const id of selected.margin) {
        const box = boxes[id]!
        expect(box.left, id).toBeGreaterThanOrEqual(0)
        expect(box.right, id).toBeLessThanOrEqual(280)
        expect(box.width, id).toBeLessThanOrEqual(248)
        expect(box.height, id).toBeLessThanOrEqual(208)
        expect(box.wrap, id).not.toBe('normal')
      }
      for (const id of selected.edge) {
        const box = boxes[id]!
        expect(box.left, id).toBeGreaterThanOrEqual(0)
        expect(box.right, id).toBeLessThanOrEqual(280)
        expect(box.width, id).toBeLessThanOrEqual(280)
        expect(box.height, id).toBeLessThanOrEqual(240)
        expect(box.overflowY, id).toBe('auto')
        expect(box.overscroll, id).toBe('contain')
        expect(box.wrap, id).not.toBe('normal')
      }
      for (const id of selected.scroll) {
        expect(boxes[id]?.overflowY, id).toBe('auto')
        expect(boxes[id]?.overscroll, id).toBe('contain')
      }
    }
  })

  it('uses logical inline geometry and mirrors the submenu affordance in RTL', async () => {
    const read = async (direction: 'ltr' | 'rtl') => {
      const page = await openPage('registry', undefined, {
        direction,
        viewport: { width: 800, height: 600 },
      })
      const result = await page.evaluate(() => {
        const style = (id: string): CSSStyleDeclaration =>
          getComputedStyle(document.getElementById(id)!)
        const horizontal = (id: string) => ({
          left: style(id).left,
          right: style(id).right,
          paddingLeft: style(id).paddingLeft,
          paddingRight: style(id).paddingRight,
          marginLeft: style(id).marginLeft,
          marginRight: style(id).marginRight,
        })
        const readingEdge = (headerId: string, labelId: string) => {
          const header = document.getElementById(headerId)!
          const label = document.getElementById(labelId)!
          const textNode = label.firstChild!
          const range = document.createRange()
          range.selectNodeContents(textNode)
          const headerRect = header.getBoundingClientRect()
          const textRect = range.getBoundingClientRect()
          return {
            align: getComputedStyle(header).textAlign,
            leftGap: textRect.left - headerRect.left,
            rightGap: headerRect.right - textRect.right,
          }
        }
        return {
          checkbox: horizontal('registry-menu-checked'),
          menuIndicator: horizontal('registry-menu-indicator'),
          shortcut: horizontal('registry-menu-shortcut'),
          selectItem: horizontal('registry-select-selected'),
          selectIndicator: horizontal('registry-select-indicator'),
          dialogClose: horizontal('registry-dialog-close'),
          drawerClose: horizontal('registry-drawer-close'),
          sheetClose: horizontal('registry-sheet-close'),
          comboboxTrigger: horizontal('registry-combobox-trigger'),
          toastRegion: horizontal('registry-toast-region'),
          submenuChevron: getComputedStyle(document.querySelector('#registry-menu-subtrigger svg')!)
            .rotate,
          headers: {
            alertDialog: readingEdge(
              'registry-alert-dialog-header',
              'registry-alert-dialog-header-label',
            ),
            dialog: readingEdge('registry-dialog-header', 'registry-dialog-header-label'),
            drawer: readingEdge('registry-drawer-header', 'registry-drawer-header-label'),
          },
        }
      })
      await page.close()
      return result
    }

    const ltr = await read('ltr')
    const rtl = await read('rtl')
    expect([ltr.checkbox.paddingLeft, ltr.checkbox.paddingRight]).toEqual(['32px', '8px'])
    expect([rtl.checkbox.paddingLeft, rtl.checkbox.paddingRight]).toEqual(['8px', '32px'])
    expect([ltr.menuIndicator.left, rtl.menuIndicator.right]).toEqual(['8px', '8px'])
    expect(Number.parseFloat(ltr.shortcut.marginLeft)).toBeGreaterThan(0)
    expect(Number.parseFloat(rtl.shortcut.marginRight)).toBeGreaterThan(0)
    expect([ltr.selectItem.paddingLeft, ltr.selectItem.paddingRight]).toEqual(['8px', '32px'])
    expect([rtl.selectItem.paddingLeft, rtl.selectItem.paddingRight]).toEqual(['32px', '8px'])
    expect([ltr.selectIndicator.right, rtl.selectIndicator.left]).toEqual(['8px', '8px'])
    for (const key of [
      'dialogClose',
      'drawerClose',
      'sheetClose',
      'comboboxTrigger',
      'toastRegion',
    ] as const) {
      expect(ltr[key].right, `${key}/ltr`).toMatch(/^(0px|16px)$/)
      expect(rtl[key].left, `${key}/rtl`).toMatch(/^(0px|16px)$/)
    }
    expect(ltr.submenuChevron).toBe('none')
    expect(rtl.submenuChevron).toBe('180deg')
    for (const key of ['alertDialog', 'dialog', 'drawer'] as const) {
      expect(ltr.headers[key].leftGap, `${key}/ltr`).toBeLessThan(ltr.headers[key].rightGap)
      expect(rtl.headers[key].rightGap, `${key}/rtl`).toBeLessThan(rtl.headers[key].leftGap)
      expect(ltr.headers[key].align, `${key}/ltr-align`).toMatch(/^(left|start)$/)
      expect(rtl.headers[key].align, `${key}/rtl-align`).toMatch(/^(right|start)$/)
    }
  })
})
