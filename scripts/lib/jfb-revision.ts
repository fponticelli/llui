import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function readPinnedJfbRevision(root: string): string {
  const revision = readFileSync(resolve(root, 'benchmarks/jfb-revision.txt'), 'utf8').trim()
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('benchmarks/jfb-revision.txt must contain one full 40-character commit SHA')
  }
  return revision
}

export function currentJfbRevision(repo: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
}

export function assertJfbRevision(repo: string, expected: string): void {
  const actual = currentJfbRevision(repo)
  if (actual !== expected) {
    throw new Error(`JFB revision mismatch: expected ${expected}, found ${actual}`)
  }
}
