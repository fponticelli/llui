// Prefix-walker: the proposed reactivity model.
//
// At mount, walk every binding's prefix list and assign each unique prefix
// closure a stable bit index. Bindings store the OR'd mask of their prefix
// bits. Each update cycle, walk the prefix table once (`O(unique prefixes)`),
// computing the dirty mask by reference-comparing prev/next at each prefix.
// Bindings gate on `(mask & dirty)` exactly like today — same fast path.
//
// Multi-word overflow: when unique-prefix count exceeds 31, promote to a
// pair-of-uint32 representation. The walker check becomes
// `(b.mask0 & dirty0) | (b.mask1 & dirty1)` — still O(1) per binding.

import type { Binding } from './bindings.js'
import type { AppState } from './state.js'

interface PrefixEntry {
  fn: (s: AppState) => unknown
  bit: number // word-relative bit (0..30 in word 0, 0..30 in word 1, ...)
  word: number
}

export interface PrefixScope {
  table: PrefixEntry[]
  wordCount: number
  // Pre-allocated dirty mask buffer (avoids GC per update).
  dirty: number[]
}

export function buildPrefixScope(bindings: Binding[]): PrefixScope {
  // Dedupe prefix closures by reference. The compiler hoists each unique
  // prefix to a module-scoped const; bindings reference these by identity.
  // In this spike, our `pathPrefix(path)` helper caches by path string so
  // distinct bindings reading the same path get the same closure object.
  // Pack 31 bits per word (avoiding the sign bit for ergonomic OR/AND).
  const BITS_PER_WORD = 31
  const byRef = new Map<(s: AppState) => unknown, PrefixEntry>()
  for (const b of bindings) {
    for (const pfn of b.prefixList) {
      if (byRef.has(pfn)) continue
      const idx = byRef.size
      byRef.set(pfn, {
        fn: pfn,
        word: Math.floor(idx / BITS_PER_WORD),
        bit: idx % BITS_PER_WORD,
      })
    }
  }
  const table = Array.from(byRef.values())
  const wordCount = Math.max(1, Math.ceil(table.length / BITS_PER_WORD))

  for (const b of bindings) {
    const m = new Array(wordCount).fill(0)
    for (const pfn of b.prefixList) {
      const entry = byRef.get(pfn)!
      m[entry.word] |= 1 << entry.bit
    }
    ;(b as Binding & { prefixMask: number[] }).prefixMask = m
  }

  return { table, wordCount, dirty: new Array(wordCount).fill(0) }
}

// Update cycle: compute dirty by walking the prefix table once
export function computePrefixDirty(scope: PrefixScope, prev: AppState, next: AppState): void {
  const { table, dirty, wordCount } = scope
  for (let i = 0; i < wordCount; i++) dirty[i] = 0
  for (let i = 0; i < table.length; i++) {
    const e = table[i]!
    if (e.fn(prev) !== e.fn(next)) {
      dirty[e.word]! |= 1 << e.bit
    }
  }
}

// Gate one binding against the precomputed dirty mask
export function isDirtyPrefix(b: Binding & { prefixMask: number[] }, scope: PrefixScope): boolean {
  const { wordCount, dirty } = scope
  for (let i = 0; i < wordCount; i++) {
    if ((b.prefixMask[i]! & dirty[i]!) !== 0) return true
  }
  return false
}

// Single-word fast path (the ≤31 unique prefixes case)
export interface PrefixScope1 {
  table: PrefixEntry[]
  dirty: number // single-word
}

export function buildPrefixScope1(bindings: Binding[]): PrefixScope1 {
  const byRef = new Map<(s: AppState) => unknown, PrefixEntry>()
  for (const b of bindings) {
    for (const pfn of b.prefixList) {
      if (byRef.has(pfn)) continue
      const idx = byRef.size
      if (idx >= 31) throw new Error('too many prefixes for single-word path')
      byRef.set(pfn, { fn: pfn, word: 0, bit: idx })
    }
  }
  for (const b of bindings) {
    let m = 0
    for (const pfn of b.prefixList) {
      const entry = byRef.get(pfn)!
      m |= 1 << entry.bit
    }
    ;(b as Binding & { prefixMask1: number }).prefixMask1 = m
  }
  return { table: Array.from(byRef.values()), dirty: 0 }
}

export function computePrefixDirty1(scope: PrefixScope1, prev: AppState, next: AppState): number {
  const table = scope.table
  let dirty = 0
  for (let i = 0; i < table.length; i++) {
    const e = table[i]!
    if (e.fn(prev) !== e.fn(next)) dirty |= 1 << e.bit
  }
  return dirty
}
