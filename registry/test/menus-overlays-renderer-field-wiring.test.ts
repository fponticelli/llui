/**
 * #265 B7 — mirrors
 * `packages/components/test/styles/menus-overlays-renderer-field-wiring.test.ts`
 * for the REGISTRY scenario renderer: the shared jsdom dimension test
 * globally skips `placement` (documented rationale there: jsdom performs no
 * real layout, so mutating the renderer's `placement: input.placement`
 * wiring to a hardcoded value produces no observable diff in that harness).
 * `attachFloating`'s `data-placement`/`data-side` are computed from the
 * placement string alone (side/alignment), independent of real element
 * size, so a focused test calling the adapter directly closes the gap.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { REGISTRY_ADAPTERS, type RenderContext } from './menus-overlays-scenario-renderer'
import type { FloatingPresenceCaseInput } from '../../packages/components/test/styles/menus-overlays-scenarios'
import { DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT } from '@llui/cli/presentation-scenarios'

const ctx: RenderContext = {
  scenarioId: 'component:popover',
  caseId: 'test',
  environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
}

afterEach(() => {
  document.body.innerHTML = ''
})

// See the components-side twin for why this needs a macrotask flush:
// `attachFloating` resolves `data-placement`/`data-side` through
// `computePosition(...).then(...)`, itself several async platform-method
// microtask hops deep even in jsdom with zero-size rects.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('#265 B7 — registry renderer wires the real requested `placement` through to attachFloating', () => {
  it('a bottom-anchored case yields data-side="bottom" and a top-anchored one yields data-side="top"', async () => {
    const bottomInput: FloatingPresenceCaseInput = {
      presence: 'open',
      skipAnimations: true,
      placement: 'bottom',
      label: 'Dimensions',
    }
    const topInput: FloatingPresenceCaseInput = {
      presence: 'open',
      skipAnimations: true,
      placement: 'top-start',
      label: 'Dimensions',
    }

    // The overlay content is PORTALED to `document.body`, not a descendant
    // of the mount host, so it must be queried there — sequentially, one
    // mount disposed before the next (both use the same fixed part-bag id).
    const bottomHost = document.createElement('div')
    document.body.appendChild(bottomHost)
    const bottomHandle = REGISTRY_ADAPTERS['component:popover'](bottomHost, bottomInput, ctx)
    await flush()
    const bottomSide = document
      .querySelector('[data-scope="popover"][data-part="content"]')
      ?.getAttribute('data-side')
    bottomHandle.dispose()
    bottomHost.remove()

    const topHost = document.createElement('div')
    document.body.appendChild(topHost)
    const topHandle = REGISTRY_ADAPTERS['component:popover'](topHost, topInput, ctx)
    await flush()
    const topSide = document
      .querySelector('[data-scope="popover"][data-part="content"]')
      ?.getAttribute('data-side')
    topHandle.dispose()
    topHost.remove()

    expect(bottomSide).toBe('bottom')
    expect(topSide).toBe('top')
    expect(bottomSide).not.toBe(topSide)
  })
})
