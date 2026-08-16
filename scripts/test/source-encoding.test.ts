import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Repo-wide guard: no tracked TEXT source may contain a NUL byte (#94).
 *
 * git has no file-type database — it SNIFFS. A single NUL in the first 8000 bytes
 * of a blob makes git call the file binary, and from then on `git diff`,
 * `git log -p`, `git add -p` and GitHub's web/PR review view all hide its contents
 * by default. A change to it lands unreviewed unless someone remembers `--text`.
 *
 * That is how `packages/markdown/src/keying.ts` — which owns the re-render
 * decision for reused prefix blocks during streaming, and where #84 was a one-line
 * omission — spent its life invisible to review: its fingerprint separator was
 * written as a LITERAL U+0000 instead of the `\0` escape. Both encodings produce
 * the same string at runtime; only one of them is diffable. Prefer the escape.
 *
 * This lives in the root scripts suite rather than a package suite because the
 * hazard is not markdown-specific and the fix must not be either.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** git's own sniff window (`buffer_is_binary` reads up to 8000 bytes). */
const SNIFF_BYTES = 8000

/** Extensions git is expected to diff as TEXT. A positive list, so a newly added
 * binary asset type cannot fail this test by accident. */
const TEXT_EXTENSIONS = [
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'json',
  'jsonc',
  'md',
  'css',
  'html',
  'svg',
  'yml',
  'yaml',
  'sh',
  'txt',
  'toml',
  'svelte',
  'tmpl',
]

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  const deleted = new Set(
    execFileSync('git', ['ls-files', '--deleted', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter((path) => path !== ''),
  )
  // A file intentionally deleted in the working tree has no bytes left to
  // classify. Excluding git's explicit deletion set keeps the scan meaningful
  // during a legitimate refactor without hiding an unreadable file that should
  // still exist.
  return out.split('\0').filter((path) => path !== '' && !deleted.has(path))
}

/** True iff git would sniff this file as binary — a NUL in its first 8000 bytes. */
function looksBinaryToGit(path: string): boolean {
  let fd: number
  try {
    fd = openSync(resolve(repoRoot, path), 'r')
  } catch (cause) {
    // A file that was present when trackedFiles ran but disappeared before this
    // read indicates a concurrent or interrupted working-tree operation.
    throw new Error(
      `cannot read tracked file ${path} — index and working tree disagree ` +
        `(interrupted rebase/checkout?). Settle the working tree and re-run.`,
      { cause },
    )
  }
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES)
    const read = readSync(fd, buffer, 0, SNIFF_BYTES, 0)
    return buffer.subarray(0, read).includes(0)
  } finally {
    closeSync(fd)
  }
}

describe('tracked sources stay diffable as text (#94)', () => {
  const candidates = trackedFiles().filter((path) => {
    const ext = path.slice(path.lastIndexOf('.') + 1)
    return TEXT_EXTENSIONS.includes(ext)
  })

  it('finds the tracked text sources to scan', () => {
    // A broken `git ls-files` (wrong cwd, no repo) would make the scan vacuous.
    expect(candidates.length).toBeGreaterThan(100)
    expect(candidates).toContain('packages/markdown/src/keying.ts')
  })

  it('contains no raw NUL byte in the 8000-byte sniff window', () => {
    // Write control characters as ESCAPES (a backslash-zero, not the byte): the
    // value a string carries at runtime is unaffected, but whether the file stays
    // reviewable is not.
    expect(candidates.filter(looksBinaryToGit)).toEqual([])
  })
})
