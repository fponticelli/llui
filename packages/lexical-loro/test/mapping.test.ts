import { describe, expect, it } from 'vitest'
import type { ContainerID } from 'loro-crdt'
import type { NodeKey } from 'lexical'

import { ContainerNodeMap } from '../src/index.js'

/** A syntactically valid ContainerID for tests that never touch a real doc. */
const cid = (n: number): ContainerID => `cid:${n}@1:Map`
const key = (n: number): NodeKey => String(n)

describe('link', () => {
  it('maps both directions', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))

    expect(map.nodeKey(cid(1))).toBe(key(10))
    expect(map.containerId(key(10))).toBe(cid(1))
    expect(map.hasContainer(cid(1))).toBe(true)
    expect(map.hasNode(key(10))).toBe(true)
    expect(map.size).toBe(1)
    map.assertBijective()
  })

  it('is idempotent', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.link(cid(1), key(10))
    expect(map.size).toBe(1)
    map.assertBijective()
  })

  it('evicts the stale REVERSE entry when a container is re-linked', () => {
    // The bug this prevents: key(10) keeps resolving to cid(1) after cid(1) has
    // moved on, so an outbound edit on node 10 writes to a container that no
    // longer represents it.
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.link(cid(1), key(20))

    expect(map.nodeKey(cid(1))).toBe(key(20))
    expect(map.containerId(key(10))).toBeUndefined()
    expect(map.size).toBe(1)
    map.assertBijective()
  })

  it('evicts the stale FORWARD entry when a node is re-linked', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.link(cid(2), key(10))

    expect(map.containerId(key(10))).toBe(cid(2))
    expect(map.nodeKey(cid(1))).toBeUndefined()
    expect(map.size).toBe(1)
    map.assertBijective()
  })

  it('evicts BOTH stale directions when re-linking crosses two live entries', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.link(cid(2), key(20))
    // cid(1) -> key(20) must drop cid(1)->key(10) AND cid(2)->key(20).
    map.link(cid(1), key(20))

    expect(map.entries()).toEqual([{ id: cid(1), key: key(20) }])
    expect(map.nodeKey(cid(2))).toBeUndefined()
    expect(map.containerId(key(10))).toBeUndefined()
    map.assertBijective()
  })
})

describe('expect* accessors', () => {
  it('return the mapped value', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    expect(map.expectNodeKey(cid(1))).toBe(key(10))
    expect(map.expectContainerId(key(10))).toBe(cid(1))
  })

  it('throw with the missing address, rather than writing to the wrong node', () => {
    const map = new ContainerNodeMap()
    expect(() => map.expectNodeKey(cid(9))).toThrow(/no NodeKey mapped for container cid:9@1:Map/)
    expect(() => map.expectContainerId(key(9))).toThrow(/no ContainerID mapped for node 9/)
  })
})

describe('rekey — the text-normalization path', () => {
  it('moves a container to the surviving node key', () => {
    // Lexical merged our run's TextNode into a sibling: the container must now
    // address the survivor, and the discarded key must stop resolving.
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))

    expect(map.rekey(cid(1), key(11))).toBe(true)
    expect(map.nodeKey(cid(1))).toBe(key(11))
    expect(map.containerId(key(10))).toBeUndefined()
    expect(map.size).toBe(1)
    map.assertBijective()
  })

  it('reports false for an unmapped container and creates nothing', () => {
    const map = new ContainerNodeMap()
    expect(map.rekey(cid(1), key(10))).toBe(false)
    expect(map.size).toBe(0)
  })

  it('collapses two containers onto one node without leaving a half-entry', () => {
    // Two adjacent runs whose nodes Lexical merged into one.
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.link(cid(2), key(20))
    map.rekey(cid(2), key(10))

    expect(map.entries()).toEqual([{ id: cid(2), key: key(10) }])
    map.assertBijective()
  })
})

