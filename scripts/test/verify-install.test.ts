import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import {
  directDependencies,
  expectedPackages,
  installState,
  missingPackages,
} from '../lib/verify-install'

/**
 * Regression cover for the install verification `pnpm bench:setup` runs (#81).
 *
 * These build a synthetic install tree in a temp dir — the real subject is a
 * ~600 MB js-framework-benchmark clone, which is neither committable nor
 * cheap to produce, and every rule under test is a pure function of a
 * lockfile plus which directories exist.
 */

interface LockEntry {
  readonly version?: string
  readonly optional?: boolean
  readonly os?: readonly string[]
}

let dir = ''

function writeTree(options: {
  readonly manifest: Record<string, unknown>
  readonly lock: Record<string, LockEntry>
  /** Lock paths to actually materialize on disk. */
  readonly present: readonly string[]
  /** Omit npm's install stamp, as an unrun install would. */
  readonly stamp?: boolean
}): void {
  writeFileSync(resolve(dir, 'package.json'), JSON.stringify(options.manifest))
  writeFileSync(
    resolve(dir, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { '': options.manifest, ...options.lock } }),
  )
  for (const path of options.present) {
    mkdirSync(resolve(dir, path), { recursive: true })
    writeFileSync(resolve(dir, path, 'package.json'), '{"version":"1.0.0"}')
  }
  if (options.stamp !== false) {
    mkdirSync(resolve(dir, 'node_modules'), { recursive: true })
    writeFileSync(resolve(dir, 'node_modules/.package-lock.json'), '{}')
  }
}

const MANIFEST = { dependencies: { fastify: '^5.0.0' }, devDependencies: { typescript: '^6.0.0' } }

/** `fastify` pulls `find-my-way`; only the latter goes missing below. */
const LOCK: Record<string, LockEntry> = {
  'node_modules/fastify': { version: '5.8.5' },
  'node_modules/find-my-way': { version: '9.0.0' },
  'node_modules/typescript': { version: '6.0.3' },
}
const ALL = Object.keys(LOCK)

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), 'llui-verify-install-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('install verification', () => {
  it('reports a complete tree as ok', () => {
    writeTree({ manifest: MANIFEST, lock: LOCK, present: ALL })
    expect(missingPackages(dir)).toEqual([])
    expect(installState(dir)).toBe('ok')
  })

  it('catches a missing TRANSITIVE package, not just direct deps', () => {
    // The exact shape that passed a direct-deps-only check while breaking the
    // jfb server at boot: every declared dependency present, one of their
    // dependencies gone.
    writeTree({
      manifest: MANIFEST,
      lock: LOCK,
      present: ['node_modules/fastify', 'node_modules/typescript'],
    })
    expect(directDependencies(dir)).toEqual(['fastify', 'typescript'])
    expect(missingPackages(dir)).toEqual(['node_modules/find-my-way'])
    expect(installState(dir)).toBe('incomplete')
  })

  it('catches a devDependency-omitting install (npm ci --omit=dev exits 0)', () => {
    writeTree({
      manifest: MANIFEST,
      lock: LOCK,
      present: ['node_modules/fastify', 'node_modules/find-my-way'],
    })
    expect(missingPackages(dir)).toEqual(['node_modules/typescript'])
  })

  it('does not flag optional or platform-gated packages npm legitimately skips', () => {
    writeTree({
      manifest: MANIFEST,
      lock: {
        ...LOCK,
        'node_modules/fsevents': { version: '2.3.3', optional: true, os: ['darwin'] },
        'node_modules/@esbuild/linux-x64': { version: '0.25.0', os: ['linux'] },
      },
      present: ALL,
    })
    expect(expectedPackages(dir)).toEqual(ALL)
    expect(missingPackages(dir)).toEqual([])
  })

  it('treats an install older than its lockfile as stale', () => {
    writeTree({ manifest: MANIFEST, lock: LOCK, present: ALL })
    const later = new Date(Date.now() + 60_000)
    utimesSync(resolve(dir, 'package-lock.json'), later, later)
    expect(installState(dir)).toBe('stale')
  })

  it('treats a tree npm never wrote as absent', () => {
    writeTree({ manifest: MANIFEST, lock: LOCK, present: [], stamp: false })
    expect(installState(dir)).toBe('absent')
  })
})
