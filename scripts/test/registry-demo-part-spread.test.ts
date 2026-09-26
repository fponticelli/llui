import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Regression guard for the `examples/registry-demo/src/sections/pickers.ts`
 * defect: a registry `classPart`/`classPartWithDefaults`/`createVariantsPart`
 * helper (`GradientPickerTrack`, `ColorPickerPreview`, …) is a CALLABLE
 * function — see `examples/registry-demo/src/lib/utils.ts`'s `PartHelper`
 * type. Spreading one directly into an object literal
 * (`div({ ...gp.track, ...GradientPickerTrack }, […])`) copies no own
 * enumerable properties (a function's own keys are `length`/`name`/`prototype`,
 * none of which are DOM attributes), so the element silently gets no class at
 * all and every part in the tree renders `class=""`. The fix is always to CALL
 * the helper (`GradientPickerTrack({ ...gp.track }, […])`) — see
 * `examples/registry-demo/src/sections/forms.ts` for the correct pattern.
 *
 * AST-driven (TypeScript Compiler API), not a string/regex scan: a regex over
 * `\.\.\.[A-Z]` would also flag a legitimate spread of an unrelated
 * PascalCase-named local, and would miss the same defect written across a
 * line break. This walks every `SpreadAssignment` inside an
 * `ObjectLiteralExpression` and resolves the spread's identifier back to its
 * import — flagging it only when that import's module specifier is a
 * relative path under `components/ui/` (the registry's part-helper barrel),
 * which is the one shape that is ALWAYS this bug.
 *
 * Files are enumerated via `git ls-files`, never a raw filesystem walk (this
 * repo's CLAUDE.md convention — a raw walk would also cross into
 * `.claude/worktrees/`, gitignored sibling-lane checkouts, if this scope were
 * ever widened).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCOPE = 'examples/registry-demo/src'

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', SCOPE], { cwd: repoRoot, encoding: 'utf8' })
  return out
    .split('\0')
    .filter((path) => path !== '')
    .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
    .sort()
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

/** A relative import path this repo's registry apps use for their own
 * generated part-helper barrels — `./components/ui/x`, `../components/ui/x`,
 * `../../components/ui/x`, and so on. Never matches a bare package specifier
 * (`@llui/components/...`), which is a different, unrelated import shape. */
const PART_HELPER_MODULE_RE = /^\.{1,2}\/(?:.*\/)?components\/ui\//

interface Violation {
  readonly file: string
  readonly line: number
  readonly identifier: string
  readonly moduleSpecifier: string
}

/**
 * Every `{ ...Identifier }` inside an object literal, where `Identifier` was
 * imported (named import) from a relative `components/ui/*` module.
 */
export function findPartHelperSpreads(fileName: string, source: string): Violation[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  )

  const partHelperImports = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (!ts.isStringLiteralLike(stmt.moduleSpecifier)) continue
    const moduleSpecifier = stmt.moduleSpecifier.text
    if (!PART_HELPER_MODULE_RE.test(moduleSpecifier)) continue
    const bindings = stmt.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      // The LOCAL name — `import { Foo as Bar }` means `Bar` is what a spread
      // in this file's source would spell.
      partHelperImports.set(element.name.text, moduleSpecifier)
    }
  }
  if (partHelperImports.size === 0) return []

  const violations: Violation[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (!ts.isSpreadAssignment(prop)) continue
        const expr = prop.expression
        if (ts.isIdentifier(expr)) {
          const moduleSpecifier = partHelperImports.get(expr.text)
          if (moduleSpecifier !== undefined) {
            const { line } = sf.getLineAndCharacterOfPosition(prop.getStart(sf))
            violations.push({
              file: fileName,
              line: line + 1,
              identifier: expr.text,
              moduleSpecifier,
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return violations
}

function scanAll(): Violation[] {
  return trackedFiles().flatMap((relPath) => {
    const source = readFileSync(resolve(repoRoot, relPath), 'utf8')
    return findPartHelperSpreads(relPath, source)
  })
}

describe('registry-demo never spreads a part-helper import (#PartHelper spread bug)', () => {
  it('finds tracked registry-demo source files to scan', () => {
    // A broken `git ls-files` scope (wrong cwd, wrong path) would make every
    // other assertion in this file vacuously pass.
    const files = trackedFiles()
    expect(files.length).toBeGreaterThan(5)
    expect(files).toContain('examples/registry-demo/src/sections/pickers.ts')
    expect(files).toContain('examples/registry-demo/src/sections/forms.ts')
  })

  it('detects a spread of a part-helper import when one is present', () => {
    // The instrument, proven on a known-bad fixture before its verdict on the
    // real tree is trusted — the exact shape the real bug had.
    const fixture = [
      "import { div } from '@llui/dom'",
      "import { GradientPickerTrack } from '../components/ui/gradient-picker'",
      'export const bad = (gp: { track: object }) =>',
      '  div({ ...gp.track, ...GradientPickerTrack }, [])',
      '',
    ].join('\n')
    const hits = findPartHelperSpreads('fixture.ts', fixture)
    expect(hits).toEqual([
      {
        file: 'fixture.ts',
        line: 4,
        identifier: 'GradientPickerTrack',
        moduleSpecifier: '../components/ui/gradient-picker',
      },
    ])
  })

  it('does not flag calling the helper, or spreading an unrelated identifier', () => {
    const fixture = [
      "import { div } from '@llui/dom'",
      "import { GradientPickerTrack } from '../components/ui/gradient-picker'",
      "import * as gradientPickerC from '@llui/components/gradient-picker'",
      'export const good = (gp: { track: object }) =>',
      '  GradientPickerTrack({ ...gp.track }, [])',
      'export const unrelated = (other: object) => div({ ...other }, [])',
      '',
    ].join('\n')
    expect(findPartHelperSpreads('fixture.ts', fixture)).toEqual([])
  })

  it('never spreads a part-helper import into an object literal anywhere under examples/registry-demo/src', () => {
    const violations = scanAll()
    const blame = violations.map(
      (v) =>
        `  ${v.file}:${v.line} — spreads \`${v.identifier}\` (imported from "${v.moduleSpecifier}"); ` +
        `CALL it instead, e.g. \`${v.identifier}({ ...prevBag }, […])\``,
    )
    expect(
      violations,
      'Part-helper imports (classPart/classPartWithDefaults/createVariantsPart results) are ' +
        'callable functions, not prop objects — spreading one copies no own-enumerable ' +
        'properties and the element renders class="":\n' +
        blame.join('\n'),
    ).toEqual([])
  })
})
