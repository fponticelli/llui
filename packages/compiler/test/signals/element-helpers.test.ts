import { describe, it, expect } from 'vitest'
import { ELEMENT_HELPERS } from '../../src/signals/element-helpers.js'

describe('ELEMENT_HELPERS — parity with @llui/dom authoring element helpers', () => {
  // Genuinely-missing runtime element helpers that used to be absent from the
  // compiler set, so they neither lowered nor tripped the lint rules keyed off it.
  // Each exists as an `elementHelper(...)` in packages/dom/src/signals/authoring.ts.
  it('includes the previously-missing non-namespaced tags', () => {
    for (const tag of ['blockquote', 'hr', 'br', 'optgroup', 'dl', 'dt', 'dd', 'caption', 'time']) {
      expect(ELEMENT_HELPERS.has(tag)).toBe(true)
    }
  })

  // Namespaced (SVG) helpers must NOT be in the set: the runtime builds them via
  // createElementNS; lowering to `el('svg', …)` yields a dead HTMLUnknownElement.
  it('excludes namespaced svg helpers', () => {
    for (const tag of ['svg', 'path', 'g', 'circle', 'rect', 'line', 'polygon', 'ellipse']) {
      expect(ELEMENT_HELPERS.has(tag)).toBe(false)
    }
  })

  // Sanity: the common non-namespaced tags stay present.
  it('still includes the core tags', () => {
    for (const tag of ['div', 'span', 'button', 'input', 'summary', 'details']) {
      expect(ELEMENT_HELPERS.has(tag)).toBe(true)
    }
  })
})
