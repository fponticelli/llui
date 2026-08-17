import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('benchmark setup installs', () => {
  it('uses the pinned JFB peer-resolution mode directly and disables install reporting noise', () => {
    const setup = readFileSync(resolve(import.meta.dirname, '../setup-bench.ts'), 'utf8')

    expect(setup).toContain("installStep('jfb root', JFB_REPO, ['--legacy-peer-deps'])")
    expect(setup).toContain("const npmCiArgs = ['ci', '--no-audit', '--no-fund', ...installArgs]")
    expect(setup).not.toContain('isEresolve')
    expect(setup).not.toContain('Retrying with')
  })
})
