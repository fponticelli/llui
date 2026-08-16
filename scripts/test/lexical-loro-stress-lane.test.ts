import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import normalConfig from '../../packages/lexical-loro/vitest.config.js'
import stressConfig from '../../packages/lexical-loro/vitest.stress.config.js'

const root = resolve(import.meta.dirname, '../..')

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>
}

describe('@llui/lexical-loro test lanes', () => {
  it('keeps deep stress tests out of the default package command', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'packages/lexical-loro/package.json'), 'utf8'),
    ) as PackageManifest

    expect(manifest.scripts?.['test']).toBe('vitest run')
    expect(manifest.scripts?.['test:contention']).toBe(
      'node ../../scripts/with-cpu-contention.mjs -- pnpm exec vitest run test/convergence.test.ts test/convergence-attack.test.ts test/to-loro.test.ts test/harden.test.ts --reporter=verbose',
    )
    expect(normalConfig.test?.include).toEqual(['test/**/*.test.ts'])
    expect(normalConfig.test?.include).not.toContain('test/stress/**/*.stress.ts')
  })

  it('exposes the deep suite through one dedicated package command and budget', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'packages/lexical-loro/package.json'), 'utf8'),
    ) as PackageManifest

    expect(manifest.scripts?.['test:stress']).toBe('vitest run --config vitest.stress.config.ts')
    expect(stressConfig.test?.include).toEqual(['test/stress/**/*.stress.ts'])
    expect(stressConfig.test?.testTimeout).toBeGreaterThan(30_000)
    expect(stressConfig.test?.retry ?? 0).toBe(0)
  })

  it('schedules the package stress command daily and permits manual dispatch only', () => {
    const workflow = readFileSync(
      resolve(root, '.github/workflows/lexical-loro-stress.yml'),
      'utf8',
    )

    expect(workflow).toMatch(/^on:\n {2}schedule:\n {4}- cron: '[^']+'\n {2}workflow_dispatch:/m)
    expect(workflow).not.toMatch(/^ {2}(?:push|pull_request):/m)
    expect(workflow).toMatch(/^ {4}timeout-minutes: [1-9][0-9]*$/m)
    expect(workflow).toContain('run: pnpm --filter @llui/lexical-loro test:stress')
    expect(workflow).not.toContain('continue-on-error: true')
  })
})
