import { describe, it, expect } from 'vitest'
import { transformSignalComponentSource } from '../parsed.js'

// #244 — `each`'s DIRECT tier stringified a `Signal` handle that arrives as a
// BARE IDENTIFIER.
//
// The direct tier builds the row imperatively: a cloned skeleton plus
// `applyAttr(node, name, <expr>)` / `node.data = String(<expr>)` for every slot
// it decided was STATIC. "Static" was defined as "not recognized as a signal
// EXPRESSION" — and recognition is by import provenance (#238), which reads the
// factory CALL in the expression (`derived(…)`, `constant(…)`, a `state.at(…)`
// chain). A handle that arrives as a plain identifier names no call at all, so
// it fell into the static bucket and the row emitted, verbatim:
//
//   applyAttr(_r0, "data-unit", unit)     ->  <li data-unit="[object Object]">
//   _c2.data = String(unit)               ->  "[object Object]"
//
// with a clean build, a clean type-check and no diagnostic. Both ways the
// identifier can be bound reach it — a view-helper PARAMETER and a module-scope
// `const` CAPTURED by the row — and handing signal handles to plain view-helper
// functions is the composition pattern CLAUDE.md recommends, so this is the
// idiomatic shape rather than a corner case. There was a live in-repo instance
// at `packages/dom/test/signals/structured-dep-paths.test.ts`.
//
// The string-edit transform has no `ts.Program`/checker, so "is this
// identifier's declared type a `Signal`" is not a question it can ask. The fix
// is the conservative direction the repo's standing rule prescribes: a static
// text/attr slot (or a row local feeding one) that reads a FREE identifier the
// row factory did not introduce, and that is not provably a plain value,
// DECLINES the direct tier and lowers as an ARM — where `el`/`text` consume the
// handle correctly. Erring toward the arm costs an optimization; the previous
// behaviour cost a silently wrong render.

const HEAD = [
  "import { each, li, span, text, constant } from '@llui/dom'",
  "import type { Renderable, Signal } from '@llui/dom'",
].join('\n')

