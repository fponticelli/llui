import { describe, expect, it } from 'vitest'
import { build } from 'vite'

describe('component locale bundle boundaries', () => {
  it('a tags-input-only bundle ships its own strings and no date-picker month names', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        target: 'es2022',
        minify: false,
        lib: {
          entry: new URL('../../src/components/tags-input.ts', import.meta.url).pathname,
          formats: ['es'],
        },
        rollupOptions: {
          external: (id) => id.startsWith('@llui/'),
        },
      },
    })
    const buildResults = Array.isArray(result) ? result : [result]
    const outputs = buildResults.flatMap((item) => ('output' in item ? item.output : []))
    const code = outputs.map((item) => (item.type === 'chunk' ? item.code : '')).join('')

    expect(code).toContain('Add tag')
    expect(code).not.toContain('January')
    expect(code).not.toContain('September')
  })
})
