/**
 * The ONE live Chromium harness for the menus-overlays scenario renderers
 * (#265). Every browser suite that mounts a real `BASELINE_ADAPTERS` /
 * `REGISTRY_ADAPTERS` case goes through here, so the Vite servers, the
 * source aliases, the contract join and the per-case mount protocol cannot
 * drift between suites.
 *
 * Each path's fixture root (`examples/baseline-css` — the Tailwind-free
 * Baseline consumer — for the baseline path, `examples/registry-demo` for the
 * registry path) serves its own `src/test-fixtures/menus-overlays-live-render.ts`,
 * which exposes a per-case mount on `window`. Every case mounts in its OWN
 * page: never a shared style universe between two cases, or between the two
 * paths.
 *
 * Both fixtures are BUILT once per suite and served static
 * (`scripts/lib/prebuilt-fixture.mjs`), not served by a Vite dev server. On a
 * dev server the first page per path compiled the fixture on demand inside
 * whichever test ran first — the ContextMenu virtual-pointer test, 5.3 s /
 * 3.2 s alone at ambient load ~20 on 4 CPUs, past its 30 s budget inside a
 * parallel `turbo test` — and every later page (one per test, several per
 * toast test) re-fetched 107-134 unbundled modules through the dev server,
 * sharing each example's dependency-optimizer cache with every other suite
 * serving that example from a concurrent worker.
 *
 * Only for `// @vitest-environment node` suites: it starts real servers and
 * a real browser.
 */
import { afterAll, afterEach, beforeAll } from 'vitest'
import type { Browser, Page } from 'playwright'
import type { Alias } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sourceAliasesFromExports } from '../../../../scripts/lib/vite-source-aliases.mjs'
import { prebuildFixture, type PrebuiltFixture } from '../../../../scripts/lib/prebuilt-fixture.mjs'
import { useHermeticBrowser } from '../../../../scripts/lib/hermetic-browser.mjs'
import { ProductContractSchema } from '@llui/cli'

export const repoRoot = resolve(import.meta.dirname, '../../../..')

interface RawContract {
  productContract?: unknown
}

export const contract = ProductContractSchema.parse(
  (JSON.parse(readFileSync(resolve(repoRoot, 'registry/registry.json'), 'utf8')) as RawContract)
    .productContract,
)

export type LivePath = 'baseline' | 'registryTailwind'
export const LIVE_PATHS = ['baseline', 'registryTailwind'] as const

export interface MountRequest {
  readonly scenarioId: string
  readonly caseId: string
  readonly environment?: Record<string, unknown>
  readonly hostId: string
}

declare global {
  interface Window {
    __mountMenusOverlaysBaselineCase?: (contract: unknown, request: MountRequest) => void
    __disposeMenusOverlaysBaselineCase?: (hostId: string) => void
    __mountMenusOverlaysRegistryCase?: (contract: unknown, request: MountRequest) => void
    __disposeMenusOverlaysRegistryCase?: (hostId: string) => void
  }
}

export const MOUNT_FN: Record<
  LivePath,
  '__mountMenusOverlaysBaselineCase' | '__mountMenusOverlaysRegistryCase'
> = {
  baseline: '__mountMenusOverlaysBaselineCase',
  registryTailwind: '__mountMenusOverlaysRegistryCase',
}

const sourceAliases: Alias[] = [
  ...(['components', 'dom', 'interactions', 'cli'] as const).map((name) =>
    sourceAliasesFromExports({
      packageName: `@llui/${name}`,
      packageJsonPath: resolve(repoRoot, `packages/${name}/package.json`),
      srcDir: resolve(repoRoot, `packages/${name}/src`),
    }),
  ),
  [
    { find: '@/lib', replacement: resolve(repoRoot, 'registry/llui/lib') },
    { find: '@/ui', replacement: resolve(repoRoot, 'registry/llui/ui') },
  ],
].flat()

const FIXTURE = 'src/test-fixtures/menus-overlays-live-render.html'

