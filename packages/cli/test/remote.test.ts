import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { add, VersionMismatchError } from '../src/add'
import { ConfigSchema } from '../src/config'

// The BUILT registry — what llui.dev actually serves. Its index deliberately has
// no file bodies, so this exercises the hydration hop the local path skips. That
// asymmetry is the whole reason this file exists separately from add.test.ts: a
// suite that only ever reads a checkout would pass while every real `llui add`
// wrote empty files.
const BUILT = path.resolve(__dirname, '../../../site/public/r')
const BASE = 'https://llui.dev/r'

let cwd: string
let requested: string[]

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'llui-cli-remote-'))
  requested = []
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url)
    const name = url.slice(BASE.length + 1)
    try {
      const body = await readFile(path.join(BUILT, name), 'utf8')
      return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(body) }
    } catch {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }
    }
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(cwd, { recursive: true, force: true })
})

const config = ConfigSchema.parse({ registry: BASE })

describe('remote registry', () => {
  it('fetches the index, then each item it installs', async () => {
    await add({ cwd, config, names: ['button'] })
    expect(requested).toEqual([
      `${BASE}/registry.json`,
      `${BASE}/utils.json`,
      `${BASE}/button.json`,
    ])
  })

  it('writes real file contents, not empty files', async () => {
    await add({ cwd, config, names: ['button'] })
    const src = await readFile(path.join(cwd, 'src/components/ui/button.ts'), 'utf8')
    expect(src).toContain('export function Button')
    expect(src.length).toBeGreaterThan(500)
  })

  it('rewrites imports the same way the local path does', async () => {
    await add({ cwd, config, names: ['button'] })
    const src = await readFile(path.join(cwd, 'src/components/ui/button.ts'), 'utf8')
    expect(src).toContain(`from '../../lib/utils'`)
  })

  it('does not fetch item records on a dry run', async () => {
    // The index carries the file LIST, so the plan is fully answerable from it.
    // A preview that hits the network once per item is not much of a preview.
    await add({ cwd, config, names: ['button'], dryRun: true })
    expect(requested).toEqual([`${BASE}/registry.json`])
  })

  it('fetches an item record once, not once per file', async () => {
    await add({ cwd, config, names: ['button', 'card'] })
    const utils = requested.filter((u) => u.endsWith('/utils.json'))
    expect(utils).toHaveLength(1)
  })

  it('does not fetch a record for an item whose files are all skipped', async () => {
    await add({ cwd, config, names: ['button'] })
    requested.length = 0
    await add({ cwd, config, names: ['button'] })
    expect(requested).toEqual([`${BASE}/registry.json`])
  })

  it('refuses an older @llui/components from the SERVED minimum, before fetching any item', async () => {
    const index = JSON.parse(await readFile(path.join(BUILT, 'registry.json'), 'utf8')) as {
      items: { name: string; dependencies: string[] }[]
    }
    const spec = index.items
      .find((i) => i.name === 'sonner')!
      .dependencies.find((d) => d.startsWith('@llui/components@'))!
    const minimum = spec.slice('@llui/components@^'.length)
    await mkdir(path.join(cwd, 'node_modules/@llui/components'), { recursive: true })
    await writeFile(
      path.join(cwd, 'node_modules/@llui/components/package.json'),
      JSON.stringify({ name: '@llui/components', version: '0.0.1' }),
    )

    const failure = await add({ cwd, config, names: ['sonner'] }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(VersionMismatchError)
    expect((failure as Error).message).toContain(
      `@llui/components: installed 0.0.1, requires >= ${minimum}`,
    )
    expect(requested).toEqual([`${BASE}/registry.json`])
    await expect(readdir(path.join(cwd, 'src'))).rejects.toThrow()
  })

  it('writes nothing when an item record needs a newer package than its index declares', async () => {
    const file = (name: string, content?: string) => ({
      path: `registry/llui/ui/${name}.ts`,
      type: 'registry:ui',
      target: `${name}.ts`,
      ...(content === undefined ? {} : { content }),
    })
    const first = {
      name: 'first',
      type: 'registry:ui',
      dependencies: [],
      registryDependencies: [],
      files: [file('first')],
    }
    const second = {
      ...first,
      name: 'second',
      dependencies: ['@llui/components@^0.20.1'],
      files: [file('second')],
    }
    const responses = new Map<string, unknown>([
      ['registry.json', { name: 'test', items: [first, second] }],
      ['first.json', { ...first, files: [file('first', 'export const first = true')] }],
      [
        'second.json',
        {
          ...second,
          dependencies: ['@llui/components@^0.21.0'],
          files: [file('second', 'export const second = true')],
        },
      ],
    ])
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      json: async () => responses.get(url.slice(BASE.length + 1)),
    }))
    await mkdir(path.join(cwd, 'node_modules/@llui/components'), { recursive: true })
    await writeFile(
      path.join(cwd, 'node_modules/@llui/components/package.json'),
      JSON.stringify({ name: '@llui/components', version: '0.20.1' }),
    )

    await expect(add({ cwd, config, names: ['first', 'second'] })).rejects.toThrow(
      'differs between the index and its full record',
    )
    await expect(readdir(path.join(cwd, 'src'))).rejects.toThrow()
  })

  it('surfaces a failed request with its status', async () => {
    await expect(
      add({ cwd, config: ConfigSchema.parse({ registry: `${BASE}/missing` }), names: ['button'] }),
    ).rejects.toThrow(/Registry request failed: 404/)
  })
})
