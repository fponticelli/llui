import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as rootApi from '../src/index.js'
import * as galleryApi from '../src/gallery.js'

const PACKAGE_ROOT = resolve(import.meta.dirname, '..')

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

describe('@llui/cli/gallery package boundary', () => {
  it('is published as its own browser-safe subpath', () => {
    const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(manifest.exports['./gallery']).toEqual({
      types: './dist/gallery.d.ts',
      import: './dist/gallery.js',
    })
  })

  it('imports at runtime only the two dependency-free protocol modules', () => {
    // Both are asserted import-free (or import only each other) by the
    // presentation-scenarios package test, so this keeps the subpath pure
    // transitively: no Node, DOM, zod or LLui runtime.
    expect(runtimeImports('src/gallery.ts')).toEqual(['./presentation-scenarios.js'])
  })

  it('stays off the Node-backed root entry', () => {
    const galleryNames = Object.keys(galleryApi)
    expect(galleryNames.length).toBeGreaterThan(0)
    expect(galleryNames.filter((name) => name in rootApi)).toEqual([])
  })
})
