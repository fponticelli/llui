// @vitest-environment node
/**
 * The three builds, as Rollup actually produced them (#267): the structural
 * half of the isolation proof (the cascade half is measured on the live
 * CSSOM in the browser suite). A document can only ever apply what its own
 * build emitted, so "no page mixes both styling systems" reduces, at build
 * time, to what each build's module graph and CSS output contain.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, resolveConfig, type Plugin } from 'vite'

const GALLERY = resolve(import.meta.dirname, '..')
const REPO = resolve(GALLERY, '../..')
const CONFIGS = {
  shell: 'vite.config.ts',
  baseline: 'vite.baseline.config.ts',
  registry: 'vite.registry.config.ts',
} as const
type Build = keyof typeof CONFIGS

interface Output {
  readonly modules: string[]
  css: string
}
const outputs = {} as Record<Build, Output>
let outDir: string

function capture(into: Output): Plugin {
  return {
    name: 'test:capture-build',
    generateBundle(_options, bundle) {
      for (const id of this.getModuleIds()) {
        const file = id.split('?')[0]!
        into.modules.push(file.startsWith(REPO + sep) ? relative(REPO, file) : file)
      }
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'asset' && chunk.fileName.endsWith('.css')) {
          into.css += String(chunk.source)
        }
      }
    },
  }
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'llui-gallery-graph-'))
  process.env['LLUI_GALLERY_OUT'] = outDir
  try {
    for (const [name, config] of Object.entries(CONFIGS) as [Build, string][]) {
      outputs[name] = { modules: [], css: '' }
      await build({
        configFile: resolve(GALLERY, config),
        logLevel: 'error',
        plugins: [capture(outputs[name])],
      })
    }
  } finally {
    delete process.env['LLUI_GALLERY_OUT']
  }
}, 120_000)

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

const modules = (name: Build, pattern: RegExp) =>
  outputs[name].modules.filter((id) => pattern.test(id))
const count = (css: string, needle: string) => css.split(needle).length - 1

const BASELINE_RENDERERS = /^packages\/components\/test\/styles\/[a-z-]+-baseline-renderer\.ts$/
const REGISTRY_RENDERERS = /^registry\/test\/[a-z-]+-scenario-renderer\.ts$/
const COPIED_SKINS = /^examples\/registry-demo\/src\/components\/ui\//
/** Baseline part selectors (minifiers may drop the quotes). */
const BASELINE_PART = '[data-scope='
/** Every Tailwind v4 utility build declares `--tw-*` custom properties. */
const TAILWIND_SIGNATURE = '--tw-'

describe('build outputs (#267)', () => {
  it('each document is built by its own config, with Tailwind only in the registry one', async () => {
    const plugins = async (config: string) =>
      (
        await resolveConfig({ configFile: resolve(GALLERY, config), logLevel: 'error' }, 'build')
      ).plugins.map(({ name }) => name)
    expect((await plugins(CONFIGS.baseline)).filter((name) => /tailwind/i.test(name))).toEqual([])
    expect((await plugins(CONFIGS.shell)).filter((name) => /tailwind/i.test(name))).toEqual([])
    expect((await plugins(CONFIGS.registry)).some((name) => /tailwind/i.test(name))).toBe(true)
  })

  it('the Baseline theme document is plain baseline CSS and baseline renderers only', () => {
    const { css } = outputs.baseline
    expect(count(css, BASELINE_PART)).toBeGreaterThan(200)
    expect(count(css, TAILWIND_SIGNATURE)).toBe(0)
    expect(count(css, '@layer')).toBe(0)
    expect(modules('baseline', BASELINE_RENDERERS)).toHaveLength(4)
    expect(modules('baseline', REGISTRY_RENDERERS)).toEqual([])
    expect(modules('baseline', COPIED_SKINS)).toEqual([])
    // The contract (registry/registry.json) is shared data; registry CODE is not.
    expect(modules('baseline', /^registry\/(llui|test)\//)).toEqual([])
  })

  it('the Registry skins document is Tailwind over the COPIED skins, and nothing of the baseline', () => {
    const { css } = outputs.registry
    expect(count(css, TAILWIND_SIGNATURE)).toBeGreaterThan(50)
    expect(css).toMatch(/@layer\s+utilities/)
    expect(count(css, BASELINE_PART)).toBe(0)
    expect(modules('registry', REGISTRY_RENDERERS)).toHaveLength(4)
    expect(modules('registry', COPIED_SKINS).length).toBeGreaterThan(20)
    expect(modules('registry', BASELINE_RENDERERS)).toEqual([])
    // The copies, never the registry source they were copied from.
    expect(modules('registry', /^registry\/llui\//)).toEqual([])
  })

  it('the shell carries neither styling system nor any renderer', () => {
    const { css } = outputs.shell
    expect(css.length).toBeGreaterThan(1000)
    expect(count(css, TAILWIND_SIGNATURE)).toBe(0)
    expect(count(css, BASELINE_PART)).toBe(0)
    expect(count(css, '--primary')).toBe(0)
    expect(modules('shell', /^packages\/components\/src\//)).toEqual([])
    expect(modules('shell', BASELINE_RENDERERS)).toEqual([])
    expect(modules('shell', REGISTRY_RENDERERS)).toEqual([])
    expect(modules('shell', COPIED_SKINS)).toEqual([])
    // Its inventory comes from the contract and the family scenario data only.
    expect(modules('shell', /registry\/registry\.json$/)).toEqual(['registry/registry.json'])
    expect(modules('shell', /-scenarios\.ts$/).sort()).toEqual([
      'packages/components/test/styles/fixtures/form-control-scenarios.ts',
      'packages/components/test/styles/forms-controls-scenarios.ts',
      'packages/components/test/styles/menus-overlays-scenarios.ts',
      'packages/components/test/styles/navigation-data-scenarios.ts',
      'packages/components/test/styles/specialized-tools-scenarios.ts',
    ])
  })
})
