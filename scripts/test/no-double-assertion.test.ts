import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Production source carries no DOUBLE type assertion.
 *
 * `x as unknown as T` (and its spellings `<T><unknown>x`, `(x as unknown) as T`,
 * and the `any` variants) is an assertion TypeScript cannot refuse: it states a
 * relation between two types the compiler has just said are unrelated. Every
 * one of the 30 this repo carried in `packages/*\/src` was removable, and the
 * removal found what they hid — a2ui handing one component's UI-state blob to
 * another component's reducer after a re-type (a crash), an MCP tool
 * advertising note kinds that do not exist, a fake `EventBus` missing a member,
 * two relays dispatching `constructor`/`toString` as debug-API methods, and
 * platform globals (`WebSocketPair`, `Deno`) trusted unchecked. Several were
 * simply unnecessary (the value already had the type).
 *
 * The replacements are real types: a correct generic or narrower parameter, a
 * runtime guard that checks what it claims, a decoder at a JSON / wire / global
 * boundary, `instanceof`, or a declared global. See
 * `docs/agents/verification.md` ("Double assertions").
 *
 * The TWO-STEP spelling is caught too: `const x = y as unknown` (or a later
 * `x = y as any`) followed by `x as T`, with `x` resolved by symbol so a
 * shadowing binding of the same name is not conflated with it.
 *
 * Parsed, not grepped: prose, strings and a lone `as unknown` (widening, which
 * is always sound) are not findings. Test code is out of scope.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Files allowed to carry a double assertion, keyed by repo-relative path, each
 * with the reason TypeScript cannot see the relation. Closed at both ends: an
 * entry whose file no longer has a finding fails too. Empty on purpose.
 */
const DOUBLE_ASSERTION_ALLOWED: Readonly<Record<string, string>> = {}

const SOURCE = /\.(?:[cm]?ts|tsx)$/
const DECLARATION = /\.d\.[cm]?ts$/
/** `packages/<pkg>/src/<…>` — the production-source scope, exactly. */
const IN_SCOPE = /^packages\/[^/]+\/src\/.+/

function isScannedSource(path: string): boolean {
  return IN_SCOPE.test(path) && SOURCE.test(path) && !DECLARATION.test(path)
}

/** Enumeration 1: git's view (tracked + untracked-but-not-ignored). */
function gitSources(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(isScannedSource)
    .sort()
}

/** The packages that have a `src/` directory, straight from the filesystem. */
function packagesWithSrc(): string[] {
  return readdirSync(resolve(repoRoot, 'packages'))
    .filter((pkg) =>
      statSync(resolve(repoRoot, 'packages', pkg, 'src'), { throwIfNoEntry: false })?.isDirectory(),
    )
    .sort()
}

/** Enumeration 2: the filesystem's view, walked independently of git. */
function walkedSources(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(repoRoot, full).split('\\').join('/'))
    }
  }
  for (const pkg of packagesWithSrc()) walk(resolve(repoRoot, 'packages', pkg, 'src'))
  return out.filter(isScannedSource).sort()
}

function isWideningType(node: ts.TypeNode): boolean {
  return node.kind === ts.SyntaxKind.UnknownKeyword || node.kind === ts.SyntaxKind.AnyKeyword
}

function isAssertion(node: ts.Node): node is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
}

/** The operand of an assertion, through parentheses. */
function operandOf(node: ts.AsExpression | ts.TypeAssertion): ts.Expression {
  let inner = node.expression
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression
  return inner
}

/** Whether `expr` (through parentheses) is an assertion to `unknown` / `any`. */
function isWideningAssertion(expr: ts.Expression): boolean {
  let inner = expr
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression
  return isAssertion(inner) && isWideningType(inner.type)
}

/**
 * A checker over `source` alone: no lib, no module resolution. Imports stay
 * unresolved, which is fine — the only question asked of it is which LOCAL
 * declaration an identifier denotes (so shadowing is honoured, where a
 * name-based match would conflate two bindings).
 */
function singleFileChecker(file: ts.SourceFile): ts.TypeChecker {
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [], allowJs: false }
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === file.fileName ? file : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => name === file.fileName,
    readFile: () => undefined,
  }
  return ts.createProgram([file.fileName], options, host).getTypeChecker()
}

/**
 * Every double assertion in `source`, as `line: text`:
 *
 * - DIRECT: an assertion whose operand (through parentheses) is itself an
 *   assertion to `unknown` or `any` — `x as unknown as T`, `<T><unknown>x`, …
 * - TWO-STEP: an assertion (to anything but `unknown` / `any` / `const`) whose
 *   operand is an identifier bound to a variable that RECEIVED an assertion to
 *   `unknown` / `any` — as its initializer or by a later `=` assignment:
 *   `const x = y as unknown` … `x as T`. Resolved by symbol, not by name.
 */
