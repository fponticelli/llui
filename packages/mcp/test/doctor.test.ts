import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

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
    // Spawn an HTTP-mode MCP, wait for marker, run doctor.
    const port = 15230
    const server = spawn(process.execPath, [CLI_PATH, '--http', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    server.stderr?.on('data', (b: Buffer) => (stderr += b.toString()))
    // Poll for the listening line.
    for (let i = 0; i < 40; i++) {
      if (/HTTP transport on/.test(stderr)) break
      await delay(50)
    }
    try {
      const run = await runDoctor()
      expect(run.stdout).toMatch(/✓\s+marker file/)
      expect(run.stdout).toMatch(/✓\s+marker valid JSON/)
      expect(run.stdout).toMatch(/✓\s+bridge port \d+ listening/)
      expect(run.stdout).toMatch(/✓\s+marker pid \d+/)
    } finally {
      server.kill('SIGTERM')
      await delay(100)
    }
  }, 6000)

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
