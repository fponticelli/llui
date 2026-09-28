import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * Every browser a TEST opens is hermetic (`scripts/lib/hermetic-browser.mjs`).
 *
 * The browser suites used to launch Chromium directly, and every one that
 * loaded a demo then asked `api.iconify.design` for glyphs — live, silently,
 * with no assertion on the answer — so the same suite rendered different pages
 * on a networked runner and in a sandbox and was green in both. The guard fixes
 * that for the suites that use it; this file makes "uses it" a build failure
 * rather than a convention, in three structural checks:
 *
 *  1. DIRECT LAUNCHES. Across every tracked source file, the set of files that
 *     call a Playwright launcher (`chromium.launch(…)` and friends) is EXACTLY
 *     the allowlist below, each entry with the reason it may. A new suite that
 *     launches its own browser fails here, naming the file; an entry that no
 *     longer launches fails as stale, so the list cannot rot into a pass.
 *  2. BROWSER SUITES. Every `*.browser.test.ts` calls `useHermeticBrowser()`,
 *     itself or through a relative module it imports (the menus-overlays live
 *     harness). Checked file by file over the exact `git ls-files` set.
 *  3. PLACEMENT. `useHermeticBrowser()` registers vitest hooks, and a hook
 *     registered from inside a hook or a test never runs. No call may sit in
 *     such a callback. (`launch()` also refuses at runtime until its own hook
 *     has run; this catches the mistake before anything launches.)
 *
 * Enumeration is `git ls-files --cached --others --exclude-standard`, never a
 * filesystem walk: `.claude/worktrees/` holds full checkouts of sibling lanes
 * and is gitignored. Detection is by AST (the TypeScript parser), not by
 * text, so a comment that mentions `chromium.launch()` is not a launch.
 */

const ROOT = path.resolve(__dirname, '../..')

/**
 * Files allowed to launch Playwright directly, and why. Everything else goes
 * through `useHermeticBrowser()`.
 */
const DIRECT_LAUNCHERS: Readonly<Record<string, string>> = {
  'scripts/lib/hermetic-browser.mjs': 'the guard itself',
  'scripts/test/hermetic-browser.test.ts':
    "the guard's own test: wraps its browser with `guardBrowser` to observe the refusals directly",
  'scripts/smoke-examples.ts':
    'not a vitest suite: routes every context through the same `routeContext` policy, single-origin',
  'packages/mcp/src/transports/cdp.ts':
    "PRODUCT code: the MCP server's own browser, pointed at the user's app on purpose",
  'packages/mcp/demo.ts': 'a manual demo script, run by hand, not a test',
  'packages/mcp/test/manual-playwright.mjs':
    'a manual debugging script (`node …`), not collected by vitest',
}

