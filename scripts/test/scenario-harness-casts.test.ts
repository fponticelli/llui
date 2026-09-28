import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * The presentation-scenario harnesses carry no type assertions.
 *
 * The scenario protocol (`packages/cli/src/presentation-scenarios.ts`) types
 * every renderer adapter by its own scenario's case input and dispatches
 * without a cast. Its test harnesses used to erase exactly that typing —
 * `adapter as (h, input: unknown, …) => …`, `scenarioId as …`,
 * `input as Record<string, unknown>` — to feed hand-mutated inputs no declared
 * case has, and a cast checks nothing: measured when they were removed, the
 * registry dimension harness had been rendering nine inputs outside their
 * declared types (an Alert `variant: 'outline'`, a Sidebar `state: 'closed'`,
 * …). The harnesses now mutate through typed per-field tables
 * (`packages/components/test/styles/scenario-field-mutations.ts`), route
 * intentionally ill-typed values through the protocol's `unknown`-taking
 * `decode…` entry points, and read untyped values through runtime-checked
 * access (`packages/cli/test/untyped-access.ts`).
 *
 * This keeps it that way. Parsed, not grepped: `as const` is allowed (it
 * narrows, it does not assert), and prose or strings mentioning a cast are not
 * findings. Non-null assertions (`!`) are out of scope.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const HARNESS_FILES: readonly RegExp[] = [
  // The protocol's own tests and their untyped-access helper.
  /^packages\/cli\/test\/(presentation-scenarios[^/]*|untyped-access)\.ts$/,
  // Family scenario modules, renderers, field tables and their tests.
  /^packages\/components\/test\/styles\/[^/]*(scenario|renderer|field-mutations|field-assertions)[^/]*\.ts$/,
  /^packages\/components\/test\/styles\/(navigation-data-contract-source|menus-overlays-product-effects\.browser\.test)\.ts$/,
  /^registry\/test\/[^/]*(scenario|renderer)[^/]*\.ts$/,
  /^registry\/test\/forms-controls\.browser\.test\.ts$/,
  // The Component Gallery renders every family's scenarios; all of its tests.
  /^examples\/component-gallery\/test\/.+\.ts$/,
]

/** Exact, not a floor: a harness that silently drops out of the scan is a finding too. */
const EXPECTED_FILE_COUNT = 69

function harnessFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((path) => HARNESS_FILES.some((pattern) => pattern.test(path)))
    .sort()
}

/** Every type assertion in `source` other than `as const`, as `line: text`. */
function castsIn(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const findings: string[] = []
  const visit = (node: ts.Node): void => {
    const isAssertion = ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    if (isAssertion && !ts.isConstTypeReference(node.type)) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
      findings.push(`${line + 1}: ${node.getText(file).replace(/\s+/g, ' ')}`)
    }
    node.forEachChild(visit)
  }
  visit(file)
  return findings
}

describe('scenario harnesses carry no type assertions', () => {
  it('the instrument finds `as T` and `<T>x`, and passes `as const`', () => {
    expect(castsIn('probe.ts', 'const a = b as Foo\nconst c = <Foo>d\n')).toEqual([
      '1: b as Foo',
      '2: <Foo>d',
    ])
    expect(castsIn('probe.ts', "const a = ['x'] as const\nconst b = { c: 1 } as const\n")).toEqual(
      [],
    )
    expect(castsIn('probe.ts', '// x as Foo\nconst s = "y as Foo"\n')).toEqual([])
  })

  it(`scans exactly the ${EXPECTED_FILE_COUNT} harness files`, () => {
    expect(harnessFiles()).toHaveLength(EXPECTED_FILE_COUNT)
  })

  it('finds none in any harness file', () => {
    const findings = harnessFiles().flatMap((path) =>
      castsIn(path, readFileSync(resolve(repoRoot, path), 'utf8')).map(
        (finding) => `${path}:${finding}`,
      ),
    )
    expect(findings).toEqual([])
  })
})
