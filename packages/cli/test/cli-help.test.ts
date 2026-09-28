/**
 * CLI help and discovery text (#269). The help must teach the two surfaces — `llui add` copies
 * source, `@llui/components/<name>` imports a headless machine — without a hand-maintained
 * count, and `llui init` must print the same Registry skins stylesheet the docs prescribe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { main } from '../src/cli'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'llui-cli-help-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true })
})

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')))
  const code = await main(argv)
  vi.restoreAllMocks()
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('llui --help', () => {
  it('says that add and import are different artifacts, and where to see both', async () => {
    const { code, out } = await run('--help')
    expect(code).toBe(0)
    expect(out).toMatch(/llui add <name>\s+copies/)
    expect(out).toContain('@llui/components/<name>')
    expect(out).toMatch(/different artifacts/)
    expect(out).toMatch(/names can differ/)
    expect(out).toContain('llui list')
    expect(out).toContain('https://llui.dev/component-catalog')
  })

  it('names both styling paths and which one needs Tailwind', async () => {
    const { out } = await run('--help')
    expect(out).toMatch(/Registry skins.*Tailwind v4/)
    expect(out).toMatch(/Baseline theme.*no Tailwind/)
  })

  it('carries no hand-maintained count', async () => {
    const { out } = await run('--help')
    expect(out).not.toMatch(/\b\d+\s+(?:components?|items|machines|skins|aliases)\b/i)
  })
})

describe('llui init', () => {
  it('prints the Registry skins stylesheet in order, tw-animate-css included', async () => {
    const { code, out } = await run('init', '--cwd', cwd)
    expect(code).toBe(0)
    const lines = [
      "@import 'tailwindcss';",
      "@import 'tw-animate-css';",
      "@import '@llui/components/styles/tokens.css';",
      "@import '@llui/components/styles/tokens-dark.css';",
    ]
    const at = lines.map((line) => out.indexOf(line))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(out).toMatch(/Not styles\/theme\.css/)
  })
})
