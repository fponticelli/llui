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

describe('ModuleRegistry — transformCall hook (Phase 2b)', () => {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

  it('dispatches transformCall once per CallExpression', () => {
    const seen: string[] = []
    const moduleA: CompilerModule = {
      name: 'a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: (_ctx, node) => {
        seen.push(ts.isIdentifier(node.expression) ? node.expression.text : '?')
        return null
      },
    }
    const registry = new ModuleRegistry([moduleA])
    registry.run(parse(`foo(); bar(baz()); qux()`))
    expect(seen.sort()).toEqual(['bar', 'baz', 'foo', 'qux'])
  })

  it('returning null leaves the node unchanged', () => {
    const noop: CompilerModule = {
      name: 'noop',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: () => null,
    }
    const registry = new ModuleRegistry([noop])
    const sf = parse(`foo(42)`)
    const result = registry.run(sf)
    const out = printer.printFile(result.analysis.sourceFile)
    expect(out.trim()).toBe(`foo(42);`)
  })

  it('returning a new node replaces the call', () => {
    // Module that rewrites foo(...) → foo(...) with an injected trailing arg `1`.
    const argInjector: CompilerModule = {
      name: 'arg-injector',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'foo') return null
        return ctx.factory.createCallExpression(node.expression, node.typeArguments, [
          ...node.arguments,
          ctx.factory.createNumericLiteral(1),
        ])
      },
    }
    const registry = new ModuleRegistry([argInjector])
    const result = registry.run(parse(`foo(42)`))
    const out = printer.printFile(result.analysis.sourceFile)
    expect(out.trim()).toBe(`foo(42, 1);`)
  })

  it('chains transformCall across modules in declaration order', () => {
    // Module A: foo → bar. Module B: bar → baz. Composition order: A then B.
    const renameFooBar: CompilerModule = {
      name: 'rename-foo-bar',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'foo') return null
        return ctx.factory.createCallExpression(
          ctx.factory.createIdentifier('bar'),
          node.typeArguments,
          node.arguments,
        )
      },
    }
    const renameBarBaz: CompilerModule = {
      name: 'rename-bar-baz',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'bar') return null
        return ctx.factory.createCallExpression(
          ctx.factory.createIdentifier('baz'),
          node.typeArguments,
          node.arguments,
        )
      },
    }
    const registry = new ModuleRegistry([renameFooBar, renameBarBaz])
    const result = registry.run(parse(`foo()`))
    const out = printer.printFile(result.analysis.sourceFile)
    expect(out.trim()).toBe(`baz();`)
  })

  it('reverses chain composition when modules declared in reverse order', () => {
    // With renameBarBaz first, then renameFooBar: bar→baz fires before foo→bar,
    // so foo() stays bar() at the end of A's pass and B doesn't match.
    const renameFooBar: CompilerModule = {
      name: 'rename-foo-bar',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'foo') return null
        return ctx.factory.createCallExpression(
          ctx.factory.createIdentifier('bar'),
          node.typeArguments,
          node.arguments,
        )
      },
    }
    const renameBarBaz: CompilerModule = {
      name: 'rename-bar-baz',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'bar') return null
        return ctx.factory.createCallExpression(
          ctx.factory.createIdentifier('baz'),
          node.typeArguments,
          node.arguments,
        )
      },
    }
    const registry = new ModuleRegistry([renameBarBaz, renameFooBar])
    const result = registry.run(parse(`foo()`))
    const out = printer.printFile(result.analysis.sourceFile)
    expect(out.trim()).toBe(`bar();`)
  })

  it('reads visitor-phase findings via analysis.perModule', () => {
    // Module records all foo() call sites in its slot during visit,
    // then rewrites only those sites during transformCall. Demonstrates
    // the analyze-then-rewrite split.
    const annotator: CompilerModule = {
      name: 'annotator',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: (ctx, n) => {
          const call = n as ts.CallExpression
          if (ts.isIdentifier(call.expression) && call.expression.text === 'foo') {
            const slot = ctx.getSlot('annotator', () => ({ count: 0 }))
            slot.count++
          }
        },
      },
      transformCall: (ctx, node) => {
        const slot = ctx.analysis.perModule.get('annotator') as { count: number } | undefined
        if (!slot || slot.count === 0) return null
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'foo') return null
        // Append a numeric literal arg equal to slot.count for every foo() call.
        return ctx.factory.createCallExpression(node.expression, node.typeArguments, [
          ...node.arguments,
          ctx.factory.createNumericLiteral(slot.count),
        ])
      },
    }
    const registry = new ModuleRegistry([annotator])
    const result = registry.run(parse(`foo(); foo()`))
    const out = printer.printFile(result.analysis.sourceFile).replace(/\s+/g, ' ').trim()
    expect(out).toBe(`foo(2); foo(2);`)
  })

  it('phase is skipped (zero cost) when no module declares transformCall', () => {
    const visitorOnly: CompilerModule = {
      name: 'visitor-only',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.CallExpression]: () => {},
      },
    }
    const registry = new ModuleRegistry([visitorOnly])
    const sf = parse(`foo()`)
    const result = registry.run(sf)
    // Without any transformCall, the analysis.sourceFile reference is
    // unchanged from input (no `ts.visitNode` walk).
    expect(result.analysis.sourceFile).toBe(sf)
  })
})

