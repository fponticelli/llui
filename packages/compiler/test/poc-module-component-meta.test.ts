import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import {
  ModuleRegistry,
  componentMetaModule,
  type CompilerModule,
  type EmissionContribution,
} from '../src/index.js'

/**
 * v2c/decomp-2 — component-meta module.
 *
 * First per-component-targeted emission in the registry. Validates:
 *   - `__componentMeta` is emitted per `component()` call (not file-global).
 *   - Each emission carries a `target` referencing its own call site.
 *   - Multi-component files produce multiple emissions, each with its
 *     own `file` + `line`.
 *   - The registry's conflict detector permits same-(module, field)
 *     emissions across *different* targets, but rejects duplicates on
 *     the same target.
 */

function parse(source: string, fileName = 'test.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
}

function extractMeta(emission: EmissionContribution): { file: string; line: number } {
  expect(ts.isObjectLiteralExpression(emission.value)).toBe(true)
  const lit = emission.value as ts.ObjectLiteralExpression
  let file = ''
  let line = 0
  for (const prop of lit.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
    if (prop.name.text === 'file' && ts.isStringLiteral(prop.initializer)) {
      file = prop.initializer.text
    } else if (prop.name.text === 'line' && ts.isNumericLiteral(prop.initializer)) {
      line = Number(prop.initializer.text)
    }
  }
  return { file, line }
}

describe('v2c/decomp-2 — componentMetaModule', () => {
  it('emits one __componentMeta per component() call', () => {
    const src = `
      const C = component({ name: 'C' })
      const D = component({ name: 'D' })
    `
    const sf = parse(src, '/page.ts')
    const registry = new ModuleRegistry([componentMetaModule])
    const result = registry.run(sf)
    const metas = result.emissions.filter((e) => e.field === '__componentMeta')
    expect(metas).toHaveLength(2)
  })

  it('carries a target ts.CallExpression on each emission', () => {
    const src = `const C = component({ name: 'C' })`
    const sf = parse(src, '/page.ts')
    const registry = new ModuleRegistry([componentMetaModule])
    const result = registry.run(sf)
    const meta = result.emissions.find((e) => e.field === '__componentMeta')!
    expect(meta.target).toBeDefined()
    expect(ts.isCallExpression(meta.target!)).toBe(true)
    if (ts.isCallExpression(meta.target!)) {
      expect(ts.isIdentifier(meta.target.expression)).toBe(true)
      expect((meta.target.expression as ts.Identifier).text).toBe('component')
    }
  })

  it('records the correct file + line for each call', () => {
    const src = [
      '',
      'const C = component({ name: "C" })',
      '',
      '',
      'const D = component({ name: "D" })',
      '',
    ].join('\n')
    // Lines:        1                2                                3 4 5                                6
    const sf = parse(src, '/page.ts')
    const registry = new ModuleRegistry([componentMetaModule])
    const result = registry.run(sf)
    const metas = result.emissions
      .filter((e) => e.field === '__componentMeta')
      .map(extractMeta)
      .sort((a, b) => a.line - b.line)
    expect(metas).toHaveLength(2)
    expect(metas[0]).toEqual({ file: '/page.ts', line: 2 })
    expect(metas[1]).toEqual({ file: '/page.ts', line: 5 })
  })

  it('emits nothing when no component() call is in the file', () => {
    const src = `const x = 1; foo(); bar({ name: 'bar' })`
    const sf = parse(src)
    const registry = new ModuleRegistry([componentMetaModule])
    const result = registry.run(sf)
    expect(result.emissions.filter((e) => e.field === '__componentMeta')).toHaveLength(0)
  })

  it('rejects two modules contributing __componentMeta to the SAME target', () => {
    const src = `const C = component({ name: 'C' })`
    const sf = parse(src)
    // Build a duplicate of componentMetaModule under a different name —
    // when both run, they target the SAME call expression with the
    // SAME field, which is the conflict the registry catches.
    const duplicate: CompilerModule = {
      ...componentMetaModule,
      name: 'component-meta-dup',
    }
    const registry = new ModuleRegistry([componentMetaModule, duplicate])
    expect(() => registry.run(sf)).toThrow(/module-emission-conflict/)
  })

  it('permits two modules emitting __componentMeta to DIFFERENT targets', () => {
    // Synthetic test: two modules, each targeting a different call.
    // This validates the keyFor(field, target) distinction.
    const src = `const C = component({ name: 'C' })\nconst D = component({ name: 'D' })`
    const sf = parse(src, '/page.ts')

    // The two component() calls.
    let firstCall: ts.CallExpression | undefined
    let secondCall: ts.CallExpression | undefined
    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === 'component'
      ) {
        if (!firstCall) firstCall = n
        else if (!secondCall) secondCall = n
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    expect(firstCall).toBeDefined()
    expect(secondCall).toBeDefined()

    const moduleA: CompilerModule = {
      name: 'meta-a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      emit: () => [
        {
          module: 'meta-a',
          field: '__custom',
          value: ts.factory.createStringLiteral('A'),
          target: firstCall,
        },
      ],
    }
    const moduleB: CompilerModule = {
      name: 'meta-b',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      emit: () => [
        {
          module: 'meta-b',
          field: '__custom',
          value: ts.factory.createStringLiteral('B'),
          target: secondCall,
        },
      ],
    }
    const registry = new ModuleRegistry([moduleA, moduleB])
    const result = registry.run(sf)
    expect(result.emissions.filter((e) => e.field === '__custom')).toHaveLength(2)
  })
})
