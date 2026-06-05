import { describe, it, expect, afterEach } from 'vitest'
import { mountStatic, mountReactive, body } from './util.js'
import type { Mounted, ReactiveMounted } from './util.js'

let mounted: Mounted | ReactiveMounted | undefined
afterEach(() => mounted?.cleanup())

describe('options', () => {
  it('disables GFM tables when gfm:false', () => {
    mounted = mountStatic('| a | b |\n| - | - |\n| 1 | 2 |', { gfm: false })
    const root = body(mounted.container)
    expect(root.querySelector('table')).toBeNull()
  })

  it('applies a custom wrapper class', () => {
    mounted = mountStatic('# x', { class: 'prose' })
    expect(mounted.container.querySelector('.prose')).toBeTruthy()
    expect(mounted.container.querySelector('.markdown-body')).toBeNull()
  })

  it('honors a custom keyOf for block reuse', () => {
    // Key every block by its index — so editing a block in place keeps the same
    // key and the row is reconciled rather than replaced.
    const r = mountReactive('# Title\n\noriginal', { keyOf: (_node, index) => index })
    mounted = r
    const headingBefore = body(r.container).querySelector('h1')
    r.set('# Title\n\nedited')
    // index-keyed: the heading row keeps key 0 and is reused.
    expect(body(r.container).querySelector('h1')).toBe(headingBefore)
    expect(body(r.container).querySelector('p')?.textContent).toBe('edited')
  })
})
