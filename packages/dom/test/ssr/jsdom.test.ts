import { describe, it, expect } from 'vitest'
import { jsdomEnv } from '../../src/ssr/jsdom'

// `jsdomEnv()` used to build a full `new JSDOM(...)` per call (~1-5ms + MBs of
// window state per SSR request). It now shares ONE window per process and mints
// a fresh document per call. This must preserve request isolation: two envs must
// not share document nodes, but they should reuse the (expensive) window.
describe('jsdomEnv', () => {
  it('mints an isolated document per call while reusing the shared window', async () => {
    const a = await jsdomEnv()
    const b = await jsdomEnv()

    // Shared window: the constructors come from the one cached JSDOM instance.
    expect(a.Element).toBe(b.Element)
    expect(a.Node).toBe(b.Node)
    expect(a.HTMLElement).toBe(b.HTMLElement)

    // Isolated node trees: an element built by one env belongs to a DIFFERENT
    // document than one built by the other — no cross-request node sharing.
    const elA = a.createElement('div')
    const elB = b.createElement('div')
    expect(elA.ownerDocument).not.toBeNull()
    expect(elA.ownerDocument).not.toBe(elB.ownerDocument)

    // Appending into one env's tree must not surface in the other's.
    const childA = a.createElement('span')
    elA.appendChild(childA)
    expect(elA.contains(childA)).toBe(true)
    expect(elB.contains(childA)).toBe(false)

    // Nodes are still instances of the shared constructors (same realm).
    expect(elA instanceof a.Element).toBe(true)
    expect(elB instanceof a.Element).toBe(true)
  })
})