describe('#244 — a Signal arriving as a bare identifier must not reach a static row slot', () => {
  // Binding form 1: a view-HELPER PARAMETER. This is the shape CLAUDE.md's
  // Composition section recommends (`header(state.at('header'), send)`).
  const PARAM = `${HEAD}
export function rows(items: Signal<string[]>, unit: Signal<string>): Renderable {
  return [
    each(items, {
      key: (it: string) => it,
      render: (item) => [li({ 'data-unit': unit }, [text(item), text(unit)])],
    }),
  ]
}
`

  // Binding form 2: a module-scope `const` CAPTURED by the row. This is exactly
  // how a reused constant is written, and the reason provenance cannot see it:
  // the `.peek()`/slot expression is a bare identifier with no factory call.
  const CAPTURED = `${HEAD}
const unit = constant('mmol/L')
export function rows(items: Signal<string[]>): Renderable {
  return [
    each(items, {
      key: (it: string) => it,
      render: (item) => [li({ 'data-unit': unit }, [text(item), text(unit)])],
    }),
  ]
}
`

  for (const [label, src] of [
    ['a view-helper parameter', PARAM],
    ['a captured module-scope const', CAPTURED],
  ] as const) {
    it(`never stringifies the handle — ${label}`, () => {
      const out = transformSignalComponentSource(src, { fileName: 'rows.tsx' })
      expect(out).not.toContain('String(unit)')
      expect(out).not.toMatch(/applyAttr\([^)]*,\s*unit\)/)
    })

    it(`hands it to helpers that CONSUME a handle, in both slot kinds — ${label}`, () => {
      const out = transformSignalComponentSource(src, { fileName: 'rows.tsx' })
      expect(out).toContain('text(unit)')
      expect(out).toContain("'data-unit': unit")
      // The row drops ONE tier; it does not fall back to the uncompiled
      // authoring `each`.
      expect(out).toContain('eachArm(')
      expect(out).not.toContain('eachDirect(')
    })

    it(`reports the tier drop through the bail channel — ${label}`, () => {
      const bails: { kind: string; reason: string }[] = []
      transformSignalComponentSource(src, {
        fileName: 'rows.tsx',
        onLowerBail: (b) => bails.push({ kind: b.kind, reason: b.reason }),
      })
      expect(bails).toContainEqual({ kind: 'each-direct', reason: 'row-slot-free-identifier:unit' })
    })
  }

  // A ROW LOCAL is the third way the handle reaches a slot, and the one a
  // slot-only guard misses: `const u = unit` makes `u` a name the factory DID
  // introduce, so the text slot below sees a known identifier and the taint
  // would launder through. The row-local initializer is checked with the same
  // predicate, so the row bails before `u` is ever admitted.
  it('bails when a row LOCAL aliases the captured handle (taint does not launder)', () => {
    const src = `${HEAD}
const unit = constant('mmol/L')
export function rows(items: Signal<string[]>): Renderable {
  return [
    each(items, {
      key: (it: string) => it,
      render: (item) => {
        const u = unit
        return [li([text(item), text(u)])]
      },
    }),
  ]
}
`
    const bails: { kind: string; reason: string }[] = []
    const out = transformSignalComponentSource(src, {
      fileName: 'rows.tsx',
      onLowerBail: (b) => bails.push({ kind: b.kind, reason: b.reason }),
    })
    expect(out).not.toContain('String(u)')
    expect(out).not.toContain('eachDirect(')
    expect(bails).toContainEqual({ kind: 'each-direct', reason: 'row-slot-free-identifier:unit' })
  })

  // The COMPONENT-view each goes through the same `lowerRowFactory`, so the
  // defect and the fix are one, not two. Pinned separately because the two
  // tiers emit different helpers (`signalEachDirect` vs `eachDirect`) and a
  // guard placed in `lowerHelperEach` rather than in the shared factory would
  // pass the tests above and leave this one wrong.
  it('covers the COMPONENT-view direct tier too (one shared row factory)', () => {
    const src = `
import { component, li, text, each, constant } from '@llui/dom'
interface S { rows: { id: string }[] }
type M = { type: 'noop' }
const unit = constant('mmol/L')
export const App = component<S, M>({
  name: 'App',
  init: () => ({ rows: [] }),
  update: (s: S) => s,
  view: ({ state }) => [
    each(state.at('rows'), {
      key: (r: { id: string }) => r.id,
      render: (row) => [li([text(row.at('id')), text(unit)])],
    }),
  ],
})
`
    const out = transformSignalComponentSource(src, { fileName: 'App.tsx' })
    expect(out).not.toContain('String(unit)')
    expect(out).not.toContain('signalEachDirect(')
  })
})

