import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  ProductContractError,
  ProductContractSchema,
  parseProductContract,
} from '../src/product-contract.js'

const PACKAGE_ROOT = resolve(import.meta.dirname, '..')
const REGISTRY_JSON = resolve(PACKAGE_ROOT, '../../registry/registry.json')

function runtimeImports(file: string): string[] {
  const source = readFileSync(resolve(PACKAGE_ROOT, file), 'utf8')
  const emitted = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText
  const sourceFile = ts.createSourceFile('out.js', emitted, ts.ScriptTarget.ES2022, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifiers.push('<dynamic>')
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers.sort()
}

function caught(run: () => unknown): ProductContractError {
  try {
    run()
  } catch (error) {
    if (error instanceof ProductContractError) return error
    throw error
  }
  throw new Error('expected a ProductContractError')
}

function shippedContract(): unknown {
  const parsed: unknown = JSON.parse(readFileSync(REGISTRY_JSON, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('productContract' in parsed)) {
    throw new Error('registry/registry.json carries no productContract')
  }
  return parsed.productContract
}

describe('@llui/cli/product-contract package boundary', () => {
  it('is published as its own subpath', () => {
    const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(manifest.exports['./product-contract']).toEqual({
      types: './dist/product-contract.d.ts',
      import: './dist/product-contract.js',
    })
  })

  it('is browser-safe: its only runtime imports are zod and the dependency-free structural types', () => {
    // The CLI's Node-backed modules (`registry.ts`, `add.ts`, `config.ts`, `versions.ts`) are
    // reachable only through the root entry; a browser app validates a contract through this
    // subpath without pulling any of them (or `node:*`) into its bundle.
    expect(runtimeImports('src/product-contract.ts')).toEqual([
      './product-contract-types.js',
      'zod',
    ])
    expect(runtimeImports('src/product-contract-types.ts')).toEqual([])
  })
})

describe('parseProductContract', () => {
  it('returns the contract the authoritative schema parses, for the shipped registry', () => {
    const raw = shippedContract()
    expect(parseProductContract(raw, 'registry/registry.json')).toEqual(
      ProductContractSchema.parse(raw),
    )
  })

  it('fails loudly, naming the source and the exact path of every violation', () => {
    const contract = ProductContractSchema.parse(shippedContract())
    const [first, second, ...rest] = contract.entries
    const malformed: unknown = {
      ...contract,
      entries: [
        { ...first, name: 'Not A Name' },
        { ...second, presentation: { ...second!.presentation, baseline: { mode: 'sparkly' } } },
        ...rest,
      ],
    }

    const error = caught(() =>
      parseProductContract(malformed, 'registry/registry.json#productContract'),
    )
    expect(error.name).toBe('ProductContractError')
    expect(error.source).toBe('registry/registry.json#productContract')
    expect(error.issues.map((issue) => issue.slice(0, issue.indexOf(': ')))).toEqual([
      '$.entries[0].name',
      '$.entries[1].presentation.baseline.mode',
    ])
    expect(error.message).toMatch(
      /^Invalid ProductContract in registry\/registry\.json#productContract \(2 issues\):\n {2}- \$\.entries\[0\]\.name: /,
    )
    expect(error.message).toContain('\n  - $.entries[1].presentation.baseline.mode: ')
  })

  it.each([
    ['a missing contract', undefined, '$: '],
    ['a wrong version', { version: 1, entries: [], aliases: [] }, '$.version: '],
    ['an unknown top-level key', { version: 2, entries: [], aliases: [], extra: 1 }, '$: '],
  ])('rejects %s', (_label, value, path) => {
    const error = caught(() => parseProductContract(value, 'fixture'))
    expect(error.issues[0]!.startsWith(path)).toBe(true)
    expect(error.message.startsWith('Invalid ProductContract in fixture (')).toBe(true)
  })
})
