/**
 * The ContainerID ↔ NodeKey registry — the core invariant of this package.
 *
 * ── Why it exists ──────────────────────────────────────────────────────────
 *
 * Lexical's `NodeKey` is a bare per-session counter
 * (`LexicalUtils.ts`: `return '' + keyCounter++`). It is meaningless to a peer
 * and unstable across reloads. Loro's `ContainerID` is the stable, replicated
 * address. Every sync operation is therefore a translation between the two, and
 * this registry is the only place that translation is allowed to happen.
 *
 * There is also NO stable node-object identity to key off: Lexical CLONES a node
 * on every write, so `node === node` fails across an update. The NodeKey string
 * survives cloning; the object does not. Hence a key↔id map, never a WeakMap.
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────
 *
 * The two internal maps are always exact inverses of each other: a BIJECTION.
 *
 *     byContainer.get(id) === key   ⟺   byNode.get(key) === id
 *
 * No ContainerID ever addresses two NodeKeys, and no NodeKey ever addresses two
 * ContainerIDs. `link()` enforces this by evicting BOTH stale directions before
 * writing, so a re-link can never leave a half-entry behind. A violated
 * bijection is the failure mode that silently corrupts a document: a stale
 * reverse entry makes an inbound remote edit land on the wrong Lexical node.
 *
 * ── When it must be updated ────────────────────────────────────────────────
 *
 * - local create/delete   — the user edited; mirror the change outbound
 * - remote create/delete  — an inbound event created/removed a container
 * - TEXT NORMALIZATION    — Lexical silently merges/splits adjacent TextNodes
 *   and reports it via `normalizedNodes`. This is the easiest one to forget and
 *   the one that corrupts the document: the surviving node keeps ONE key and the
 *   others are discarded, so their entries must be re-linked or dropped. This is
 *   also why inbound application runs `discrete: true` — without a synchronous
 *   flush the normalization happens after we have already read back keys, and
 *   the mapping drifts.
 *
 * Entries are never implicitly expired. Use `sweep()` after a structural change
 * to drop entries whose container or node no longer exists.
 */

import type { ContainerID } from 'loro-crdt'
import type { NodeKey } from 'lexical'

/** One direction of a mapping entry, as reported by iteration and sweeps. */
export interface MappingEntry {
  readonly id: ContainerID
  readonly key: NodeKey
}

/** Liveness probes used by {@link ContainerNodeMap.sweep}. */
export interface LivenessProbe {
  /** True when the container still exists in the Loro document. */
  readonly hasContainer: (id: ContainerID) => boolean
  /** True when the node still exists in the Lexical editor state. */
  readonly hasNode: (key: NodeKey) => boolean
}

/**
 * A bijective, explicitly-invalidated registry mapping Loro `ContainerID`s to
 * Lexical `NodeKey`s. See the file header for the invariant it maintains.
 */
export class ContainerNodeMap {
  readonly #byContainer = new Map<ContainerID, NodeKey>()
  readonly #byNode = new Map<NodeKey, ContainerID>()

  /** Number of live entries. Both directions always agree on this. */
  get size(): number {
    return this.#byContainer.size
  }

  /**
   * Link a container to a node, replacing any previous link on EITHER side.
   *
   * Evicting both directions first is what preserves the bijection: linking
   * `id → k2` when `id → k1` existed must also drop `k1 → id`, or `k1` keeps
   * resolving to a container it no longer owns.
   */
  link(id: ContainerID, key: NodeKey): void {
    const previousKey = this.#byContainer.get(id)
    if (previousKey !== undefined && previousKey !== key) this.#byNode.delete(previousKey)
    const previousId = this.#byNode.get(key)
    if (previousId !== undefined && previousId !== id) this.#byContainer.delete(previousId)
    this.#byContainer.set(id, key)
    this.#byNode.set(key, id)
  }

