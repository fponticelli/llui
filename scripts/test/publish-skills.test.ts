import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const readSkill = (owner: '.agents' | '.claude'): string =>
  readFileSync(resolve(repoRoot, owner, 'skills/publish/SKILL.md'), 'utf8')

describe('publish skill mirrors', () => {
  const codex = readSkill('.agents')
  const claude = readSkill('.claude')

  it('keeps the Codex and Claude workflows byte-for-byte identical', () => {
    expect(codex).toBe(claude)
  })

  it('regenerates, builds, commits, and deploy-verifies llui.dev', () => {
    for (const skill of [codex, claude]) {
      expect(skill).toContain('pnpm --filter @llui/site generate')
      expect(skill).toContain('pnpm --filter @llui/site build')
      expect(skill).toContain('site/content/api')
      expect(skill).toContain('site/public/llms.txt')
      expect(skill).toContain('site/public/llms-full.txt')
      expect(skill).toContain('.github/workflows/deploy-docs.yml')
      expect(skill).toContain('https://llui.dev')
    }
  })
})
