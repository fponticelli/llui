import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { analyzeAccessor, covers } from '../../src/signals/analyze-deps.js'

// Parse the OUTER arrow from a source snippet like `(s) => s.a.b`.
function parseFn(src: string): ts.ArrowFunction {
  const sf = ts.createSourceFile('t.ts', `const __f = ${src}`, ts.ScriptTarget.Latest, true)
  let found: ts.ArrowFunction | undefined
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isArrowFunction(n)) {
      found = n
      return
    }
    n.forEachChild(visit)
  }
  sf.forEachChild(visit)
  if (!found) throw new Error('no arrow in: ' + src)
  return found
}

function depsOf(src: string, param = 0): string[] {
  const r = analyzeAccessor(parseFn(src))
  return [...(r.deps[param] ?? new Set<string>())].sort()
}

describe('analyzeAccessor — precision (worked examples)', () => {
  const cases: [string, string[]][] = [
    ['(s) => s.user.name', ['user.name']],
    ['(s) => s.user', ['user']],
    ['(s) => s', ['']],
    // method call: receiver path, not the whole param
    ['(s) => s.user.name.toUpperCase()', ['user.name']],
    // collection method: whole array (covers element reads)
    ['(s) => s.items.filter((e) => e.done).length', ['items']],
    // template: each interpolation
    ['(s) => `${s.a} ${s.b}`', ['a', 'b']],
    // ternary: condition + both branches (static superset)
    ['(s) => (s.flag ? s.x : s.y)', ['flag', 'x', 'y']],
    // escape into opaque helper: argument path wholesale
    ['(s) => fmt(s.user)', ['user']],
    ['(s) => fmt(s.user.profile.email)', ['user.profile.email']],
    // arithmetic: operands consumed
    ['(s) => s.nested.x * 2 + s.nested.y', ['nested.x', 'nested.y']],
    // string-literal element access narrows; numeric too
    ["(s) => s.map['key'].v", ['map.key.v']],
    ['(s) => s.list[0].p', ['list.0.p']],
    // dynamic key: wholesale receiver
    ['(s) => s.map[s.k]', ['k', 'map']],
  ]
  for (const [src, expected] of cases) {
    it(src, () => expect(depsOf(src)).toEqual([...expected].sort()))
  }
})

describe('analyzeAccessor — block bodies, aliasing, scope', () => {
  it('alias through const', () => {
    expect(depsOf('(s) => { const p = s.user.profile; return p.name }')).toEqual([
      'user.profile.name',
    ])
  })

  it('destructured parameter', () => {
    expect(depsOf('({ user }) => user.name')).toEqual(['user.name'])
  })

  it('destructured rest coarsens to the parent', () => {
    // `rest` captures unknown remaining keys -> whole param
    expect(depsOf('({ a, ...rest }) => use(a, rest)')).toEqual(['', 'a'])
  })

  it('if/else unions both branches', () => {
    expect(depsOf('(s) => { if (s.flag) { return s.x } return s.y }')).toEqual(['flag', 'x', 'y'])
  })

  it('nested closure reads the OUTER binding correctly', () => {
    expect(depsOf('(s) => s.list.map((x) => x.k + s.tax)')).toEqual(['list', 'tax'])
  })

  it('shadowing: inner param named the same does NOT leak to outer', () => {
    // The inner `s` shadows the outer; `s.inner` is the inner binding (opaque),
    // so only `outer` (passed to f) is a dependency. This is the historical
    // shadowing bug class — must not regress.
    const deps = depsOf('(s) => { const f = (s) => s.inner; return f(s.outer) }')
    expect(deps).toEqual(['outer'])
    expect(deps).not.toContain('inner')
  })
})

describe('analyzeAccessor — derived (multiple params)', () => {
  it('tracks each parameter independently', () => {
    const r = analyzeAccessor(parseFn('(a, b) => a.name + b.count'))
    expect([...(r.deps[0] ?? [])]).toEqual(['name'])
    expect([...(r.deps[1] ?? [])]).toEqual(['count'])
  })
})

