import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { assertJfbRevision } from '../lib/jfb-revision'

let repo = ''

beforeEach(() => {
  repo = mkdtempSync(resolve(tmpdir(), 'llui-jfb-revision-'))
  execFileSync('git', ['init', '--quiet'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
  writeFileSync(resolve(repo, 'README.md'), 'fixture\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repo })
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: repo })
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('pinned js-framework-benchmark revision', () => {
  it('rejects a checkout at any revision other than the repository pin', () => {
    const actual = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()

    expect(() => assertJfbRevision(repo, '0000000000000000000000000000000000000000')).toThrow(
      `expected 0000000000000000000000000000000000000000, found ${actual}`,
    )
  })
})
