// Shape assertions for the element-helper sets — everything checkable WITHOUT
// reading `@llui/dom`'s source.
//
// The parity/drift gate against the runtime's actual `authoring.ts` deliberately
// does NOT live here: `authoring.ts` is not an input of any task in this package
// (and `@llui/compiler` has no `@llui/dom` dependency to make it one), so a gate
// here would replay from cache under `pnpm turbo test` while the runtime drifted.
// It lives in `packages/dom/test/signals/element-helper-parity.test.ts`, where
// the file it guards is a task input. Do not move it back.

import { describe, it, expect } from 'vitest'
import {
  ELEMENT_HELPERS,
  SVG_ELEMENT_HELPERS,
  ALL_ELEMENT_HELPERS,
} from '../../src/signals/element-helpers.js'

describe('ELEMENT_HELPERS', () => {
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

describe('SVG_ELEMENT_HELPERS / ALL_ELEMENT_HELPERS', () => {
  // The sets hold CALLEE names (what an author writes, and what HelperBindings
  // resolves an identifier to), not tags — the SVG `<text>` element is exported
  // as `svgText` so it doesn't collide with the `text()` node helper.
  it('carries the callee name `svgText`, not the tag `text`', () => {
    expect(SVG_ELEMENT_HELPERS.has('svgText')).toBe(true)
    expect(SVG_ELEMENT_HELPERS.has('text')).toBe(false)
  })

  it('is disjoint from ELEMENT_HELPERS', () => {
    const overlap = [...SVG_ELEMENT_HELPERS].filter((h) => ELEMENT_HELPERS.has(h))
    expect(overlap).toEqual([])
  })

  it('is the union of the HTML and SVG sets', () => {
    expect([...ALL_ELEMENT_HELPERS].sort()).toEqual(
      [...new Set([...ELEMENT_HELPERS, ...SVG_ELEMENT_HELPERS])].sort(),
    )
  })
})
