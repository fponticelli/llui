import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * No test in this repository RETRIES (loose-h).
 *
 * `retry` re-runs a failed test and reports it green if any attempt passes. It
 * is therefore unable to tell a load transient from a real race, and it cannot
 * report which one it absorbed. The five sites this guard was written after
 * (agent-e2e and devmode-annotate package-wide, `@llui/agent`'s integration
 * test, both `@llui/mcp` Playwright describes, `vite-plugin`'s dirWatcher test)
 * all said the same thing — "timing-sensitive under full-repo parallel load,
 * retry the transient starvation, a deterministic test passes first try" —
 * and "passes first try" is exactly what cannot be observed while retry is on.
 * Removing it and running under measured load found:
 *
 *   - `devmode-annotate`'s "does not close/persist when the modal is closed"
 *     failed 10 of 10 runs, and alone and unloaded too. It was not load at
 *     all: the previous test's HUD, removed from the DOM without `destroy()`,
 *     was still live, and a PRODUCT bug let it and its successor both mirror
 *     into one localStorage key. Retry hid it because the first attempt's
 *     Escape happened to close the orphan's modal.
 *   - fixed sleeps and private deadlines standing in for protocol events that
 *     exist and can be awaited (`hello-ack`, `watch`, the relay's `onopen`),
 *     and a dynamic-import wait that passed only because an earlier test had
 *     warmed the module cache.
 *
 * Measurements and per-site detail: `docs/agents/tests-and-load.md`. Retry is
 * ALSO wrong for perf-ratio tests, for a different reason (#246): a transient
 * that reddens healthy code greens a real regression just as often.
 *
 * What is checked, and why each layer exists:
 *
 *   1. SOURCE: every file vitest loads as test code — test files, test support
 *      files, every vitest config and `vitest.shared.ts`, `scripts/`, and the
 *      private `@llui/agent-e2e` fixture package — parsed with TypeScript. Any
 *      object-literal property named `retry` (`{ retry: 2 }`, `{ 'retry': 2 }`,
 *      `{ retry }`, `['retry']: …`) or assignment to a `.retry` member is a
 *      finding. That covers per-test and per-describe options, `test.retry` in
 *      a config, and an options object hoisted into a variable. It is parsed,
 *      not grepped, so a comment or string that MENTIONS `retry: 2` (several
 *      explain its removal) is not a finding, and neither is a call to
 *      `@llui/effects`' `retry(...)` builder or a `retryOn` key.
 *   2. CLI: `--retry` in any package.json script or CI workflow step.
 *   3. RESOLVED CONFIG: `scripts/test/vitest-config-baseline.test.ts` loads
 *      every config and asserts `test.retry` is unset in each (and in every
 *      inline project), which catches a value this parse cannot see (computed,
 *      imported, merged in).
 *
 * A data literal in test code that legitimately needs a `retry` key would be a
 * false positive; rename it, or allowlist it below by FILE with the reason.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Files allowed to set `retry`, keyed by repo-relative path, each with a
 * MEASURED justification. Closed at both ends: an entry whose file no longer
 * has a finding fails too, so an exception cannot outlive its reason. Empty on
 * purpose — every retry this repo had was hiding a fixable cause.
 */
const RETRY_ALLOWED: Readonly<Record<string, string>> = {}

const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/
const DECLARATION = /\.d\.[cm]?ts$/

/** Is `path` test code — something vitest loads to run tests? */
function isTestCode(path: string): boolean {
  if (!SOURCE.test(path) || DECLARATION.test(path)) return false
  if (path.startsWith('scripts/')) return true
  if (path.startsWith('packages/agent-e2e/')) return true
  if (/(^|\/)vitest(\.[^/]+)?\.(config|shared)\.[cm]?[jt]s$/.test(path)) return true
  if (/(^|\/)(test|tests|__tests__)\//.test(path)) return true
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
}

/**
 * `git ls-files`, never a directory walk: `.claude/worktrees/` is gitignored
 * and holds a full checkout of every sibling lane (see
 * `vitest-config-baseline.test.ts`). Tracked plus untracked-but-not-ignored,
 * so a new file is covered before it is staged.
 */
function repoFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((path) => path.length > 0)
    .sort()
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
    return name.expression.text
  }
  return null
}

/** Every place `source` sets `retry`, as `line: text` (1-based line). */
function findRetrySettings(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path))
  const found: string[] = []
  const report = (node: ts.Node): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    found.push(`${line + 1}: ${node.getText(file).split('\n')[0]!.trim()}`)
  }
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node)) &&
      ts.isObjectLiteralExpression(node.parent) &&
      propertyNameText(node.name) === 'retry'
    ) {
      report(node)
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ((ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'retry') ||
        (ts.isElementAccessExpression(node.left) &&
          ts.isStringLiteralLike(node.left.argumentExpression) &&
          node.left.argumentExpression.text === 'retry'))
    ) {
      report(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** `--retry` in a shell command line (`--retry 2`, `--retry=2`). */
const CLI_RETRY = /(^|\s)--retry(?=[\s=]|$)/

const files = repoFiles()
const testCode = files.filter(isTestCode)

describe('no test retries', () => {
  it('the detector finds every way to set retry, and nothing that only mentions it', () => {
    const positives = [
      `it('x', { retry: 2 }, () => {})`,
      `describe.skipIf(!pw)('x', { retry: 2 }, () => {})`,
      `const opts = { timeout: 5, 'retry': 1 }`,
      `const retry = 3; test('x', { retry }, () => {})`,
      `export default defineConfig({ test: { ['retry']: 2 } })`,
      `config.test.retry = 2`,
      `task['retry'] = 1`,
    ]
    for (const source of positives) {
      expect(findRetrySettings('probe.test.ts', source), source).toHaveLength(1)
    }
    const negatives = [
      `// With \`retry: 2\` that is three consecutive hook timeouts`,
      `/* { retry: 2 } looked like the free answer */`,
      `const s = 'retry: 2'`,
      `retry(http(), { maxAttempts: 3, retryOn: () => true })`,
      `expect(res.headers.get('retry-after')).toBe('30')`,
      `const { retry } = stressConfig.test ?? {}`,
      `expect(stressConfig.test?.retry ?? 0).toBe(0)`,
      `send({ type: 'retry' })`,
    ]
    for (const source of negatives) {
      expect(findRetrySettings('probe.test.ts', source), source).toEqual([])
    }
    expect(CLI_RETRY.test('vitest run --retry 2')).toBe(true)
    expect(CLI_RETRY.test('vitest run --retry=2')).toBe(true)
    expect(CLI_RETRY.test('curl --retry-all-errors')).toBe(false)
  })

  it('scans the test code this repository owns, and nothing of a sibling worktree', () => {
    expect(testCode.filter((path) => path.startsWith('.claude/'))).toEqual([])
    // Sentinels on both sides of the classifier: every former retry site (as
    // configs, test files, fixture sources and support files) is IN, product
    // sources that use a `retry:` key for their own data are OUT.
    for (const path of [
      'vitest.shared.ts',
      'vitest.scripts.config.ts',
      'packages/agent-e2e/vitest.config.ts',
      'packages/agent-e2e/src/test-utils.ts',
      'packages/agent-e2e/test/wait.e2e.test.ts',
      'packages/devmode-annotate/vitest.config.ts',
      'packages/devmode-annotate/test/support/hud-teardown.ts',
      'packages/agent/test/client/integration.test.ts',
      'packages/mcp/test/playwright-e2e.test.ts',
      'packages/mcp/test/support/state-dir.ts',
      'packages/vite-plugin/test/mcp-watch.test.ts',
      'packages/lexical-loro/vitest.stress.config.ts',
      'scripts/lib/wait-until.mjs',
      'registry/vitest.config.ts',
      'examples/component-gallery/vitest.config.ts',
    ]) {
      expect(testCode, path).toContain(path)
    }
    for (const path of [
      'packages/effects/src/resolve.ts',
      'packages/components/src/locale/file-upload.ts',
      'packages/devmode-annotate/src/index.ts',
      'scripts/lib/wait-until.d.mts',
    ]) {
      expect(files, path).toContain(path)
      expect(testCode, path).not.toContain(path)
    }
  })

  it('no test file, support file or vitest config sets retry', () => {
    const findings: Record<string, string[]> = {}
    for (const path of testCode) {
      const source = readFileSync(resolve(repoRoot, path), 'utf8')
      // Parse only what can possibly match: a file that never spells `retry`
      // cannot set it, and parsing all ~900 files costs ~5 s for nothing.
      if (!source.includes('retry')) continue
      const hits = findRetrySettings(path, source)
      if (hits.length > 0) findings[path] = hits
    }
    const unexcused = Object.fromEntries(
      Object.entries(findings).filter(([path]) => !(path in RETRY_ALLOWED)),
    )
    expect(unexcused, 'remove the retry and fix the timing it hides').toEqual({})
    // Closed at the other end: an exception whose file no longer retries goes.
    const stale = Object.keys(RETRY_ALLOWED).filter((path) => !(path in findings))
    expect(stale, 'allowlisted files that no longer set retry').toEqual([])
  })

  it('no package script or CI step passes --retry to a test runner', () => {
    const offenders: string[] = []
    for (const path of files.filter((p) => /(^|\/)package\.json$/.test(p))) {
      const parsed: unknown = JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))
      const scripts = (parsed as { scripts?: Record<string, string> }).scripts ?? {}
      for (const [name, command] of Object.entries(scripts)) {
        if (CLI_RETRY.test(command)) offenders.push(`${path}: ${name}`)
      }
    }
    for (const path of files.filter((p) => /^\.github\/workflows\/.+\.ya?ml$/.test(p))) {
      readFileSync(resolve(repoRoot, path), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!line.trimStart().startsWith('#') && CLI_RETRY.test(line)) {
            offenders.push(`${path}:${index + 1}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})
