import { describe, it, expect, afterEach } from 'vitest'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { LluiMcpServer } from '../src/index'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../')

describe('llui_find_msg_producers', () => {
  it('finds send() call sites for a known msg type in the examples', async () => {
    const server = new LluiMcpServer()
    const result = (await server.handleToolCall('llui_find_msg_producers', {
      msgType: 'inc',
      rootDir: resolve(ROOT, 'examples/counter/src'),
    })) as { hits: Array<{ file: string; line: number; column: number; context: string }> }
    expect(Array.isArray(result.hits)).toBe(true)
  })

  it('returns empty hits for a nonexistent msg type', async () => {
    const server = new LluiMcpServer()
    const result = (await server.handleToolCall('llui_find_msg_producers', {
      msgType: '__nonexistent_type_xyz__',
      rootDir: ROOT,
    })) as { hits: unknown[] }
    expect(result.hits.length).toBe(0)
  })
})

describe('llui_find_msg_handlers', () => {
  it('finds update() case branches for a known msg type', async () => {
    const server = new LluiMcpServer()
    const result = (await server.handleToolCall('llui_find_msg_handlers', {
      msgType: 'inc',
      rootDir: resolve(ROOT, 'examples/counter/src'),
    })) as { hits: unknown[] }
    expect(Array.isArray(result.hits)).toBe(true)
  })
})

describe('llui_run_test', () => {
  it('runs a specific test file and returns pass/fail', async () => {
    const server = new LluiMcpServer()
    const result = (await server.handleToolCall('llui_run_test', {
      file: resolve(ROOT, 'packages/mcp/test/mcp.test.ts'),
    })) as { passed: boolean; output: string }
    expect(typeof result.passed).toBe('boolean')
    expect(typeof result.output).toBe('string')
  }, 60_000)
})

describe('llui_compiler_diagnostics — fixes', () => {
  let fixtureDir: string | undefined
  afterEach(() => {
    if (fixtureDir && existsSync(fixtureDir)) rmSync(fixtureDir, { recursive: true, force: true })
    fixtureDir = undefined
  })

  it('emits a deterministic rename fix for convention / handler / attr-name', async () => {
    // The fixture must live INSIDE the workspace: llui_compiler_diagnostics
    // is workspace-scoped (path-traversal defense), so an os.tmpdir() path
    // is rejected by design.
    const dir = mkdtempSync(join(ROOT, 'packages/mcp/.tmp-fix-'))
    fixtureDir = dir
    writeFileSync(
      join(dir, 'c.tsx'),
      [
        "import { component, div, text } from '@llui/dom'",
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state, send }) => [div({ className: 'x', tabIndex: 0, onclick: () => send({ type: 'x' }) }, [text('hi')])],",
        '})',
      ].join('\n'),
    )
    const server = new LluiMcpServer()
    const result = (await server.handleToolCall('llui_compiler_diagnostics', {
      rootDir: dir,
    })) as {
      diagnostics: Array<{
        id: string
        severity: string
        fix?: { title: string; edits: Array<{ oldText: string; newText: string }> }
      }>
    }
    const byId = (id: string) => result.diagnostics.find((d) => d.id === id)

    const conv = byId('convention')
    expect(conv?.severity).toBe('warning') // auto-fixed by build → warning
    expect(conv?.fix?.edits[0]?.oldText).toBe('tabIndex')
    expect(conv?.fix?.edits[0]?.newText).toBe('tabindex')

    const handler = byId('event-handler-casing')
    expect(handler?.severity).toBe('error') // silent bug → blocking error
    expect(handler?.fix?.edits[0]?.newText).toBe('onClick')

    const attr = byId('attr-name')
    expect(attr?.fix?.edits[0]?.newText).toBe('class')
  })
})

describe('source tools — command injection hardening', () => {
  const sentinel = join(tmpdir(), `llui-mcp-pwned-${process.pid}-${Date.now()}`)

  afterEach(() => {
    if (existsSync(sentinel)) rmSync(sentinel)
  })

  it('does not execute an injected command in llui_run_test testName', async () => {
    const server = new LluiMcpServer()
    // A shell would interpret `; touch <sentinel>; #` as a separate
    // command. With execFileSync (no shell) it is passed to vitest as a
    // literal -t pattern, so the sentinel must never appear.
    await server.handleToolCall('llui_run_test', {
      file: resolve(ROOT, 'packages/mcp/test/mcp.test.ts'),
      testName: `nope"; touch ${sentinel}; echo "`,
    })
    expect(existsSync(sentinel)).toBe(false)
  }, 60_000)

  it('does not execute an injected command in llui_find_msg_producers msgType', async () => {
    const server = new LluiMcpServer()
    // msgType is interpolated into the grep -E pattern; a `$(...)` /
    // backtick / `;` must reach grep as literal regex text, not the shell.
    await server.handleToolCall('llui_find_msg_producers', {
      msgType: `x"; touch ${sentinel}; echo "`,
      rootDir: resolve(ROOT, 'examples/counter/src'),
    })
    expect(existsSync(sentinel)).toBe(false)
    const server2 = new LluiMcpServer()
    await server2.handleToolCall('llui_find_msg_producers', {
      msgType: 'x$(touch ' + sentinel + ')',
      rootDir: resolve(ROOT, 'examples/counter/src'),
    })
    expect(existsSync(sentinel)).toBe(false)
  })

  it('rejects a rootDir that escapes the workspace root', async () => {
    const server = new LluiMcpServer()
    await expect(
      server.handleToolCall('llui_find_msg_producers', {
        msgType: 'inc',
        rootDir: '/etc',
      }),
    ).rejects.toThrow(/escapes the workspace root/)
  })

  it('rejects a llui_run_test file that escapes the workspace root', async () => {
    const server = new LluiMcpServer()
    await expect(server.handleToolCall('llui_run_test', { file: '/etc/passwd' })).rejects.toThrow(
      /escapes the workspace root/,
    )
  })
})

describe('source tool list', () => {
  it('exposes the source tools', () => {
    const server = new LluiMcpServer()
    const names = server.getTools().map((t) => t.name)
    expect(names).toContain('llui_find_msg_producers')
    expect(names).toContain('llui_find_msg_handlers')
    expect(names).toContain('llui_run_test')
    // `llui_lint_project` was removed in the lint→compiler migration —
    // lint rules now emit as compiler errors.
    expect(names).not.toContain('llui_lint_project')
  })
})
