import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { ModuleRegistry, type CompilerModule, type EmissionContribution } from '../src/module.js'

/**
 * v2c §2 — visitor registry primitive.
 *
 * Covers:
 *   - Visitor ordering follows module declaration order.
 *   - A single AST walk dispatches each node to every matching module
 *     (cost is O(nodes), not O(modules × nodes)).
 *   - Per-module slot accumulators isolate findings.
 *   - Emission conflict detection (`llui/module-emission-conflict`).
 *   - Dependency verification (missing dep → hard error).
 *   - `runtimeImports` union with dedup.
 */

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true)
}

describe('ModuleRegistry — single-pass dispatch', () => {
  it('walks each AST node once and dispatches to every matching module', () => {
    const seenA: ts.SyntaxKind[] = []
    const seenB: ts.SyntaxKind[] = []
    const moduleA: CompilerModule = {
      name: 'a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: (_, n) => seenA.push(n.kind),
      },
    }
    const moduleB: CompilerModule = {
      name: 'b',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: (_, n) => seenB.push(n.kind),
      },
    }
    const registry = new ModuleRegistry([moduleA, moduleB])
    const sf = parse(`foo(); bar(baz()); qux()`)
    registry.run(sf)
    // 4 call expressions: foo, bar, baz, qux.
    expect(seenA.length).toBe(4)
    expect(seenB.length).toBe(4)
  })

  it('dispatches to modules in declaration order', () => {
    const order: string[] = []
    const moduleA: CompilerModule = {
      name: 'a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: () => order.push('a'),
      },
    }
    const moduleB: CompilerModule = {
      name: 'b',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: () => order.push('b'),
      },
    }
    const moduleC: CompilerModule = {
      name: 'c',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: () => order.push('c'),
      },
    }
    const registry = new ModuleRegistry([moduleC, moduleA, moduleB])
    registry.run(parse(`foo()`))
    expect(order).toEqual(['c', 'a', 'b'])
  })

  it('skips dispatch entirely when no module registered for a node kind', () => {
    let seen = 0
    const moduleA: CompilerModule = {
      name: 'a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        // Registered for ArrowFunction only.
        [ts.SyntaxKind.ArrowFunction]: () => seen++,
      },
    }
    const registry = new ModuleRegistry([moduleA])
    // No arrow functions in this source — module should fire zero times.
    registry.run(parse(`function foo() { return 1 }`))
    expect(seen).toBe(0)
  })
})

describe('ModuleRegistry — per-module slot accumulators', () => {
  it('isolates each module’s findings under its own slot key', () => {
    const moduleA: CompilerModule = {
      name: 'a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: (ctx) => {
          const slot = ctx.getSlot('a', () => ({ calls: 0 })) as { calls: number }
          slot.calls++
        },
      },
    }
    const moduleB: CompilerModule = {
      name: 'b',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: (ctx) => {
          const slot = ctx.getSlot('b', () => ({ calls: 0 })) as { calls: number }
          slot.calls++
        },
      },
    }
    const registry = new ModuleRegistry([moduleA, moduleB])
    const result = registry.run(parse(`foo(); bar()`))
    expect(result.analysis.perModule.get('a')).toEqual({ calls: 2 })
    expect(result.analysis.perModule.get('b')).toEqual({ calls: 2 })
  })
})

describe('ModuleRegistry — emission conflict detection', () => {
  it('throws when two modules contribute to the same field', () => {
    const make = (name: string, field: string): CompilerModule => ({
      name,
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      emit: (ctx): EmissionContribution[] => [
        { module: name, field, value: ctx.factory.createNumericLiteral(1) },
      ],
    })
    const registry = new ModuleRegistry([make('a', '__x'), make('b', '__x')])
    expect(() => registry.run(parse(``))).toThrow(/module-emission-conflict/)
  })

  it('allows distinct fields from different modules', () => {
    const moduleA: CompilerModule = {
      name: 'a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      emit: (ctx) => [{ module: 'a', field: '__a', value: ctx.factory.createNumericLiteral(1) }],
    }
    const moduleB: CompilerModule = {
      name: 'b',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      emit: (ctx) => [{ module: 'b', field: '__b', value: ctx.factory.createNumericLiteral(2) }],
    }
    const registry = new ModuleRegistry([moduleA, moduleB])
    const result = registry.run(parse(``))
    expect(result.emissions.map((e) => e.field).sort()).toEqual(['__a', '__b'])
  })
})

