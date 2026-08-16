import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build, type Rollup } from 'vite'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = resolve(import.meta.dirname, '../src')

type PublicEntry = '@llui/components' | '@llui/components/dialog' | '@llui/components/utils'

interface BundleMeasurement {
  bytes: number
  componentModules: string[]
}

async function bundle(entry: PublicEntry): Promise<BundleMeasurement> {
  const imported = entry.endsWith('/utils') ? 'pushFocusTrap' : 'dialog'
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'components-public-entry',
        enforce: 'pre',
        resolveId(source) {
          if (source === 'virtual:consumer') return '\0consumer'
          if (source === '@llui/components') return resolve(SOURCE_ROOT, 'index.ts')
          if (source === '@llui/components/dialog') {
            return resolve(SOURCE_ROOT, 'components/dialog.ts')
          }
          if (source === '@llui/components/utils') return resolve(SOURCE_ROOT, 'utils/index.ts')
          return undefined
        },
        load(id) {
          if (id !== '\0consumer') return undefined
          return `import { ${imported} } from ${JSON.stringify(entry)}; console.log(${imported})`
        },
      },
    ],
    build: {
      target: 'es2022',
      minify: false,
      write: false,
      rollupOptions: {
        input: 'virtual:consumer',
        external: (id) => id.startsWith('@llui/') && !id.startsWith('@llui/components'),
      },
    },
  })

  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    'output' in output ? output.output : [],
  )
  const chunks = outputs.filter((output): output is Rollup.OutputChunk => output.type === 'chunk')
  return {
    bytes: chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk.code), 0),
    componentModules: chunks
      .flatMap((chunk) => Object.keys(chunk.modules))
      .flatMap((id) => {
        const match = id
          .replaceAll('\\', '/')
          .match(/\/packages\/components\/(?:src|dist)\/(components\/.+)$/)
        return match?.[1] ? [match[1].replace(/\.(?:ts|js)$/, '')] : []
      })
      .sort(),
  }
}

describe('@llui/components package boundaries', () => {
  it('publishes granular format and utils modules without dropping the aggregate utils seam', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports['./utils']).toEqual({
      types: './dist/utils/index.d.ts',
      import: './dist/utils/index.js',
    })
    expect(packageJson.exports['./utils/*']).toEqual({
      types: './dist/utils/*.d.ts',
      import: './dist/utils/*.js',
    })
    expect(packageJson.exports['./format/*']).toEqual({
      types: './dist/format/*.d.ts',
      import: './dist/format/*.js',
    })
  })

  it('keeps a utils-only production bundle free of component modules', async () => {
    const utils = await bundle('@llui/components/utils')

    expect(utils.componentModules).toEqual([])
  })

  it('makes a root single-component import as narrow as its direct subpath', async () => {
    const [root, direct] = await Promise.all([
      bundle('@llui/components'),
      bundle('@llui/components/dialog'),
    ])

    expect(root.componentModules).toEqual(direct.componentModules)
    expect(root.componentModules).toEqual(['components/dialog', 'components/presence'])
    // With minification and sourcemaps disabled, the two inputs render the same
    // normalized production code. A namespace wrapper adds a stable facade
    // delta here even when a newer bundler manages to discard its other leaves.
    expect(root.bytes).toBe(direct.bytes)
  })
})
