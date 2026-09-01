import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = resolve(import.meta.dirname, '..')
const SOURCE_PATH = resolve(PACKAGE_ROOT, 'src/presentation-scenarios.ts')

function runtimeModuleSpecifiers(source: string): string[] {
  const emitted = ts.transpileModule(source, {
    fileName: SOURCE_PATH,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText
  const sourceFile = ts.createSourceFile(
    'presentation-scenarios.js',
    emitted,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  )
  const specifiers: string[] = []

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const [specifier] = node.arguments
      specifiers.push(
        specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : '<dynamic>',
      )
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

describe('@llui/cli/presentation-scenarios package boundary', () => {
  it('publishes only a direct browser-safe subpath', () => {
    const packageJson = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./presentation-scenarios']).toEqual({
      types: './dist/presentation-scenarios.d.ts',
      import: './dist/presentation-scenarios.js',
    })
  })

  it('emits no runtime imports and type-checks without DOM libraries', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8')
    expect(runtimeModuleSpecifiers(source)).toEqual([])

    const program = ts.createProgram({
      rootNames: [SOURCE_PATH],
      options: {
        lib: ['lib.es2022.d.ts'],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
        verbatimModuleSyntax: true,
      },
    })
    const sourceFile = program.getSourceFile(SOURCE_PATH)
    expect(sourceFile).toBeDefined()
    const diagnostics = [
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    ]

    expect(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => PACKAGE_ROOT,
        getNewLine: () => '\n',
      }),
    ).toBe('')
  })
})
