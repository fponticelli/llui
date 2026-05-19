import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { ToolRegistry } from '../tool-registry.js'
import { findWorkspaceRoot } from '../index.js'

export function registerSourceTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_find_msg_producers',
      description:
        'Find all send({type: "msgType"}) call sites in the project source. Returns file path, line, column, and surrounding context for each hit.',
      schema: z.object({
        msgType: z.string().describe('The Msg variant type string to search for'),
        rootDir: z
          .string()
          .optional()
          .describe('Root directory to search (defaults to workspace root)'),
      }),
    },
    'source',
    async (args, _ctx) => {
      const rootDir = args.rootDir ?? findWorkspaceRoot()
      const pattern = `send\\(\\{[^}]*type:\\s*['"]${args.msgType}['"]`
      const hits = grepHits(pattern, rootDir, ['*.ts', '*.tsx'])
      return { msgType: args.msgType, hits }
    },
  )

  registry.register(
    {
      name: 'llui_find_msg_handlers',
      description:
        'Find all update() function branches that handle a specific Msg variant. Returns file, line, column, and context for each case arm.',
      schema: z.object({
        msgType: z.string().describe('The Msg variant type string to search for'),
        rootDir: z
          .string()
          .optional()
          .describe('Root directory to search (defaults to workspace root)'),
      }),
    },
    'source',
    async (args, _ctx) => {
      const rootDir = args.rootDir ?? findWorkspaceRoot()
      const pattern = `case\\s+['"]${args.msgType}['"]\\s*:`
      const hits = grepHits(pattern, rootDir, ['*.ts', '*.tsx'])
      return { msgType: args.msgType, hits }
    },
  )

  registry.register(
    {
      name: 'llui_run_test',
      description:
        'Run a vitest test file (and optionally a specific test name). Returns pass/fail status and captured output.',
      schema: z.object({
        file: z.string().optional().describe('Absolute path to the test file'),
        testName: z.string().optional().describe('Test name pattern to filter (-t flag)'),
      }),
    },
    'source',
    async (args, _ctx) => {
      const workspaceRoot = findWorkspaceRoot()
      let cmd = `pnpm exec vitest run`
      if (args.file) cmd += ` "${args.file}"`
      if (args.testName) cmd += ` -t "${args.testName}"`
      try {
        const output = execSync(cmd, {
          cwd: workspaceRoot,
          encoding: 'utf8',
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        return { passed: true, output: output.slice(-4000) }
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string }
        const output = ((e.stdout ?? '') + (e.stderr ?? '')).slice(-4000)
        return { passed: false, output: output || e.message || 'Test failed' }
      }
    },
  )

  // The `llui_lint_project` tool was removed in the lint→compiler
  // migration (commit lint-migration-final). All LLui-specific lint
  // rules now emit as compiler errors via `@llui/compiler`; the build
  // pipeline surfaces them through `@llui/vite-plugin`. A future MCP
  // tool can expose those compiler diagnostics directly if needed.
}

interface GrepHit {
  file: string
  line: number
  column: number
  context: string
}

function grepHits(pattern: string, rootDir: string, globs: string[]): GrepHit[] {
  if (!existsSync(rootDir)) return []
  const globArgs = globs.map((g) => `--include="${g}"`).join(' ')
  try {
    const out = execSync(`grep -rn --color=never -E ${globArgs} "${pattern}" "${rootDir}"`, {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const m = /^(.+?):(\d+):(.+)$/.exec(line)
        if (!m) return null
        return { file: m[1]!, line: Number(m[2]), column: 1, context: m[3]!.trim() }
      })
      .filter((x): x is GrepHit => x !== null)
      .slice(0, 100)
  } catch {
    return []
  }
}
