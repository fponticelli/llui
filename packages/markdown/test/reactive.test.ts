import { describe, it, expect, afterEach } from 'vitest'
import { mountReactive, body } from './util.js'
import type { ReactiveMounted } from './util.js'

let mounted: ReactiveMounted | undefined
afterEach(() => mounted?.cleanup())

describe('reactive rendering', () => {
  it('updates the DOM when the source signal changes', () => {
    mounted = mountReactive('# First')
    expect(body(mounted.container).querySelector('h1')?.textContent).toBe('First')
    mounted.set('# Second')
    expect(body(mounted.container).querySelector('h1')?.textContent).toBe('Second')
  })

  it('reuses the DOM of unchanged earlier blocks when appending (streaming)', () => {
    mounted = mountReactive('# Title\n\nfirst paragraph')
    const root = body(mounted.container)
    const headingBefore = root.querySelector('h1')
    const firstParaBefore = root.querySelector('p')
    expect(headingBefore?.textContent).toBe('Title')

    // Append a new block — earlier blocks' source is byte-identical ⇒ reused.
    mounted.set('# Title\n\nfirst paragraph\n\nsecond paragraph')
    const paras = root.querySelectorAll('p')
    expect(paras).toHaveLength(2)
    expect(root.querySelector('h1')).toBe(headingBefore) // same node, not rebuilt
    expect(paras[0]).toBe(firstParaBefore)
    expect(paras[1]?.textContent).toBe('second paragraph')
  })

  it('rebuilds only the block whose content changed', () => {
    mounted = mountReactive('# Title\n\noriginal')
    const root = body(mounted.container)
    const headingBefore = root.querySelector('h1')
    const paraBefore = root.querySelector('p')

    mounted.set('# Title\n\nedited')
    expect(root.querySelector('h1')).toBe(headingBefore) // heading unchanged ⇒ reused
    const paraAfter = root.querySelector('p')
    expect(paraAfter).not.toBe(paraBefore) // changed paragraph ⇒ rebuilt
    expect(paraAfter?.textContent).toBe('edited')
  })

  it('handles empty and whitespace-only sources', () => {
    mounted = mountReactive('')
    expect(body(mounted.container).children).toHaveLength(0)
    mounted.set('   \n\n  ')
    expect(body(mounted.container).querySelector('p')).toBeNull()
    mounted.set('now there is content')
    expect(body(mounted.container).querySelector('p')?.textContent).toBe('now there is content')
  })

  it('grows a list incrementally', () => {
    mounted = mountReactive('- a')
    expect(body(mounted.container).querySelectorAll('li')).toHaveLength(1)
    mounted.set('- a\n- b\n- c')
    expect(body(mounted.container).querySelectorAll('li')).toHaveLength(3)
  })

  it('resolves a reference definition that arrives AFTER the block using it', () => {
    // `[a][r]` renders as label text while `r` is unresolved; when `[r]: /x`
    // streams in later the block's key folds in the new definition, so it
    // rebuilds and the anchor appears. (Its source slice is byte-identical, so a
    // pure content key would never re-render it — the streaming ref bug.)
    mounted = mountReactive('[a][r]')
    let root = body(mounted.container)
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).toContain('a')

    mounted.set('[a][r]\n\n[r]: /x')
    root = body(mounted.container)
    const anchor = root.querySelector('a')
    expect(anchor).toBeTruthy()
    expect(anchor?.getAttribute('href')).toBe('/x')
  })

  it('rebuilds a ref-bearing block when its definition is EDITED', () => {
    mounted = mountReactive('[a][r]\n\n[r]: /old')
    expect(body(mounted.container).querySelector('a')?.getAttribute('href')).toBe('/old')
    mounted.set('[a][r]\n\n[r]: /new')
    expect(body(mounted.container).querySelector('a')?.getAttribute('href')).toBe('/new')
  })
})
