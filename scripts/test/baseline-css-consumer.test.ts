/**
 * The PUBLISHED-ARTIFACT gate for the Tailwind-free Baseline theme (#262,
 * #268): a minimal consumer builds and renders the Baseline path from the
 * packed tarballs — exactly the files npm would install — in a directory
 * where Tailwind cannot even be resolved.
 *
 * `packages/components/test/styles/distribution.test.ts` pins the SOURCE
 * contract (module list, no Tailwind directive in a baseline module, the
 * consumer's manifest); this is the other half, and the one a consumer
 * meets: `files`, the `exports` map, the published `dist/styles`, and the
 * published machine + runtime JS, assembled outside the workspace.
 *
 *   1. `pnpm pack` `@llui/components` and `@llui/dom` (their built `dist`,
 *      so this runs after the Build step, like every published-artifact
 *      check here) and unpack them into a fresh consumer's `node_modules`;
 *   2. copy `examples/baseline-css` into it, and link its one build tool
 *      (`vite`, which it declares) — nothing else;
 *   3. prove Tailwind and PostCSS are UNRESOLVABLE from it, then build it;
 *   4. read the emitted CSS for the baseline rules and for any trace of a
 *      Tailwind pipeline, and render it in Chromium: the real `switch`
 *      machine's parts are styled by the published theme and respond.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { build, preview, type PreviewServer } from 'vite'
import { useHermeticBrowser } from '../lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

const repoRoot = path.resolve(import.meta.dirname, '../..')
const fixtureDir = path.join(repoRoot, 'examples/baseline-css')
const PACKED = ['components', 'dom'] as const
const FIXTURE_FILES = ['index.html', 'package.json', 'vite.config.ts', 'src/main.ts'] as const
/** What a Tailwind pipeline would need; none may resolve from the consumer. */
const TAILWIND_TOOLING = [
  'tailwindcss',
  '@tailwindcss/vite',
  '@tailwindcss/postcss',
  'postcss',
  'tw-animate-css',
] as const

let workDir: string
let consumerDir: string
let emittedCss = ''
let packedStyles: string[] = []
let server: PreviewServer | undefined
let browser: Browser | undefined
let page: Page

function pack(name: (typeof PACKED)[number], destination: string): string {
  const out = execFileSync(
    'pnpm',
    ['pack', '--pack-destination', destination, '--config.ignore-scripts=true'],
    { cwd: path.join(repoRoot, 'packages', name), encoding: 'utf8' },
  )
  const tarball = out.trim().split('\n').at(-1)?.trim() ?? ''
  if (!tarball.endsWith('.tgz') || !existsSync(tarball)) {
    throw new Error(`pnpm pack @llui/${name} produced no tarball:\n${out}`)
  }
  return tarball
}

