import { describe, expect, it } from 'vitest'
import {
  attachFloating,
  flipArrow,
  getFocusables,
  isFocusable,
  lockBodyScroll,
  pushDismissable,
  pushFocusTrap,
  resolveRovingMove,
  setAriaHiddenOutside,
  watchInteractOutside,
} from '../src/index'

describe('@llui/interactions public entry point', () => {
  it('exports every promoted interaction family without a components import', () => {
    const exports = [
      attachFloating,
      flipArrow,
      getFocusables,
      isFocusable,
      lockBodyScroll,
      pushDismissable,
      pushFocusTrap,
      resolveRovingMove,
      setAriaHiddenOutside,
      watchInteractOutside,
    ]

    expect(exports.every((value) => typeof value === 'function')).toBe(true)
  })
})
