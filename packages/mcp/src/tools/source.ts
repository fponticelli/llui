import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { transformLlui } from '@llui/compiler'
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

  registry.register(
    {
      name: 'llui_compiler_diagnostics',
      description:
        'Run @llui/compiler against every .ts/.tsx file in a directory and return the union of structured diagnostics. Each diagnostic has { id, severity, category, message, location: { file, range } } — same shape the vite-plugin surfaces as build errors. Use this to inspect a project for LLui rule violations without spinning up a full Vite build.',
      schema: z.object({
        rootDir: z.string().optional().describe('Directory to scan (defaults to workspace root)'),
        idFilter: z
          .string()
          .optional()
          .describe(
            'Optional substring filter on diagnostic id — e.g. "agent-emits" matches both agent-emits-drift entries.',
          ),
      }),
    },
    'source',
    async (args, _ctx) => {
      const rootDir = args.rootDir ?? findWorkspaceRoot()
      const idFilter = args.idFilter
      const files = collectTsFiles(rootDir)
      const diagnostics: Array<{
        id: string
        severity: string
        category: string
        message: string
        file: string
        line: number
        column: number
      }> = []
      let scanned = 0
      let failed = 0
      for (const file of files) {
        scanned++
        let source: string
        try {
          source = readFileSync(file, 'utf8')
        } catch {
          failed++
          continue
        }
        let result: ReturnType<typeof transformLlui>
        try {
          result = transformLlui(source, file)
        } catch (err) {
          failed++
          diagnostics.push({
            id: 'llui/internal-error',
            severity: 'error',
            category: 'internal',
            message: `transformLlui threw: ${(err as Error).message ?? String(err)}`,
            file: relative(rootDir, file),
            line: 1,
            column: 1,
          })
          continue
        }
        if (!result) continue
        for (const d of result.diagnostics) {
          if (idFilter && !d.id.includes(idFilter)) continue
          diagnostics.push({
            id: d.id,
            severity: d.severity,
            category: d.category,
            message: d.message,
            file: relative(rootDir, d.location.file),
            line: d.location.range.start.line + 1,
            column: d.location.range.start.column + 1,
          })
        }
      }
      return { scanned, failed, diagnostics }
    },
  )
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', '__fixtures__'])

function collectTsFiles(rootDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      if (entry.startsWith('.') && entry !== '.eslintrc.ts') continue
      const full = join(dir, entry)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if (st.isFile() && (entry.endsWith('.ts') || entry.endsWith('.tsx'))) {
        if (entry.endsWith('.d.ts')) continue
        out.push(full)
      }
    }
  }
  walk(rootDir)
  return out
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
