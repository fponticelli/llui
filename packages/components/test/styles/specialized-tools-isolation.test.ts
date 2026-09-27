// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SPECIALIZED_TOOLS_PRODUCT_IDS } from './specialized-tools-scenarios'
import { loadProductContract } from './navigation-data-contract-source'

/**
 * No implementation dependency leaks between the baseline and registry paths
 * (#266). Each path is a separate product a consumer adopts on its own, so:
 *
 *  - the baseline renderer imports no registry skin, no `@/` alias and no
 *    Tailwind entry; the registry renderer imports no baseline renderer and no
 *    baseline stylesheet;
 *  - the shared modules (scenarios, states, fixtures) import neither renderer,
 *    no skin and no stylesheet — they are renderer-neutral by construction;
 *  - the family's baseline CSS contains no Tailwind construct, and the family's
 *    registry skins name no baseline scope selector and no baseline-only token.
 *
 * Imports are read from the TypeScript AST, never a substring scan (a comment
 * naming a path must not count, and a real import must not hide in one).
 */

const ROOT = resolve(import.meta.dirname, '../../../..')

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: string[] = []
  for (const statement of sf.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      out.push(statement.moduleSpecifier.text)
    }
  }
  return out
}

const here = (name: string): string => resolve(import.meta.dirname, name)
const BASELINE_RENDERER = here('specialized-tools-baseline-renderer.ts')
const REGISTRY_RENDERER = resolve(ROOT, 'registry/test/specialized-tools-scenario-renderer.ts')
const SHARED = [
  here('specialized-tools-scenarios.ts'),
  here('specialized-tools-states.ts'),
  here('specialized-tools-fixtures.ts'),
]

describe('specialized-tools styling paths stay isolated (#266)', () => {
  it('reads real imports (self-check on a known module)', () => {
    expect(importsOf(BASELINE_RENDERER)).toContain('@llui/dom')
    expect(importsOf(REGISTRY_RENDERER)).toContain('../llui/ui/qr-code')
  })

  it('the baseline renderer imports nothing from the registry path', () => {
    const leaked = importsOf(BASELINE_RENDERER).filter(
      (spec) =>
        spec.includes('registry/') || spec.startsWith('@/') || /tailwind|tokens\.css/.test(spec),
    )
    expect(leaked).toEqual([])
  })

  it('the registry renderer imports nothing from the baseline path', () => {
    const leaked = importsOf(REGISTRY_RENDERER).filter(
      (spec) =>
        spec.includes('baseline-renderer') || spec.endsWith('.css') || spec.includes('/src/styles'),
    )
    expect(leaked).toEqual([])
  })

  it('the shared modules are renderer-neutral', () => {
    for (const file of SHARED) {
      const leaked = importsOf(file).filter(
        (spec) =>
          spec.includes('renderer') ||
          spec.includes('registry/') ||
          spec.startsWith('@/') ||
          spec.endsWith('.css'),
      )
      expect(leaked, file).toEqual([])
    }
  })

  it('the family baseline CSS carries no Tailwind construct', () => {
    const css = readFileSync(
      resolve(ROOT, 'packages/components/src/styles/specialized-tools.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/@apply|@theme|@layer|@utility|@variant|--tw-|--color-|--spacing\(/)
  })

  it('the family registry skins name no baseline scope selector or baseline-only token', () => {
    const contract = loadProductContract()
    const family = new Set<string>(SPECIALIZED_TOOLS_PRODUCT_IDS)
    const artifacts = contract.entries
      .filter(({ name }) => family.has(name))
      .flatMap(({ copiedArtifacts }) => copiedArtifacts.map(({ name }) => name))
    expect(artifacts.length).toBeGreaterThan(15)
    for (const artifact of artifacts) {
      const source = readFileSync(resolve(ROOT, `registry/llui/ui/${artifact}.ts`), 'utf8')
      expect(source, artifact).not.toMatch(/\[data-scope=/)
      // `--llui-floating-available-height` is the one documented registry
      // translation; nothing in this family needs it.
      expect(source.replace(/\/\*[\s\S]*?\*\//g, ''), artifact).not.toMatch(/--llui-/)
    }
  })
})
