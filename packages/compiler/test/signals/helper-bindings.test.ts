import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { HelperBindings, scopeIntroduces } from '../../src/signals/helper-bindings.js'

function parse(src: string): ts.SourceFile {
  return ts.createSourceFile('t.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** Every call-expression callee identifier with the given name, in source order. */
function calleeIdents(sf: ts.SourceFile, name: string): ts.Identifier[] {
  const out: ts.Identifier[] = []
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      out.push(n.expression)
    }
    n.forEachChild(walk)
  }
  walk(sf)
  return out
}

const resolveOnly = (src: string, name: string): (string | null)[] => {
  const sf = parse(src)
  const b = HelperBindings.fromSourceFile(sf)
  return calleeIdents(sf, name).map((id) => b.resolve(id))
}

describe('HelperBindings.resolve', () => {
  it('resolves a plain @llui/dom named import to its own name', () => {
    expect(resolveOnly("import { each } from '@llui/dom'\neach(xs, {})", 'each')).toEqual(['each'])
  })

  it('resolves an aliased import to its ORIGINAL export name (each as loop)', () => {
    expect(resolveOnly("import { each as loop } from '@llui/dom'\nloop(xs, {})", 'loop')).toEqual([
      'each',
    ])
    expect(resolveOnly("import { div as box } from '@llui/dom'\nbox([])", 'box')).toEqual(['div'])
  })

  it('resolves an import from a @llui/dom SUBPATH', () => {
    expect(resolveOnly("import { each } from '@llui/dom/x'\neach(xs, {})", 'each')).toEqual([
      'each',
    ])
  })

  it('returns null for a user function that shadows a helper name at module scope', () => {
    expect(resolveOnly('function text(x) { return x }\ntext("hi")', 'text')).toEqual([null])
  })

  it('returns null for a module-scope const/class/enum of the same name', () => {
    expect(resolveOnly('const each = (x) => x\neach(xs)', 'each')).toEqual([null])
    expect(resolveOnly('class div {}\ndiv()', 'div')).toEqual([null])
  })

  it('returns null for a helper name imported from ANOTHER module', () => {
    expect(resolveOnly("import { text } from './utils.js'\ntext('hi')", 'text')).toEqual([null])
  })

  it('returns null for default and namespace imports', () => {
    expect(resolveOnly("import dom from '@llui/dom'\ndom()", 'dom')).toEqual([null])
    expect(resolveOnly("import * as each from '@llui/dom'\neach()", 'each')).toEqual([null])
  })

  it('falls back to canonical-name recognition when the name is UNBOUND at module scope', () => {
    // A real component file always imports its helpers; the permissive fallback
    // only matters for import-less unit-test snippets, where it must still fire.
    expect(resolveOnly('text("hi")', 'text')).toEqual(['text'])
    expect(resolveOnly('div([])', 'div')).toEqual(['div'])
  })

  it('treats an inner lexical shadow as NOT the helper (per call site)', () => {
    const src = [
      "import { div } from '@llui/dom'",
      'const outer = () => div()', // module `div` -> helper
      'const inner = (div) => div()', // param `div` shadows -> not a helper
    ].join('\n')
    // source order: outer call first, inner (shadowed) call second
    expect(resolveOnly(src, 'div')).toEqual(['div', null])
  })

  it('honors a block-local declaration that shadows a helper name', () => {
    const src = [
      "import { each } from '@llui/dom'",
      'function f() { const each = (x) => x; return each(1) }',
    ].join('\n')
    expect(resolveOnly(src, 'each')).toEqual([null])
  })

  it('empty() is permissive but still shadow-aware', () => {
    const sf = parse('const f = (text) => text("x")')
    const b = HelperBindings.empty()
    // `text` here is the arrow param -> shadowed -> null even under empty bindings
    expect(calleeIdents(sf, 'text').map((id) => b.resolve(id))).toEqual([null])
  })
})