// The other direction. Bailing costs the list hot path, so the predicate has to
// stay off the shapes a static row slot legitimately reads. Each of these is a
// name the row factory either introduced itself or can prove is not a handle.
describe('#244 — the direct tier must SURVIVE a static slot that reads no opaque name', () => {
  const direct = (src: string): string =>
    transformSignalComponentSource(src, { fileName: 'rows.tsx' })

  it('keeps the tier for a row LOCAL computed from the row itself', () => {
    const out = direct(`${HEAD}
export function rows(items: Signal<{ type: string }[]>): Renderable {
  return [
    each(items, {
      key: (it: { type: string }) => it.type,
      render: (item) => {
        const isDir = item.peek().type === 'dir'
        return [li([text(isDir ? 'D' : 'F')])]
      },
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
    expect(out).not.toContain('eachArm(')
  })

  // The CALLEE subtree of a call is exempt: what reaches the slot is the
  // RETURN, not the callee. That covers both `fmt(x)` (an imported/declared
  // helper the file cannot prove plain) and `unit.peek()` — the sanctioned
  // one-shot read the perf hint itself recommends.
  it('keeps the tier for a call whose callee the file cannot prove plain', () => {
    const out = direct(`${HEAD}
import { fmt } from './fmt'
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li([text(fmt(item.peek().n))])],
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
  })

  it('keeps the tier for `.peek()` on a captured handle (the sanctioned read)', () => {
    const out = direct(`${HEAD}
const unit = constant('mmol/L')
export function rows(items: Signal<string[]>): Renderable {
  return [
    each(items, {
      key: (it: string) => it,
      render: (item) => [li({ 'data-unit': unit.peek() }, [text(item)])],
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
    expect(out).toContain('unit.peek()')
  })

  it('keeps the tier for an ambient global read as a VALUE', () => {
    const out = direct(`${HEAD}
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li({ 'data-p': Math.PI }, [text(item.peek().n)])],
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
  })

  it('keeps the tier for a module-scope const with a PROVABLY plain initializer', () => {
    const out = direct(`${HEAD}
const SEP = ' · '
const CLASSES = { row: 'row' }
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li({ class: CLASSES.row }, [text(item.peek().n + SEP)])],
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
  })

  it('keeps the tier for a name bound INSIDE the slot expression', () => {
    const out = direct(`${HEAD}
export function rows(items: Signal<{ tags: string[] }[]>): Renderable {
  return [
    each(items, {
      key: (it: { tags: string[] }) => it.tags[0] ?? '',
      render: (item) => [li([text(item.peek().tags.map((t: string) => t).join(','))])],
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
  })

  // An EVENT HANDLER legitimately closes over a signal handle (`onClick: () =>
  // send({ type: 'x', v: unit.peek() })`), and the emitted factory stays
  // lexically where the `each` was, so the free name still resolves. The guard
  // is scoped to the STATIC value slots — widening it to handlers would drop
  // the tier for every row that dispatches.
  it('keeps the tier when the free handle is read only from an event handler', () => {
    const out = direct(`${HEAD}
const unit = constant('mmol/L')
export function rows(items: Signal<string[]>): Renderable {
  return [
    each(items, {
      key: (it: string) => it,
      render: (item) => [
        li({ onClick: () => console.log(unit.peek(), item.peek()) }, [text(item)]),
      ],
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
    expect(out).not.toContain('eachArm(')
  })

  // A module-scope const whose initializer is a CALL is not provably plain —
  // `constant('x')` and `formatUnit()` are indistinguishable without a checker
  // — so the tier drops. That is the accepted cost, pinned so the trade is
  // visible rather than discovered.
  it('drops the tier for a module const initialized by a CALL (the accepted cost)', () => {
    const out = direct(`${HEAD}
const SEP = ' · '.trim()
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li([text(item.peek().n + SEP)])],
    }),
  ]
}
`)
    expect(out).not.toContain('eachDirect(')
    expect(out).toContain('eachArm(')
  })

  // The literal-only version of "provably plain" missed three shapes that are
  // trivially provable and cost a real tier — every operator below yields
  // either a primitive or ONE of its operands, so two plain operands make a
  // plain result. `const STYLE_ROW = '…' + '…'` is a live in-repo row style
  // (`packages/devmode-annotate/src/browse-view.ts`), which is how these were
  // found.
  it('keeps the tier for a `+` of two plain operands (the live STYLE_ROW shape)', () => {
    const out = direct(`${HEAD}
const STYLE_ROW = 'border: 1px solid red;' + ' padding: 6px 8px;'
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li({ 'data-s': STYLE_ROW }, [text(item.peek().n)])],
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
  })

  it('keeps the tier for a negated numeric literal and for a const aliasing a const', () => {
    const out = direct(`${HEAD}
const N = -1
const A = 'a'
const B = A
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li({ 'data-n': N, 'data-b': B }, [text(item.peek().n)])],
    }),
  ]
}
`)
    expect(out).toContain('eachDirect(')
  })

  // The alias chain needs a cycle guard: a pair of mutually-referring consts
  // proves nothing and must not recurse forever.
  it('fails closed (and terminates) on a reference cycle between two consts', () => {
    const out = direct(`${HEAD}
const A = B
const B = A
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li({ 'data-a': A }, [text(item.peek().n)])],
    }),
  ]
}
`)
    expect(out).not.toContain('eachDirect(')
    expect(out).toContain('eachArm(')
  })

  // A `let` is refused for the reason `imperative-dom-mutation` refuses one: it
  // can be reassigned between the declaration and the read, and a syntax-only
  // analysis cannot see that.
  it('drops the tier for a `let` bound to a literal', () => {
    const out = direct(`${HEAD}
let SEP = ' · '
export function retarget(v: string): void {
  SEP = v
}
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li([text(item.peek().n + SEP)])],
    }),
  ]
}
`)
    expect(out).not.toContain('eachDirect(')
  })

  // A name declared TWICE in the file cannot be resolved without scope
  // analysis, so the plain-value proof fails closed even when both
  // declarations are literals.
  it('fails closed on a name the file declares more than once', () => {
    const out = direct(`${HEAD}
const SEP = ' · '
export function other(): string {
  const SEP = ' , '
  return SEP
}
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li([text(item.peek().n + SEP)])],
    }),
  ]
}
`)
    expect(out).not.toContain('eachDirect(')
  })

  // The ambient-global allowance is only sound while the module has not
  // rebound the name, so a file-level declaration of `Math` withdraws it —
  // otherwise `const Math = someSignals` would be trusted on its spelling, which
  // is the very thing #238 removed from signal recognition.
  it('withdraws the ambient-global allowance for a name the module declares', () => {
    const out = direct(`${HEAD}
const Math = { PI: constant(3) }
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li({ 'data-p': Math.PI }, [text(item.peek().n)])],
    }),
  ]
}
`)
    expect(out).not.toContain('eachDirect(')
  })

  // The trust-withdrawal set is the UNSAFE direction of this predicate: a name
  // it misses keeps the ambient-global allowance and miscompiles. It was a
  // hand-enumerated list of node kinds and had already lost two of them —
  // `namespace Math { … }` and `import Math = require(…)` both rebind `Math` at
  // module scope, were not counted, and emitted `applyAttr(_r0, "data-p",
  // Math.PI)` while the `const Math` case above passed beside them. It is now a
  // structural test on the generic `.name` slot, so every declaration kind is
  // covered at once; these two are the regression pins for the kinds the list
  // forgot, not an exhaustive enumeration of a new list.
  const shadowedGlobalRow = (decl: string): string =>
    direct(`${HEAD}
${decl}
export function rows(items: Signal<{ n: number }[]>): Renderable {
  return [
    each(items, {
      key: (it: { n: number }) => String(it.n),
      render: (item) => [li({ 'data-p': Math.PI }, [text(item.peek().n)])],
    }),
  ]
}
`)

  it('withdraws the allowance for a name a NAMESPACE declaration rebinds', () => {
    const out = shadowedGlobalRow('namespace Math { export const PI = constant(3) }')
    expect(out).not.toContain('eachDirect(')
    expect(out).not.toMatch(/applyAttr\([^)]*Math\.PI\)/)
    // Positive half: the row was still ANALYSED and merely dropped a tier — a
    // bare `not.toContain` would also pass if the fixture stopped compiling.
    expect(out).toContain('eachArm(')
  })

  it('withdraws the allowance for a name an `import =` rebinds', () => {
    const out = shadowedGlobalRow("import Math = require('./m')")
    expect(out).not.toContain('eachDirect(')
    expect(out).not.toMatch(/applyAttr\([^)]*Math\.PI\)/)
    expect(out).toContain('eachArm(')
  })

  // A free identifier in an OBJECT position of a property read is checked too,
  // because the property it names can itself be a handle — which is how a
  // `connect()` part bag is shaped. The `Math.PI` case above passes only because
  // the global allowance answers for `Math`.
  it('bails on a property read off an opaque object (a part-bag-shaped source)', () => {
    const out = direct(`${HEAD}
export function rows(items: Signal<string[]>, parts: { unit: Signal<string> }): Renderable {
  return [
    each(items, {
      key: (it: string) => it,
      render: (item) => [li({ 'data-unit': parts.unit }, [text(item)])],
    }),
  ]
}
`)
    expect(out).not.toContain('eachDirect(')
    expect(out).not.toMatch(/applyAttr\([^)]*parts\.unit\)/)
  })
})
