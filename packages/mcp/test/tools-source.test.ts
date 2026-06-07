import { describe, it, expect } from 'vitest'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
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
  it('emits a deterministic rename fix for convention / handler / attr-name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llui-mcp-fix-'))
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
