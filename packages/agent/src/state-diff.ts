/**
 * Compute a structural diff between two state snapshots and return it
 * in JSON-Patch-shaped form (RFC 6902 subset: `add`, `remove`,
 * `replace`).
 *
 * Why JSON Patch shape: LLMs see this exact format in their training
 * data — it's the standard for describing object mutations on the
 * wire. The agent learns the schema implicitly and can answer "what
 * changed?" in a sentence by reading the ops.
 *
 * Why not unified-diff or per-binding dirty masks: the dirty mask
 * tracks what bindings need re-rendering, which is a layout concern.
 * The agent wants to know what *values* changed, which is a state
 * concern. Dirty masks miss field-level resolution; per-path JSON
 * Patch gives it.
 *
 * Cost is O(state size) per dispatch. For typical app states (a few
 * KB) that's microseconds. Apps with very large states (collections
 * of thousands of items) should subscribe to specific slices via
 * `query_state` / `wait_for_change` instead of reading full diffs.
 *
 * Path escaping follows JSON Pointer (RFC 6901): `/` becomes `~1`,
 * `~` becomes `~0`. The escape happens per-segment.
 */

export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }

export type StateDiff = JsonPatchOp[]

/**
 * Compute the diff. Order of operations: removes first, then adds,
 * then replaces. This is RFC 6902's recommended order — the receiver
 * can apply ops sequentially without ambiguity.
 *
 * The implementation is a simple recursive walk; collection diffs
 * are positional (index-based for arrays, key-based for objects)
 * rather than structural (no LCS). Apps that pass identity-stable
 * collections (`[...prev, item]`-style appends) get clean diffs;
 * apps that rebuild arrays from scratch get noisy ones — same
 * tradeoff a React reconciler makes, and the same fix (stable keys
 * + push-don't-rebuild updates) applies.
 */
export function computeStateDiff(prev: unknown, next: unknown): StateDiff {
  const ops: JsonPatchOp[] = []
  diffInto(prev, next, '', ops)
  return ops
}

function diffInto(prev: unknown, next: unknown, basePath: string, ops: JsonPatchOp[]): void {
  if (Object.is(prev, next)) return

  // Either side null/undefined or non-object → straight replace at this path.
  // (`null` is `typeof === 'object'`, so we test it explicitly.)
  if (
    prev === null ||
    next === null ||
    prev === undefined ||
    next === undefined ||
    typeof prev !== 'object' ||
    typeof next !== 'object'
  ) {
    ops.push({ op: 'replace', path: basePath, value: next })
    return
  }

  const prevIsArr = Array.isArray(prev)
  const nextIsArr = Array.isArray(next)

  // Type change (object↔array) — single replace at the path. Recursing
  // into mismatched containers would emit a wall of incoherent ops.
  if (prevIsArr !== nextIsArr) {
    ops.push({ op: 'replace', path: basePath, value: next })
    return
  }

  if (prevIsArr && nextIsArr) {
    diffArray(prev, next, basePath, ops)
    return
  }

  diffObject(prev as Record<string, unknown>, next as Record<string, unknown>, basePath, ops)
}

function diffArray(
  prev: readonly unknown[],
  next: readonly unknown[],
  basePath: string,
  ops: JsonPatchOp[],
): void {
  const minLen = Math.min(prev.length, next.length)
  // Recurse into shared indices.
  for (let i = 0; i < minLen; i++) {
    diffInto(prev[i], next[i], `${basePath}/${i}`, ops)
  }
  // Excess elements: remove from the end (descending order so each
  // index is still valid as we apply).
  if (prev.length > next.length) {
    for (let i = prev.length - 1; i >= next.length; i--) {
      ops.push({ op: 'remove', path: `${basePath}/${i}` })
    }
  }
  // New elements: add at the position they end up in. RFC 6902 allows
  // a `-` index for "append" semantics, but explicit indices are easier
  // for the LLM to reason about ("alternative at index 8 was added").
  if (next.length > prev.length) {
    for (let i = prev.length; i < next.length; i++) {
      ops.push({ op: 'add', path: `${basePath}/${i}`, value: next[i] })
    }
  }
}

function diffObject(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  basePath: string,
  ops: JsonPatchOp[],
): void {
  // Removes: keys that exist in prev but not next.
  for (const k in prev) {
    if (!(k in next)) {
      ops.push({ op: 'remove', path: `${basePath}/${escapeSegment(k)}` })
    }
  }
  // Adds + replaces: keys in next.
  for (const k in next) {
    const path = `${basePath}/${escapeSegment(k)}`
    if (!(k in prev)) {
      ops.push({ op: 'add', path, value: next[k] })
    } else {
      diffInto(prev[k], next[k], path, ops)
    }
  }
}

/**
 * Escape a single path segment per RFC 6901: `~` → `~0`, then `/` →
 * `~1`. Order matters; do `~` first so `/` substitution doesn't
 * double-escape an already-escaped tilde.
 */
function escapeSegment(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1')
}