describe('ModuleRegistry — dependency verification', () => {
  it('throws when a module declares an absent dependency', () => {
    const moduleA: CompilerModule = {
      name: 'agent',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      dependsOn: ['core'],
      visitors: {},
    }
    expect(() => new ModuleRegistry([moduleA])).toThrow(/depends on "core"/)
  })

  it('accepts a module with a satisfied dependency', () => {
    const core: CompilerModule = {
      name: 'core',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
    }
    const agent: CompilerModule = {
      name: 'agent',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      dependsOn: ['core'],
      visitors: {},
    }
    expect(() => new ModuleRegistry([core, agent])).not.toThrow()
  })
})

describe('ModuleRegistry — runtimeImports merge', () => {
  it('unions imports across modules with dedup + stable sort', () => {
    const moduleA: CompilerModule = {
      name: 'a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      runtimeImports: ['elSplit', '__runPhase2'],
    }
    const moduleB: CompilerModule = {
      name: 'b',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      runtimeImports: ['__runPhase2', 'memo'],
    }
    const registry = new ModuleRegistry([moduleA, moduleB])
    const result = registry.run(parse(``))
    expect(result.runtimeImports).toEqual(['__runPhase2', 'elSplit', 'memo'])
  })
})

describe('ModuleRegistry — diagnostic reporting', () => {
  it('collects diagnostics into the analysis output', () => {
    const moduleA: CompilerModule = {
      name: 'a',
      compilerVersion: '^0.3.0',
      diagnostics: [{ id: 'llui/test-diag', description: 'test diagnostic' }],
      visitors: {
        [ts.SyntaxKind.CallExpression]: (ctx, node) => {
          ctx.reportDiagnostic({
            id: 'llui/test-diag',
            severity: 'warning',
            category: 'reactivity',
            message: 'test',
            location: {
              file: 'test.ts',
              range: {
                start: { line: 0, column: 0 },
                end: { line: 0, column: node.getText().length },
              },
            },
          })
        },
      },
    }
    const registry = new ModuleRegistry([moduleA])
    const result = registry.run(parse(`foo(); bar()`))
    expect(result.analysis.diagnostics).toHaveLength(2)
    expect(result.analysis.diagnostics[0]!.id).toBe('llui/test-diag')
  })
})

describe('ModuleRegistry — introspection', () => {
  it('listModules returns names in declaration order', () => {
    const registry = new ModuleRegistry([
      {
        name: 'core',
        compilerVersion: '^0.3.0',
        diagnostics: [],
        visitors: {},
      },
      {
        name: 'agent',
        compilerVersion: '^0.3.0',
        diagnostics: [],
        visitors: {},
      },
    ])
    expect(registry.listModules()).toEqual(['core', 'agent'])
  })

  it('listDiagnostics concatenates all modules’ diagnostic definitions', () => {
    const registry = new ModuleRegistry([
      {
        name: 'core',
        compilerVersion: '^0.3.0',
        diagnostics: [{ id: 'llui/core-a', description: 'A' }],
        visitors: {},
      },
      {
        name: 'agent',
        compilerVersion: '^0.3.0',
        diagnostics: [
          { id: 'llui/agent-a', description: 'A' },
          { id: 'llui/agent-b', description: 'B' },
        ],
        visitors: {},
      },
    ])
    expect(registry.listDiagnostics().map((d) => d.id)).toEqual([
      'llui/core-a',
      'llui/agent-a',
      'llui/agent-b',
    ])
  })
})
