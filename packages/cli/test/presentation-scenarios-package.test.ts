import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { PRESENTATION_SCENARIO_COMPLEXITY_LIMITS } from '../src/presentation-scenarios.js'
import { ownPath } from './untyped-access.js'

// @test-needs-own-build — this suite imports and packages this package's emitted dist/ graph.

const PACKAGE_ROOT = resolve(import.meta.dirname, '..')
const SOURCE_PATH = resolve(PACKAGE_ROOT, 'src/presentation-scenarios.ts')
const CONTRACT_TYPES_SOURCE_PATH = resolve(PACKAGE_ROOT, 'src/product-contract-types.ts')
const ROOT_SOURCE_PATH = resolve(PACKAGE_ROOT, 'src/index.ts')
const DIST_PATH = resolve(PACKAGE_ROOT, 'dist/presentation-scenarios.js')
const DIST_TYPES_PATH = resolve(PACKAGE_ROOT, 'dist/presentation-scenarios.d.ts')
const DIST_CONTRACT_TYPES_PATH = resolve(PACKAGE_ROOT, 'dist/product-contract-types.d.ts')
const DIST_CONTRACT_TYPES_JS_PATH = resolve(PACKAGE_ROOT, 'dist/product-contract-types.js')
const DIST_ROOT_PATH = resolve(PACKAGE_ROOT, 'dist/index.js')

