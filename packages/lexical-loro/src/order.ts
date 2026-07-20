/**
 * Fractional indexing: the sibling ORDER of a child list, as a sortable
 * property rather than as a list position.
 *
 * Every child carrier holds a `pos` string; the rendered order is
 * `sort by (pos, uuid)` — a PURE function of replicated state, and therefore
 * commutative by construction. A MOVE is one last-writer-wins register write to
 * `pos`: no container is deleted, none is recreated, and nothing in the moved
 * subtree is touched. See `schema.ts` for why that property is load-bearing.
 *
 * ── FOUR CONSTRAINTS, EACH MEASURED, EACH EASY TO BREAK ────────────────────
 *
 * These are not style preferences. Each one was a REAL, reproduced defect in a
 * spike, and each is the kind of thing a later contributor removes because it
 * looks redundant. Do not relax one without re-reading `test/order.test.ts`.
 *
 * 1. BATCH ALLOCATION, OFF ONE ANCHOR. Allocating a multi-block paste one block
 *    at a time makes both peers generate the SAME keys in the same gap, so the
 *    uuid tiebreak alternates them: two 5-paragraph pastes at the same spot
 *    render as a 10-paragraph A/B/A/B interleaving. Convergent, and nonsense.
 *    `allocate` therefore takes the WHOLE batch and hangs it off a single anchor
 *    carrying a per-peer jitter digit, which confines each peer's paste to a
 *    private sub-interval.
 *
 * 2. JITTER PER BATCH, NEVER PER INSERT. Always-on jitter degrades key growth
 *    from ~0.2 to ~1.0 characters per insert, because a suffix digit at the far
 *    end of the alphabet from the direction of travel consumes the whole
 *    remaining interval. And WHICH digit is pathological is direction-dependent
 *    — a low digit is worst for repeated left-inserts, a high digit for
 *    right-inserts — so no fixed per-peer digit is safe in both. `allocate`
 *    consequently IGNORES `jitter` when `count === 1`, which is the overwhelming
 *    majority of calls. That branch is not an optimization; deleting it makes
 *    single-insert keys grow five times faster.
 *
 * 3. NEVER REBALANCE. Rewriting every `pos` to spread the keys out evenly is the
 *    "obvious" fix for key growth. IT IS UNSAFE. A peer that concurrently
 *    inserted computed its key against the OLD keys, so after the merge its
 *    block lands at an arbitrary position — convergent, and silently wrong about
 *    what the user asked for. It is measured: the block ends up at neither of
 *    the neighbours it was typed between.
 *
 *    There is no need for it anyway. Growth is LINEAR and bounded in practice —
 *    2000 adversarial same-spot inserts reach a 401-character key, and a move
 *    carries exactly one such key, keeping even that pathological case under a
 *    kilobyte on the wire. Unlike a plain list's delete+recreate, it does not
 *    scale with the subtree.
 *
 * 4. EQUAL POSITIONS ARE REACHABLE, and the uuid tiebreak only resolves
 *    RENDERING. Two peers inserting at the same slot mint an IDENTICAL `pos`.
 *    No key exists strictly between two equal keys, and `between(a, a)` returns
 *    a key that sorts AFTER BOTH while claiming to sort between them — silent
 *    corruption of the one invariant this module exists to maintain. Callers
 *    must go through {@link allocateAt}, which sees the sibling list and widens
 *    past the degenerate group rather than emitting an impossible key.
 */

/**
 * The key alphabet, in ascending code-unit order.
 *
 * Base 62 buys ~5.9 binary subdivisions per character, which is what keeps
 * growth at roughly one character per five same-spot inserts. Every character
 * here must be ASCII and strictly ascending, because the comparator is plain
 * lexicographic `<` on the raw string — the same comparison every peer performs
 * with no locale involved.
 */
export const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

const BASE = DIGITS.length

/**
 * A key strictly between `a` and `b`, where `null` means unbounded.
 *
 * REQUIRES `a < b`. It does not check, and on equal or inverted bounds it
 * returns a key OUTSIDE the interval rather than failing — see constraint 4.
 * Prefer {@link allocateAt}, which cannot be called with a degenerate interval.
 */
export function between(a: string | null, b: string | null): string {
  let result = ''
  for (let i = 0; ; i++) {
    const low = a !== null && i < a.length ? DIGITS.indexOf(a[i]!) : 0
    const high = b !== null && i < b.length ? DIGITS.indexOf(b[i]!) : BASE
    if (high - low > 1) return result + DIGITS[Math.floor((low + high) / 2)]!
    result += DIGITS[low]!
  }
}