function buildExample(directory: string): Promise<PrebuiltFixture> {
  return prebuildFixture({
    root: resolve(repoRoot, directory),
    inputs: [FIXTURE],
    alias: sourceAliases,
  })
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface OpenCaseOptions {
  readonly viewport?: Viewport
  /** Runs on the loaded page BEFORE the case mounts (e.g. a page-level theme
   * on `<html>`, or body padding that gives a floating anchor room). */
  readonly beforeMount?: (page: Page) => Promise<void>
}

export interface MenusOverlaysLiveHarness {
  /** A fresh page on `path`'s fixture, with its mount function ready. Closed
   * after the current test. */
  newPage(path: LivePath, viewport?: Viewport): Promise<Page>
  /** Mount one case into a new host element with id `request.hostId`. */
  mount(page: Page, path: LivePath, request: MountRequest): Promise<void>
  /** A new page with ONE case mounted into `#case`. */
  openCase(
    path: LivePath,
    scenarioId: string,
    caseId: string,
    environment?: Record<string, unknown>,
    options?: OpenCaseOptions,
  ): Promise<Page>
}

/** Register the servers/browser lifecycle on the enclosing suite and return
 * the page helpers. Call once, at the top of a `describe`. */
export function useMenusOverlaysLiveHarness(): MenusOverlaysLiveHarness {
  const hermetic = useHermeticBrowser()
  let browser: Browser | undefined
  let fixtures: PrebuiltFixture[] = []
  let urls: Record<LivePath, string> = { baseline: '', registryTailwind: '' }
  const openPages: Page[] = []

  beforeAll(async () => {
    const [baseline, registryTailwind, launched] = await Promise.all([
      buildExample('examples/baseline-css'),
      buildExample('examples/registry-demo'),
      hermetic.launch({ headless: true }),
    ])
    fixtures = [baseline, registryTailwind]
    browser = launched
    urls = { baseline: baseline.url(FIXTURE), registryTailwind: registryTailwind.url(FIXTURE) }
  }, 120_000)

  afterEach(async () => {
    for (const page of openPages.splice(0)) await page.close().catch(() => {})
  })

  afterAll(async () => {
    await browser?.close()
    await Promise.all(fixtures.map((fixture) => fixture.close()))
  })

  const newPage = async (path: LivePath, viewport?: Viewport): Promise<Page> => {
    if (browser === undefined) throw new Error('live harness used before beforeAll ran')
    const page = await browser.newPage({ viewport: viewport ?? { width: 1024, height: 768 } })
    openPages.push(page)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(urls[path])
    // The fixture is ONE bundled module script that assigns its mount function
    // synchronously, and module scripts run before `load` — so by the time
    // `goto` returns it is there or it never will be. Asserting instead of
    // waiting turns a broken fixture into an immediate error naming the
    // page's own exception, rather than a 30 s wait for a happy state that is
    // not coming.
    const ready = await page.evaluate(
      (name) => typeof window[name as keyof Window] === 'function',
      MOUNT_FN[path],
    )
    if (!ready) {
      throw new Error(
        `${path} fixture loaded without defining window.${MOUNT_FN[path]}` +
          (errors.length > 0 ? `: ${errors.join('; ')}` : ''),
      )
    }
    return page
  }

  const mount = async (page: Page, path: LivePath, request: MountRequest): Promise<void> => {
    await page.evaluate(
      ({ fn, contract, request }) => {
        const mountCase = window[fn as keyof Window] as (c: unknown, r: MountRequest) => void
        mountCase(contract, request)
      },
      { fn: MOUNT_FN[path], contract, request },
    )
  }

  const openCase: MenusOverlaysLiveHarness['openCase'] = async (
    path,
    scenarioId,
    caseId,
    environment,
    options,
  ) => {
    const page = await newPage(path, options?.viewport)
    await options?.beforeMount?.(page)
    await mount(page, path, {
      scenarioId,
      caseId,
      hostId: 'case',
      ...(environment !== undefined ? { environment } : {}),
    })
    return page
  }

  return { newPage, mount, openCase }
}
