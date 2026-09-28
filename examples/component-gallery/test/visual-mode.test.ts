/**
 * WHEN the visual gate compares (#268): the decision between comparing
 * against the committed baselines, checking determinism, and failing.
 *
 * A baseline is reproducible only where the rendering is — the same browser
 * build, platform and architecture, AND the same fonts and rasteriser. The
 * first three are names; the last two are not, so the manifest records a
 * RENDERING FINGERPRINT (`gates/fingerprint.ts`) and a run compares only
 * when every component of the environment, the fingerprint included,
 * matches. A host with CI's browser build but other fonts used to enter
 * compare mode and fail ~937 cases on sizes and pixels.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calibrationDigest } from './gates/fingerprint'
import {
  MANIFEST_PATH,
  decideVisualMode,
  describeDifferences,
  environmentDifferences,
  parseManifest,
  type RenderingFingerprint,
  type VisualEnvironment,
} from './gates/visual'

const SANS = 'ui-sans-serif, system-ui, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const hash = (seed: string): string => seed.repeat(64).slice(0, 64)

const rendering = (overrides: Partial<RenderingFingerprint> = {}): RenderingFingerprint => ({
  calibration: calibrationDigest([MONO, SANS]),
  stacks: {
    [MONO]: { fonts: ['DejaVuSansMono'], pixels: hash('a') },
    [SANS]: { fonts: ['DejaVuSans', 'DejaVuSans-Bold'], pixels: hash('b') },
  },
  raster: hash('c'),
  ...overrides,
})

const RECORDED: VisualEnvironment = {
  browser: '147.0.7727.15',
  platform: 'linux',
  arch: 'x64',
  rendering: rendering(),
}
const DECLARED = [MONO, SANS]

const withStack = (stack: string, fonts: readonly string[], pixels: string): VisualEnvironment => ({
  ...RECORDED,
  rendering: rendering({
    stacks: { ...RECORDED.rendering.stacks, [stack]: { fonts, pixels } },
  }),
})

describe('environmentDifferences', () => {
  it('finds none in the recording environment', () => {
    expect(environmentDifferences(RECORDED, RECORDED, DECLARED)).toEqual([])
  })

  it('names a browser, platform or architecture change', () => {
    const current = { ...RECORDED, browser: '148.0.1.2', platform: 'darwin', arch: 'arm64' }
    expect(environmentDifferences(RECORDED, current, DECLARED)).toEqual([
      { component: 'browser', detail: 'chromium 148.0.1.2 here, 147.0.7727.15 when recorded' },
      { component: 'platform', detail: 'darwin here, linux when recorded' },
      { component: 'arch', detail: 'arm64 here, x64 when recorded' },
    ])
  })

  it('names a font stack that resolves to other fonts — the same browser build is not enough', () => {
    const current = withStack(SANS, ['LiberationSans', 'LiberationSans-Bold'], hash('d'))
    expect(environmentDifferences(RECORDED, current, DECLARED)).toEqual([
      {
        component: 'fonts',
        detail: `"${SANS}" resolves to LiberationSans, LiberationSans-Bold here, DejaVuSans, DejaVuSans-Bold when recorded`,
      },
    ])
  })

  it('names a stack that draws other pixels with the same fonts', () => {
    const current = withStack(MONO, ['DejaVuSansMono'], hash('e'))
    expect(environmentDifferences(RECORDED, current, DECLARED)).toEqual([
      {
        component: 'text',
        detail: `"${MONO}" draws different pixels with the same fonts (hinting, antialiasing or font file version)`,
      },
    ])
  })

  it('names a raster change', () => {
    const current = { ...RECORDED, rendering: rendering({ raster: hash('f') }) }
    expect(environmentDifferences(RECORDED, current, DECLARED)).toEqual([
      {
        component: 'raster',
        detail:
          'the shape calibration draws different pixels (Skia/GPU raster configuration differs)',
      },
    ])
  })

  it('refuses a fingerprint taken with another calibration document, without comparing it', () => {
    const current = {
      ...RECORDED,
      rendering: rendering({ calibration: hash('9'), raster: hash('f') }),
    }
    expect(environmentDifferences(RECORDED, current, DECLARED)).toEqual([
      {
        component: 'calibration',
        detail: 'the calibration document changed since the fingerprint was recorded',
      },
    ])
  })

  it('refuses a fingerprint that never rendered a font stack the documents now declare', () => {
    const serif = 'Georgia, serif'
    expect(environmentDifferences(RECORDED, RECORDED, [...DECLARED, serif])).toEqual([
      {
        component: 'coverage',
        detail: `the documents declare font stacks the fingerprint never rendered: "${serif}"`,
      },
    ])
  })

  it('does not require a stack the documents no longer declare', () => {
    expect(environmentDifferences(RECORDED, RECORDED, [SANS])).toEqual([])
  })

  it('refuses a measurement that is missing a recorded stack', () => {
    const { [MONO]: _dropped, ...rest } = RECORDED.rendering.stacks
    const current = { ...RECORDED, rendering: rendering({ stacks: rest }) }
    expect(environmentDifferences(RECORDED, current, DECLARED)).toEqual([
      { component: 'fonts', detail: `"${MONO}" was not measured here` },
    ])
  })
})

describe('decideVisualMode', () => {
  const decide = (
    options: { update?: boolean; required?: boolean; recorded?: VisualEnvironment },
    current: VisualEnvironment,
  ) =>
    decideVisualMode({
      update: options.update ?? false,
      required: options.required ?? false,
      recorded: options.recorded,
      current,
      declaredStacks: DECLARED,
    })

  it('compares only when browser, platform, arch AND the rendering fingerprint match', () => {
    expect(decide({ recorded: RECORDED }, RECORDED)).toEqual({ mode: 'compare', differences: [] })
    expect(decide({ recorded: RECORDED, required: true }, RECORDED).mode).toBe('compare')
  })

  it('checks determinism locally when only the fonts differ', () => {
    const current = withStack(SANS, ['LiberationSans'], hash('d'))
    const decision = decide({ recorded: RECORDED }, current)
    expect(decision.mode).toBe('determinism')
    expect(decision.differences.map(({ component }) => component)).toEqual(['fonts'])
  })

  it('fails under LLUI_VISUAL_REQUIRED when the fingerprint differs', () => {
    const current = { ...RECORDED, rendering: rendering({ raster: hash('f') }) }
    expect(decide({ recorded: RECORDED, required: true }, current).mode).toBe('unavailable')
  })

  it('checks determinism, or fails when required, with no baselines at all', () => {
    expect(decide({}, RECORDED)).toEqual({ mode: 'determinism', differences: [] })
    expect(decide({ required: true }, RECORDED)).toEqual({ mode: 'unavailable', differences: [] })
  })

  it('records whatever the environment in update mode', () => {
    const current = withStack(SANS, ['LiberationSans'], hash('d'))
    expect(decide({ recorded: RECORDED, update: true }, current).mode).toBe('update')
    expect(decide({ update: true, required: true }, current).mode).toBe('update')
  })
})

describe('describeDifferences', () => {
  it('headlines a fingerprint mismatch by component and says how to fix it', () => {
    const current = {
      ...withStack(SANS, ['LiberationSans'], hash('d')),
      rendering: {
        ...withStack(SANS, ['LiberationSans'], hash('d')).rendering,
        raster: hash('f'),
      },
    }
    const text = describeDifferences(environmentDifferences(RECORDED, current, DECLARED))
    expect(text).toMatch(
      /^rendering fingerprint differs \(fonts, raster\): fonts\/raster differ from the recording environment/,
    )
    expect(text).toContain(`"${SANS}" resolves to LiberationSans here`)
    expect(text).toContain('run `pnpm gallery:visual:update`')
    expect(text).toContain('`visual-baselines` artifact')
  })

  it('headlines an identity mismatch as the environment, not the fingerprint', () => {
    const text = describeDifferences(
      environmentDifferences(RECORDED, { ...RECORDED, browser: '148.0.1.2' }, DECLARED),
    )
    expect(text).toMatch(/^recording environment differs \(browser\): chromium 148\.0\.1\.2 here/)
  })
})

describe('parseManifest', () => {
  const valid = { version: 2, environment: RECORDED, cases: { 'a/b': { width: 1, height: 2 } } }

  it('accepts a well-formed manifest', () => {
    expect(parseManifest(valid)).toEqual(valid)
  })

  it('rejects a manifest recorded before the rendering fingerprint existed', () => {
    const { rendering: _rendering, ...identity } = RECORDED
    expect(() => parseManifest({ ...valid, version: 1, environment: identity })).toThrow(
      /manifest version 1 is not supported \(expected 2, .*\).*gallery:visual:update/,
    )
  })

  it('names the malformed field', () => {
    const broken = {
      ...valid,
      environment: {
        ...RECORDED,
        rendering: { ...RECORDED.rendering, stacks: { [SANS]: { fonts: 'DejaVuSans' } } },
      },
    }
    expect(() => parseManifest(broken)).toThrow(/environment\.rendering\.stacks\[.*\]\.fonts/)
    expect(() => parseManifest({ ...valid, cases: { x: { width: '1', height: 2 } } })).toThrow(
      /cases\["x"\]\.width/,
    )
  })

  it('reads the committed manifest, fingerprinted with the current calibration document', () => {
    const committed = parseManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')))
    const { calibration, stacks } = committed.environment.rendering
    expect(Object.keys(stacks).length).toBeGreaterThan(0)
    expect(calibration).toBe(calibrationDigest(Object.keys(stacks)))
  })
})
