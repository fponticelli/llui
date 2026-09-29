import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Every ephemeral-port server in test code binds an EXPLICIT host.
 *
 * `server.listen(0)` binds the wildcard `::`. On macOS (BSD sockets) a second
 * process may then bind the SAME port on the more specific `127.0.0.1`, and
 * the kernel routes `127.0.0.1:<port>` to that one. Under a parallel
 * `pnpm -r run test`, with dozens of test servers taking ephemeral ports, a
 * test dialling `127.0.0.1` reached an unrelated server that hung up:
 * `@llui/agent`'s integration test failed with `UND_ERR_SOCKET other side
 * closed` after writing its request and reading 0 bytes. Reproduced
 * directly — a `::` listener and a `127.0.0.1` listener on one port, and the
 * fetch lands on the latter. Vite's default host `localhost` has the same
 * hole (it may bind `::1` while the client resolves `127.0.0.1`).
 *
 * Binding `127.0.0.1` makes the kernel refuse the clash instead, so a port
 * number names exactly one server. Linux (CI) rejects the overlapping bind
 * by default, which is why this only ever failed locally.
 *
 * Findings, parsed (not grepped) over the same test-code set as
 * `no-test-retry.test.ts`:
 *   - `x.listen(0)`, `x.listen(0, cb)`, `x.listen({ port: 0 })` — no host;
 *   - a Vite `server` / `preview` option object with `port: 0` and no `host`.
 *
 * A `{ port: 0 }` passed to anything else is an option of that API, which
 * binds wherever it binds (e.g. `WebSocketRelayTransport` binds `127.0.0.1`
 * itself), so it is not a finding.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/
const DECLARATION = /\.d\.[cm]?ts$/

function isTestCode(path: string): boolean {
  if (!SOURCE.test(path) || DECLARATION.test(path)) return false
  if (path.startsWith('scripts/')) return true
  if (path.startsWith('packages/agent-e2e/')) return true
  if (/(^|\/)vitest(\.[^/]+)?\.(config|shared)\.[cm]?[jt]s$/.test(path)) return true
  if (/(^|\/)(test|tests|__tests__)\//.test(path)) return true
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
}

/** `git ls-files`, never a directory walk (`.claude/worktrees/` is ignored). */
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

/** Vite option objects that configure a bind. */
const VITE_BIND_OPTIONS: ReadonlySet<string> = new Set(['server', 'preview'])

const isZero = (node: ts.Node): boolean => ts.isNumericLiteral(node) && node.text === '0'

function propertyNamed(object: ts.ObjectLiteralExpression, name: string): ts.Node | undefined {
  for (const property of object.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name
    ) {
      return property
    }
  }
  return undefined
}

/** `{ port: 0 }` with no `host` beside it. */
function isHostlessEphemeral(node: ts.Node): node is ts.ObjectLiteralExpression {
  if (!ts.isObjectLiteralExpression(node)) return false
  const port = propertyNamed(node, 'port')
  return (
    port !== undefined &&
    ts.isPropertyAssignment(port) &&
    isZero(port.initializer) &&
    propertyNamed(node, 'host') === undefined
  )
}

/** Every host-less ephemeral bind in `source`, as `line: text` (1-based). */
function findHostlessBinds(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path))
  const found: string[] = []
  const report = (node: ts.Node): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    found.push(`${line + 1}: ${node.getText(file).split('\n')[0]!.trim()}`)
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'listen' &&
      node.arguments.length > 0 &&
      isZero(node.arguments[0]!)
    ) {
      const second = node.arguments[1]
      if (second === undefined || ts.isArrowFunction(second) || ts.isFunctionExpression(second)) {
        report(node)
      } else if (ts.isIdentifier(second) && node.arguments.length === 2) {
        // `listen(0, resolve)`: a lone identifier after the port is the
        // callback, not a host (a host would be followed by the callback).
        report(node)
      }
    } else if (
      isHostlessEphemeral(node) &&
      ((ts.isPropertyAssignment(node.parent) &&
        ts.isIdentifier(node.parent.name) &&
        VITE_BIND_OPTIONS.has(node.parent.name.text)) ||
        (ts.isCallExpression(node.parent) &&
          ts.isPropertyAccessExpression(node.parent.expression) &&
          node.parent.expression.name.text === 'listen'))
    ) {
      report(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

const testCode = repoFiles().filter(isTestCode)

describe('ephemeral test servers bind an explicit host', () => {
  it('the detector finds every host-less ephemeral bind, and nothing that names a host', () => {
    const positives = [
      `server.listen(0)`,
      `server.listen(0, () => resolve())`,
      `server.listen(0, resolve)`,
      `server.listen(0, function () {})`,
      `http.createServer().listen({ port: 0 })`,
      `createServer({ server: { port: 0, strictPort: false } })`,
      `preview({ preview: { port: 0 } })`,
    ]
    for (const source of positives) {
      expect(findHostlessBinds('probe.test.ts', source), source).toHaveLength(1)
    }
    const negatives = [
      `server.listen(0, '127.0.0.1')`,
      `server.listen(0, '127.0.0.1', () => resolve())`,
      `server.listen(0, host, resolve)`,
      `server.listen({ port: 0, host: '127.0.0.1' })`,
      `createServer({ server: { host: '127.0.0.1', port: 0 } })`,
      `server.listen(port, host)`,
      `server.listen(8080)`,
      `const o = { port: 3000 }`,
      `// server.listen(0) binds the wildcard`,
      `new WebSocketRelayTransport({ port: 0 })`,
      `const options = { port: 0 }`,
    ]
    for (const source of negatives) {
      expect(findHostlessBinds('probe.test.ts', source), source).toEqual([])
    }
  })

  it('scans the test code this repository owns, and nothing of a sibling worktree', () => {
    expect(testCode.filter((path) => path.startsWith('.claude/'))).toEqual([])
    for (const path of [
      'packages/agent/test/client/integration.test.ts',
      'packages/agent/test/server/ws/upgrade.test.ts',
      'packages/agent-bridge/test/bridge.test.ts',
      'packages/agent-e2e/src/harness.ts',
      'packages/mcp/test/playwright-e2e.test.ts',
    ]) {
      expect(testCode, path).toContain(path)
    }
    expect(testCode).not.toContain('packages/mcp/src/cli.ts')
  })

  it('no test server binds an ephemeral port without a host', () => {
    const findings: Record<string, string[]> = {}
    for (const path of testCode) {
      const hits = findHostlessBinds(path, readFileSync(resolve(repoRoot, path), 'utf8'))
      if (hits.length > 0) findings[path] = hits
    }
    expect(findings).toEqual({})
  })
})
