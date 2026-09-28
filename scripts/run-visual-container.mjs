#!/usr/bin/env node
// @ts-check
/**
 * `pnpm gallery:visual:update` — re-record the Component Gallery's visual
 * baselines in CI's Playwright image (see `scripts/lib/visual-container.mjs`).
 *
 * The alternative that needs no Docker: every CI run that cannot compare
 * (no baselines yet, or a new browser build) uploads a complete candidate set
 * captured in CI as the `visual-baselines` artifact; review it and commit it
 * as `examples/component-gallery/test/visual-baselines/`.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BASELINE_RELATIVE, ciPlaywrightImage, dockerRunArgs } from './lib/visual-container.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(resolve(root, BASELINE_RELATIVE), { recursive: true })
const result = spawnSync('docker', dockerRunArgs({ root, image: ciPlaywrightImage(root) }), {
  cwd: root,
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.signal !== null) throw new Error(`docker terminated by ${result.signal}`)
process.exit(result.status ?? 1)
