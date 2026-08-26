import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { add } from '../src/add'
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

  it('surfaces a failed request with its status', async () => {
    await expect(
      add({ cwd, config: ConfigSchema.parse({ registry: `${BASE}/missing` }), names: ['button'] }),
    ).rejects.toThrow(/Registry request failed: 404/)
  })
})