describe('covers', () => {
  it('a prefix covers descendants; root covers all; deeper covers the node', () => {
    expect(covers(new Set(['user']), 'user.name')).toBe(true)
    expect(covers(new Set(['']), 'anything.here')).toBe(true)
    expect(covers(new Set(['user.profile.name']), 'user.profile')).toBe(true)
    expect(covers(new Set(['user.name']), 'account.id')).toBe(false)
    expect(covers(new Set(['user.name']), 'user.email')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Differential soundness property test.
//
// For a generated, executable accessor body, the analyzer's emitted deps MUST
// cover every input path whose mutation changes the body's output — that is
// exactly the runtime contract (a dep fires when its value changes). If a
// mutation changes the output but the mutated path is not covered, the analyzer
// missed a dependency (would cause stale UI). This is the soundness gate.
// ---------------------------------------------------------------------------
describe('analyzeAccessor — differential soundness (imprecision coarsens, never misses)', () => {
  // deterministic PRNG for reproducibility
  let seed = 0x2f6e2b1
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!
  const NUM = ['a', 'nested.x', 'nested.deep.z', 'list.0.p', 'list.1.p', 'list.2.p']
  const STR = ['b', 'nested.y', 'list.0.q', 'list.1.q', 'list.2.q']
  const BOOL = ['flag']
  const LEAVES = [...NUM, ...STR, ...BOOL]

  const dotToSrc = (path: string): string =>
    's' +
    path
      .split('.')
      .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`))
      .join('')

  const genInput = (): unknown => ({
    a: Math.floor(rnd() * 100),
    b: 'b' + Math.floor(rnd() * 100),
    flag: rnd() > 0.5,
    nested: {
      x: Math.floor(rnd() * 100),
      y: 'y' + Math.floor(rnd() * 100),
      deep: { z: Math.floor(rnd() * 100) },
    },
    map: { key: { v: Math.floor(rnd() * 100) } },
    list: [0, 1, 2].map((i) => ({
      p: Math.floor(rnd() * 100),
      q: 'q' + i + Math.floor(rnd() * 100),
    })),
  })

  const genExpr = (d: number): string => {
    if (d <= 0) return pick([dotToSrc(pick(NUM)), dotToSrc(pick(STR))])
    const forms = [
      () => dotToSrc(pick(NUM)),
      () => dotToSrc(pick(STR)),
      () => `(${dotToSrc(pick(NUM))} + ${genExpr(d - 1)})`,
      () => `(${dotToSrc(pick(BOOL))} ? ${genExpr(d - 1)} : ${genExpr(d - 1)})`,
      () => `\`v${'${' + genExpr(d - 1) + '}'}w${'${' + genExpr(d - 1) + '}'}\``,
      () => `${dotToSrc(pick(STR))}.toUpperCase()`,
      () => `s.list.filter((e) => e.p > ${dotToSrc(pick(NUM))}).length`,
      () => `s.list[${Math.floor(rnd() * 3)}].p`,
      () => `(${dotToSrc(pick(BOOL))} && ${genExpr(d - 1)})`,
      () => `({ k: ${genExpr(d - 1)}, m: ${genExpr(d - 1)} })`,
      () => `((q) => ${genExpr(d - 1)})(1)`,
    ]
    return pick(forms)()
  }

  const setLeaf = (obj: Record<string, unknown>, path: string): void => {
    const segs = path.split('.')
    let cur: Record<string, unknown> = obj
    for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]!] as Record<string, unknown>
    const last = segs[segs.length - 1]!
    const v = cur[last]
    cur[last] = typeof v === 'number' ? v + 1000 : typeof v === 'string' ? v + '_X' : !v
  }

  it('every output-affecting mutation is covered (3000+ checks)', () => {
    let checks = 0
    let outputAffecting = 0
    for (let iter = 0; iter < 400; iter++) {
      const expr = genExpr(3)
      const emitted = analyzeAccessor(parseFn(`(s) => (${expr})`)).deps[0] ?? new Set<string>()
      const fn = new Function('s', `return (${expr})`) as (s: unknown) => unknown
      const baseInput = genInput() as Record<string, unknown>
      const base = JSON.stringify(fn(baseInput))
      for (const leaf of LEAVES) {
        const mutated = JSON.parse(JSON.stringify(baseInput)) as Record<string, unknown>
        setLeaf(mutated, leaf)
        const out = JSON.stringify(fn(mutated))
        checks++
        if (out !== base) {
          outputAffecting++
          if (!covers(emitted, leaf)) {
            throw new Error(
              `SOUNDNESS VIOLATION: mutating "${leaf}" changed output of\n  ${expr}\n` +
                `but emitted deps {${[...emitted].join(', ')}} do not cover it`,
            )
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(3000)
    expect(outputAffecting).toBeGreaterThan(100) // sanity: mutations actually exercise outputs
  })
})
