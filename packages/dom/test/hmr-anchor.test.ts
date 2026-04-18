// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { component, mountAtAnchor, div, text } from '../src/index.js'
import { enableHmr, replaceComponent } from '../src/hmr.js'

function makeAnchor(): { anchor: Comment; parent: HTMLElement } {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const anchor = document.createComment('a')
  parent.appendChild(anchor)
  return { anchor, parent }
}

describe('HMR for anchor-mounted instances', () => {
  beforeEach(() => {
    enableHmr()
  })

  it('hot-swap rebuilds DOM between the sentinels, preserving the anchor and outer DOM', () => {
    const { anchor, parent } = makeAnchor()
    // Add a sibling in the parent BEFORE the anchor — hot-swap must not touch it.
    const outerBefore = document.createElement('section')
    outerBefore.id = 'outer-before'
    parent.insertBefore(outerBefore, anchor)

    type S = { n: number }
    const v1 = component<S, never, never>({
      name: 'Swappable',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'v1' }, [t((s: S) => 'v1:' + s.n)])],
    })
    const handle = mountAtAnchor(anchor, v1)

    // v2 replaces the view — same state type
    const v2 = component<S, never, never>({
      name: 'Swappable',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'v2' }, [t((s: S) => 'v2:' + s.n)])],
    })
    replaceComponent('Swappable', v2)

    // Outer sibling untouched
    expect(parent.querySelector('#outer-before')).toBe(outerBefore)
    // Anchor still in place
    expect(anchor.parentNode).toBe(parent)
    // Fresh v2 node is between anchor and end sentinel
    const fresh = anchor.nextSibling as HTMLElement
    expect(fresh.id).toBe('v2')
    const endSentinel = fresh.nextSibling as Comment
    expect(endSentinel.nodeValue).toBe('llui-mount-end')

    handle.dispose()
  })

  it('hot-swap targets only the instance whose name matches', () => {
    const a = makeAnchor()
    const b = makeAnchor()
    const defA = component<{}, never, never>({
      name: 'A',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'A-v1' }, [])],
    })
    const defB = component<{}, never, never>({
      name: 'B',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'B-v1' }, [])],
    })
    const hA = mountAtAnchor(a.anchor, defA)
    const hB = mountAtAnchor(b.anchor, defB)

    const defAv2 = component<{}, never, never>({
      name: 'A',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'A-v2' }, [])],
    })
    replaceComponent('A', defAv2)

    expect((a.anchor.nextSibling as HTMLElement).id).toBe('A-v2')
    expect((b.anchor.nextSibling as HTMLElement).id).toBe('B-v1')

    hA.dispose()
    hB.dispose()
  })

  it('dispose unregisters from HMR — subsequent swap is a no-op for the disposed instance', () => {
    const { anchor } = makeAnchor()
    const def = component<{}, never, never>({
      name: 'Gone',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'gone-v1' }, [])],
    })
    const handle = mountAtAnchor(anchor, def)
    handle.dispose()

    const defV2 = component<{}, never, never>({
      name: 'Gone',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ id: 'gone-v2' }, [])],
    })
    const swapResult = replaceComponent('Gone', defV2)
    expect(swapResult).toBeNull()
    // No DOM was re-added at the anchor
    expect(anchor.nextSibling).toBeNull()
  })
})
