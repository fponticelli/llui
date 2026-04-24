import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ToolRegistry } from '../tool-registry.js'
import { findWorkspaceRoot } from '../index.js'

export function registerSourceTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_find_msg_producers',
      description:
        'Find all send({type: "msgType"}) call sites in the project source. Returns file path, line, column, and surrounding context for each hit.',
      inputSchema: {
        type: 'object',
        properties: {
          msgType: { type: 'string', description: 'The Msg variant type string to search for' },
          rootDir: {
            type: 'string',
            description: 'Root directory to search (defaults to workspace root)',
          },
        },
        required: ['msgType'],
      },
    },
    'source',
    async (args, _ctx) => {
      const msgType = args.msgType as string
      const rootDir = (args.rootDir as string | undefined) ?? findWorkspaceRoot()
      const pattern = `send\\(\\{[^}]*type:\\s*['"]${msgType}['"]`
      const hits = grepHits(pattern, rootDir, ['*.ts', '*.tsx'])
      return { msgType, hits }
    },
  )

  registry.register(
    {
      name: 'llui_find_msg_handlers',
      description:
        'Find all update() function branches that handle a specific Msg variant. Returns file, line, column, and context for each case arm.',
      inputSchema: {
        type: 'object',
        properties: {
          msgType: { type: 'string', description: 'The Msg variant type string to search for' },
          rootDir: {
            type: 'string',
            description: 'Root directory to search (defaults to workspace root)',
          },
        },
        required: ['msgType'],
      },
    },
    'source',
    async (args, _ctx) => {
      const msgType = args.msgType as string
      const rootDir = (args.rootDir as string | undefined) ?? findWorkspaceRoot()
      const pattern = `case\\s+['"]${msgType}['"]\\s*:`
      const hits = grepHits(pattern, rootDir, ['*.ts', '*.tsx'])
      return { msgType, hits }
    },
  )

  registry.register(
    {
      name: 'llui_run_test',
      description:
        'Run a vitest test file (and optionally a specific test name). Returns pass/fail status and captured output.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Absolute path to the test file' },
          testName: { type: 'string', description: 'Test name pattern to filter (-t flag)' },
        },
      },
    },
    'source',
    async (args, _ctx) => {
      const workspaceRoot = findWorkspaceRoot()
      let cmd = `pnpm exec vitest run`
      if (args.file) cmd += ` "${args.file as string}"`
      if (args.testName) cmd += ` -t "${args.testName as string}"`
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

  registry.register(
    {
      name: 'llui_lint_project',
      description:
        'Run @llui/eslint-plugin rules across all TypeScript files in a directory. Returns a 0–20 idiomatic score, violation count, and per-file violations.',
      inputSchema: {
        type: 'object',
        properties: {
          rootDir: {
            type: 'string',
            description: 'Directory to lint (defaults to workspace root)',
          },
        },
      },
    },
    'source',
    async (args, _ctx) => {
      const rootDir = (args.rootDir as string | undefined) ?? findWorkspaceRoot()
      const workspaceRoot = findWorkspaceRoot()
      const target = resolve(rootDir, '**/*.{ts,tsx}')
      const cmd = `pnpm exec eslint --format json "${target}"`
      try {
        const output = execSync(cmd, {
          cwd: workspaceRoot,
          encoding: 'utf8',
          timeout: 60_000,
        })
        return parseEslintOutput(output)
      } catch (err: unknown) {
        const e = err as { stdout?: string }
        if (e.stdout) {
          try {
            return parseEslintOutput(e.stdout)
          } catch {
            // fall through
          }
        }
        return { score: 0, violations: [], fileCount: 0, error: 'ESLint failed' }
      }
    },
  )
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

function parseEslintOutput(output: string): {
  score: number
  violations: unknown[]
  fileCount: number
} {
  const results = JSON.parse(output) as Array<{ filePath: string; messages: unknown[] }>
  const violations = results.flatMap((r) => r.messages)
  const fileCount = results.length
  const score = Math.max(0, 20 - violations.length)
  return { score, violations, fileCount }
}
