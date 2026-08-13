import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { z } from 'zod'

const execFileAsync = promisify(execFile)
import { lintSignalSource } from '@llui/compiler'
import type { ToolRegistry } from '../tool-registry.js'
import { findWorkspaceRoot } from '../index.js'
import { assertWithinWorkspace } from '../util/workspace.js'

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
      const workspaceRoot = findWorkspaceRoot()
      const rootDir = assertWithinWorkspace(args.rootDir ?? workspaceRoot, workspaceRoot)
      const pattern = `send\\(\\{[^}]*type:\\s*['"]${args.msgType}['"]`
      const hits = await grepHits(pattern, rootDir, ['*.ts', '*.tsx'])
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
      const workspaceRoot = findWorkspaceRoot()
      const rootDir = assertWithinWorkspace(args.rootDir ?? workspaceRoot, workspaceRoot)
      const pattern = `case\\s+['"]${args.msgType}['"]\\s*:`
      const hits = await grepHits(pattern, rootDir, ['*.ts', '*.tsx'])
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
      // Build the argv as discrete array entries — no shell, so a `"`,
      // `$(...)`, backtick, or `;` in `file`/`testName` is passed
      // literally to vitest and can never be reinterpreted as a command.
      const argv = ['exec', 'vitest', 'run']
      if (args.file) {
        argv.push(assertWithinWorkspace(args.file, workspaceRoot))
      }
      if (args.testName) {
        // `-t <pattern>` — the pattern is its own argv item, never
        // concatenated into a command string.
        argv.push('-t', args.testName)
      }
      try {
        const { stdout } = await execFileAsync('pnpm', argv, {
          cwd: workspaceRoot,
          encoding: 'utf8',
          timeout: 60_000,
        })
        return { passed: true, output: stdout.slice(-4000) }
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
      const workspaceRoot = findWorkspaceRoot()
      const rootDir = assertWithinWorkspace(args.rootDir ?? workspaceRoot, workspaceRoot)
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
          source = await readFile(file, 'utf8')
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

/**
 * Absolute paths git considers ignored under `rootDir`, or null when the
 * question cannot be answered (not a repo, no git on PATH).
 *
 * The hard-coded `SKIP_DIRS` above cannot express a VENDORED tree — a
 * gitignored checkout of somebody else's project sitting inside this one. In
 * this repo that is `benchmarks/js-framework-benchmark-repo/`, which
 * contributed 261 of the 1552 files this walk collected (~17%), every one of
 * them parsed with the TypeScript compiler on the way to answering a question
 * about THIS repo's message types. That is wrong on its own terms, not merely
 * slow: `llui_find_msg_producers` could return hits from code the user does
 * not own (issue #86).
 *
 * One `git ls-files` per scan, not one `check-ignore` per entry: the walk
 * discovers thousands of paths and spawning per path would cost far more than
 * the parsing this exists to avoid. `--directory` collapses a fully-ignored
 * tree to its directory, so the returned set stays small.
 */
function ignoredPaths(rootDir: string): Set<string> | null {
  try {
    const out = execFileSync(
      'git',
      [
        '-C',
        rootDir,
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '-z',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const set = new Set<string>()
    for (const rel of out.split('\0')) {
      if (rel === '') continue
      // `--directory` marks a collapsed directory with a trailing slash.
      set.add(join(rootDir, rel.endsWith('/') ? rel.slice(0, -1) : rel))
    }
    return set
  } catch {
    // Not a git repo, or git is unavailable. Fall back to SKIP_DIRS alone —
    // the previous behaviour, which is still correct, just less precise.
    return null
  }
}

function collectTsFiles(rootDir: string): string[] {
  const out: string[] = []
  const ignored = ignoredPaths(rootDir)
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
      if (ignored?.has(full)) continue
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

async function grepHits(pattern: string, rootDir: string, globs: string[]): Promise<GrepHit[]> {
  if (!existsSync(rootDir)) return []
  // Each flag, glob, the pattern, and the root dir are discrete argv
  // entries — grep receives them verbatim with no shell in between, so a
  // pattern or path containing `"`, `$(...)`, backticks, or `;` is matched
  // literally and can never spawn a subprocess. Async so a large-tree grep
  // doesn't block the shared event loop (stdio + relay WS + all tool calls).
  // `git grep` first, plain `grep` only as a fallback. Not for speed — for
  // CORRECTNESS: plain `grep -rn` has no exclusions whatsoever, so it walks
  // `node_modules`, `dist`, and any vendored checkout sitting in the tree, and
  // happily reports a `send({type:'inc'})` from somebody else's package as a
  // producer in this project. `git grep` searches TRACKED files only, which is
  // exactly the set "code that is part of this repo" (issue #86).
  //
  // It is also what makes this bounded: over this repo the untargeted walk
  // took long enough to blow a 5s test budget under load, because ~17% of what
  // it read belonged to a gitignored benchmark clone.
  const gitArgv = ['-C', rootDir, 'grep', '-nI', '--no-color', '-E', '-e', pattern, '--']
  for (const g of globs) gitArgv.push(g)
  try {
    const { stdout: out } = await execFileAsync('git', gitArgv, {
      encoding: 'utf8',
      timeout: 15_000,
    })
    // `git grep` prints paths relative to `rootDir` (we ran it with `-C`);
    // callers expect the same absolute paths plain grep produced.
    return parseGrepOutput(out, (f) => join(rootDir, f))
  } catch (err) {
    // Exit 1 means "no matches" for git grep too — a real failure (not a repo,
    // git absent) has a different code, and only that should fall through.
    const code = (err as { code?: unknown }).code
    if (code === 1) return []
  }
  const argv = ['-rn', '--color=never', '-E']
  for (const g of globs) argv.push(`--include=${g}`)
  for (const d of SKIP_DIRS) argv.push(`--exclude-dir=${d}`)
  argv.push(pattern, rootDir)
  try {
    const { stdout: out } = await execFileAsync('grep', argv, {
      encoding: 'utf8',
      timeout: 15_000,
    })
    return parseGrepOutput(out, (f) => f)
  } catch {
    return []
  }
}

function parseGrepOutput(out: string, toPath: (file: string) => string): GrepHit[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = /^(.+?):(\d+):(.+)$/.exec(line)
      if (!m) return null
      return { file: toPath(m[1]!), line: Number(m[2]), column: 1, context: m[3]!.trim() }
    })
    .filter((x): x is GrepHit => x !== null)
    .slice(0, 100)
}
