import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { ModuleRegistry, reactivePathsModule } from '../src/index.js'
import { transformLlui } from '../src/transform.js'

/**
 * v2c/2.3 — proof-of-concept: validate that the visitor registry +
 * `reactive-paths` CompilerModule produce a `__prefixes` array whose
 * paths match what the monolithic `transformLlui` emits today.
 *
 * The POC runs both pipelines on the same source. The module-based
 * pipeline emits an `__prefixes` ArrayLiteralExpression; the monolithic
 * pipeline emits the same field as part of its larger transform. The
 * test parses the monolith's output, extracts its `__prefixes` list,
 * and compares against the POC module's emission.
 *
 * Equality bar: the *set* of paths emitted by both pipelines must
 * match. Ordering differences are documented as intentional — the POC
 * module emits sorted (deterministic regardless of source order); the
 * monolith emits in source-encounter order. The next decomposition push
 * makes the monolith deterministic-sorted to match.
 *
 * What this proves:
 *   - The registry interface is expressive enough to host a real
 *     compiler concern.
 *   - Visitor dispatch + emit are sufficient for at least one
 *     well-understood emission slot.
 *   - The module's output is byte-printable through `ts.createPrinter`
 *     (no synthetic-node issues).
 *
 * What this does NOT prove yet:
 *   - That every monolith concern can fit the registry shape — that's
 *     established by completing the decomposition.
 *   - That the registry's per-statement-diff edit emission works —
 *     this POC compares *expressions*, not edit lists.
 */

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true)
}

function extractMonolithPrefixes(transformedSource: string): string[] {
  // Find `__prefixes: [...]` in the monolith's output, parse the array
  // literal, and pull out each arrow's body path. The monolith emits
  // optional-chained access (`s?.user?.name`) on non-leaf segments
  // for reference-stability under undefined intermediates; the regex
  // normalises both `.` and `?.` separators.
  const match = transformedSource.match(/__prefixes:\s*\[([^\]]*)\]/)
  if (!match) return []
  const body = match[1] ?? ''
  const paths: string[] = []
  const arrowRe = /s\s*=>\s*s\??\.([\w?.]+)/g
  let m: RegExpExecArray | null
  while ((m = arrowRe.exec(body)) !== null) {
    paths.push(m[1]!.replace(/\?\./g, '.'))
  }
  return paths
}

function extractModulePrefixes(sourceFile: ts.SourceFile): string[] {
  const registry = new ModuleRegistry([reactivePathsModule])
  const result = registry.run(sourceFile)
  const prefixes = result.emissions.find((e) => e.field === '__prefixes')
  if (!prefixes) return []
  const value = prefixes.value
  if (!ts.isArrayLiteralExpression(value)) return []
  const paths: string[] = []
  for (const el of value.elements) {
    if (!ts.isArrowFunction(el)) continue
    const body = el.body
    if (!ts.isPropertyAccessExpression(body) && !ts.isIdentifier(body)) continue
    paths.push(printPath(body))
  }
  return paths
}

function printPath(node: ts.Expression): string {
  const parts: string[] = []
  let cur: ts.Expression = node
  while (ts.isPropertyAccessExpression(cur)) {
    parts.unshift(cur.name.text)
    cur = cur.expression
  }
  // Drop the leading `s` identifier.
  return parts.join('.')
}

const FIXTURE_A = `
import { component, div, text } from '@llui/dom'

type State = { count: number; label: string }
type Msg = { type: 'inc' }

export const C = component<State, Msg>({
  name: 'C',
  init: () => [{ count: 0, label: 'x' }, []],
  update: (s, _m) => [s, []],
  view: ({ text }) => [
    div({}, [text((s) => String(s.count))]),
    div({}, [text((s) => s.label)]),
  ],
})
`

const FIXTURE_NESTED = `
import { component, div, text } from '@llui/dom'

type State = { user: { name: string; email: string }; theme: string }
type Msg = { type: 'noop' }

export const C = component<State, Msg>({
  name: 'C',
  init: () => [{ user: { name: '', email: '' }, theme: 'light' }, []],
  update: (s, _m) => [s, []],
  view: ({ text }) => [
    div({}, [text((s) => s.user.name)]),
    div({}, [text((s) => s.user.email)]),
    div({}, [text((s) => s.theme)]),
  ],
})
`

describe('v2c/2.3 POC — reactivePathsModule path-set matches monolith', () => {
  it('produces the same set of paths for a flat state shape', () => {
    const sf = parse(FIXTURE_A)
    const modulePaths = extractModulePrefixes(sf).sort()
    const monoOutput = transformLlui(FIXTURE_A, '/test.ts', false, false)
    expect(monoOutput).not.toBeNull()
    const monoPaths = extractMonolithPrefixes(monoOutput!.output).sort()
    expect(modulePaths).toEqual(monoPaths)
    expect(modulePaths.length).toBeGreaterThan(0)
  })

  it('produces the same set of paths for a nested state shape (depth-2 normalised)', () => {
    const sf = parse(FIXTURE_NESTED)
    const modulePaths = extractModulePrefixes(sf).sort()
    const monoOutput = transformLlui(FIXTURE_NESTED, '/test.ts', false, false)
    expect(monoOutput).not.toBeNull()
    const monoPaths = extractMonolithPrefixes(monoOutput!.output).sort()
    expect(modulePaths).toEqual(monoPaths)
    expect(modulePaths).toContain('user.name')
    expect(modulePaths).toContain('user.email')
    expect(modulePaths).toContain('theme')
  })

  it('emits no contribution when the file has no reactive accessors', () => {
    const sf = parse(`export const x = 1`)
    const registry = new ModuleRegistry([reactivePathsModule])
    const result = registry.run(sf)
    expect(result.emissions.find((e) => e.field === '__prefixes')).toBeUndefined()
  })

  it('emits ArrayLiteralExpression printable via ts.createPrinter', () => {
    const sf = parse(FIXTURE_A)
    const registry = new ModuleRegistry([reactivePathsModule])
    const result = registry.run(sf)
    const prefixes = result.emissions.find((e) => e.field === '__prefixes')
    expect(prefixes).toBeDefined()
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
    const text = printer.printNode(ts.EmitHint.Unspecified, prefixes!.value, sf)
    // Should be a parseable array literal of arrow functions.
    expect(text).toMatch(/^\[s =>/)
    expect(text).toContain('s.count')
    expect(text).toContain('s.label')
  })
})
