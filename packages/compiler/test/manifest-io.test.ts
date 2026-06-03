import { describe, it, expect } from 'vitest'
import { serializeManifest, parseManifest } from '../src/manifest-io.js'
import { COMPILER_VERSION } from '../src/version.js'
import type { Manifest } from '../src/manifest.js'

const sample: Manifest = {
  version: 2,
  compilerVersion: COMPILER_VERSION,
  helpers: {
    'components/rating-group#itemFill': {
      kind: 'view-helper',
      helperLocalPaths: [],
      viaParams: [
        { index: 0, shape: 'state-value', reads: ['value', 'hoveredValue', 'allowHalf'] },
        { index: 1, shape: 'opaque' },
      ],
    },
    'components/accordion#connect': {
      kind: 'parts-helper',
      helperLocalPaths: [],
      viaParams: [
        {
          index: 0,
          shape: 'accessor',
          innerReads: [{ kind: 'param-result-path', from: 0, path: 'open' }],
        },
        { index: 1, shape: 'send' },
      ],
      contextReads: [{ context: '@llui/components#LocaleContext', subPaths: ['accordion.label'] }],
    },
  },
  components: {},
}

describe('manifest-io', () => {
  it('round-trips a valid manifest', () => {
    const json = serializeManifest(sample)
    const parsed = parseManifest(json)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.manifest).toEqual(sample)
  })

  it('produces stable, sorted-key output (re-serialize is byte-identical)', () => {
    const a = serializeManifest(sample)
    // Reverse insertion order of helpers; output must be identical.
    const reordered: Manifest = {
      ...sample,
      helpers: Object.fromEntries(Object.entries(sample.helpers).reverse()),
    }
    expect(serializeManifest(reordered)).toBe(a)
    // viaParams (array) order is preserved — it is index-meaningful.
    expect(a.indexOf('"index": 0')).toBeLessThan(a.indexOf('"index": 1'))
  })

  it('rejects an unsupported schema version as incompatible', () => {
    const bad = serializeManifest(sample).replace('"version": 2', '"version": 3')
    const parsed = parseManifest(bad)
    expect(parsed).toMatchObject({ ok: false, reason: 'incompatible' })
  })

  it('rejects a major-incompatible compilerVersion', () => {
    const bad = serializeManifest({ ...sample, compilerVersion: '99.0.0' })
    const parsed = parseManifest(bad)
    expect(parsed).toMatchObject({ ok: false, reason: 'incompatible' })
  })

  it('accepts a minor/patch-different compilerVersion (same major)', () => {
    const major = COMPILER_VERSION.split('.')[0]
    const parsed = parseManifest(
      serializeManifest({ ...sample, compilerVersion: `${major}.999.999` }),
    )
    expect(parsed.ok).toBe(true)
  })

  it('reports malformed JSON', () => {
    expect(parseManifest('{ not json')).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('reports a structurally invalid helper entry', () => {
    const bad = JSON.stringify({
      version: 2,
      compilerVersion: COMPILER_VERSION,
      helpers: { x: { kind: 'nope' } },
      components: {},
    })
    expect(parseManifest(bad)).toMatchObject({ ok: false, reason: 'malformed' })
  })
})
