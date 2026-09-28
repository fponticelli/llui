/**
 * The Component Gallery visual gate's WIRING (#268): where baselines are
 * recorded, how CI requires them, and how a failing run hands the maintainer
 * a complete CI-environment candidate set. Each of these is one line in one
 * file, and each silently switches the gate off if it drifts — a baseline
 * recorded in another image never compares, and a CI step without
 * `LLUI_VISUAL_REQUIRED` falls back to a determinism check and goes green.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BASELINE_RELATIVE,
  CONTAINER_SCRIPT,
  ciPlaywrightImage,
  dockerRunArgs,
} from '../lib/visual-container.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')

/** The body of one named `ci.yml` step, from its `- name:` to the next step. */
function ciStep(name: string): string {
  const workflow = read('.github/workflows/ci.yml')
  const start = workflow.indexOf(`      - name: ${name}\n`)
  expect(start, `ci.yml step "${name}"`).toBeGreaterThan(-1)
  const next = workflow.indexOf('\n      - ', start + 1)
  return workflow.slice(start, next === -1 ? undefined : next)
}

describe('visual baselines are recorded where CI compares them', () => {
  it("records in CI's own Playwright image, pinned to the locked playwright version", () => {
    const image = ciPlaywrightImage(root)
    const lock = read('pnpm-lock.yaml')
    const locked = /\n {2}playwright@(\d+\.\d+\.\d+):/.exec(lock)?.[1]
    expect(locked).toBeDefined()
    expect(image).toBe(`mcr.microsoft.com/playwright:v${locked}-noble`)
  })

  it('mounts the repository read-only and only the baseline directory writable, on amd64', () => {
    const args = dockerRunArgs({ root, image: 'IMAGE' })
    expect(args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(args).toContain(`type=bind,src=${root},dst=/src,readonly`)
    expect(args).toContain(`type=bind,src=${path.join(root, BASELINE_RELATIVE)},dst=/out`)
    expect(args[args.indexOf('--platform') + 1]).toBe('linux/amd64')
    expect(args.slice(-4)).toEqual(['IMAGE', 'bash', '-c', CONTAINER_SCRIPT])
  })

  it('re-records through the real gate, in update mode, from a clean install', () => {
    expect(CONTAINER_SCRIPT).toMatch(/^set -euo pipefail\n/)
    expect(CONTAINER_SCRIPT).toContain('pnpm install --frozen-lockfile')
    expect(CONTAINER_SCRIPT).toContain(
      'LLUI_VISUAL_UPDATE=1 pnpm --filter @llui/example-component-gallery exec vitest run --project browser test/cases.browser.test.ts',
    )
    expect(
      existsSync(path.join(root, 'examples/component-gallery/test/cases.browser.test.ts')),
    ).toBe(true)
    expect(CONTAINER_SCRIPT).toContain(`cp -a ${BASELINE_RELATIVE}/. /out/`)
    // Never the host's installed or built trees.
    for (const excluded of ['*/node_modules', '*/dist', './.claude']) {
      expect(CONTAINER_SCRIPT).toContain(`--exclude='${excluded}'`)
    }
    const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(manifest.scripts['gallery:visual:update']).toBe('node scripts/run-visual-container.mjs')
  })
})

describe('CI requires the visual gate and keeps its evidence', () => {
  it('runs the test step with baselines REQUIRED and a relative output directory', () => {
    const step = ciStep('Test')
    expect(step).toMatch(/\n {10}LLUI_VISUAL_REQUIRED: '1'\n/)
    expect(step).toMatch(/\n {10}LLUI_VISUAL_OUTPUT: \.visual-output\n/)
  })

  it('uploads that directory when the job fails', () => {
    const step = ciStep('Upload visual gate output')
    expect(step).toContain('if: failure()')
    expect(step).toContain('uses: actions/upload-artifact@')
    expect(step).toMatch(/\n {10}path: \.visual-output\n/)
    expect(step).toContain('name: visual-baselines')
  })

  it('declares the gate’s variables to turbo and ignores its output', () => {
    const turbo = JSON.parse(read('examples/component-gallery/turbo.json')) as {
      tasks: { test: { env: string[] } }
    }
    expect(turbo.tasks.test.env).toEqual(
      expect.arrayContaining(['LLUI_VISUAL_OUTPUT', 'LLUI_VISUAL_REQUIRED', 'LLUI_VISUAL_UPDATE']),
    )
    expect(read('.gitignore')).toMatch(/^\.visual-output\/$/m)
  })
})
