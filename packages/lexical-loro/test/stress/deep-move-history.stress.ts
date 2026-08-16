import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  type ElementNode,
} from 'lexical'

import { collabNetwork, edit, setParagraphs } from '../collaboration.js'
import { expectAllWellFormed, expectConverged, type Peer } from '../network.js'

const DEEP_HISTORY = { seed: 0x5eed1234, operations: 220 } as const

interface ActionCounts {
  text: number
  insert: number
  delete: number
  move: number
}

function blockCount(peer: Peer): number {
  let count = 0
  peer.editor.getEditorState().read(() => {
    count = $getRoot().getChildrenSize()
  })
  return count
}

/** Move an attached block to a distinct rendered index without recreating it. */
function moveBlock(peer: Peer, from: number, to: number): boolean {
  let moved = false
  edit(peer, () => {
    const root = $getRoot()
    const node = root.getChildAtIndex(from)
    if (node === null) throw new Error(`no block at index ${from}`)
    const before = root.getChildren().map((child) => child.getKey())
    const others = root.getChildren().filter((child) => !child.is(node))
    if (to === others.length) others.at(-1)?.insertAfter(node)
    else others[to]?.insertBefore(node)
    const after = root.getChildren().map((child) => child.getKey())
    moved = before.some((key, index) => after[index] !== key)
  })
  return moved
}

function operationFailure(seed: number, operation: number, cause: unknown): Error {
  return new Error(
    `deep collaboration stress failed at seed 0x${seed.toString(16)}, operation ${operation}`,
    { cause },
  )
}

describe('deep concurrent move history', () => {
  const { seed: seedValue, operations } = DEEP_HISTORY
  const hex = `0x${seedValue.toString(16)}`

  it(`accumulates ${operations} mixed operations in one three-peer history (seed ${hex})`, () => {
    // This literal assertion is the depth guard: changing the workload to 199
    // operations must fail instead of silently turning stress into another
    // aggregate of shallow trials.
    expect(operations, `seed ${hex} must retain a 200+ operation history`).toBeGreaterThanOrEqual(
      200,
    )

    let state = seedValue
    const random = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 0x100000000
    }

    const counts: ActionCounts = { text: 0, insert: 0, delete: 0, move: 0 }
    let staleEdits = 0
    let partialDeliveries = 0
    const network = collabNetwork(['a', 'b', 'c'])

    try {
      setParagraphs(network.a, ['p0', 'p1', 'p2', 'p3'])
      network.settle()

      for (let operation = 0; operation < operations; operation++) {
        try {
          const peer = network.peers[Math.floor(random() * network.peers.length)]!
          if (peer.inbox.length > 0) staleEdits++

          const size = blockCount(peer)
          const action = Math.floor(random() * 4)
          if (size === 0) {
            edit(peer, () => {
              $getRoot().append($createParagraphNode().append($createTextNode(`re${operation}`)))
            })
            counts.insert++
          } else if (action === 0) {
            edit(peer, () => {
              const block = $getRoot().getChildAtIndex<ElementNode>(Math.floor(random() * size))
              const text = block?.getFirstChild()
              if (text != null && $isTextNode(text)) {
                text.setTextContent(`${text.getTextContent()}-${operation.toString(36)}`)
              } else {
                block?.append($createTextNode(operation.toString(36)))
              }
            })
            counts.text++
          } else if (action === 1) {
            edit(peer, () => {
              $getRoot()
                .getChildAtIndex(Math.floor(random() * size))
                ?.insertAfter(
                  $createParagraphNode().append($createTextNode(`new-${operation.toString(36)}`)),
                )
            })
            counts.insert++
          } else if (action === 2 && size > 1) {
            edit(peer, () => {
              $getRoot()
                .getChildAtIndex(Math.floor(random() * size))
                ?.remove()
            })
            counts.delete++
          } else if (size > 1) {
            const from = Math.floor(random() * size)
            const compressedTo = Math.floor(random() * (size - 1))
            const to = compressedTo >= from ? compressedTo + 1 : compressedTo
            if (!moveBlock(peer, from, to)) {
              throw new Error(`move from ${from} to ${to} did not change rendered order`)
            }
            counts.move++
          } else {
            edit(peer, () => {
              $getRoot()
                .getFirstChildOrThrow<ElementNode>()
                .insertAfter($createParagraphNode().append($createTextNode(`grow-${operation}`)))
            })
            counts.insert++
          }

          // Deliver to a seeded random subset after each edit. At least one peer
          // usually remains behind while another catches up, so later operations
          // are performed against genuinely stale/interleaved states.
          let delivered = 0
          for (const other of network.peers) {
            if (random() < 0.5) {
              other.flushInbox()
              delivered++
            }
          }
          if (delivered > 0 && delivered < network.peers.length) partialDeliveries++
        } catch (error) {
          throw operationFailure(seedValue, operation, error)
        }
      }

      try {
        network.settle()
        expectConverged(network)
        expectAllWellFormed(network)
        expect(counts.text, `seed ${hex} selected no text edits`).toBeGreaterThan(0)
        expect(counts.insert, `seed ${hex} selected no insertions`).toBeGreaterThan(0)
        expect(counts.delete, `seed ${hex} selected no deletions`).toBeGreaterThan(0)
        expect(counts.move, `seed ${hex} performed no actual distinct-index moves`).toBeGreaterThan(
          0,
        )
        expect(
          staleEdits,
          `seed ${hex} performed no edits with pending remote updates`,
        ).toBeGreaterThan(0)
        expect(
          partialDeliveries,
          `seed ${hex} produced no partial network deliveries`,
        ).toBeGreaterThan(0)
      } catch (error) {
        throw operationFailure(seedValue, operations - 1, error)
      }
    } finally {
      network.dispose()
    }
  })
})