beforeAll(async () => {
  for (const name of PACKED) {
    const dist = path.join(repoRoot, 'packages', name, 'dist')
    if (!existsSync(dist)) {
      throw new Error(`packages/${name}/dist is missing — build the packages first`)
    }
  }
  // Real path: Vite names emitted pages relative to `root` from their REAL
  // path, and the default macOS tmpdir is a symlink (`/var` -> `/private/var`).
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'llui-baseline-consumer-')))
  consumerDir = path.join(workDir, 'consumer')
  const tarballs = path.join(workDir, 'tarballs')
  mkdirSync(tarballs, { recursive: true })
  for (const name of PACKED) {
    const target = path.join(consumerDir, 'node_modules/@llui', name)
    mkdirSync(target, { recursive: true })
    execFileSync('tar', ['-xzf', pack(name, tarballs), '-C', target, '--strip-components=1'])
  }
  for (const file of FIXTURE_FILES) {
    mkdirSync(path.dirname(path.join(consumerDir, file)), { recursive: true })
    cpSync(path.join(fixtureDir, file), path.join(consumerDir, file))
  }
  // The consumer's one build tool, which its package.json declares.
  symlinkSync(
    realpathSync(path.join(fixtureDir, 'node_modules/vite')),
    path.join(consumerDir, 'node_modules/vite'),
    'dir',
  )
  packedStyles = readdirSync(path.join(consumerDir, 'node_modules/@llui/components/dist/styles'))
    .filter((file) => file.endsWith('.css'))
    .sort()

  await build({
    root: consumerDir,
    configFile: path.join(consumerDir, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir: path.join(consumerDir, 'dist'), emptyOutDir: true },
  })
  const assets = path.join(consumerDir, 'dist/assets')
  emittedCss = readdirSync(assets)
    .filter((file) => file.endsWith('.css'))
    .map((file) => readFileSync(path.join(assets, file), 'utf8'))
    .join('\n')

  server = await preview({
    root: consumerDir,
    configFile: false,
    build: { outDir: path.join(consumerDir, 'dist') },
    preview: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  })
  const address = server.httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('preview bound no port')
  browser = await hermetic.launch({ headless: true })
  page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${address.port}/`)
  await page.locator('#theme-switch').waitFor()
}, 60_000)

afterAll(async () => {
  await browser?.close()
  if (server !== undefined) {
    const http = server.httpServer
    if ('closeAllConnections' in http) http.closeAllConnections()
    await new Promise<void>((done) => http.close(() => done()))
  }
  if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true })
})

/** Paint a computed colour and read it back (oklch/color-mix come back verbatim). */
async function painted(selector: string, property: 'backgroundColor' | 'color'): Promise<number[]> {
  return page.evaluate(
    ({ selector, property }) => {
      const element = document.querySelector(selector)
      if (element === null) throw new Error(`no ${selector}`)
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')!
      context.fillStyle = getComputedStyle(element)[property]
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    },
    { selector, property },
  )
}

describe('a consumer of the PUBLISHED Baseline theme, without Tailwind (#268)', () => {
  it('installs only the packed artifacts and its declared build tool', () => {
    // (`.vite-temp` is Vite's own scratch space for bundling the config.)
    const installed = readdirSync(path.join(consumerDir, 'node_modules'))
      .filter((name) => !name.startsWith('.'))
      .sort()
    expect(installed).toEqual(['@llui', 'vite'])
    expect(readdirSync(path.join(consumerDir, 'node_modules/@llui')).sort()).toEqual([
      'components',
      'dom',
    ])
    // The packed styles are exactly what the package exports.
    const manifest = JSON.parse(
      readFileSync(path.join(consumerDir, 'node_modules/@llui/components/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> }
    const exported = Object.keys(manifest.exports)
      .filter((key) => key.startsWith('./styles/'))
      .map((key) => key.slice('./styles/'.length))
      .sort()
    expect(packedStyles).toEqual(exported)
    expect(packedStyles).toContain('theme.css')
  })

  it('cannot resolve any Tailwind or PostCSS tooling', async () => {
    // Walk the consumer's `node_modules` chain the way a bundler resolves a
    // bare specifier. NOT `createRequire(...).resolve`: `pnpm run` exports
    // NODE_PATH pointing at the workspace's virtual store, which CommonJS
    // resolution honours and a bundler does not — measured, it "found"
    // `@tailwindcss/vite` and `postcss` in the repo's `.pnpm` from /tmp.
    const findable = TAILWIND_TOOLING.filter((name) => {
      for (let dir = consumerDir; ; dir = path.dirname(dir)) {
        if (existsSync(path.join(dir, 'node_modules', name, 'package.json'))) return true
        if (path.dirname(dir) === dir) return false
      }
    })
    expect(findable).toEqual([])
    // And through the REAL resolver: a consumer that asked for Tailwind would
    // fail to build here (the instrument's own canary).
    const canary = path.join(workDir, 'canary')
    mkdirSync(canary, { recursive: true })
    symlinkSync(path.join(consumerDir, 'node_modules'), path.join(canary, 'node_modules'), 'dir')
    writeFileSync(path.join(canary, 'index.html'), '<link rel="stylesheet" href="./main.css" />')
    writeFileSync(path.join(canary, 'main.css'), "@import 'tailwindcss';\n")
    await expect(
      build({
        root: canary,
        configFile: false,
        logLevel: 'silent',
        build: { outDir: path.join(canary, 'dist') },
      }),
    ).rejects.toThrow(/tailwindcss/)
    const manifest = JSON.parse(readFileSync(path.join(consumerDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    expect(declared.filter((name) => /tailwind|postcss/.test(name))).toEqual([])
    for (const config of readdirSync(consumerDir)) {
      expect(config, 'a Tailwind/PostCSS config file').not.toMatch(/^(tailwind|postcss)\.config/)
    }
  })

  it('emits the baseline rules and no trace of a Tailwind pipeline', () => {
    expect(emittedCss.length).toBeGreaterThan(20_000)
    expect(emittedCss).toMatch(/\[data-scope=['"]?switch['"]?\]\[data-part=['"]?track['"]?\]/)
    expect(emittedCss).toContain('--primary')
    // Everything is resolved and bundled: no directive left for a later tool.
    expect(emittedCss).not.toMatch(/@(tailwind|apply|theme|config|plugin|source|utility|variant)\b/)
    expect(emittedCss).not.toMatch(/@import\b/)
    expect(emittedCss).not.toMatch(/--tw-/)
    expect(emittedCss).not.toMatch(/@layer\s+utilities/)
  })

  it('styles and drives the real machine from the published JS and CSS', async () => {
    const root = page.locator('#theme-switch')
    expect(await root.getAttribute('role')).toBe('switch')
    expect(await root.getAttribute('aria-checked')).toBe('true')
    const track = '#theme-switch [data-part="track"]'
    const on = await painted(track, 'backgroundColor')
    expect(on[3], 'the checked track paints').toBe(255)
    await root.click()
    expect(await root.getAttribute('aria-checked')).toBe('false')
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()))
    const off = await painted(track, 'backgroundColor')
    expect(off).not.toEqual(on)
    const primary = await painted('#primary', 'backgroundColor')
    expect(primary[3], 'the primary button paints').toBe(255)
  })

  it('switches to the published dark tokens', async () => {
    const light = await painted('#primary', 'backgroundColor')
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
      document.getAnimations().forEach((animation) => animation.finish())
    })
    const dark = await painted('#primary', 'backgroundColor')
    expect(dark).not.toEqual(light)
  })
})
