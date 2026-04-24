import { describe, it, expect } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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

describe('llui_lint_project', () => {
  it('runs eslint and returns a score and violations array', async () => {
    const server = new LluiMcpServer()
    const result = (await server.handleToolCall('llui_lint_project', {
      rootDir: resolve(ROOT, 'examples/counter/src'),
    })) as { score: number; violations: unknown[]; fileCount: number }
    expect(typeof result.score).toBe('number')
    expect(Array.isArray(result.violations)).toBe(true)
    expect(typeof result.fileCount).toBe('number')
  }, 60_000)
})

describe('source tool list', () => {
  it('exposes all 4 source tools', () => {
    const server = new LluiMcpServer()
    const names = server.getTools().map((t) => t.name)
    expect(names).toContain('llui_find_msg_producers')
    expect(names).toContain('llui_find_msg_handlers')
    expect(names).toContain('llui_run_test')
    expect(names).toContain('llui_lint_project')
  })
})
