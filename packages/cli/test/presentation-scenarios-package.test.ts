import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'

// @test-needs-own-build — this suite imports and packages this package's emitted dist/ graph.

const PACKAGE_ROOT = resolve(import.meta.dirname, '..')
const SOURCE_PATH = resolve(PACKAGE_ROOT, 'src/presentation-scenarios.ts')
const ROOT_SOURCE_PATH = resolve(PACKAGE_ROOT, 'src/index.ts')
const DIST_PATH = resolve(PACKAGE_ROOT, 'dist/presentation-scenarios.js')
const DIST_TYPES_PATH = resolve(PACKAGE_ROOT, 'dist/presentation-scenarios.d.ts')
const DIST_CONTRACT_TYPES_PATH = resolve(PACKAGE_ROOT, 'dist/product-contract-types.d.ts')
const DIST_ROOT_PATH = resolve(PACKAGE_ROOT, 'dist/index.js')

const DIRECT_EXPORTS = [
  'CompiledPresentationScenario',
  'CompiledPresentationScenarioCase',
  'CompiledPresentationScenarioFamily',
  'DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT',
  'PRESENTATION_SCENARIO_COMPLEXITY_LIMITS',
  'PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS',
  'PRESENTATION_SCENARIO_ENVIRONMENT_VALUES',
  'PRESENTATION_SCENARIO_PATHS',
  'PresentationScenarioCase',
  'PresentationScenarioDefinition',
  'PresentationScenarioDefinitions',
  'PresentationScenarioEnvironment',
  'PresentationScenarioEnvironmentAxis',
  'PresentationScenarioError',
  'PresentationScenarioErrorCode',
  'PresentationScenarioJson',
  'PresentationScenarioJsonSnapshot',
  'PresentationScenarioPath',
  'PresentationScenarioSelection',
  'ResolvedPresentationScenarioSelection',
  'compileScenarioFamily',
  'decodeScenarioFamily',
  'decodeScenarioSelection',
  'resolveScenarioSelection',
] as const

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

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

function exportedNames(rootNames: readonly string[], sourcePath: string): string[] {
  const program = ts.createProgram({
    rootNames: [...rootNames],
    options: {
      lib: ['lib.es2022.d.ts'],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: ['node'],
      verbatimModuleSyntax: true,
    },
  })
  const sourceFile = program.getSourceFile(sourcePath)
  expect(sourceFile, `TypeScript did not load ${sourcePath}`).toBeDefined()
  const symbol = program.getTypeChecker().getSymbolAtLocation(sourceFile!)
  expect(symbol, `TypeScript did not bind ${sourcePath}`).toBeDefined()
  return program
    .getTypeChecker()
    .getExportsOfModule(symbol!)
    .map(({ name }) => name)
    .sort()
}

function canonicalExportSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  let current = symbol
  const visited = new Set<ts.Symbol>()
  while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !visited.has(current)) {
    visited.add(current)
    const resolved = checker.getAliasedSymbol(current)
    if (resolved === current) break
    current = resolved
  }
  return current
}

function protocolExportLeaks(rootPath: string): string[] {
  const program = ts.createProgram({
    rootNames: [SOURCE_PATH, rootPath],
    options: {
      lib: ['lib.es2022.d.ts'],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: ['node'],
      verbatimModuleSyntax: true,
    },
  })
  const checker = program.getTypeChecker()
  const directSource = program.getSourceFile(SOURCE_PATH)
  const rootSource = program.getSourceFile(rootPath)
  expect(directSource, `TypeScript did not load ${SOURCE_PATH}`).toBeDefined()
  expect(rootSource, `TypeScript did not load ${rootPath}`).toBeDefined()
  const directModule = checker.getSymbolAtLocation(directSource!)
  const rootModule = checker.getSymbolAtLocation(rootSource!)
  expect(directModule, `TypeScript did not bind ${SOURCE_PATH}`).toBeDefined()
  expect(rootModule, `TypeScript did not bind ${rootPath}`).toBeDefined()
  const directTargets = new Set(
    checker
      .getExportsOfModule(directModule!)
      .map((symbol) => canonicalExportSymbol(checker, symbol)),
  )
  return checker
    .getExportsOfModule(rootModule!)
    .filter((symbol) => directTargets.has(canonicalExportSymbol(checker, symbol)))
    .map(({ name }) => name)
    .sort()
}

