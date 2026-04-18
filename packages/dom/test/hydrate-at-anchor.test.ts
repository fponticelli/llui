// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { component, hydrateAtAnchor, div } from '../src/index.js'

function makeAnchor(): { anchor: Comment; parent: HTMLElement } {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const anchor = document.createComment('test-anchor')
  parent.appendChild(anchor)
  return { anchor, parent }
}

function makeAnchorWithServerContent(serverHTML: string): {
  anchor: Comment
  endSentinel: Comment
  parent: HTMLElement
} {
  const { anchor, parent } = makeAnchor()
  // Simulate SSR stitching: server emits content + end sentinel
  parent.insertAdjacentHTML('beforeend', serverHTML)
  const end = document.createComment('llui-mount-end')
  parent.appendChild(end)
  return { anchor, endSentinel: end, parent }
}

describe('hydrateAtAnchor', () => {
  it('throws when the anchor is detached', () => {
    const detached = document.createComment('detached')
    const def = component<{ n: number }, never, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: () => [div({}, [])],
    })
    expect(() => hydrateAtAnchor(detached, def, { n: 42 })).toThrow(/attached to a live DOM tree/)
  })

  it('synthesizes an end sentinel when none is present (chain-hydrate path)', () => {
    const { anchor } = makeAnchor()
    const def = component<{ n: number }, never, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'out' }, [t((s: { n: number }) => String(s.n))])],
    })
    hydrateAtAnchor(anchor, def, { n: 99 })
    const n1 = anchor.nextSibling as HTMLElement
    expect(n1.id).toBe('out')
    expect(n1.textContent).toBe('99')
    const end = n1.nextSibling as Comment
    expect(end.nodeValue).toBe('llui-mount-end')
  })

  it('atomic-swaps: removes server content between the pair, inserts fresh client content', () => {
    const { anchor, endSentinel, parent } =
      makeAnchorWithServerContent('<div id="server">server</div><div id="extra">x</div>')
    expect(parent.querySelectorAll('div').length).toBe(2)

    const def = component<{ n: number }, never, never>({
      name: 'Client',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: ({ text: t }) => [div({ id: 'client' }, [t((s: { n: number }) => String(s.n))])],
    })
    hydrateAtAnchor(anchor, def, { n: 7 })

    // Server nodes are gone, client node is between the pair
    expect(parent.querySelector('#server')).toBeNull()
    expect(parent.querySelector('#extra')).toBeNull()
    const n1 = anchor.nextSibling as HTMLElement
    expect(n1.id).toBe('client')
    expect(n1.textContent).toBe('7')
    // Existing end sentinel is reused — not duplicated
    expect(n1.nextSibling).toBe(endSentinel)
  })

  it('starts with serverState as the initial state; init() effects are dispatched post-swap', () => {
    const { anchor } = makeAnchor()
    type S = { n: number; loaded: boolean }
    type E = { type: 'log'; message: string }
    const dispatched: E[] = []
    const def = component<S, never, E>({
      name: 'WithEffect',
      init: () => [{ n: 0, loaded: false }, [{ type: 'log', message: 'init-fired' }]],
      update: (s) => [s, []],
      view: () => [div({}, [])],
      onEffect: ({ effect }) => {
        dispatched.push(effect)
      },
    })
    hydrateAtAnchor(anchor, def, { n: 5, loaded: true })
    // Effects from the original init() were dispatched even though state was overridden
    expect(dispatched).toEqual([{ type: 'log', message: 'init-fired' }])
  })

  it('dispose() removes content between the pair and the end sentinel', () => {
    const { anchor, parent } = makeAnchor()
    const def = component<{ n: number }, never, never>({
      name: 'Probe',
      init: () => [{ n: 0 }, []],
      update: (s) => [s, []],
      view: () => [div({}, [])],
    })
    const handle = hydrateAtAnchor(anchor, def, { n: 0 })
    handle.dispose()
    expect(parent.children.length).toBe(0)
    expect(anchor.nextSibling).toBeNull()
  })

  it('send() and flush() work after hydrate', () => {
    const { anchor } = makeAnchor()
    type S = { n: number }
    type M = { type: 'inc' }
    const def = component<S, M, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s, m) => (m.type === 'inc' ? [{ n: s.n + 1 }, []] : [s, []]),
      view: ({ text: t }) => [div({ id: 'c' }, [t((s: S) => String(s.n))])],
    })
    const handle = hydrateAtAnchor(anchor, def, { n: 10 })
    handle.send({ type: 'inc' })
    handle.flush()
    expect((anchor.nextSibling as HTMLElement).textContent).toBe('11')
  })
})
