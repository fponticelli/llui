/**
 * Per-variant Msg coverage tracker — dev-only.
 *
 * Records each dispatched message's discriminant (or `<non-discriminant>`
 * for objects missing a `type` field) along with the message index it
 * fired at. Consumed by the `llui_coverage` MCP tool to surface untested
 * Msg variants: any variant declared in the compiled `__msgSchema` that
 * never fired in the current session shows up in `neverFired`.
 *
 * Zero cost in production: `installDevTools` is the only caller, and it
 * never runs in prod builds. Hot path is one optional-chain read per
 * dispatched message (`ci._coverage?.record(...)`).
 */

export interface CoverageSnapshot {
  fired: Record<string, { count: number; lastIndex: number }>
  neverFired: string[]
}

export interface CoverageTracker {
  record(variant: string, messageIndex: number): void
  snapshot(knownVariants?: string[]): CoverageSnapshot
  clear(): void
}

export function createCoverageTracker(): CoverageTracker {
  const fired = new Map<string, { count: number; lastIndex: number }>()
  return {
    record(variant, messageIndex) {
      const existing = fired.get(variant)
      if (existing) {
        existing.count++
        existing.lastIndex = messageIndex
      } else {
        fired.set(variant, { count: 1, lastIndex: messageIndex })
      }
    },
    snapshot(knownVariants) {
      const firedObj: Record<string, { count: number; lastIndex: number }> = {}
      for (const [k, v] of fired) firedObj[k] = { ...v }
      const neverFired = knownVariants ? knownVariants.filter((v) => !fired.has(v)) : []
      return { fired: firedObj, neverFired }
    },
    clear() {
      fired.clear()
    },
  }
}
