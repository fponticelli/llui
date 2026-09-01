import { describe, expect, it } from 'vitest'
import { createOverlay } from '../../src/utils/overlay-engine'
import { signalOf } from '../_signal'

describe('overlay engine lifetime contracts', () => {
  it('rejects visibility-scoped floating when the mounted phase can retain presentation', () => {
    const state = signalOf({ mounted: true, visible: true })

    expect(() =>
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
      }),
    ).toThrow(/persistent floating/i)
  })
})
