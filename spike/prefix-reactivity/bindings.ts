// A representative binding set. Each binding declares the prefix path(s) it
// reads as strings; the `pathPrefix` helper hoists each unique path to a
// stable closure (one per distinct path string). This matches how the real
// compiler would hoist per source-location.

import type { AppState } from './state.js'
import { pathPrefix } from './prefixes.js'

export interface Binding {
  id: number
  accessor: (s: AppState) => unknown
  prefixList: Array<(s: AppState) => unknown>
  topLevelFields: string[]
  mask: number
  lastValue: unknown
}

interface Spec {
  accessor: (s: AppState) => unknown
  prefixPaths: string[]
}

const specs: Spec[] = [
  // Top-level scalars
  { accessor: (s) => s.query, prefixPaths: ['query'] },
  { accessor: (s) => s.selectedId, prefixPaths: ['selectedId'] },

  // Auth — nested reads, four bindings on different sub-paths
  { accessor: (s) => s.auth.status, prefixPaths: ['auth.status'] },
  { accessor: (s) => s.auth.user?.name ?? '', prefixPaths: ['auth.user'] },
  { accessor: (s) => s.auth.user?.email ?? '', prefixPaths: ['auth.user'] },
  { accessor: (s) => s.auth.formError, prefixPaths: ['auth.formError'] },

  // UI slice
  { accessor: (s) => s.ui.sidebarOpen, prefixPaths: ['ui.sidebarOpen'] },
  { accessor: (s) => s.ui.viewport, prefixPaths: ['ui.viewport'] },
  { accessor: (s) => s.ui.confirm?.open ?? false, prefixPaths: ['ui.confirm'] },
  { accessor: (s) => s.ui.confirm?.title ?? '', prefixPaths: ['ui.confirm'] },

  // Arrays (just length read)
  { accessor: (s) => s.items.length, prefixPaths: ['items'] },

  // Filter
  { accessor: (s) => s.filter.text, prefixPaths: ['filter.text'] },
  { accessor: (s) => s.filter.tags.length, prefixPaths: ['filter.tags'] },
  { accessor: (s) => s.filter.sort, prefixPaths: ['filter.sort'] },

  // Multi-prefix
  {
    accessor: (s) => s.auth.status === 'signed-in' && !s.ui.confirm,
    prefixPaths: ['auth.status', 'ui.confirm'],
  },
  {
    accessor: (s) => `${s.query} (${s.filter.text})`,
    prefixPaths: ['query', 'filter.text'],
  },
]

// Add per-flag bindings — each gets its own distinct prefix path.
for (let i = 0; i < 36; i++) {
  const path = `flag${i}`
  specs.push({
    accessor: (s) => (s as unknown as Record<string, unknown>)[path],
    prefixPaths: [path],
  })
}

// Now expand to a realistic distribution: many bindings sharing hot paths.
// 100 item-row-style bindings, all reading from the items array.
for (let i = 0; i < 100; i++) {
  const k = i
  specs.push({
    accessor: (s) => s.items[k % s.items.length]?.title ?? '',
    prefixPaths: ['items'],
  })
}
// 30 auth-user-reading bindings (header/sidebar pattern)
for (let i = 0; i < 30; i++) {
  specs.push({
    accessor: (s) => s.auth.user?.id ?? '',
    prefixPaths: ['auth.user'],
  })
}

// ── Build bindings array ────────────────────────────────────────────

// Determine top-level fields used (for the bitmask path)
function topLevelOf(path: string): string {
  return path.split('.')[0]!
}

const allTopLevel = new Set<string>()
for (const spec of specs) {
  for (const p of spec.prefixPaths) allTopLevel.add(topLevelOf(p))
}

export const TOP_LEVEL_COUNT = allTopLevel.size

const bitmaskIndex = new Map<string, number>()
{
  let bit = 0
  for (const f of allTopLevel) bitmaskIndex.set(f, bit++)
}

const FULL_MASK = -1 >>> 0

export const bindings: Binding[] = specs.map((spec, id) => {
  const prefixList = spec.prefixPaths.map((p) => pathPrefix(p))
  const topLevelFields = spec.prefixPaths.map(topLevelOf)
  let mask = 0
  for (const f of topLevelFields) {
    const bit = bitmaskIndex.get(f)!
    if (bit >= 31) {
      mask = FULL_MASK
    } else if (mask !== FULL_MASK) {
      mask |= 1 << bit
    }
  }
  return {
    id,
    accessor: spec.accessor,
    prefixList,
    topLevelFields,
    mask,
    lastValue: undefined,
  }
})

export { bitmaskIndex }

export function computeBitmaskDirty(prev: AppState, next: AppState): number {
  let dirty = 0
  for (const [f, bit] of bitmaskIndex) {
    const a = (prev as unknown as Record<string, unknown>)[f]
    const b = (next as unknown as Record<string, unknown>)[f]
    if (a !== b) {
      if (bit >= 31) dirty = FULL_MASK
      else if (dirty !== FULL_MASK) dirty |= 1 << bit
    }
  }
  return dirty
}
