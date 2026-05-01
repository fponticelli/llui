import type { JsonPatchOp, StateDiff } from '../state-diff.js'

/**
 * Humanized renderers for `StateDiff` (JSON-Patch). The raw shape is
 * accurate but technical (`{ op: 'add', path: '/items/3/name', value: 'X' }`);
 * the agent panel reads better in plain prose.
 *
 * Two output forms:
 *   - `summarizeDiff` — one-line headline ("3 items changed") for a
 *     row in the activity feed.
 *   - `groupDiff` — structured per-top-level-path summary for an
 *     expanded sidecar that lists what changed in each region.
 *
 * Both are pure functions; both treat the input as immutable. Callers
 * that need a different rendering (e.g. an emoji-driven layout, a
 * deeper drill-down) should compose on top of `groupDiff` rather than
 * forking — the grouping covers 90% of the structural work.
 */

/**
 * One-line summary of the entire diff. Examples:
 *
 *   - `[{ op: 'replace', path: '/cart/total', value: 9 }]`
 *     → "1 field changed"
 *   - `[{ op: 'add', path: '/items/-' }, { op: 'add', path: '/items/-' }]`
 *     → "2 items added"
 *   - mixed adds/removes/replaces across multiple regions
 *     → "5 changes across 3 regions"
 *
 * The summary collapses multiple ops on the same logical path
 * (e.g. updating multiple fields on the same item) into a single
 * "change" — counting raw op entries would surface implementation
 * detail (which JSON-Patch ops the differ emitted), not user-relevant
 * counts.
 */
export function summarizeDiff(diff: StateDiff | undefined | null): string {
  if (!diff || diff.length === 0) return 'no changes'

  let adds = 0
  let removes = 0
  let replaces = 0
  const topPaths = new Set<string>()
  for (const op of diff) {
    topPaths.add(topLevelOf(op.path))
    if (op.op === 'add') adds++
    else if (op.op === 'remove') removes++
    else replaces++
  }

  // Single-region special case: name the region so the summary doesn't
  // hide WHERE the change happened. "3 changes in cart" beats "3 changes".
  if (topPaths.size === 1) {
    const region = Array.from(topPaths)[0]!
    if (region === '*') {
      return 'state replaced'
    }
    const total = adds + removes + replaces
    return `${total} change${total === 1 ? '' : 's'} in ${region}`
  }

  // Multi-region: prefer the dominant op verb when one dominates,
  // else fall back to a generic count.
  if (adds > 0 && removes === 0 && replaces === 0) {
    return `${adds} item${adds === 1 ? '' : 's'} added across ${topPaths.size} regions`
  }
  if (removes > 0 && adds === 0 && replaces === 0) {
    return `${removes} item${removes === 1 ? '' : 's'} removed across ${topPaths.size} regions`
  }
  if (replaces > 0 && adds === 0 && removes === 0) {
    return `${replaces} field${replaces === 1 ? '' : 's'} changed across ${topPaths.size} regions`
  }
  const total = adds + removes + replaces
  return `${total} changes across ${topPaths.size} regions`
}

/**
 * Per-top-level-path breakdown. Returns an array (stable order) where
 * each entry describes the changes affecting one top-level region.
 * Useful for a sidecar that wants to render a row per region with the
 * affected fields beneath it.
 *
 * The returned `paths` are the FULL JSON-Pointer paths of the ops, so
 * a consumer can render "/items/3/name" verbatim or further humanize
 * it. The renderer doesn't make policy choices about how deeply to
 * label — that's the host's call.
 */
export type DiffGroup = {
  /** Top-level state field, or `'*'` for whole-state replace. */
  region: string
  adds: number
  removes: number
  replaces: number
  /** Full op paths in arrival order. */
  paths: string[]
}

export function groupDiff(diff: StateDiff | undefined | null): DiffGroup[] {
  if (!diff || diff.length === 0) return []
  const byRegion = new Map<string, DiffGroup>()
  for (const op of diff) {
    const region = topLevelOf(op.path)
    let g = byRegion.get(region)
    if (!g) {
      g = { region, adds: 0, removes: 0, replaces: 0, paths: [] }
      byRegion.set(region, g)
    }
    if (op.op === 'add') g.adds++
    else if (op.op === 'remove') g.removes++
    else g.replaces++
    g.paths.push(op.path)
  }
  return Array.from(byRegion.values())
}

/**
 * Per-op short verb + readable path. Useful for a flat detail view:
 *
 *   - `{ op: 'replace', path: '/cart/total', value: 9 }` → `'changed cart.total'`
 *   - `{ op: 'add',     path: '/items/3' }`              → `'added items.3'`
 *   - `{ op: 'remove',  path: '/items/3' }`              → `'removed items.3'`
 *   - `{ op: 'replace', path: '/' }`                     → `'replaced state'`
 *
 * The path is converted from JSON-Pointer to dotted form (with
 * `~0`/`~1` un-escaping) so it reads as a plain field accessor.
 */
export function describeOp(op: JsonPatchOp): string {
  if (op.path === '' || op.path === '/') {
    return op.op === 'replace' ? 'replaced state' : `${verbForOp(op.op)} state`
  }
  return `${verbForOp(op.op)} ${dottedPath(op.path)}`
}

// ── internals ────────────────────────────────────────────────────────

function topLevelOf(path: string): string {
  if (path === '' || path === '/') return '*'
  // JSON Pointer: leading '/', then segments.
  const parts = path.split('/')
  return parts.length >= 2 && parts[1] ? unescapePointerSegment(parts[1]) : '*'
}

function dottedPath(path: string): string {
  if (path === '' || path === '/') return ''
  // Drop leading '/', un-escape pointer segments, join with '.'.
  const parts = path.split('/').slice(1).map(unescapePointerSegment)
  return parts.join('.')
}

function unescapePointerSegment(seg: string): string {
  // RFC 6901: `~1` first (so a `~0` in the input doesn't introduce
  // a `/` that interferes), then `~0`.
  return seg.replace(/~1/g, '/').replace(/~0/g, '~')
}

function verbForOp(op: JsonPatchOp['op']): string {
  switch (op) {
    case 'add':
      return 'added'
    case 'remove':
      return 'removed'
    case 'replace':
      return 'changed'
  }
}
