import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { engineFocus, isEngineFocusInProgress, runEngineFocus } from '../../src/utils/engine-focus'
import { watchInteractOutside } from '../../src/utils/interact-outside'

/**
 * #155 — the guard that makes an engine-initiated focus move invisible to other
 * layers' outside-interaction watchers, and the three properties that keep it
 * from being a blunt mute.
 */
describe('engine-focus guard', () => {
  let container: HTMLElement
  let outside: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    outside = document.createElement('button')
    document.body.append(container, outside)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    // Never leaks past the call, however the suite got here.
    expect(isEngineFocusInProgress()).toBe(false)
  })

  it('is active only for the synchronous duration of the body', () => {
    expect(isEngineFocusInProgress()).toBe(false)
    const seen = runEngineFocus(() => isEngineFocusInProgress())
    expect(seen).toBe(true)
    expect(isEngineFocusInProgress()).toBe(false)
  })

  it('is depth-counted, so a nested move does not clear the outer one', () => {
    runEngineFocus(() => {
      runEngineFocus(() => {
        expect(isEngineFocusInProgress()).toBe(true)
      })
      // The inner release must NOT have unguarded the outer move — a focus trap
      // releasing inside an overlay's own restore is exactly this shape.
      expect(isEngineFocusInProgress()).toBe(true)
    })
    expect(isEngineFocusInProgress()).toBe(false)
  })

  it('releases when the body throws', () => {
    expect(() =>
      runEngineFocus(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(isEngineFocusInProgress()).toBe(false)
  })

  it('suppresses the focusin outside path for an engine-initiated focus move', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({ element: container, onInteractOutside })

    engineFocus(outside)
    expect(document.activeElement).toBe(outside)
    expect(onInteractOutside).not.toHaveBeenCalled()

    cleanup()
  })

  it('leaves a genuine focus move — and every pointerdown — dispatching', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({ element: container, onInteractOutside })

    // A user's focus move is not routed through the guard.
    outside.focus()
    expect(onInteractOutside).toHaveBeenCalledTimes(1)

    // And the POINTER path is never gated, not even mid-move: a genuine click
    // that lands while the engine is restoring focus must still dismiss.
    runEngineFocus(() => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(onInteractOutside).toHaveBeenCalledTimes(2)

    cleanup()
  })
})
