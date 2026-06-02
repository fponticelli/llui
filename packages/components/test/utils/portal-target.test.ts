import { describe, it, expect, afterEach } from 'vitest'
import { resolvePortalTarget } from '../../src/utils/portal-target'

// Regression: overlays resolve their portal host at `overlay()` build time, which
// runs on the SERVER too. Touching `document` there threw
// `ReferenceError: document is not defined` and 500'd every SSR render that
// mounts a dialog/combobox/drawer. `resolvePortalTarget` must be SSR-safe.

describe('resolvePortalTarget', () => {
  const realDocument = globalThis.document

  afterEach(() => {
    // Restore the jsdom document the test environment provides.
    Object.defineProperty(globalThis, 'document', {
      value: realDocument,
      configurable: true,
      writable: true,
    })
  })

  it('returns an Element target unchanged', () => {
    const el = document.createElement('div')
    expect(resolvePortalTarget(el)).toBe(el)
  })

  it('resolves a string selector against document in a browser', () => {
    expect(resolvePortalTarget('body')).toBe(document.body)
  })

  it('falls back to document.body when the selector misses', () => {
    expect(resolvePortalTarget('#does-not-exist')).toBe(document.body)
  })

  it('returns undefined (does NOT throw) when document is absent — the SSR path', () => {
    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    expect(() => resolvePortalTarget('body')).not.toThrow()
    expect(resolvePortalTarget('body')).toBeUndefined()
    // A real Element is still returned even with no document — portal() can use it.
    const el = realDocument.createElement('section')
    expect(resolvePortalTarget(el)).toBe(el)
  })
})
