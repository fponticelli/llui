import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { add } from '../src/add'
import { ConfigSchema, type Config } from '../src/config'

// The repo's own registry, read straight off disk — no build step, no network.
const REGISTRY = path.resolve(__dirname, '../../../registry')

let cwd: string
const config = (over: Partial<Config> = {}): Config =>
  ConfigSchema.parse({ registry: REGISTRY, ...over })

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'llui-cli-'))
})
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('add', () => {
  it('writes the item and its registry dependency', async () => {
    const result = await add({ cwd, config: config(), names: ['button'] })
    expect(result.written).toEqual(['src/lib/utils.ts', 'src/components/ui/button.ts'])
    await expect(
      readFile(path.join(cwd, 'src/components/ui/button.ts'), 'utf8'),
    ).resolves.toContain('export function Button')
  })

  it('rewrites the @/ import to something that resolves from where the file landed', async () => {
    await add({ cwd, config: config(), names: ['button'] })
    const src = await readFile(path.join(cwd, 'src/components/ui/button.ts'), 'utf8')
    expect(src).toContain(`from '../../lib/utils'`)
    expect(src).not.toContain('@/lib/utils')
  })

  it('reports the npm dependencies the items need', async () => {
    const result = await add({ cwd, config: config(), names: ['button'] })
    const names = result.dependencies.map((d) => d.name)
    expect(names).toContain('@llui/dom')
    expect(names).toContain('clsx')
    expect(names).toContain('tailwind-merge')
  })

  it('resolves a workspace:^ source spec to the workspace version, as the build does', async () => {
    const dom = JSON.parse(
      await readFile(path.resolve(__dirname, '../../dom/package.json'), 'utf8'),
    ) as { version: string }
    const result = await add({ cwd, config: config(), names: ['button'], dryRun: true })
    expect(result.dependencies.find((d) => d.name === '@llui/dom')).toEqual({
      name: '@llui/dom',
      spec: `@llui/dom@^${dom.version}`,
      minimum: dom.version,
      // `utils` is button's registryDependency and resolves first.
      requiredBy: ['utils', 'button'],
    })
  })

  it('does NOT overwrite an edited file by default', async () => {
    await add({ cwd, config: config(), names: ['button'] })
    const file = path.join(cwd, 'src/components/ui/button.ts')
    await writeFile(file, '// my edits\n', 'utf8')

    const second = await add({ cwd, config: config(), names: ['button'] })
    expect(second.skipped).toContain('src/components/ui/button.ts')
    expect(second.written).not.toContain('src/components/ui/button.ts')
    await expect(readFile(file, 'utf8')).resolves.toBe('// my edits\n')
  })

  it('replaces the file when overwrite is set', async () => {
    await add({ cwd, config: config(), names: ['button'] })
    const file = path.join(cwd, 'src/components/ui/button.ts')
    await writeFile(file, '// my edits\n', 'utf8')

    const second = await add({ cwd, config: config(), names: ['button'], overwrite: true })
    expect(second.skipped).toEqual([])
    await expect(readFile(file, 'utf8')).resolves.toContain('export function Button')
  })

  it('writes nothing on a dry run but still reports the plan', async () => {
    const result = await add({ cwd, config: config(), names: ['button'], dryRun: true })
    expect(result.written).toEqual(['src/lib/utils.ts', 'src/components/ui/button.ts'])
    await expect(readFile(path.join(cwd, 'src/components/ui/button.ts'), 'utf8')).rejects.toThrow()
  })

  it('honours a configured alias instead of rewriting to a relative path', async () => {
    await add({
      cwd,
      config: config({ aliases: { ui: '@/components/ui', lib: '@/lib' } }),
      names: ['button'],
    })
    const src = await readFile(path.join(cwd, 'src/components/ui/button.ts'), 'utf8')
    expect(src).toContain(`from '@/lib/utils'`)
  })

  it('honours configured target directories', async () => {
    const result = await add({
      cwd,
      config: config({ paths: { ui: 'app/ui', lib: 'app/util' } }),
      names: ['button'],
    })
    expect(result.written).toEqual(['app/util/utils.ts', 'app/ui/button.ts'])
    const src = await readFile(path.join(cwd, 'app/ui/button.ts'), 'utf8')
    expect(src).toContain(`from '../util/utils'`)
  })

  it('creates missing intermediate directories', async () => {
    await mkdir(path.join(cwd, 'src'), { recursive: true })
    await expect(add({ cwd, config: config(), names: ['card'] })).resolves.toBeDefined()
  })
})