  /** The NodeKey addressed by a container, or `undefined` if unmapped. */
  nodeKey(id: ContainerID): NodeKey | undefined {
    return this.#byContainer.get(id)
  }

  /** The ContainerID addressing a node, or `undefined` if unmapped. */
  containerId(key: NodeKey): ContainerID | undefined {
    return this.#byNode.get(key)
  }

  /**
   * The NodeKey addressed by a container. Throws when unmapped.
   *
   * Prefer this on paths where a missing entry means the registry is already
   * corrupt — failing loudly beats writing to the wrong node.
   */
  expectNodeKey(id: ContainerID): NodeKey {
    const key = this.#byContainer.get(id)
    if (key === undefined) throw new Error(`lexical-loro: no NodeKey mapped for container ${id}`)
    return key
  }

  /** The ContainerID addressing a node. Throws when unmapped. */
  expectContainerId(key: NodeKey): ContainerID {
    const id = this.#byNode.get(key)
    if (id === undefined) throw new Error(`lexical-loro: no ContainerID mapped for node ${key}`)
    return id
  }

  hasContainer(id: ContainerID): boolean {
    return this.#byContainer.has(id)
  }

  hasNode(key: NodeKey): boolean {
    return this.#byNode.has(key)
  }

  /**
   * Move a container's link to a different NodeKey, keeping the bijection.
   *
   * This is the TEXT-NORMALIZATION path: Lexical merged our run's node into a
   * sibling, so the container must now address the survivor. Returns false when
   * the container was not mapped (nothing to move).
   */
  rekey(id: ContainerID, key: NodeKey): boolean {
    if (!this.#byContainer.has(id)) return false
    this.link(id, key)
    return true
  }

  /** Drop the entry for a container. Returns whether one existed. */
  unlinkContainer(id: ContainerID): boolean {
    const key = this.#byContainer.get(id)
    if (key === undefined) return false
    this.#byContainer.delete(id)
    this.#byNode.delete(key)
    return true
  }

  /** Drop the entry for a node. Returns whether one existed. */
  unlinkNode(key: NodeKey): boolean {
    const id = this.#byNode.get(key)
    if (id === undefined) return false
    this.#byNode.delete(key)
    this.#byContainer.delete(id)
    return true
  }

  /** Every live entry, in insertion order. */
  entries(): MappingEntry[] {
    return [...this.#byContainer].map(([id, key]) => ({ id, key }))
  }

  /**
   * Drop every entry whose container or node no longer exists, and return the
   * entries removed.
   *
   * Deleting a subtree removes many containers at once; rather than making every
   * caller walk the removed subtree, sweep after the structural change. An entry
   * is stale if EITHER side is gone — a half-live entry is exactly the corrupt
   * state the invariant forbids.
   */
  sweep(probe: LivenessProbe): MappingEntry[] {
    const removed: MappingEntry[] = []
    for (const [id, key] of this.#byContainer) {
      if (probe.hasContainer(id) && probe.hasNode(key)) continue
      removed.push({ id, key })
    }
    for (const { id } of removed) this.unlinkContainer(id)
    return removed
  }

  /** Drop every entry. Used when the document is re-seeded from scratch. */
  clear(): void {
    this.#byContainer.clear()
    this.#byNode.clear()
  }

  /**
   * Assert the bijection holds. A debugging/test aid: production paths maintain
   * it structurally, so a failure here means a bug in this class, not a caller.
   *
   * @internal
   */
  assertBijective(): void {
    if (this.#byContainer.size !== this.#byNode.size) {
      throw new Error(
        `lexical-loro: mapping is not bijective — ${this.#byContainer.size} containers vs ${this.#byNode.size} nodes`,
      )
    }
    for (const [id, key] of this.#byContainer) {
      if (this.#byNode.get(key) !== id) {
        throw new Error(`lexical-loro: mapping is not bijective at ${id} ↔ ${key}`)
      }
    }
  }
}
