import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { killChild, spawnCli } from './kill-child'

// Integration test: `llui-mcp doctor` as a subcommand. Offline-only
// (no long-lived server), so the suite spawns the CLI, captures the
// summary, and checks the expected punch-list shape.

const CLI_PATH = resolve(__dirname, '../dist/cli.js')

interface DoctorRun {
  code: number | null
  stdout: string
  stderr: string
}

async function runDoctor(extraArgs: string[] = []): Promise<DoctorRun> {
  return new Promise<DoctorRun>((resolvePromise) => {
    const proc = spawn(process.execPath, [CLI_PATH, 'doctor', ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Strip NO_COLOR so the default test run exercises the emoji path
      // explicitly; the --plain test overrides.
      env: { ...process.env, NO_COLOR: undefined } as NodeJS.ProcessEnv,
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (b: Buffer) => (stdout += b.toString()))
    proc.stderr?.on('data', (b: Buffer) => (stderr += b.toString()))
    proc.on('exit', (code) => resolvePromise({ code, stdout, stderr }))
  })
}

describe('llui-mcp doctor', () => {
  it('prints the punch-list header + marker check', async () => {
    const run = await runDoctor()
    expect(run.stdout).toContain('llui-mcp doctor')
    expect(run.stdout).toContain('marker file')
    expect(run.stdout).toContain('bridge port')
    // Exit code mirrors overall state. In a clean repo with no MCP
    // running we expect failure (marker absent, port closed). Assert
    // the code is a number — the specific value depends on env.
    expect([0, 1]).toContain(run.code)
  })

  it('reports marker + pid when an MCP server is running', async () => {
    // Spawn an HTTP-mode MCP, wait for marker, run doctor. `--http 0`
    // asks the OS for a free port: a fixed one is machine-global, and two
    // concurrent runs of this file (two worktrees, CI fan-out) collided
    // on the bind — one of them then died on the startup timeout below
    // with no hint of the real cause (issue #85). Doctor discovers the
    // port from the marker file, so nothing here needs to know it.
    // `spawnCli` (not bare `spawn`) so the child leads its own process group
    // and teardown can reap it and anything it spawned — the second of the two
    // #192 guards, the first being the CLI's own parent watchdog.
    const server = spawnCli(process.execPath, [CLI_PATH, '--http', '0'])
    let stderr = ''
    server.stderr?.on('data', (b: Buffer) => (stderr += b.toString()))
    // Poll for the listening line. Generous cap (~30s): a cold `node`
    // spawn + MCP SDK load under parallel CI load can take many seconds,
    // and a tight cap let doctor run before the bridge was up. Breaks
    // immediately once the line appears, so the happy path stays fast.
    // The `finally` must cover the POLL as well as the assertions: the startup
    // timeout below is an error path like any other, and while it sat outside
    // the `try` it leaked the spawned CLI exactly the way a vitest timeout does
    // (#192).
    try {
      let listening = false
      for (let i = 0; i < 600; i++) {
        if (/HTTP transport on/.test(stderr)) {
          listening = true
          break
        }
        await delay(50)
      }
      if (!listening) throw new Error('[llui-mcp] did not start within 30s')
      const run = await runDoctor()
      expect(run.stdout).toMatch(/✓\s+marker file/)
      expect(run.stdout).toMatch(/✓\s+marker valid JSON/)
      expect(run.stdout).toMatch(/✓\s+bridge port \d+ listening/)
      expect(run.stdout).toMatch(/✓\s+marker pid \d+/)
    } finally {
      await killChild(server)
    }
    // KEPT deliberately above the shared 30 s `testTimeout` (`vitest.shared.ts`,
    // #147): the poll above is itself capped at 30 s, so an equal budget races
    // it, and 35 s lets the internal cap fire first every time.
    //
    // What that buys, precisely: the clear "did not start within 30s" instead
    // of a generic vitest timeout. It does NOT by itself prevent the orphan —
    // a vitest timeout tears the test down without running `finally` at all,
    // which is one of the ways #192 is produced, and no per-test budget can
    // change that. (Until the `try` was widened just above, the internal path
    // orphaned the child too, so the budget bought only the message.)
  }, 35000)

  it('falls back to OK/FAIL glyphs with --plain', async () => {
    const run = await runDoctor(['--plain'])
    expect(run.stdout).not.toContain('✓')
    expect(run.stdout).not.toContain('✗')
    // With no MCP running the doctor fails — we expect FAIL somewhere.
    expect(run.stdout).toMatch(/\bFAIL\b/)
  })

  it('honors NO_COLOR env var', async () => {
    const proc = spawn(process.execPath, [CLI_PATH, 'doctor'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    })
    let stdout = ''
    proc.stdout?.on('data', (b: Buffer) => (stdout += b.toString()))
    await new Promise<void>((resolvePromise) => proc.on('exit', () => resolvePromise()))
    expect(stdout).not.toContain('✓')
    expect(stdout).not.toContain('✗')
  })
})
