import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { HelperBindings } from '../../src/signals/helper-bindings.js'

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
      'const outer = () => div({})', // module `div` -> helper
      'const inner = (div) => div({})', // param `div` shadows -> not a helper
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