describe('unlink', () => {
  it('removes both directions by container', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    expect(map.unlinkContainer(cid(1))).toBe(true)
    expect(map.size).toBe(0)
    expect(map.containerId(key(10))).toBeUndefined()
    map.assertBijective()
  })

  it('removes both directions by node', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    expect(map.unlinkNode(key(10))).toBe(true)
    expect(map.size).toBe(0)
    expect(map.nodeKey(cid(1))).toBeUndefined()
    map.assertBijective()
  })

  it('reports false when nothing was mapped', () => {
    const map = new ContainerNodeMap()
    expect(map.unlinkContainer(cid(1))).toBe(false)
    expect(map.unlinkNode(key(10))).toBe(false)
  })
})

describe('sweep', () => {
  const probe = (containers: readonly ContainerID[], nodes: readonly NodeKey[]) => ({
    hasContainer: (id: ContainerID) => containers.includes(id),
    hasNode: (k: NodeKey) => nodes.includes(k),
  })

  it('keeps entries whose container and node both still exist', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.link(cid(2), key(20))

    const removed = map.sweep(probe([cid(1), cid(2)], [key(10), key(20)]))
    expect(removed).toEqual([])
    expect(map.size).toBe(2)
  })

  it('drops an entry whose CONTAINER is gone (a remote subtree delete)', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.link(cid(2), key(20))

    const removed = map.sweep(probe([cid(1)], [key(10), key(20)]))
    expect(removed).toEqual([{ id: cid(2), key: key(20) }])
    expect(map.size).toBe(1)
    expect(map.containerId(key(20))).toBeUndefined()
    map.assertBijective()
  })

  it('drops an entry whose NODE is gone (a local subtree delete)', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.link(cid(2), key(20))

    const removed = map.sweep(probe([cid(1), cid(2)], [key(20)]))
    expect(removed).toEqual([{ id: cid(1), key: key(10) }])
    expect(map.size).toBe(1)
    map.assertBijective()
  })

  it('drops a HALF-LIVE entry — either side missing is stale', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    // Container alive, node gone.
    expect(map.sweep(probe([cid(1)], []))).toEqual([{ id: cid(1), key: key(10) }])
    expect(map.size).toBe(0)
  })

  it('sweeps a whole removed subtree in one pass', () => {
    const map = new ContainerNodeMap()
    for (let i = 1; i <= 5; i++) map.link(cid(i), key(i * 10))

    const removed = map.sweep(probe([cid(1)], [key(10)]))
    expect(removed.map((e) => e.id)).toEqual([cid(2), cid(3), cid(4), cid(5)])
    expect(map.entries()).toEqual([{ id: cid(1), key: key(10) }])
    map.assertBijective()
  })

  it('is idempotent', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.sweep(probe([], []))
    expect(map.sweep(probe([], []))).toEqual([])
    expect(map.size).toBe(0)
  })
})

describe('entries and clear', () => {
  it('lists every entry in insertion order', () => {
    const map = new ContainerNodeMap()
    map.link(cid(2), key(20))
    map.link(cid(1), key(10))
    expect(map.entries()).toEqual([
      { id: cid(2), key: key(20) },
      { id: cid(1), key: key(10) },
    ])
  })

  it('clear empties both directions', () => {
    const map = new ContainerNodeMap()
    map.link(cid(1), key(10))
    map.clear()
    expect(map.size).toBe(0)
    expect(map.nodeKey(cid(1))).toBeUndefined()
    expect(map.containerId(key(10))).toBeUndefined()
    map.assertBijective()
  })
})

describe('the bijection invariant survives arbitrary operation sequences', () => {
  it('holds under randomized link/rekey/unlink/sweep', () => {
    // A deterministic LCG: reproducible, and no dependency for one use.
    let seed = 0x2f6e2b1
    const random = (n: number): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed % n
    }

    const map = new ContainerNodeMap()
    for (let step = 0; step < 5000; step++) {
      const id = cid(random(12))
      const k = key(random(12))
      switch (random(5)) {
        case 0:
          map.link(id, k)
          break
        case 1:
          map.rekey(id, k)
          break
        case 2:
          map.unlinkContainer(id)
          break
        case 3:
          map.unlinkNode(k)
          break
        default: {
          const live = map.entries().filter((_, i) => i % 2 === 0)
          const ids = live.map((e) => e.id)
          const keys = live.map((e) => e.key)
          map.sweep({ hasContainer: (x) => ids.includes(x), hasNode: (x) => keys.includes(x) })
        }
      }
      map.assertBijective()
    }
  })
})
