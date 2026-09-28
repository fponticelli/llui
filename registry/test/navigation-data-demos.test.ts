import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { component, mountApp } from '@llui/dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Browser } from 'playwright'
import { compileCandidates, markerName } from '../../scripts/lib/tailwind-compile.mjs'
import * as registryMedia from '../../examples/registry-demo/src/sections/media'
import * as baselineData from '../../examples/components-demo/src/sections/data'
import { useHermeticBrowser } from '../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const baselineCss = [
  'semantic-tokens.css',
  'semantic-tokens-dark.css',
  'foundation.css',
  'disclosure-navigation.css',
  'data-display.css',
  'motion.css',
]
  .map((file) =>
    readFileSync(
      resolve(import.meta.dirname, '../../packages/components/src/styles', file),
      'utf8',
    ),
  )
  .join('\n')

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

function carouselOnly(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content.querySelector<HTMLElement>(
    '[data-scope="carousel"][data-part="root"]',
  )
  if (root === null) throw new Error('Actual demo did not render a carousel root')
  return root.outerHTML
}

function mountRegistryDemo(): string {
  const host = document.createElement('div')
  document.body.append(host)
  const app = mountApp(
    host,
    component<registryMedia.State, registryMedia.Msg>({
      name: 'ActualRegistryMediaDemo',
      init: registryMedia.init,
      update: registryMedia.update,
      view: ({ state, send }) => registryMedia.view(state, send),
    }),
  )
  const html = host.innerHTML
  app.dispose()
  host.remove()
  return html
}

function mountBaselineDemo(): string {
  const host = document.createElement('div')
  document.body.append(host)
  const app = mountApp(
    host,
    component<baselineData.State, baselineData.Msg, baselineData.Effect>({
      name: 'ActualBaselineDataDemo',
      init: baselineData.init,
      update: baselineData.update,
      onEffect: (effect, { send }) => baselineData.onEffect(effect, send),
      view: ({ state, send }) => baselineData.view(state, send),
    }),
  )
  const html = host.innerHTML
  app.dispose()
  host.remove()
  return html
}

