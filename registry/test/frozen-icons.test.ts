import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FROZEN_LUCIDE_BODIES } from './specialized-tools-frozen-icons'

const REPO = resolve(import.meta.dirname, '../..')

describe('frozen Iconify source (#267)', () => {
  it('answers exactly the glyph vocabulary the registry skins and scenario renderers name', () => {
    // The Component Gallery's Registry skins document installs this source
    // for EVERY family, so a glyph missing here would be a live network
    // request and a non-deterministic render. Collected from source text
    // (git-enumerated, never a directory walk), not from what happens to
    // render, so a renamed glyph is caught before anything draws it.
    const files = execFileSync(
      'git',
      [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        'registry/llui/ui',
        'registry/test',
      ],
      { cwd: REPO, encoding: 'utf8' },
    )
      .split('\n')
      .filter((file) => /\.ts$/.test(file) && !file.endsWith('.test.ts'))
    const named = new Set<string>()
    for (const file of files) {
      const source = readFileSync(resolve(REPO, file), 'utf8')
      for (const match of source.matchAll(/'lucide:([a-z0-9-]+)'/g)) named.add(match[1]!)
    }
    expect(named.has('check')).toBe(true)
    expect(Object.keys(FROZEN_LUCIDE_BODIES).sort()).toEqual([...named].sort())
  })
})