const DIRECT_EXPORTS = [
  'CompiledPresentationScenario',
  'CompiledPresentationScenarioCase',
  'CompiledPresentationScenarioFamily',
  'DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT',
  'NoPresentationScenarioAdapterExtra',
  'PRESENTATION_SCENARIO_COMPLEXITY_LIMITS',
  'PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS',
  'PRESENTATION_SCENARIO_ENVIRONMENT_VALUES',
  'PRESENTATION_SCENARIO_PATHS',
  'PreparedPresentationScenario',
  'PresentationScenarioAdapter',
  'PresentationScenarioAdapterBinding',
  'PresentationScenarioAdapterContext',
  'PresentationScenarioAdapterExtra',
  'PresentationScenarioAdapters',
  'PresentationScenarioCase',
  'PresentationScenarioCaseInput',
  'PresentationScenarioDefinition',
  'PresentationScenarioDefinitions',
  'PresentationScenarioEnvironment',
  'PresentationScenarioEnvironmentAxis',
  'PresentationScenarioError',
  'PresentationScenarioErrorCode',
  'PresentationScenarioFamilyIds',
  'PresentationScenarioJson',
  'PresentationScenarioJsonSnapshot',
  'PresentationScenarioPath',
  'PresentationScenarioSelection',
  'ResolvedPresentationScenarioSelection',
  'bindScenarioAdapters',
  'compileScenarioFamily',
  'decodeScenarioFamily',
  'decodeScenarioSelection',
  'dispatchScenarioSelection',
  'resolveScenarioSelection',
] as const

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function runtimeModuleSpecifiers(source: string, fileName: string = SOURCE_PATH): string[] {
  const emitted = ts.transpileModule(source, {
    fileName,
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
    const packageJson: unknown = JSON.parse(
      readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'),
    )

    expect(ownPath(packageJson, 'exports', './presentation-scenarios')).toEqual({
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

  it('emits runtime imports only to product-contract-types.js, itself import-free, and type-checks the full source graph without DOM libraries', () => {
    // presentation-scenarios.ts is allowed exactly ONE runtime import, to the pure structural
    // types module — and that module must in turn have ZERO runtime imports of its own, so the
    // whole graph stays transitively free of Node/DOM/zod/LLui runtime code.
    const source = readFileSync(SOURCE_PATH, 'utf8')
    expect(runtimeModuleSpecifiers(source)).toEqual(['./product-contract-types.js'])
    const contractTypesSource = readFileSync(CONTRACT_TYPES_SOURCE_PATH, 'utf8')
    expect(runtimeModuleSpecifiers(contractTypesSource, CONTRACT_TYPES_SOURCE_PATH)).toEqual([])

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
    const direct: object = await import(`${pathToFileURL(DIST_PATH).href}?${nonce}`)
    const root: object = await import(`${pathToFileURL(DIST_ROOT_PATH).href}?${nonce}`)

    expect(Object.keys(direct).sort()).toEqual(
      [
        'DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT',
        'PRESENTATION_SCENARIO_COMPLEXITY_LIMITS',
        'PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS',
        'PRESENTATION_SCENARIO_ENVIRONMENT_VALUES',
        'PRESENTATION_SCENARIO_PATHS',
        'PresentationScenarioError',
        'bindScenarioAdapters',
        'compileScenarioFamily',
        'decodeScenarioFamily',
        'decodeScenarioSelection',
        'dispatchScenarioSelection',
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
    // The direct subpath now carries one real runtime import to product-contract-types.js (#270
    // finding 6) — the synthetic package needs that runtime file too, not just its declaration.
    copyFileSync(DIST_CONTRACT_TYPES_JS_PATH, join(distDirectory, 'product-contract-types.js'))
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

      // This file is TYPE-CHECKED only (see \`ts.createProgram\` below), never executed — a
      // \`declare const\` fixture value says that plainly, rather than reaching for a double cast
      // to manufacture a runtime value this file never runs.
      declare const definitions: PresentationScenarioDefinitions
      declare const catalog: CompiledPresentationScenarioFamily
      declare const resolved: ResolvedPresentationScenarioSelection
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

  it('documents the exact PRESENTATION_SCENARIO_COMPLEXITY_LIMITS values in README.md', () => {
    // A bare `readme.includes(formatted)` ties a NUMBER to the README but not to which constant it
    // is supposed to describe — it would pass just as happily if two numbers were swapped between
    // dimensions, or if an unrelated number elsewhere happened to coincide. Each phrase below names
    // its constant's own descriptive words AROUND the formatted value, generated from the live
    // constant so the expectation itself can never drift out of sync with the code (#270, round
    // three) — only the PROSE can drift out of sync with the phrase, which is exactly the failure
    // this guards. This is what caught "288,000 … own fields" (the actual `familyFields` is
    // 576,000, 2x `familyNodes`) the first time.
    const readme = readFileSync(resolve(PACKAGE_ROOT, 'README.md'), 'utf8')
    const phraseFor: Record<
      keyof typeof PRESENTATION_SCENARIO_COMPLEXITY_LIMITS,
      (formatted: string) => string
    > = {
      depth: (n) => `up to ${n} nested levels`,
      familyNodes: (n) => `${n} decoded nodes`,
      familyFields: (n) => `${n} own fields`,
      familyStringUnits: (n) => `${n} total string units`,
      stringLength: (n) => `${n} units in any one string`,
      arrayLength: (n) => `${n} entries in any one array`,
      products: (n) => `at most ${n} products/scenarios`,
      casesPerProduct: (n) => `${n} cases per product`,
      identifierLength: (n) => `${n} characters`,
    }
    const isLimitName = (
      name: string,
    ): name is keyof typeof PRESENTATION_SCENARIO_COMPLEXITY_LIMITS =>
      Object.hasOwn(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS, name)
    for (const [name, value] of Object.entries(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS)) {
      if (!isLimitName(name)) throw new Error(`${name} is not an own limit`)
      const formatted = value.toLocaleString('en-US')
      const phrase = phraseFor[name](formatted)
      expect(readme.includes(phrase), `README.md must document ${name} as "${phrase}"`).toBe(true)
    }
    // Every key in the limits object has its own phrase above — if a new dimension is added and
    // this map is not updated, `phraseFor[name]` throws (a phrase generator does not exist for an
    // unmapped key) rather than silently skipping it.
    expect(Object.keys(phraseFor)).toEqual(Object.keys(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS))
    // The diagnostic policy is documented separately (also asserted here so it cannot drift
    // silently either): 100 issues, 16,384 message units.
    expect(readme).toContain('100 issues and 16,384 UTF-16 units')
  })
})
