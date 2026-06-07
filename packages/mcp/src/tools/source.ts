import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { lintSignalSource } from '@llui/compiler'
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
        'Run the @llui/compiler signal lint rules against every .ts/.tsx file in a directory and return the union of structured diagnostics. Each diagnostic has { id, severity, category, message, file, line, column } — the same rules the vite-plugin surfaces as build errors. Rename-style rules (convention, event-handler-casing, attr-name) also include a `fix` { title, edits: [{ start, end, oldText, newText }] } you can apply directly to the source. Use this to inspect a project for LLui rule violations without spinning up a full Vite build.',
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
        // Present for rename-style rules — a deterministic fix the agent can
        // apply (offsets into the file, plus the old/new text for a string edit).
        fix?: {
          title: string
          edits: Array<{ start: number; end: number; oldText: string; newText: string }>
        }
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
        let msgs: ReturnType<typeof lintSignalSource>
        try {
          msgs = lintSignalSource(source, file)
        } catch (err) {
          failed++
          diagnostics.push({
            id: 'llui/internal-error',
            severity: 'error',
            category: 'internal',
            message: `lintSignalSource threw: ${(err as Error).message ?? String(err)}`,
            file: relative(rootDir, file),
            line: 1,
            column: 1,
          })
          continue
        }
        for (const m of msgs) {
          if (idFilter && !m.rule.includes(idFilter)) continue
          diagnostics.push({
            id: m.rule,
            // `convention` is auto-fixed by the build (runtime-neutral); surface
            // it as a warning. Everything else halts the build → error.
            severity: m.rule === 'convention' ? 'warning' : 'error',
            category: 'signal',
            message: m.message,
            file: relative(rootDir, file),
            line: m.line,
            column: m.column + 1,
            ...(m.fix
              ? {
                  fix: {
                    title: m.fix.title,
                    edits: m.fix.edits.map((e) => ({
                      start: e.start,
                      end: e.end,
                      oldText: source.slice(e.start, e.end),
                      newText: e.newText,
                    })),
                  },
                }
              : {}),
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