describe('ModuleRegistry — transformCallEnter (top-down)', () => {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })

  it('fires top-down before children are recursed', () => {
    // Module renames `outer(...)` → `OUTER(...)` via enter. Then a
    // second exit-only module renames any `inner(...)` to `INNER(...)`.
    // The exit module sees `inner()` as a child of the renamed `OUTER`
    // — proving enter fired first AND recursion happened after.
    const visitedCallees: string[] = []
    const renameOuterEnter: CompilerModule = {
      name: 'rename-outer-enter',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCallEnter: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'outer') return null
        return ctx.factory.createCallExpression(
          ctx.factory.createIdentifier('OUTER'),
          node.typeArguments,
          node.arguments,
        )
      },
    }
    const renameInnerExit: CompilerModule = {
      name: 'rename-inner-exit',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: (ctx, node) => {
        if (!ts.isIdentifier(node.expression)) return null
        visitedCallees.push(node.expression.text)
        if (node.expression.text !== 'inner') return null
        return ctx.factory.createCallExpression(
          ctx.factory.createIdentifier('INNER'),
          node.typeArguments,
          node.arguments,
        )
      },
    }
    const registry = new ModuleRegistry([renameOuterEnter, renameInnerExit])
    const result = registry.run(parse(`outer(inner())`))
    const out = printer.printFile(result.analysis.sourceFile)
    expect(out.trim()).toBe(`OUTER(INNER());`)
    // Exit observation order is bottom-up: child (inner) fires before parent.
    // After enter rename, the parent's callee is OUTER.
    expect(visitedCallees).toEqual(['inner', 'OUTER'])
  })

  it('enter chain composes in declaration order before recursion', () => {
    const order: string[] = []
    const enterA: CompilerModule = {
      name: 'enter-a',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCallEnter: (_ctx, node) => {
        order.push('enter-a')
        return node
      },
    }
    const enterB: CompilerModule = {
      name: 'enter-b',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCallEnter: (_ctx, node) => {
        order.push('enter-b')
        return node
      },
    }
    const exitC: CompilerModule = {
      name: 'exit-c',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCall: (_ctx, node) => {
        order.push('exit-c')
        return node
      },
    }
    const registry = new ModuleRegistry([enterA, enterB, exitC])
    registry.run(parse(`foo()`))
    // Single call: enter-a, enter-b (declaration order, top-down),
    // then exit-c (bottom-up). No interleaving.
    expect(order).toEqual(['enter-a', 'enter-b', 'exit-c'])
  })

  it('children of an enter-rewritten node are recursed under the new shape', () => {
    // Enter wraps each `foo(x)` → `foo(x, 1)`. The added literal `1`
    // is a child of the new call — a separate visitor that counts
    // NumericLiterals via a transformCall (exit, returning original)
    // proves the recursion saw the synthesized child.
    const numCounts: number[] = []
    const wrapper: CompilerModule = {
      name: 'wrapper',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCallEnter: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'foo') return null
        return ctx.factory.createCallExpression(node.expression, node.typeArguments, [
          ...node.arguments,
          ctx.factory.createNumericLiteral(1),
        ])
      },
    }
    const numericCounter: CompilerModule = {
      name: 'numeric-counter',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {
        [ts.SyntaxKind.NumericLiteral]: (_ctx, _n) => {
          /* visitor doesn't see post-enter nodes */
        },
      },
      // The exit hook fires on each CallExpression after children
      // are recursed. The wrapper added a numeric child; the visit
      // function walked it before this exit fires.
      transformCall: (_ctx, node) => {
        let count = 0
        const walk = (n: ts.Node): void => {
          if (ts.isNumericLiteral(n)) count++
          ts.forEachChild(n, walk)
        }
        ts.forEachChild(node, walk)
        numCounts.push(count)
        return null
      },
    }
    const registry = new ModuleRegistry([wrapper, numericCounter])
    registry.run(parse(`foo(); foo(42)`))
    // For `foo()`: enter wraps it to `foo(1)`. Exit sees 1 numeric child.
    // For `foo(42)`: enter wraps it to `foo(42, 1)`. Exit sees 2 numeric children.
    expect(numCounts).toEqual([1, 2])
  })

  it('a module may declare both enter and transformCall on the same call', () => {
    // Enter adds arg `1`; exit adds arg `2`. Result has both — and the
    // enter-added child is recursed but doesn't fire enter again
    // (enter only fires once per node).
    const dualModule: CompilerModule = {
      name: 'dual',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: {},
      transformCallEnter: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'foo') return null
        return ctx.factory.createCallExpression(node.expression, node.typeArguments, [
          ...node.arguments,
          ctx.factory.createNumericLiteral(1),
        ])
      },
      transformCall: (ctx, node) => {
        if (!ts.isIdentifier(node.expression) || node.expression.text !== 'foo') return null
        return ctx.factory.createCallExpression(node.expression, node.typeArguments, [
          ...node.arguments,
          ctx.factory.createNumericLiteral(2),
        ])
      },
    }
    const registry = new ModuleRegistry([dualModule])
    const result = registry.run(parse(`foo()`))
    const out = printer.printFile(result.analysis.sourceFile)
    expect(out.trim()).toBe(`foo(1, 2);`)
  })

  it('phase still skipped when only visitors declared (no enter, no exit)', () => {
    const visitorOnly: CompilerModule = {
      name: 'visitor-only',
      compilerVersion: '^0.3.0',
      diagnostics: [],
      visitors: { [ts.SyntaxKind.CallExpression]: () => {} },
    }
    const registry = new ModuleRegistry([visitorOnly])
    const sf = parse(`foo()`)
    const result = registry.run(sf)
    expect(result.analysis.sourceFile).toBe(sf)
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