// ── issue #153 — a function/class EXPRESSION binds its OWN name ─────────────
//
// `scopeIntroduces` is the repo's ONE shadowing predicate: every walker that
// carries a NAME through a subtree prunes with it rather than re-deriving
// shadowing, so a case it misses is missed EVERYWHERE at once. It checked a
// function-like node's PARAMETERS only — but a `FunctionExpression`'s own name
// is a binding scoped over its own body (that is exactly how a self-recursive
// function expression calls itself), and so is a `ClassExpression`'s name
// inside the class. Neither was considered, so
// `tagSend(send, ['open'], function send(m?) { send({type:'inner'}) })`
// reported two `tag-send-drift` diagnostics on code that type-checks, and
// `function div() { return div({}, []) }` was linted (and lowered) as the
// `@llui/dom` helper inside its own body.
//
// Pinned here, at the predicate, rather than only through the rule — the fix is
// SHARED with helper recognition (hence lowering) and `collect-signal-deps`'s
// root pruning, and those consumers have their own tests in
// `rules.test.ts` / `transform-component.test.ts` / `collect-signal-deps.test.ts`.
describe('scopeIntroduces — a function/class EXPRESSION binds its own name (#153)', () => {
  const find = <T extends ts.Node>(src: string, pred: (n: ts.Node) => n is T): T => {
    const sf = parse(src)
    let hit: T | undefined
    const walk = (n: ts.Node): void => {
      if (hit === undefined && pred(n)) hit = n
      n.forEachChild(walk)
    }
    walk(sf)
    if (hit === undefined) throw new Error('node not found')
    return hit
  }
  const fnExpr = (src: string): ts.FunctionExpression => find(src, ts.isFunctionExpression)
  const classExpr = (src: string): ts.ClassExpression => find(src, ts.isClassExpression)

  it('a NAMED function expression introduces its own name', () => {
    expect(scopeIntroduces(fnExpr('const f = function send(m) { send(m) }'), 'send')).toBe(true)
  })

  it('an ANONYMOUS function expression introduces nothing but its parameters', () => {
    expect(scopeIntroduces(fnExpr('const f = function (m) { send(m) }'), 'send')).toBe(false)
    expect(scopeIntroduces(fnExpr('const f = function (send) { send(1) }'), 'send')).toBe(true)
  })

  it('a function expression named something ELSE does not shadow the name asked about', () => {
    expect(scopeIntroduces(fnExpr('const f = function handler(m) { send(m) }'), 'send')).toBe(false)
  })

  it('a NAMED class expression introduces its own name', () => {
    expect(scopeIntroduces(classExpr('const K = class send { m() { send(1) } }'), 'send')).toBe(
      true,
    )
  })

  it('an ANONYMOUS class expression introduces nothing', () => {
    expect(scopeIntroduces(classExpr('const K = class { m() { send(1) } }'), 'send')).toBe(false)
  })

  // DELIBERATE NON-CASE: a function/class DECLARATION's name binds in the
  // ENCLOSING scope, not by virtue of the declaration node itself — the `Block`
  // branch (hoisted `function`/`class`) and, at module scope,
  // `HelperBindings.fromSourceFile` already own it. Adding a self-name check
  // there would be redundant, and pinning the asymmetry keeps a later reader
  // from "fixing" a case that is already covered one node up.
  it('a function DECLARATION is still covered by the enclosing BLOCK, not by itself', () => {
    const decl = find('function f() { function send(m) { send(m) } }', ts.isFunctionDeclaration)
    // the inner declaration node itself: parameters only
    const inner = find('{ function send(m) { send(m) } }', ts.isFunctionDeclaration)
    expect(scopeIntroduces(inner, 'send')).toBe(false)
    // …but the block that HOLDS it does introduce the name.
    expect(scopeIntroduces(decl.body as ts.Block, 'send')).toBe(true)
  })
})

describe('HelperBindings.resolve — the #153 fix is lowering-visible', () => {
  it('a named function expression is NOT the helper inside its own body', () => {
    // Inside `function div(…)`, `div` is the function expression itself. Calling
    // it there is a recursive self-call, not a framework helper call — and
    // treating it as one lints (and lowers) a user's own function.
    const src = ["import { div } from '@llui/dom'", 'const row = function div() { return div() }']
    expect(resolveOnly(src.join('\n'), 'div')).toEqual([null])
  })

  it('a named class expression is NOT the helper inside its own body', () => {
    const src = ["import { div } from '@llui/dom'", 'const K = class div { m() { return div() } }']
    expect(resolveOnly(src.join('\n'), 'div')).toEqual([null])
  })

  it('an ANONYMOUS function expression still sees the helper (control)', () => {
    const src = ["import { div } from '@llui/dom'", 'const row = function () { return div() }']
    expect(resolveOnly(src.join('\n'), 'div')).toEqual(['div'])
  })

  it('a function expression named X does not hide a DIFFERENT helper (control)', () => {
    const src = ["import { div } from '@llui/dom'", 'const row = function text() { return div() }']
    expect(resolveOnly(src.join('\n'), 'div')).toEqual(['div'])
  })
})
