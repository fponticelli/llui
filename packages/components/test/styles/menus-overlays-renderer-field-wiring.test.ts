/**
 * #265 mutation review — three survivors against the shared jsdom dimension
 * test (`menus-overlays-baseline-renderer.test.ts`'s "every case field...
 * materially changes real output" check):
 *
 *   - A3/B7: `placement` is globally SKIPPED there (documented rationale:
 *     jsdom performs no real layout, so every element measures a zero rect
 *     regardless of the requested placement — mutating the renderer's
 *     `placement: input.placement` wiring to a hardcoded value produces no
 *     observable diff in THAT harness). But `attachFloating` still computes
 *     its `data-placement`/`data-side` attributes from `computeCoordsFromPlacement`
 *     using the placement string alone (side/alignment), which does not
 *     depend on real element size — so a FOCUSED test calling the adapter
 *     directly, one case field at a time, closes the gap without needing
 *     real Chromium layout.
 *   - A5: a menu item's `disabled` case field is likewise never asserted
 *     against the rendered `aria-disabled`/`data-disabled` output anywhere
 *     in the dimension sweep (menu items are an array-of-objects field,
 *     which `mutateFieldValue` structurally declines to mutate at all).
 *
 * This file exercises the real baseline (`packages/components`) and registry
 * (`registry/`) adapters directly with hand-built case inputs — the exact
 * pattern `Adapter`'s own doc comment names ("a dimension-mutation test can
 * call it directly with a hand-mutated `input`").
 */
import { describe, expect, it, afterEach } from 'vitest'
import { BASELINE_ADAPTERS, type RenderContext } from './menus-overlays-baseline-renderer.js'
import type { FloatingPresenceCaseInput, MenuCaseInput } from './menus-overlays-scenarios.js'
import { DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT } from '@llui/cli/presentation-scenarios'

const ctx: RenderContext = {
  scenarioId: 'component:popover',
  caseId: 'test',
  environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
}

afterEach(() => {
  document.body.innerHTML = ''
})

// `attachFloating` computes position via `computePosition(...).then(...)`,
// and floating-ui's platform methods are themselves `async` (several
// microtask hops deep even in jsdom with zero-size rects) — a macrotask
// flush guarantees every pending microtask has drained before a mount's
// `data-placement`/`data-side` are read, matching the existing jsdom
// submenu-positioning integration test's own `flush()`.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('#265 A3/B7 — baseline renderer wires the real requested `placement` through to attachFloating', () => {
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
    const bottomHandle = BASELINE_ADAPTERS['component:popover'](bottomHost, bottomInput, ctx)
    await flush()
    const bottomSide = document
      .querySelector('[data-scope="popover"][data-part="content"]')
      ?.getAttribute('data-side')
    bottomHandle.dispose()
    bottomHost.remove()

    const topHost = document.createElement('div')
    document.body.appendChild(topHost)
    const topHandle = BASELINE_ADAPTERS['component:popover'](topHost, topInput, ctx)
    await flush()
    const topSide = document
      .querySelector('[data-scope="popover"][data-part="content"]')
      ?.getAttribute('data-side')
    topHandle.dispose()
    topHost.remove()

    // Before #265 A3/B7 were closed, a renderer whose `placement:
    // input.placement` wiring silently dropped to a hardcoded value would
    // report the SAME data-side for both cases — this is exactly what the
    // mutation `{ placement: input.placement } -> { placement: 'bottom' }`
    // survived against the jsdom dimension sweep, which globally skips
    // `placement` for a documented, unrelated reason (real geometry).
    expect(bottomSide).toBe('bottom')
    expect(topSide).toBe('top')
    expect(bottomSide).not.toBe(topSide)
  })
})

describe("#265 A5 — baseline renderer wires each menu item's real `disabled` field through", () => {
  it('an item marked disabled in the case input renders aria-disabled/data-disabled; an enabled sibling does not', () => {
    const input: MenuCaseInput = {
      presence: 'open',
      skipAnimations: true,
      placement: 'bottom',
      items: [
        { value: 'enabled-item', label: 'Enabled', kind: 'action', disabled: false },
        { value: 'disabled-item', label: 'Disabled', kind: 'action', disabled: true },
      ],
      highlighted: null,
      checked: [],
      nestedOpen: false,
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const handle = BASELINE_ADAPTERS['component:menu'](host, input, {
      ...ctx,
      scenarioId: 'component:menu',
    })

    const enabledItem = document.querySelector('[data-part="item"][data-value="enabled-item"]')
    const disabledItem = document.querySelector('[data-part="item"][data-value="disabled-item"]')

    // Before #265 A5, the renderer's `disabled: item.disabled` wiring
    // silently dropping to `disabled: undefined` produced no observable
    // diff anywhere in the jsdom dimension sweep, because menu `items` is
    // an array-of-objects case field `mutateFieldValue` structurally
    // declines to mutate.
    expect(disabledItem?.getAttribute('aria-disabled')).toBe('true')
    expect(disabledItem?.getAttribute('data-disabled')).toBe('')
    expect(enabledItem?.getAttribute('aria-disabled')).toBeNull()
    expect(enabledItem?.getAttribute('data-disabled')).toBeNull()

    handle.dispose()
  })
})
