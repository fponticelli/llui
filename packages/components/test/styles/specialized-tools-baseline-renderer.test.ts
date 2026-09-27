import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadProductContract } from './navigation-data-contract-source'
import {
  applicableSpecializedToolsScenarios,
  compileSpecializedToolsCatalog,
  joinSpecializedToolsScenarios,
  type SpecializedToolsJoinedScenario,
} from './specialized-tools-scenarios'
import {
  BASELINE_ADAPTERS,
  mountBaselineSpecializedToolsScenarios,
  type Disposable,
} from './specialized-tools-baseline-renderer'

const contract = loadProductContract()
const catalog = compileSpecializedToolsCatalog(contract)
const joined = joinSpecializedToolsScenarios(catalog, contract)
const scenarios = applicableSpecializedToolsScenarios(joined, 'baseline')

/** Every `data-part` a product's machine source can publish. */
function publishedParts(productId: string): string[] {
  const file =
    productId === 'wizard'
      ? '../../src/components/steps.ts'
      : `../../src/components/${productId}.ts`
  return [
    ...new Set(
      [
        ...readFileSync(resolve(import.meta.dirname, file), 'utf8').matchAll(
          /['"]data-part['"]:\s*['"]([^'"]+)['"]/g,
        ),
      ].map(([, part]) => part!),
    ),
  ].sort()
}

/**
 * Parts a product publishes that the gallery deliberately does not render,
 * each with its reason. Closed: an entry that becomes rendered fails as
 * obsolete (see the test below), so the list cannot silently outlive a reason.
 */
const UNRENDERED_PARTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'color-picker': {
    'saturation-slider': 'HSV-only secondary slider; the #264 color-picker tests cover it',
    'lightness-slider': 'HSV-only secondary slider; the #264 color-picker tests cover it',
    'chroma-slider': 'OKLCH-only secondary slider; the #264 color-picker tests cover it',
    'oklch-lightness-slider': 'OKLCH-only secondary slider; the #264 color-picker tests cover it',
    'eyedropper-trigger': 'feature-detected browser API; never deterministic in a gallery',
  },
  'date-picker': { preset: 'presets are an application choice; the range case shows the state' },
  'file-upload': {
    'clear-trigger': 'bulk clear is a secondary action; item-delete-trigger shows removal',
    'item-preview': 'previews need object URLs of real File handles — not deterministic data',
    'item-remove': 'alias of item-delete-trigger with identical wiring',
  },
  'gradient-picker': {
    'angle-input': 'kind-specific control; the #264 gradient-picker tests cover it',
    'center-area': 'kind-specific control; the #264 gradient-picker tests cover it',
    'center-thumb': 'kind-specific control; the #264 gradient-picker tests cover it',
    'css-error': 'shown only for an unparseable CSS entry; covered by #264',
    'distribute-button': 'secondary stop action; covered by #264',
    'interpolation-hue-select': 'interpolation controls; covered by #264',
    'interpolation-space-select': 'interpolation controls; covered by #264',
    'repeating-toggle': 'secondary toggle; covered by #264',
    'reverse-button': 'secondary stop action; covered by #264',
  },
  editable: { 'edit-trigger': 'the preview is the edit affordance in every case' },
  wizard: {
    'next-trigger': 'rendered through the WIZARD part bag, whose parts are steps-scoped',
    'prev-trigger': 'rendered through the WIZARD part bag, whose parts are steps-scoped',
  },
}

describe('baseline specialized-tools scenario renderer (#266)', () => {
  let mounted: Disposable | undefined

  const render = (
    candidate: readonly SpecializedToolsJoinedScenario[] = scenarios,
  ): HTMLElement => {
    const host = document.createElement('div')
    document.body.append(host)
    mounted = mountBaselineSpecializedToolsScenarios(host, contract, catalog, candidate)
    return host
  }

  afterEach(() => {
    mounted?.dispose()
    mounted = undefined
    document.body.replaceChildren()
  })

  it('binds exactly the products whose baseline mode is visually applicable', () => {
    expect(Object.keys(BASELINE_ADAPTERS).sort()).toEqual(
      scenarios.map(({ scenarioId }) => scenarioId).sort(),
    )
    expect(() => render(scenarios.slice(1))).toThrow(/do not match applicable/)
  })

  it('renders every applicable case with its canonical markers', () => {
    const host = render()
    const markers = [...host.querySelectorAll<HTMLElement>('[data-scenario-case]')]
      .map((node) => `${node.dataset.scenarioId}:${node.dataset.scenarioCase}`)
      .sort()
    expect(markers).toEqual(
      scenarios.flatMap((s) => s.cases.map((c) => `${s.scenarioId}:${c.id}`)).sort(),
    )
    for (const host_ of host.querySelectorAll<HTMLElement>('[data-scenario-case]')) {
      expect(host_.getAttribute('dir'), host_.id).toBe('ltr')
      expect(host_.dataset.theme, host_.id).toBe('light')
    }
  })

  it('renders every published part of every product, or states why not', () => {
    const host = render()
    for (const scenario of scenarios) {
      const scope = scenario.productId === 'wizard' ? 'steps' : scenario.productId
      const rendered = new Set(
        [
          ...host.querySelectorAll<HTMLElement>(
            `[data-scenario-product="${scenario.productId}"] [data-scope="${scope}"][data-part]`,
          ),
        ].map((node) => node.dataset.part!),
      )
      const allowed = UNRENDERED_PARTS[scenario.productId] ?? {}
      for (const part of publishedParts(scenario.productId)) {
        if (part in allowed) {
          // Closed at the other end: an allowance must still be needed.
          if (scenario.productId !== 'wizard') {
            expect(rendered.has(part), `${scenario.productId}: ${part} is rendered now`).toBe(false)
          }
          continue
        }
        expect(rendered.has(part), `${scenario.productId} never renders part ${part}`).toBe(true)
      }
    }
  })

  it('styles only through parts: no adapter adds a class or a style to a part', () => {
    const host = render()
    const offenders = [...host.querySelectorAll<HTMLElement>('[data-scope][data-part]')]
      .filter((node) => node.hasAttribute('class'))
      .filter(
        // The wizard's actions take the foundation `.btn` classes by design.
        (node) => !(node.dataset.scope === 'steps' && /-trigger$/.test(node.dataset.part ?? '')),
      )
      .map((node) => `${node.dataset.scope}/${node.dataset.part}`)
    expect(offenders).toEqual([])
    // The only inline styles on parts are the ones a MACHINE writes, plus the
    // consumer's share of a partial product (tour positioning) and the one
    // documented density override.
    const MACHINE_STYLED = new Set([
      'floating-panel/root',
      'image-cropper/crop-box',
      'scroll-area/thumb',
      'scroll-area/root',
      'splitter/primary-panel',
      'splitter/secondary-panel',
      'file-upload/item-progress-range',
      'file-upload/hidden-input',
      'tour/root',
      'tour/spotlight',
      'date-picker/root',
      'color-picker/area',
      'color-picker/area-thumb',
      'color-picker/preview',
      'color-picker/swatch',
      'color-picker/hue-slider',
      'color-picker/alpha-slider',
      'gradient-picker/preview',
      'gradient-picker/track',
      'gradient-picker/stop',
      'sortable/item',
    ])
    const styled = [...host.querySelectorAll<HTMLElement>('[data-scope][data-part][style]')]
      .map((node) => `${node.dataset.scope}/${node.dataset.part}`)
      .filter((key) => !MACHINE_STYLED.has(key))
    expect([...new Set(styled)]).toEqual([])
  })

  it('is deterministic: two renders produce byte-identical markup', () => {
    const first = render().innerHTML
    mounted?.dispose()
    document.body.replaceChildren()
    const second = render().innerHTML
    expect(second).toBe(first)
    expect(first).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/)
  })

  it('drives each complex state through the real reducer, visible as published state', () => {
    const host = render()
    const at = (product: string, caseId: string, selector: string): HTMLElement | null =>
      host.querySelector<HTMLElement>(
        `[data-scenario-product="${product}"][data-scenario-case="${caseId}"] ${selector}`,
      )
    expect(at('async-list', 'loading', '[data-part="root"]')?.getAttribute('aria-busy')).toBe(
      'true',
    )
    expect(at('async-list', 'empty', '[data-part="root"]')?.hasAttribute('data-empty')).toBe(true)
    expect(at('async-list', 'error', '[data-part="retry-trigger"]')?.hidden).toBe(false)
    expect(
      at('clipboard', 'permission-denied', '[data-part="indicator"]')?.hasAttribute('data-failed'),
    ).toBe(true)
    expect(at('date-input', 'invalid', '[data-part="input"]')?.getAttribute('aria-invalid')).toBe(
      'true',
    )
    expect(at('date-picker', 'single', '[data-today]')?.dataset.date).toBe('2026-03-14')
    expect(at('date-picker', 'time-zone', '[data-today]')?.dataset.date).toBe('2026-03-15')
    expect(
      at('date-picker', 'unavailable', '[data-date="2026-03-19"]')?.hasAttribute(
        'data-unavailable',
      ),
    ).toBe(true)
    expect(
      at('date-picker', 'range', '[data-date="2026-03-11"]')?.hasAttribute('data-in-range'),
    ).toBe(true)
    expect(at('date-picker', 'locale-de', '[role="columnheader"]')?.textContent).toBe('Mo')
    expect(
      at(
        'file-upload',
        'uploading',
        '[data-upload-status="uploading"] [role="progressbar"]',
      )?.getAttribute('aria-valuenow'),
    ).toBe('42')
    expect(
      at(
        'file-upload',
        'error-retry',
        '[data-upload-status="error"] [data-part="item-retry-trigger"]',
      )?.hidden,
    ).toBe(false)
    expect(
      at('file-upload', 'dragging', '[data-part="dropzone"]')?.hasAttribute('data-dragging'),
    ).toBe(true)
    expect(at('floating-panel', 'min-size', '[data-part="root"]')?.getAttribute('style')).toContain(
      'width:200px',
    )
    expect(
      at('image-cropper', 'zoomed', '[data-part="crop-box"]')?.getAttribute('aria-label'),
    ).toMatch(/Crop area: 248 × 248/)
    expect(at('qr-code', 'empty', '[data-part="root"]')?.hasAttribute('data-empty')).toBe(true)
    expect(
      at('signature-pad', 'cleared-undoable', '[data-part="undo-trigger"]')?.hasAttribute(
        'disabled',
      ),
    ).toBe(false)
    expect(at('signature-pad', 'signed', '[data-signature-ink] path')).not.toBeNull()
    expect(at('sortable', 'dragging', '[data-over]')?.dataset.id).toBe('task-2')
    expect(at('sortable', 'keyboard-grab', '[aria-grabbed="true"]')).not.toBeNull()
    expect(at('timer', 'complete', '[data-part="root"]')?.hasAttribute('data-complete')).toBe(true)
    expect(at('timer', 'complete', '[data-part="display"]')?.textContent).toBe('00:00')
    expect(at('tour', 'last-step', '[data-part="next-trigger"]')?.hasAttribute('data-last')).toBe(
      true,
    )
    expect(
      at('wizard', 'validating', '[data-part="next-trigger"]')?.getAttribute('aria-busy'),
    ).toBe('true')
  })
})