function doubleAssertionsIn(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const findings: Array<{ pos: number; text: string }> = []
  const record = (node: ts.Node, suffix = ''): void => {
    findings.push({
      pos: node.getStart(file),
      text: node.getText(file).replace(/\s+/g, ' ') + suffix,
    })
  }

  // Pass 1: direct double assertions, plus the variables that were widened.
  const widenedDeclarations: ts.Node[] = []
  const widenedAssignmentTargets: ts.Identifier[] = []
  const collect = (node: ts.Node): void => {
    if (isAssertion(node) && isWideningAssertion(operandOf(node))) record(node)
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isWideningAssertion(node.initializer)
    ) {
      widenedDeclarations.push(node)
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isWideningAssertion(node.right)
    ) {
      widenedAssignmentTargets.push(node.left)
    }
    node.forEachChild(collect)
  }
  collect(file)

  // Pass 2: two-step double assertions, only when something was widened.
  if (widenedDeclarations.length > 0 || widenedAssignmentTargets.length > 0) {
    const checker = singleFileChecker(file)
    const widened = new Set<ts.Symbol>()
    for (const decl of widenedDeclarations) {
      const name = ts.isVariableDeclaration(decl) ? decl.name : undefined
      const symbol = name ? checker.getSymbolAtLocation(name) : undefined
      if (symbol) widened.add(symbol)
    }
    for (const target of widenedAssignmentTargets) {
      const symbol = checker.getSymbolAtLocation(target)
      if (symbol) widened.add(symbol)
    }
    const visit = (node: ts.Node): void => {
      if (isAssertion(node) && !isWideningType(node.type) && !ts.isConstTypeReference(node.type)) {
        const operand = operandOf(node)
        if (ts.isIdentifier(operand)) {
          const symbol = checker.getSymbolAtLocation(operand)
          if (symbol && widened.has(symbol)) {
            record(
              node,
              ` (two-step: \`${operand.text}\` holds an \`as unknown\`/\`as any\` value)`,
            )
          }
        }
      }
      node.forEachChild(visit)
    }
    visit(file)
  }

  return findings
    .sort((a, b) => a.pos - b.pos)
    .map(({ pos, text }) => `${file.getLineAndCharacterOfPosition(pos).line + 1}: ${text}`)
}

describe('production source carries no double type assertion', () => {
  it('the instrument finds every spelling and passes single assertions', () => {
    const bad = [
      'const a = b as unknown as Foo',
      'const c = <Foo>(<unknown>d)',
      'const e = (f as unknown) as Foo',
      'const g = <Foo>(h as unknown)',
      'const i = j as any as Foo',
      'call((k as unknown as Foo).m)',
    ].join('\n')
    expect(doubleAssertionsIn('probe.ts', bad)).toEqual([
      '1: b as unknown as Foo',
      '2: <Foo>(<unknown>d)',
      '3: (f as unknown) as Foo',
      '4: <Foo>(h as unknown)',
      '5: j as any as Foo',
      '6: k as unknown as Foo',
    ])
    const good = [
      'const a = b as Foo',
      'const c = d as unknown',
      "const e = ['x'] as const",
      'const f = g satisfies Foo',
      '// h as unknown as Foo',
      "const s = 'i as unknown as Foo'",
    ].join('\n')
    expect(doubleAssertionsIn('probe.ts', good)).toEqual([])
    expect(doubleAssertionsIn('probe.tsx', 'const a = <div>{b as unknown as Foo}</div>')).toEqual([
      '1: b as unknown as Foo',
    ])
  })

  it('the instrument finds the TWO-STEP spelling, resolved by symbol', () => {
    const TWO_STEP = ' (two-step: `x` holds an `as unknown`/`as any` value)'
    const bad = [
      'const x = y as unknown',
      'const a = x as Foo',
      'function f() {',
      '  let x',
      '  x = (z as any)',
      '  return <Bar>x',
      '}',
    ].join('\n')
    expect(doubleAssertionsIn('probe.ts', bad)).toEqual([
      `2: x as Foo${TWO_STEP}`,
      `6: <Bar>x${TWO_STEP}`,
    ])
    const good = [
      'const x = y as unknown',
      'const a = isFoo(x) ? x : null', // narrowed by a guard, not asserted
      'const b = x as unknown', // widening again is sound
      'const c = [x] as const',
      'function f(x: Foo) {',
      '  return x as Bar', // a DIFFERENT `x` (shadowing): a single assertion
      '}',
      'const w = v as Foo',
      'const d = w as Bar', // `w` was never widened
    ].join('\n')
    expect(doubleAssertionsIn('probe.ts', good)).toEqual([])
  })

  it('scans exactly packages/*/src: git and the filesystem enumerate the same set', () => {
    const fromGit = gitSources()
    expect(fromGit).toEqual(walkedSources())
    // Every package with a src/ directory contributes: a scope that silently
    // lost a package would still agree with itself above.
    const scannedPackages = new Set(fromGit.map((path) => path.split('/')[1]))
    expect([...scannedPackages].sort()).toEqual(packagesWithSrc())
  })

  it('finds none outside the (empty) allowlist, and the allowlist has no stale entry', () => {
    const findings: Record<string, string[]> = {}
    for (const path of gitSources()) {
      const found = doubleAssertionsIn(path, readFileSync(resolve(repoRoot, path), 'utf8'))
      if (found.length > 0) findings[path] = found
    }
    const unexcused = Object.fromEntries(
      Object.entries(findings).filter(([path]) => !(path in DOUBLE_ASSERTION_ALLOWED)),
    )
    expect(unexcused, 'replace the double assertion with a real type (see the header)').toEqual({})
    const stale = Object.keys(DOUBLE_ASSERTION_ALLOWED).filter((path) => !(path in findings))
    expect(stale, 'allowlisted files that no longer carry a double assertion').toEqual([])
  })
})
