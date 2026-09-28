// @ts-check
/**
 * Recording the Component Gallery's visual baselines IN CI'S OWN ENVIRONMENT
 * (#268). A screenshot baseline is only reproducible on the browser build and
 * platform that produced it, and CI's `verify` job runs inside the official
 * Playwright image named in `.github/workflows/ci.yml` — so baselines are
 * recorded in that same image, on linux/amd64 (the runner's architecture).
 * `scripts/test/visual-container.test.ts` pins the image to the one `ci.yml`
 * uses, so the two cannot drift apart.
 *
 * The repository is mounted READ-ONLY and copied inside the container
 * (without `node_modules`, `dist` or sibling worktrees): installing into the
 * mounted tree would replace the host's platform-specific `node_modules`.
 * Only the baseline directory is mounted writable.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const BASELINE_RELATIVE = 'examples/component-gallery/test/visual-baselines'

/**
 * The `container.image` of CI's `verify` job, read from the workflow itself.
 * @param {string} root
 * @returns {string}
 */
export function ciPlaywrightImage(root) {
  const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
  const match = /^\s+image:\s*(mcr\.microsoft\.com\/playwright:\S+)\s*$/m.exec(workflow)
  if (match === null || match[1] === undefined) {
    throw new Error(
      '.github/workflows/ci.yml names no mcr.microsoft.com/playwright container image',
    )
  }
  return match[1]
}

/** The script the container runs, fail-fast. */
export const CONTAINER_SCRIPT = [
  'set -euo pipefail',
  'mkdir -p /work',
  // Copy the source tree, never anything installed or built on the host.
  "tar -C /src --exclude='./.claude' --exclude='*/node_modules' --exclude='./node_modules'" +
    " --exclude='*/dist' --exclude='./.turbo' --exclude='./.visual-output' -cf - . | tar -C /work -xf -",
  'cd /work',
  'corepack enable',
  'pnpm install --frozen-lockfile',
  "pnpm turbo build '--filter=@llui/example-component-gallery^...'",
  'LLUI_VISUAL_UPDATE=1 pnpm --filter @llui/example-component-gallery exec vitest run --project browser test/cases.browser.test.ts',
  'find /out -mindepth 1 -delete',
  `cp -a ${BASELINE_RELATIVE}/. /out/`,
].join('\n')

/**
 * @param {{ root: string, image: string }} options
 * @returns {string[]}
 */
export function dockerRunArgs({ root, image }) {
  return [
    'run',
    '--rm',
    '--init',
    // CI's runner is x86-64; a baseline recorded on another architecture is
    // refused by the gate (the manifest records the environment).
    '--platform',
    'linux/amd64',
    '--ipc=host',
    '--mount',
    `type=bind,src=${root},dst=/src,readonly`,
    '--mount',
    `type=bind,src=${resolve(root, BASELINE_RELATIVE)},dst=/out`,
    '--env',
    'CI=1',
    image,
    'bash',
    '-c',
    CONTAINER_SCRIPT,
  ]
}