function formattedDiagnostics(program: ts.Program): string {
  return ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => PACKAGE_ROOT,
    getNewLine: () => '\n',
  })
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

  it('has an exact direct-only source export surface, including type exports', () => {
    const direct = exportedNames([SOURCE_PATH, ROOT_SOURCE_PATH], SOURCE_PATH)
    const root = exportedNames([SOURCE_PATH, ROOT_SOURCE_PATH], ROOT_SOURCE_PATH)

    expect(direct).toEqual([...DIRECT_EXPORTS].sort())
    expect(direct.filter((name) => root.includes(name))).toEqual([])
    expect(protocolExportLeaks(ROOT_SOURCE_PATH)).toEqual([])
  })

  it('detects named, aliased, and export-star protocol leaks from a root module', () => {
    const directory = mkdtempSync(join(tmpdir(), 'llui-cli-root-export-mutations-'))
    temporaryDirectories.push(directory)
    const relativeSource = relative(directory, SOURCE_PATH)
      .replaceAll('\\', '/')
      .replace(/\.ts$/, '.js')
    const specifier = relativeSource.startsWith('.') ? relativeSource : `./${relativeSource}`
    const mutations = [
      {
        name: 'named',
        source: `export { compileScenarioFamily } from ${JSON.stringify(specifier)}\n`,
        leaks: ['compileScenarioFamily'],
      },
      {
        name: 'aliased',
        source: `export type { PresentationScenarioJson as ScenarioJson } from ${JSON.stringify(specifier)}\n`,
        leaks: ['ScenarioJson'],
      },
      {
        name: 'export-star',
        source: `export * from ${JSON.stringify(specifier)}\n`,
        leaks: [...DIRECT_EXPORTS].sort(),
      },
    ]

    for (const mutation of mutations) {
      const rootPath = join(directory, `${mutation.name}.ts`)
      writeFileSync(rootPath, mutation.source)
      expect(protocolExportLeaks(rootPath), mutation.name).toEqual(mutation.leaks)
    }
  })

  it('emits no runtime imports and type-checks the full source graph without DOM libraries', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8')
    expect(runtimeModuleSpecifiers(source)).toEqual([])

    const program = ts.createProgram({
      rootNames: [SOURCE_PATH],
      options: {
        lib: ['lib.es2022.d.ts'],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: [],
        verbatimModuleSyntax: true,
      },
    })
    expect(formattedDiagnostics(program)).toBe('')
  })

  it('keeps the built runtime export set disjoint from the package root', async () => {
    const nonce = `${Date.now()}-${Math.random()}`
    const direct = (await import(`${pathToFileURL(DIST_PATH).href}?${nonce}`)) as Record<
      string,
      unknown
    >
    const root = (await import(`${pathToFileURL(DIST_ROOT_PATH).href}?${nonce}`)) as Record<
      string,
      unknown
    >

    expect(Object.keys(direct).sort()).toEqual(
      [
        'DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT',
        'PRESENTATION_SCENARIO_COMPLEXITY_LIMITS',
        'PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS',
        'PRESENTATION_SCENARIO_ENVIRONMENT_VALUES',
        'PRESENTATION_SCENARIO_PATHS',
        'PresentationScenarioError',
        'compileScenarioFamily',
        'decodeScenarioFamily',
        'decodeScenarioSelection',
        'resolveScenarioSelection',
      ].sort(),
    )
    const directValues = new Set(Object.values(direct))
    expect(
      Object.entries(root)
        .filter(([, value]) => directValues.has(value))
        .map(([name]) => name)
        .sort(),
    ).toEqual([])
  })

  it('type-checks and executes a published consumer with zod genuinely unavailable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'llui-cli-presentation-'))
    temporaryDirectories.push(directory)
    const packageDirectory = join(directory, 'node_modules/@llui/cli')
    const distDirectory = join(packageDirectory, 'dist')
    mkdirSync(distDirectory, { recursive: true })
    copyFileSync(DIST_PATH, join(distDirectory, 'presentation-scenarios.js'))
    copyFileSync(DIST_TYPES_PATH, join(distDirectory, 'presentation-scenarios.d.ts'))
    copyFileSync(DIST_CONTRACT_TYPES_PATH, join(distDirectory, 'product-contract-types.d.ts'))
    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: '@llui/cli',
        type: 'module',
        exports: {
          './presentation-scenarios': {
            types: './dist/presentation-scenarios.d.ts',
            import: './dist/presentation-scenarios.js',
          },
        },
      }),
    )
    const consumerPath = join(directory, 'consumer.mts')
    writeFileSync(
      consumerPath,
      `import {
        DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS,
        PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
        PRESENTATION_SCENARIO_PATHS,
        PresentationScenarioError,
        compileScenarioFamily,
        resolveScenarioSelection,
        type CompiledPresentationScenarioFamily,
        type PresentationScenarioDefinitions,
        type ResolvedPresentationScenarioSelection,
      } from '@llui/cli/presentation-scenarios'

      const definitions = {} as unknown as PresentationScenarioDefinitions
      const catalog = {} as unknown as CompiledPresentationScenarioFamily
      const resolved = {} as unknown as ResolvedPresentationScenarioSelection
      void [
        DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS,
        PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
        PRESENTATION_SCENARIO_PATHS,
        PresentationScenarioError,
        compileScenarioFamily,
        resolveScenarioSelection,
        definitions,
        catalog,
        resolved,
      ]
      `,
    )
    const compilerOptions: ts.CompilerOptions = {
      lib: ['lib.es2022.d.ts'],
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: [],
      verbatimModuleSyntax: true,
    }
    expect(ts.resolveModuleName('zod', consumerPath, compilerOptions, ts.sys).resolvedModule).toBe(
      undefined,
    )
    const program = ts.createProgram({ rootNames: [consumerPath], options: compilerOptions })
    expect(formattedDiagnostics(program)).toBe('')
    expect(
      program
        .getSourceFiles()
        .filter(({ fileName }) => fileName.includes('/node_modules/@llui/cli/'))
        .map(({ fileName }) => fileName.split('/node_modules/@llui/cli/')[1]!)
        .sort(),
    ).toEqual(['dist/presentation-scenarios.d.ts', 'dist/product-contract-types.d.ts'])

    const runtimeConsumerPath = join(directory, 'consumer.mjs')
    writeFileSync(
      runtimeConsumerPath,
      `import {
        DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS,
        PRESENTATION_SCENARIO_PATHS,
      } from '@llui/cli/presentation-scenarios'
      if (DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT.theme !== 'light') throw new Error('bad default')
      if (PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues !== 100) throw new Error('bad diagnostic limits')
      if (PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.messageUnits !== 16384) throw new Error('bad diagnostic units')
      if (PRESENTATION_SCENARIO_PATHS.join(',') !== 'baseline,registryTailwind') throw new Error('bad paths')
      `,
    )
    const execution = spawnSync(process.execPath, [runtimeConsumerPath], {
      cwd: directory,
      encoding: 'utf8',
    })
    expect({ status: execution.status, stderr: execution.stderr }).toEqual({
      status: 0,
      stderr: '',
    })
  })
})
