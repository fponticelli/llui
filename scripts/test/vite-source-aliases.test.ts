import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sourceAliasesFromExports } from '../lib/vite-source-aliases.mjs'

async function withFixturePackageJson(
  exportsMap: unknown,
  run: (packageJsonPath: string) => Promise<void> | void,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'llui-vite-source-aliases-'))
  try {
    const packageJsonPath = path.join(dir, 'package.json')
    await writeFile(
      packageJsonPath,
      JSON.stringify({ name: 'fixture', exports: exportsMap }, null, 2),
    )
    await run(packageJsonPath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('sourceAliasesFromExports', () => {
  it('derives a literal alias for the root export', async () => {
    await withFixturePackageJson(
      { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      async (packageJsonPath) => {
        const aliases = sourceAliasesFromExports({
          packageName: '@llui/fixture',
          packageJsonPath,
          srcDir: '/src',
        })
        expect(aliases).toEqual([{ find: '@llui/fixture', replacement: '/src/index.ts' }])
      },
    )
  })

  it('derives a literal alias per subpath export, preserving nested directories', async () => {
    await withFixturePackageJson(
      {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './icon': { types: './dist/icon.d.ts', import: './dist/icon.js' },
        './toggle': {
          types: './dist/components/toggle.d.ts',
          import: './dist/components/toggle.js',
        },
      },
      async (packageJsonPath) => {
        const aliases = sourceAliasesFromExports({
          packageName: '@llui/fixture',
          packageJsonPath,
          srcDir: '/src',
        })
        const byFind = new Map(aliases.map((a) => [a.find, a.replacement]))
        // This is the exact #264 regression: an `./icon` export living at
        // `dist/icon.js` (src/icon.ts) must NOT fall into a `components/`
        // catch-all meant for `./toggle`-shaped entries.
        expect(byFind.get('@llui/fixture/icon')).toBe('/src/icon.ts')
        expect(byFind.get('@llui/fixture/toggle')).toBe('/src/components/toggle.ts')
      },
    )
  })

  it('preserves non-.js targets (e.g. published CSS) verbatim aside from the dist/ -> src swap', async () => {
    await withFixturePackageJson(
      {
        './styles/theme.css': './dist/styles/theme.css',
      },
      async (packageJsonPath) => {
        const aliases = sourceAliasesFromExports({
          packageName: '@llui/fixture',
          packageJsonPath,
          srcDir: '/src',
        })
        expect(aliases).toEqual([
          { find: '@llui/fixture/styles/theme.css', replacement: '/src/styles/theme.css' },
        ])
      },
    )
  })

  it('turns a wildcard subpath export into a regex alias with a matching capture group', async () => {
    await withFixturePackageJson(
      {
        './utils/*': { types: './dist/utils/*.d.ts', import: './dist/utils/*.js' },
      },
      async (packageJsonPath) => {
        const aliases = sourceAliasesFromExports({
          packageName: '@llui/fixture',
          packageJsonPath,
          srcDir: '/src',
        })
        expect(aliases).toHaveLength(1)
        const [alias] = aliases
        expect(alias.find).toBeInstanceOf(RegExp)
        expect((alias.find as RegExp).test('@llui/fixture/utils/derive')).toBe(true)
        expect((alias.find as RegExp).test('@llui/fixture/utilsx/derive')).toBe(false)
        expect('@llui/fixture/utils/derive'.replace(alias.find, alias.replacement)).toBe(
          '/src/utils/derive.ts',
        )
      },
    )
  })

  it('orders longer literal specifiers before shorter ones so a bare root alias cannot prefix-match a subpath', async () => {
    await withFixturePackageJson(
      {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './icon': { types: './dist/icon.d.ts', import: './dist/icon.js' },
      },
      async (packageJsonPath) => {
        const aliases = sourceAliasesFromExports({
          packageName: '@llui/fixture',
          packageJsonPath,
          srcDir: '/src',
        })
        const rootIndex = aliases.findIndex((a) => a.find === '@llui/fixture')
        const iconIndex = aliases.findIndex((a) => a.find === '@llui/fixture/icon')
        expect(iconIndex).toBeGreaterThanOrEqual(0)
        expect(rootIndex).toBeGreaterThan(iconIndex)
      },
    )
  })

  it('throws when an export does not resolve to a dist/ target, rather than silently mis-routing', async () => {
    await withFixturePackageJson({ './weird': './lib/weird.js' }, async (packageJsonPath) => {
      expect(() =>
        sourceAliasesFromExports({
          packageName: '@llui/fixture',
          packageJsonPath,
          srcDir: '/src',
        }),
      ).toThrow(/dist\//)
    })
  })

  it('skips the ./package.json convention export', async () => {
    await withFixturePackageJson(
      {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './package.json': './package.json',
      },
      async (packageJsonPath) => {
        const aliases = sourceAliasesFromExports({
          packageName: '@llui/fixture',
          packageJsonPath,
          srcDir: '/src',
        })
        expect(aliases.some((a) => a.find === '@llui/fixture/package.json')).toBe(false)
      },
    )
  })

  it('reproduces the real @llui/components exports map without throwing and covers icon + a nested component', () => {
    const packageJsonPath = path.resolve(__dirname, '../../packages/components/package.json')
    const aliases = sourceAliasesFromExports({
      packageName: '@llui/components',
      packageJsonPath,
      srcDir: path.resolve(__dirname, '../../packages/components/src'),
    })
    const byFind = new Map(aliases.map((a) => [a.find, a.replacement]))
    expect(byFind.get('@llui/components/icon')).toBe(
      path.resolve(__dirname, '../../packages/components/src/icon.ts'),
    )
    expect(byFind.get('@llui/components/toggle')).toBe(
      path.resolve(__dirname, '../../packages/components/src/components/toggle.ts'),
    )
    expect(byFind.get('@llui/components/patterns/data-table')).toBe(
      path.resolve(__dirname, '../../packages/components/src/patterns/data-table.ts'),
    )
  })
})
