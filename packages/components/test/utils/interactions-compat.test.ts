import { describe, expect, it } from 'vitest'
import * as compatibility from '../../src/utils/index'
import * as interactions from '@llui/interactions'

describe('@llui/components/utils compatibility', () => {
  it('re-exports the coordinated interaction singletons from @llui/interactions', () => {
    expect(compatibility.getFocusables).toBe(interactions.getFocusables)
    expect(compatibility.isFocusable).toBe(interactions.isFocusable)
    expect(compatibility.pushFocusTrap).toBe(interactions.pushFocusTrap)
    expect(compatibility.pushDismissable).toBe(interactions.pushDismissable)
    expect(compatibility.watchInteractOutside).toBe(interactions.watchInteractOutside)
    expect(compatibility.registerNestedLayer).toBe(interactions.registerNestedLayer)
    expect(compatibility.attachFloating).toBe(interactions.attachFloating)
  })
})