describe('actual navigation/data demo carousel compositions', () => {
  let browser: Browser
  let registryCarousel: string
  let baselineCarousel: string
  let registryCss: string

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
            'chevron-left': { body: '<path d="m15 18-6-6 6-6" />' },
            'chevron-right': { body: '<path d="m9 18 6-6-6-6" />' },
            x: { body: '<path d="M18 6 6 18M6 6l12 12" />' },
          },
        }),
      }),
    )
    document.documentElement.dir = 'ltr'
    const registryHtml = mountRegistryDemo()
    const baselineHtml = mountBaselineDemo()
    registryCarousel = carouselOnly(registryHtml)
    baselineCarousel = carouselOnly(baselineHtml)
    const compiled = await compileCandidates(candidates(registryHtml))
    expect(compiled.dead).toEqual([])
    registryCss = compiled.css
    browser = await hermetic.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('dir')
    document.body.replaceChildren()
    await browser?.close()
  })

  it('keeps both demo initializers SSR-deterministic before mounted direction sync', () => {
    document.documentElement.dir = 'rtl'
    expect(registryMedia.init()[0].carousel.dir).toBe('ltr')
    expect(baselineData.init()[0].carousel.dir).toBe('ltr')
    document.documentElement.dir = 'ltr'
    expect(registryMedia.init()[0].carousel.dir).toBe('ltr')
    expect(baselineData.init()[0].carousel.dir).toBe('ltr')
  })

  it.each([
    ['baseline', 280, 'ltr'],
    ['baseline', 280, 'rtl'],
    ['baseline', 640, 'ltr'],
    ['baseline', 640, 'rtl'],
    ['baseline', 1024, 'ltr'],
    ['baseline', 1024, 'rtl'],
    ['registryTailwind', 280, 'ltr'],
    ['registryTailwind', 280, 'rtl'],
    ['registryTailwind', 640, 'ltr'],
    ['registryTailwind', 640, 'rtl'],
    ['registryTailwind', 1024, 'ltr'],
    ['registryTailwind', 1024, 'rtl'],
  ] as const)('%s uses its nested container at %ipx in %s', async (path, width, direction) => {
    const context = await browser.newContext({ viewport: { width, height: 480 } })
    const page = await context.newPage()
    const styles = path === 'baseline' ? baselineCss : registryCss
    const carousel = path === 'baseline' ? baselineCarousel : registryCarousel
    // PADDING, not margin (#264 review item 9): the registry recipe's
    // previous/next now sit OUTSIDE the carousel frame at `-start-12`/
    // `-end-12` (-48px), matching shadcn's upstream, offset from `root`'s
    // OWN edge — a `margin-inline` on `available` moves `available` itself
    // inward but leaves `root` flush against `available`'s edge, so the
    // buttons still land BEFORE `available`'s box starts. `padding-inline`
    // keeps `available` spanning the full viewport while insetting `root`
    // (its child) far enough that the buttons land inside `available`'s own
    // box instead of in the margin outside it.
    await page.setContent(
      `<!doctype html><html dir="${direction}"><head><style>${styles}</style></head><body style="margin:0"><div id="available" style="inline-size:100vw;padding-inline:64px;box-sizing:border-box">${carousel}</div></body></html>`,
    )
    const got = await page.evaluate(() => {
      const available = document.getElementById('available')!.getBoundingClientRect()
      const root = document.querySelector<HTMLElement>('[data-scope="carousel"][data-part="root"]')!
      const rootRect = root.getBoundingClientRect()
      const previous = root.querySelector<HTMLElement>('[data-part="prev-trigger"]')!
      const next = root.querySelector<HTMLElement>('[data-part="next-trigger"]')!
      const previousRect = previous.getBoundingClientRect()
      const nextRect = next.getBoundingClientRect()
      const direction = getComputedStyle(root).direction
      const icon = previous.querySelector('svg')!
      const iconStyle = getComputedStyle(icon)
      return {
        // `available`'s OWN box now spans the full viewport (padding, not
        // margin, provides the arrows' clearance — see the fixture HTML's
        // own comment), so utilization is measured against its CONTENT box
        // (excluding the 64px inline padding each side), not its border box.
        utilization: rootRect.width / (available.width - 128),
        pageContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        rootContained:
          rootRect.left >= available.left - 0.5 && rootRect.right <= available.right + 0.5,
        // Contained by the outer AVAILABLE container, not `root`'s own box
        // (#264 review item 9): shadcn's upstream previous/next sit OUTSIDE
        // the carousel frame by design (`-start-12`/`-end-12`), so a real
        // page's surrounding space is what has to contain them, never the
        // carousel's own root — this is the same distinction
        // `navigation-data-styles.test.ts`'s narrow-affordance probe makes.
        controls: [previousRect, nextRect].map((rect) => ({
          width: rect.width,
          height: rect.height,
          contained: rect.left >= available.left - 0.5 && rect.right <= available.right + 0.5,
        })),
        logical:
          direction === 'rtl'
            ? previousRect.left > nextRect.left
            : previousRect.left < nextRect.left,
        iconTransform: `${iconStyle.transform}|${iconStyle.rotate}`,
        previousClass: previous.className,
        hasTrack: root.querySelector('[data-part="track"]') !== null,
      }
    })
    await context.close()

    expect(got.utilization).toBeGreaterThanOrEqual(0.95)
    expect(got.pageContained).toBe(true)
    expect(got.rootContained).toBe(true)
    expect(
      got.controls.every(
        ({ width, height, contained }) => width >= 24 && height >= 24 && contained,
      ),
    ).toBe(true)
    expect(got.logical).toBe(true)
    expect(got.hasTrack).toBe(true)
    if (direction === 'rtl') expect(got.iconTransform, got.previousClass).not.toBe('none|none')
  })
})
