import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Repo-wide guard: no tracked TEXT source may contain a NUL byte (#94, #260).
 *
 * Written as ESCAPES (`\0`), never as raw bytes. Both encodings produce the same
 * string at runtime; only one of them survives contact with the tools people and
 * agents actually use. There are TWO distinct failure modes, and they are kept as
 * two assertions on purpose because they have different windows and different
 * consequences:
 *
 * 1. GIT HIDES THE FILE FROM REVIEW (#94). git has no file-type database — it
 *    SNIFFS. A single NUL in the first 8000 bytes of a blob (`buffer_is_binary`)
 *    makes git call the file binary, and from then on `git diff`, `git log -p`,
 *    `git add -p` and GitHub's PR review view all hide its contents by default.
 *    A change lands unreviewed unless someone remembers `--text`. That is how
 *    `packages/markdown/src/keying.ts` — which owns the re-render decision for
 *    reused prefix blocks during streaming, and where #84 was a one-line omission
 *    — spent its life invisible to review.
 *
 * 2. GREP SILENTLY REFUSES THE FILE (#260). grep classifies by scanning FURTHER
 *    than git does, and a NUL ANYWHERE makes it treat the file as binary and
 *    suppress its matches. Exit 1 is indistinguishable from "no matches":
 *
 *        grep  -c noImplicitAny scripts/check-readme-examples.mjs   -> exit 1, no output
 *        grep -ac noImplicitAny scripts/check-readme-examples.mjs   -> 2
 *
 *    This is the WORSE of the two, because it makes an instrument report SUCCESS.
 *    Measured during #255: a reviewer's sweep for `\bany\b|as unknown as|
 *    @ts-expect-error` over a file carrying a NUL at offset 26491 returned zero
 *    hits and was read as a clean result. It was vacuous. A second check on the
 *    same file briefly concluded a dependency had been removed entirely. Both
 *    false readings were caught by hand; nothing automated could see them, because
 *    the NUL was 18kB past git's sniff window and arm 1 was correctly silent.
 *
 * Arm 2 subsumes arm 1 as a SET (every sniff-window NUL is also a whole-file NUL),
 * so a repo violating both fails both. They are still separate because the
 * diagnostics differ: one says "git will hide this from review", the other says
 * "your grep just lied to you". Collapsing them loses that, and the second is the
 * one a reader will not deduce.
 *
 * Cost of the whole-file arm, measured before it shipped (2202 tracked text files,
 * 19.8 MB): interleaved with the prefix scan over three rounds, whole-file read
 * 58-80 ms against prefix-only 51-106 ms — i.e. INSIDE the noise, and no slower,
 * because one `readFileSync` beats open/alloc/read/close per file. The file reads
 * the corpus ONCE and derives both verdicts from that read.
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

/**
 * The ONE detection site: reads the WHOLE file and reports the first NUL offset
 * (-1 if none) plus the bytes actually read. Reading the whole file is what makes
 * #260 reportable at all — a scan truncated at the sniff window cannot see a NUL
 * past it, which is precisely the case that shipped.
 *
 * Both the corpus arms and the known-bad/known-good self-check below go through
 * this function, deliberately. A probe that exercises a SECOND copy of the
 * detection logic stays green while the copy on the report path is broken — the
 * instrument then certifies itself and nothing else.
 */
function scanFile(absolutePath: string): { nulAt: number; bytes: number } {
  const bytes = readFileSync(absolutePath)
  return { nulAt: bytes.indexOf(0), bytes: bytes.length }
}

interface Scan {
  /** Path relative to the repo root, as `git ls-files` reports it. */
  readonly path: string
  /** Byte offset of the first NUL, or -1 if the file has none. */
  readonly nulAt: number
  /** Bytes actually read. Guards against a scan that "passed" by reading nothing. */
  readonly bytes: number
}

function scan(path: string): Scan {
  try {
    return { path, ...scanFile(resolve(repoRoot, path)) }
  } catch (cause) {
    // A file that was present when trackedFiles ran but disappeared before this
    // read indicates a concurrent or interrupted working-tree operation.
    throw new Error(
      `cannot read tracked file ${path} — index and working tree disagree ` +
        `(interrupted rebase/checkout?). Settle the working tree and re-run.`,
      { cause },
    )
  }
}

/** `path` plus the offset, because "which file" is only half of a #260 report —
 * the offset is what tells you whether git was hiding it too. */
function describeHit(hit: Scan): string {
  return `${hit.path} (first NUL at byte ${hit.nulAt})`
}

describe('tracked sources stay diffable and greppable as text (#94, #260)', () => {
  const candidates = trackedFiles().filter((path) => {
    const ext = path.slice(path.lastIndexOf('.') + 1)
    return TEXT_EXTENSIONS.includes(ext)
  })

  // Memoized, and deliberately NOT run at collection time. Reading 19.8 MB in a
  // `describe` body would leave the cost on the machine but OUT of the per-file
  // duration metric (#193 sums `assertionResults[].duration` only), so a future
  // regression in this scan would be invisible to `check:test-durations`.
  let memo: Scan[] | undefined
  const scanAll = (): Scan[] => (memo ??= candidates.map(scan))

  it('finds the tracked text sources to scan', () => {
    // A broken `git ls-files` (wrong cwd, no repo) would make the scan vacuous.
    expect(candidates.length).toBeGreaterThan(100)
    expect(candidates).toContain('packages/markdown/src/keying.ts')
    // ...and so would a scan that "passed" every file by reading zero bytes from
    // it. A file count alone cannot tell those apart: this is the corpus-floor
    // trap one layer in, where the walk runs and the READ is what went vacuous.
    const totalBytes = scanAll().reduce((sum, hit) => sum + hit.bytes, 0)
    expect(totalBytes).toBeGreaterThan(1_000_000)
  })

  it('detects a NUL at either window when one is present', () => {
    // The instrument, asserted on known-bad and known-good input before any
    // verdict is read off it. #260 exists because a NUL makes a tool report
    // SUCCESS, and a scan that had silently stopped matching would reproduce
    // exactly the class of failure this file is here to prevent.
    const dir = mkdtempSync(join(tmpdir(), 'llui-source-encoding-'))

    const clean = join(dir, 'clean.ts')
    writeFileSync(clean, 'x'.repeat(SNIFF_BYTES * 4))
    expect(scanFile(clean)).toEqual({ nulAt: -1, bytes: SNIFF_BYTES * 4 })

    // Inside git's window: both arms must see it.
    const early = join(dir, 'early.ts')
    writeFileSync(early, Buffer.concat([Buffer.from('x'.repeat(10)), Buffer.from([0])]))
    expect(scanFile(early).nulAt).toBe(10)

    // PAST git's window — #260's own shape, and the case a sniff-window-only
    // scan cannot report. The real instance sat at offset 26491.
    const late = join(dir, 'late.ts')
    const lateOffset = SNIFF_BYTES * 3
    writeFileSync(
      late,
      Buffer.concat([Buffer.from('x'.repeat(lateOffset)), Buffer.from([0]), Buffer.from('x')]),
    )
    expect(scanFile(late).nulAt).toBe(lateOffset)
    // The distinction the two arms are built on, stated as an assertion rather
    // than as prose: this file is invisible to arm 1 and caught by arm 2.
    expect(lateOffset).toBeGreaterThanOrEqual(SNIFF_BYTES)
  })

  it('contains no raw NUL byte in the 8000-byte sniff window git uses (#94)', () => {
    // A NUL here makes git call the file binary, so `git diff`, `git log -p` and
    // GitHub review hide every change to it by default.
    const hidden = scanAll().filter((hit) => hit.nulAt >= 0 && hit.nulAt < SNIFF_BYTES)
    expect(hidden.map(describeHit)).toEqual([])
  })

  it('contains no raw NUL byte ANYWHERE in the file (#260)', () => {
    // grep scans further than git sniffs: one NUL at any offset makes it refuse
    // the whole file and exit 1, which is indistinguishable from "no matches".
    // Every sweep an agent or reviewer runs over such a file returns clean.
    const ungreppable = scanAll().filter((hit) => hit.nulAt >= 0)
    expect(ungreppable.map(describeHit)).toEqual([])
  })
})
