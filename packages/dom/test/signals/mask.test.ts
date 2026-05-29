import { describe, it, expect } from 'vitest'
import {
  buildPathTable,
  resolvePath,
  computeDirty,
  bindingMask,
  intersects,
} from '../../src/signals/mask'

describe('buildPathTable', () => {
  it('dedupes and sizes chunks', () => {
    expect(buildPathTable([]).chunkCount).toBe(1)
    expect(buildPathTable(['a', 'a', 'b']).paths).toEqual(['a', 'b'])
    expect(buildPathTable(Array.from({ length: 32 }, (_, i) => 'p' + i)).chunkCount).toBe(1)
    expect(buildPathTable(Array.from({ length: 33 }, (_, i) => 'p' + i)).chunkCount).toBe(2)
    expect(buildPathTable(Array.from({ length: 65 }, (_, i) => 'p' + i)).chunkCount).toBe(3)
  })
})

describe('resolvePath', () => {
  const s = { a: 1, user: { name: 'x' }, list: [{ p: 5 }] }
  it('navigates dotted + indexed paths', () => {
    expect(resolvePath(s, '')).toBe(s)
    expect(resolvePath(s, 'a')).toBe(1)
    expect(resolvePath(s, 'user.name')).toBe('x')
    expect(resolvePath(s, 'list.0.p')).toBe(5)
    expect(resolvePath(s, 'missing.deep')).toBeUndefined()
  })
})

describe('chunk boundaries — the historical lo/hi asymmetry zone', () => {
  // 70 paths spanning bits 0..69 -> 3 chunks. The old two-word mask dropped
  // high-word changes; chunked masks must gate correctly at bits 31, 32, 63, 64.
  const paths = Array.from({ length: 70 }, (_, i) => 'p' + i)
  const table = buildPathTable(paths)

  for (const bit of [0, 31, 32, 63, 64, 69]) {
    it(`a binding on bit ${bit} fires iff that path changes`, () => {
      const mask = bindingMask(['p' + bit], table)
      // dirty set only at `bit`
      const old: Record<string, number> = {}
      const next: Record<string, number> = {}
      paths.forEach((p) => {
        old[p] = 0
        next[p] = 0
      })
      next['p' + bit] = 1
      const dirty = computeDirty(table, old, next)
      expect(intersects(mask, dirty)).toBe(true)

      // a different bit changing must NOT fire this binding
      const other = (bit + 1) % 70
      const next2: Record<string, number> = { ...old }
      next2['p' + other] = 1
      expect(intersects(mask, computeDirty(table, old, next2))).toBe(false)
    })
  }
})

describe('root path fires on any new state object (root-coarse)', () => {
  const table = buildPathTable(['', 'a'])
  const mask = bindingMask([''], table)

  it('does NOT fire when the state reference is unchanged', () => {
    const s = { a: 1 }
    expect(intersects(mask, computeDirty(table, s, s))).toBe(false)
  })
  it('fires on any new state object identity', () => {
    // matches TEA: a coarse root dep re-runs whenever update returns a new state
    expect(intersects(mask, computeDirty(table, { a: 1 }, { a: 1 }))).toBe(true)
    expect(intersects(mask, computeDirty(table, { a: 1 }, { a: 2 }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Property test: the chunk packing/gating must equal an independent oracle —
// "a binding fires iff at least one of its dep paths changed value" — across
// many paths spanning multiple chunks, with real immutable updates (cloned
// spine so prefix refs differ, matching TEA semantics).
// ---------------------------------------------------------------------------
describe('mask gating — property (matches an independent oracle across chunk boundaries)', () => {
  let seed = 0x51ed5
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!

  // 15 groups × {root, f0, f1, sub, sub.d0, sub.d1} ≈ 90 paths -> 3 chunks
  const GROUPS = 15
  type State = Record<string, { f0: number; f1: string; sub: { d0: number; d1: number } }>

  const allPaths: string[] = []
  const leafPaths: string[] = []
  for (let g = 0; g < GROUPS; g++) {
    const k = 'g' + g
    allPaths.push(k, `${k}.f0`, `${k}.f1`, `${k}.sub`, `${k}.sub.d0`, `${k}.sub.d1`)
    leafPaths.push(`${k}.f0`, `${k}.f1`, `${k}.sub.d0`, `${k}.sub.d1`)
  }
  const table = buildPathTable(allPaths)

  const genState = (): State => {
    const s: State = {}
    for (let g = 0; g < GROUPS; g++) {
      s['g' + g] = {
        f0: Math.floor(rnd() * 100),
        f1: 's' + Math.floor(rnd() * 100),
        sub: { d0: Math.floor(rnd() * 100), d1: Math.floor(rnd() * 100) },
      }
    }
    return s
  }

  const immutableSet = (state: unknown, path: string, value: unknown): unknown => {
    const segs = path.split('.')
    const root: Record<string, unknown> = { ...(state as Record<string, unknown>) }
    let cur = root
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i]!
      cur[seg] = { ...(cur[seg] as Record<string, unknown>) }
      cur = cur[seg] as Record<string, unknown>
    }
    cur[segs[segs.length - 1]!] = value
    return root
  }

  it('gate fires iff some dep path changed (2000 iters, 3 chunks)', () => {
    let multiChunkBindings = 0
    for (let iter = 0; iter < 2000; iter++) {
      const old = genState()
      // random dependency subset (1..8 paths)
      const depCount = 1 + Math.floor(rnd() * 8)
      const deps = Array.from({ length: depCount }, () => pick(allPaths))
      const mask = bindingMask(deps, table)
      if (mask.length > 1) multiChunkBindings++

      // mutate one leaf immutably (so prefix refs change, as in real updates)
      const leaf = pick(leafPaths)
      const oldVal = resolvePath(old, leaf)
      const next = immutableSet(
        old,
        leaf,
        typeof oldVal === 'number' ? (oldVal as number) + 1 : 'CHANGED',
      )

      const dirty = computeDirty(table, old, next)
      const gated = intersects(mask, dirty)

      // independent oracle: did any dep path's resolved value change?
      const oracle = deps.some((p) => !Object.is(resolvePath(old, p), resolvePath(next, p)))

      if (gated !== oracle) {
        throw new Error(
          `mask/oracle mismatch: deps=[${deps.join(',')}] changed leaf=${leaf} ` +
            `gated=${gated} oracle=${oracle}`,
        )
      }
    }
    // sanity: we genuinely exercised bindings spanning more than one chunk
    expect(multiChunkBindings).toBeGreaterThan(50)
  })
})
