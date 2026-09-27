import { describe, expect, it } from 'vitest'
import { isFrameworkError } from '@llui/dom'
import { createOverlay } from '../../src/utils/overlay-engine'
import { signalOf } from '../_signal'

describe('overlay engine lifetime contracts', () => {
  it('rejects visibility-scoped floating when the mounted phase can retain presentation', () => {
    const state = signalOf({ mounted: true, visible: true })

    const call = (): void => {
      createOverlay({
        state,
        host: undefined,
        positioner: {},
        content: () => [],
        contentId: 'floating-content',
        relationships: {},
        mountWhen: (value) => value.mounted,
        visibleWhen: (value) => value.visible,
        onDismiss: () => undefined,
        floating: {
          placement: 'bottom',
          offset: 0,
          flip: true,
          shift: true,
        },
      })
    }

    expect(call).toThrow(/persistent floating/i)
    // #265 A5 — this is a framework authoring invariant (a two-phase overlay
    // wired without `persistent: true` cannot be reconciled), so it must be
    // an `LluiFrameworkError` — brand-checked via `isFrameworkError`, never
    // contained by any mount error boundary — rather than a plain `Error`.
    try {
      call()
      expect.unreachable('createOverlay should have thrown')
    } catch (err) {
      expect(isFrameworkError(err)).toBe(true)
    }
  })
})
