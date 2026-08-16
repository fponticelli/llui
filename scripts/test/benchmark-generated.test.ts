import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { check } from 'prettier'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')

describe('generated benchmark artifacts', () => {
  it.each(['site/content/benchmarks.md', 'site/public/benchmark-data.json'])(
    'is emitted in canonical formatting: %s',
    async (relativePath) => {
      const path = resolve(ROOT, relativePath)
      expect(await check(readFileSync(path, 'utf8'), { filepath: path })).toBe(true)
    },
  )
})
