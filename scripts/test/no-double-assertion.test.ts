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

/** Every double assertion in `source` — an assertion whose operand (through
 * parentheses) is itself an assertion to `unknown` or `any` — as `line: text`. */
function doubleAssertionsIn(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const findings: string[] = []
  const visit = (node: ts.Node): void => {
    if (isAssertion(node)) {
      let inner = node.expression
      while (ts.isParenthesizedExpression(inner)) inner = inner.expression
      if (isAssertion(inner) && isWideningType(inner.type)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
        findings.push(`${line + 1}: ${node.getText(file).replace(/\s+/g, ' ')}`)
      }
    }
    node.forEachChild(visit)
  }
  visit(file)
  return findings
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
