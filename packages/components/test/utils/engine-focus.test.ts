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

/**
 * #172 — `runEngineFocus` used to accept an `async` body with no guard of any
 * kind. The depth counter drops the instant the promise is returned, so the
 * focus move that eventually happens is unprotected: the call compiles, looks
 * correct, and silently does nothing. It fails SAFE (no protection, never a
 * stuck guard), which is exactly why nothing surfaced it — and it is a PUBLIC
 * export documented as the thing a custom overlay must route its
 * engine-initiated focus moves through, so following the documentation with an
 * async body reintroduced #155 in the consumer's app.
 */
describe('#172 — runEngineFocus rejects an async body', () => {
  afterEach(() => {
    expect(isEngineFocusInProgress()).toBe(false)
  })

  it('is a COMPILE error to pass a promise-returning body', () => {
    // The primary guard: the signature. Both spellings of "async" are rejected,
    // and `@ts-expect-error` fails the build if either ever stops erroring.
    // @ts-expect-error runEngineFocus requires a SYNCHRONOUS body (#172)
    const a = (): unknown => runEngineFocus(async () => Promise.resolve(1))
    // @ts-expect-error runEngineFocus requires a SYNCHRONOUS body (#172)
    const b = (): unknown => runEngineFocus(() => Promise.resolve(1))
    // Never invoked — this test is about the types. Referencing them keeps the
    // no-unused-vars lint (and a reader) honest about that.
    expect(typeof a).toBe('function')
    expect(typeof b).toBe('function')
  })

  it('still accepts every synchronous body shape, including a value-returning one', () => {
    expect(runEngineFocus(() => 42)).toBe(42)
    expect(runEngineFocus(() => 'x')).toBe('x')
    expect(runEngineFocus(() => null)).toBeNull()
    expect(runEngineFocus(() => undefined)).toBeUndefined()
    expect(runEngineFocus(() => ({ a: 1 }))).toEqual({ a: 1 })
    // The shape every in-repo caller uses.
    expect(runEngineFocus(() => {})).toBeUndefined()
  })

  it('warns in dev when the body returns a thenable the types could not see', () => {
    // The secondary guard, for what the signature cannot reach: a JavaScript
    // consumer, an `any`-typed body, or a body declared to return a non-promise
    // that returns a thenable anyway. It cannot restore the protection — the
    // guard is already released by the time the thenable is in hand — so it only
    // reports, loudly.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const sneaky = (): void => Promise.resolve() as unknown as void
      runEngineFocus(sneaky)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('ASYNC body')
    } finally {
      warn.mockRestore()
    }
  })

  it('does not warn for a synchronous body', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      runEngineFocus(() => ({ then: 1 }))
      runEngineFocus(() => {})
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
