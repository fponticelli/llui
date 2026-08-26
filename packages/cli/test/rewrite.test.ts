import { describe, it, expect } from 'vitest'
import { rewriteImports } from '../src/rewrite'
import { ConfigSchema, type Config } from '../src/config'

const base: Config = ConfigSchema.parse({})
const aliased: Config = ConfigSchema.parse({
  aliases: { ui: '@/components/ui', lib: '@/lib' },
})

describe('rewriteImports', () => {
  it('rewrites @/lib/utils to a relative path when no alias is configured', () => {
    const out = rewriteImports(`import { cn } from '@/lib/utils'`, 'src/components/ui', base)
    expect(out).toBe(`import { cn } from '../../lib/utils'`)
  })

  it('rewrites to the configured alias when there is one', () => {
    expect(rewriteImports(`import { cn } from '@/lib/utils'`, 'src/components/ui', aliased)).toBe(
      `import { cn } from '@/lib/utils'`,
    )
  })

  it('maps a ui import to the ui alias, not the lib one', () => {
    expect(
      rewriteImports(`import { Button } from '@/ui/button'`, 'src/components/ui', aliased),
    ).toBe(`import { Button } from '@/components/ui/button'`)
  })

  it('always produces an explicitly relative specifier', () => {
    // Same directory: `path.relative` yields a bare `utils`, which a bundler
    // would resolve as a PACKAGE. The './' prefix is not cosmetic.
    const flat = ConfigSchema.parse({ paths: { ui: 'src/ui', lib: 'src/ui' } })
    expect(rewriteImports(`from '@/lib/utils'`, 'src/ui', flat)).toBe(`from './utils'`)
  })

  it('leaves package imports alone', () => {
    const src = `import { div } from '@llui/dom'\nimport { z } from 'zod'`
    expect(rewriteImports(src, 'src/components/ui', base)).toBe(src)
  })

  it('leaves an unrecognised @/ import alone rather than guessing', () => {
    const src = `import x from '@/hooks/use-thing'`
    expect(rewriteImports(src, 'src/components/ui', base)).toBe(src)
  })

  it('handles double-quoted specifiers', () => {
    expect(rewriteImports(`from "@/lib/utils"`, 'src/components/ui', base)).toBe(
      `from "../../lib/utils"`,
    )
  })
})