/**
 * `count` strictly increasing keys inside the open interval `(before, after)`.
 *
 * With `count === 1` the jitter is deliberately ignored (constraint 2). With
 * `count > 1` the whole batch hangs off ONE anchor carrying the jitter digit, so
 * two peers' concurrent batches occupy disjoint sub-intervals and cannot
 * interleave (constraint 1).
 *
 * The anchor is a strict extension of a key already strictly below `after`, and
 * every subsequent key extends the anchor further, so the whole batch stays
 * inside the interval and in order.
 */
export function allocate(
  before: string | null,
  after: string | null,
  count: number,
  jitter: string | null,
): string[] {
  if (count <= 0) return []
  if (count === 1 || jitter === null) {
    const keys: string[] = []
    let previous = before
    for (let i = 0; i < count; i++) {
      const key = between(previous, after)
      keys.push(key)
      previous = key
    }
    return keys
  }

  const anchor = between(before, after) + jitter
  const keys: string[] = [anchor]
  let suffix: string | null = null
  for (let i = 1; i < count; i++) {
    suffix = between(suffix, null)
    keys.push(anchor + suffix)
  }
  return keys
}

/**
 * `count` keys placing new children at rendered index `index` among siblings
 * whose positions are `positions` (ASCENDING — the order the projection
 * renders).
 *
 * This is the only allocation entry point callers should use, because it is the
 * only one that can see, and therefore honour, constraint 4. When the left
 * neighbour's position EQUALS the right neighbour's — reachable whenever two
 * peers insert at the same slot concurrently — there is no key strictly between
 * them. Rather than emit one that breaks the sort invariant, the right bound is
 * widened to the first position STRICTLY greater than the left neighbour's, so
 * the new children land after the whole equal-position group.
 *
 * That is a real, if narrow, loss of fidelity: the block lands one slot later
 * than the user pointed at. It is chosen over the alternatives deliberately —
 * repositioning the neighbour would be a localized rebalance (constraint 3), and
 * emitting an out-of-interval key would corrupt the ordering silently.
 */
export function allocateAt(
  positions: readonly string[],
  index: number,
  count: number,
  jitter: string | null,
): string[] {
  const clamped = Math.max(0, Math.min(index, positions.length))
  const before = clamped === 0 ? null : positions[clamped - 1]!

  // `positions` is ascending, so the only degenerate case is EQUALITY, and the
  // widened bound is the first strictly-greater position at or after `index`.
  let after: string | null = null
  for (let i = clamped; i < positions.length; i++) {
    const candidate = positions[i]!
    if (before === null || candidate > before) {
      after = candidate
      break
    }
  }

  return allocate(before, after, count, jitter)
}

/**
 * Digits usable as a per-peer jitter suffix.
 *
 * `DIGITS[0]` is excluded: appending the lowest digit to an anchor produces a
 * key that is effectively the anchor itself for subdivision purposes, wasting
 * the peer-private sub-interval the jitter exists to create.
 */
const JITTER_DIGITS = DIGITS.slice(1)

/**
 * A stable jitter digit for a peer.
 *
 * Takes Loro's own `peerId`, so peers need no coordination to pick distinct
 * digits. Collisions across the {@link JITTER_DIGITS} alphabet only degrade to
 * the un-jittered behaviour for the colliding pair; they are not a correctness
 * problem.
 */
export function jitterFor(peerId: bigint): string {
  const index = Number(
    ((peerId % BigInt(JITTER_DIGITS.length)) + BigInt(JITTER_DIGITS.length)) %
      BigInt(JITTER_DIGITS.length),
  )
  return JITTER_DIGITS[index]!
}

/**
 * The rendered order of two children: by `pos`, then by `uuid`.
 *
 * The uuid tiebreak is what makes this a TOTAL order even when two peers mint
 * the same `pos`, which is exactly what keeps every peer rendering the same
 * sequence. It resolves rendering only — it does not make the interval between
 * two equal positions usable; see constraint 4.
 */
export function comparePositions(posA: string, uuidA: string, posB: string, uuidB: string): number {
  if (posA !== posB) return posA < posB ? -1 : 1
  if (uuidA !== uuidB) return uuidA < uuidB ? -1 : 1
  return 0
}