/** Each allowlisted non-guard launcher that must still apply the policy itself. */
const MUST_ROUTE: Readonly<Record<string, RegExp>> = {
  'scripts/test/hermetic-browser.test.ts': /\bguardBrowser\(/,
  'scripts/smoke-examples.ts': /\brouteContext\(/,
}

const BROWSER_TYPES = new Set(['chromium', 'firefox', 'webkit'])
const LAUNCH_METHODS = new Set([
  'launch',
  'launchPersistentContext',
  'launchServer',
  'connect',
  'connectOverCDP',
])
/** Callbacks vitest runs AFTER collection: a hook registered in one never runs. */
const RUN_TIME_CALLBACKS = new Set([
  'beforeAll',
  'beforeEach',
  'afterAll',
  'afterEach',
  'it',
  'test',
  'onTestFinished',
  'onTestFailed',
])

function gitFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return out
    .split('\n')
    .filter((file) => /\.(?:ts|tsx|mts|mjs|js)$/.test(file) && !file.endsWith('.d.ts'))
    .filter((file) => existsSync(path.join(ROOT, file)))
    .sort()
}

function parse(file: string): ts.SourceFile {
  const text = readFileSync(path.join(ROOT, file), 'utf8')
  const kind = file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.ts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

/** The last name of `a.b.c` / `c`, or undefined for any other expression. */
function tailName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/** The root identifier of a (possibly chained) callee: `it.fails.skip` → `it`. */
function rootName(expression: ts.Expression): string | undefined {
  let current = expression
  while (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) {
    current = ts.isPropertyAccessExpression(current) ? current.expression : current.expression
  }
  return ts.isIdentifier(current) ? current.text : undefined
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function isDirectLaunch(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  if (!LAUNCH_METHODS.has(callee.name.text)) return false
  const owner = tailName(callee.expression)
  return owner !== undefined && BROWSER_TYPES.has(owner)
}

function isGuardCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'useHermeticBrowser'
  )
}

/** Files whose AST contains a node matching `predicate` — prefiltered on text. */
function filesWith(
  files: readonly string[],
  needle: RegExp,
  predicate: (node: ts.Node) => boolean,
): string[] {
  return files.filter((file) => {
    if (!needle.test(readFileSync(path.join(ROOT, file), 'utf8'))) return false
    let found = false
    walk(parse(file), (node) => {
      if (!found && predicate(node)) found = true
    })
    return found
  })
}

/** Relative module specifiers `file` imports, resolved to repo-relative paths. */
function relativeImports(file: string): string[] {
  const out: string[] = []
  for (const statement of parse(file).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue
    const specifier = statement.moduleSpecifier.text
    if (!specifier.startsWith('.')) continue
    const base = path.join(path.dirname(file), specifier)
    for (const candidate of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`]) {
      if (existsSync(path.join(ROOT, candidate)) && /\.(?:ts|mjs)$/.test(candidate)) {
        out.push(candidate.split(path.sep).join('/'))
        break
      }
    }
  }
  return out
}

function callsGuard(file: string): boolean {
  let found = false
  walk(parse(file), (node) => {
    if (!found && isGuardCall(node)) found = true
  })
  return found
}

const FILES = gitFiles()
const BROWSER_SUITES = FILES.filter((file) => file.endsWith('.browser.test.ts'))

describe('every test browser is hermetic', () => {
  it('only the allowlisted files launch Playwright directly (exact set, both directions)', () => {
    const launchers = filesWith(FILES, /\b(?:chromium|firefox|webkit)\b/, isDirectLaunch)
    expect(launchers).toEqual(Object.keys(DIRECT_LAUNCHERS).sort())
  })

  it.each(Object.entries(MUST_ROUTE))('%s still applies the policy itself', (file, pattern) => {
    expect(readFileSync(path.join(ROOT, file), 'utf8')).toMatch(pattern)
  })

  it.each(BROWSER_SUITES)('%s installs the guard', (file) => {
    const viaImport = relativeImports(file).filter(callsGuard)
    expect(
      callsGuard(file) || viaImport.length > 0,
      `${file} opens pages without useHermeticBrowser() (scripts/lib/hermetic-browser.mjs)`,
    ).toBe(true)
  })

  it('never calls useHermeticBrowser() from a hook or a test, where its hooks would never run', () => {
    const misplaced: string[] = []
    for (const file of FILES) {
      // The guard's own test does it ON PURPOSE, to pin the runtime refusal.
      if (file === 'scripts/test/hermetic-browser.test.ts') continue
      if (!readFileSync(path.join(ROOT, file), 'utf8').includes('useHermeticBrowser(')) continue
      walk(parse(file), (node) => {
        if (!isGuardCall(node)) return
        for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
          if (!ts.isCallExpression(parent)) continue
          const name = rootName(parent.expression)
          if (name !== undefined && RUN_TIME_CALLBACKS.has(name)) {
            const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
            misplaced.push(`${file}:${line + 1} (inside ${name}(…))`)
            break
          }
        }
      })
    }
    expect(misplaced).toEqual([])
  })
})
