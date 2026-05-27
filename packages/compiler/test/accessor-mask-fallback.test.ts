// Pins the FULL_MASK-on-both-words contract for every "can't statically
// analyze" return path in `computeAccessorMask`.
//
// The downstream consumers (structural-mask, element-rewrite,
// text-mask, each-memo) gate emission on the (mask, maskHi) pair. A
// low-only FULL_MASK return leaks the gate-asymmetry bug: structural
// blocks and bindings built from these accessors silently drop
// high-word state changes. These tests lock the contract so any
// future refactor that splits one of these paths back into the
// asymmetric default trips them.

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { computeAccessorMask } from '../src/transform'

const FULL_MASK = 0xffffffff | 0

// Parse `src` as a tiny source file and return its trailing arrow
// expression. Helper rather than copying the same 6 lines into every
// test.
function arrowFromSrc(src: string): ts.ArrowFunction {
  const sf = ts.createSourceFile('inline.ts', src, ts.ScriptTarget.Latest, true)
  const last = sf.statements[sf.statements.length - 1]
  if (!last || !ts.isExpressionStatement(last)) {
    throw new Error(`expected trailing ExpressionStatement in: ${src}`)
  }
  let expr: ts.Node = last.expression
  if (ts.isParenthesizedExpression(expr)) expr = expr.expression
  if (!ts.isArrowFunction(expr)) {
    throw new Error(`expected ArrowFunction at top, got ${ts.SyntaxKind[expr.kind]}`)
  }
  return expr
}

describe('computeAccessorMask — conservative fallback paths return FULL_MASK on BOTH words', () => {
  // Empty bits maps keep tests independent of a particular state shape.
  // The contract under test is the RETURN SHAPE for the unanalyzable
  // cases, not specific bit assignments.
  const emptyBits = new Map<string, number>()
  const emptyBitsHi = new Map<string, number>()

  it('zero-arg accessor → FULL_MASK on both words', () => {
    const arrow = arrowFromSrc('(() => 42)')
    const result = computeAccessorMask(arrow, emptyBits, undefined, emptyBitsHi)
    expect(result.mask).toBe(FULL_MASK)
    expect(result.maskHi).toBe(FULL_MASK)
    expect(result.readsState).toBe(false)
  })

  it('destructured first param → FULL_MASK on both words', () => {
    // `({foo}) => foo` — walker can't map destructured names back to
    // state paths. Returning FULL_MASK + 0 (old shape) would make
    // structural-mask emit `__mask: FULL_MASK` only; the runtime
    // would default `__maskHi: 0` and silently drop high-word changes.
    const arrow = arrowFromSrc('(({foo}: { foo: number }) => foo)')
    const result = computeAccessorMask(arrow, emptyBits, undefined, emptyBitsHi)
    expect(result.mask).toBe(FULL_MASK)
    expect(result.maskHi).toBe(FULL_MASK)
    expect(result.readsState).toBe(false)
  })

  it('opaque body — host.fn(s) — FULL_MASK on both words (opaqueStateFlow branch)', () => {
    // `host.fn(s)` is the canonical "state leaked into a method call"
    // shape. The walker flips `opaqueStateFlow=true`; the function
    // returns FULL_MASK on both per the explicit branch at line ~1893.
    const arrow = arrowFromSrc(
      'const host = { fn: (_s: unknown) => 0 }; ((s: unknown) => host.fn(s))',
    )
    const result = computeAccessorMask(arrow, emptyBits, undefined, emptyBitsHi)
    expect(result.mask).toBe(FULL_MASK)
    expect(result.maskHi).toBe(FULL_MASK)
    expect(result.readsState).toBe(true)
  })

  it('dynamic element access — s[expr] — FULL_MASK on both words', () => {
    // Dynamic key access `s[k]` where `k` is not a literal flips
    // opaqueStateFlow — the indexed field is unknowable at compile
    // time, the receiver may read any field.
    const arrow = arrowFromSrc(
      "((s: Record<string, number>) => s[Math.random() > 0.5 ? 'a' : 'b'])",
    )
    const result = computeAccessorMask(arrow, emptyBits, undefined, emptyBitsHi)
    expect(result.mask).toBe(FULL_MASK)
    expect(result.maskHi).toBe(FULL_MASK)
    expect(result.readsState).toBe(true)
  })

  it('reads only untracked PropertyAccess paths — catch-all → FULL_MASK on both', () => {
    // Body reads `s.foo` but `foo` is not in fieldBits. After the
    // walk: mask=0, maskHi=0, readsState=true → catch-all return at
    // ~line 1900. Must surface as FULL_MASK on both words.
    const arrow = arrowFromSrc('((s: { foo: number; bar: number }) => s.foo + s.bar)')
    const result = computeAccessorMask(arrow, emptyBits, undefined, emptyBitsHi)
    expect(result.mask).toBe(FULL_MASK)
    expect(result.maskHi).toBe(FULL_MASK)
    expect(result.readsState).toBe(true)
  })

  // Sanity counter-tests — the happy path must NOT escape to FULL_MASK.
  it('purely-precise low-word path — s.foo (foo in fieldBits) — emits the precise bit', () => {
    const fieldBits = new Map<string, number>([['foo', 1 << 5]])
    const arrow = arrowFromSrc('((s: { foo: number }) => s.foo)')
    const result = computeAccessorMask(arrow, fieldBits, undefined, emptyBitsHi)
    expect(result.mask).toBe(1 << 5)
    expect(result.maskHi).toBe(0)
    expect(result.readsState).toBe(true)
  })

  it('purely-high-word path — s.hi (hi in fieldBitsHi) — emits maskHi only, mask stays 0', () => {
    const fieldBitsHi = new Map<string, number>([['hi', 1 << 4]])
    const arrow = arrowFromSrc('((s: { hi: number }) => s.hi)')
    const result = computeAccessorMask(arrow, emptyBits, undefined, fieldBitsHi)
    expect(result.mask).toBe(0)
    expect(result.maskHi).toBe(1 << 4)
    expect(result.readsState).toBe(true)
  })
})
