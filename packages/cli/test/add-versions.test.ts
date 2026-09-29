import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { add, VersionMismatchError } from '../src/add'
import { main } from '../src/cli'
import { ConfigSchema } from '../src/config'
import { compareVersions } from '../src/semver'

// The repo's own SOURCE registry: its `@llui/*` deps are `workspace:^`, which a
// local load resolves to the workspace version — the same floor
// `scripts/build-registry.mjs` writes into the served JSON.
const REGISTRY = path.resolve(__dirname, '../../../registry')
const COMPONENTS_VERSION = (
  JSON.parse(await readFile(path.resolve(__dirname, '../../components/package.json'), 'utf8')) as {
    version: string
  }
).version

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'llui-cli-versions-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true })
})

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/** A consumer project with `pkg` installed at `version` under node_modules. */
async function install(pkg: string, version: string, root = cwd): Promise<void> {
  await writeJson(path.join(root, 'node_modules', pkg, 'package.json'), { name: pkg, version })
}

async function project(deps: Record<string, string> = {}): Promise<void> {
  await writeJson(path.join(cwd, 'package.json'), { name: 'app', dependencies: deps })
}

/** Every file under `dir`, excluding the fixture's own package.json/node_modules. */
async function writtenFiles(dir = cwd): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) await walk(full)
      else out.push(path.relative(dir, full))
    }
  }
  await walk(dir)
  return out.filter((f) => f !== 'package.json' && !f.endsWith('lock.yaml')).sort()
}

/** The previous minor (or major): strictly older, never equal. */
function older(version: string): string {
  const [major, minor] = version.split(/[.-]/).map(Number) as [number, number]
  return minor > 0 ? `${major}.${minor - 1}.0` : `${major - 1}.99.0`
}

function newer(version: string): string {
  const [major] = version.split('.').map(Number) as [number]
  return `${major + 1}.0.0`
}

/** Run the real CLI entry and capture what it prints. */
async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')))
  const code = await main([...argv, '--registry', REGISTRY, '--cwd', cwd])
  vi.restoreAllMocks()
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('llui add --help', () => {
  it.each([['add', '--help'], ['add', '-h'], ['--help']])(
    '%s %s documents the check and --force',
    async (...argv) => {
      const out: string[] = []
      vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
      expect(await main(argv)).toBe(0)
      const text = out.join('\n')
      expect(text).toMatch(/--force\s+Copy even if an installed @llui\/\* package is older/)
      expect(text).toMatch(/Version check \(llui add\)/)
      expect(text).toContain('registryDependencies')
    },
  )
})

describe('fixture sanity', () => {
  it('older() / newer() really straddle the workspace version', () => {
    expect(compareVersions(older(COMPONENTS_VERSION), COMPONENTS_VERSION)).toBe(-1)
    expect(compareVersions(newer(COMPONENTS_VERSION), COMPONENTS_VERSION)).toBe(1)
  })
})

describe('llui add — @llui/* minimum versions', () => {
  it('an older installed @llui/components exits non-zero, writes nothing, and names both versions', async () => {
    await project({ '@llui/components': `^${older(COMPONENTS_VERSION)}` })
    await install('@llui/components', older(COMPONENTS_VERSION))

    const { code, out, err } = await run('add', 'sonner')

    expect(code).toBe(1)
    expect(await writtenFiles()).toEqual([])
    expect(out).not.toMatch(/Wrote/)
    expect(err).toContain('@llui/components')
    expect(err).toContain(`installed ${older(COMPONENTS_VERSION)}`)
    expect(err).toContain(`requires >= ${COMPONENTS_VERSION}`)
    expect(err).toContain(`@llui/components@^${COMPONENTS_VERSION}`)
    expect(err).toMatch(/Nothing was written/)
    expect(err).toMatch(/--force/)
  })

  it('suggests the upgrade command of the package manager the project uses', async () => {
    await project()
    await writeFile(path.join(cwd, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8')
    await install('@llui/components', older(COMPONENTS_VERSION))

    const { err } = await run('add', 'sonner')
    expect(err).toContain(`pnpm add @llui/components@^${COMPONENTS_VERSION}`)
  })

  it('--force writes the files and prints the same mismatch as a warning', async () => {
    await project()
    await install('@llui/components', older(COMPONENTS_VERSION))

    const { code, out, err } = await run('add', 'sonner', '--force')

    expect(code).toBe(0)
    expect(await writtenFiles()).toContain(path.join('src', 'components', 'ui', 'sonner.ts'))
    expect(out).toMatch(/Wrote src\/components\/ui\/sonner\.ts/)
    expect(err).toMatch(/^Warning:/m)
    expect(err).toContain(`installed ${older(COMPONENTS_VERSION)}`)
    expect(err).toContain(`requires >= ${COMPONENTS_VERSION}`)
    expect(err).not.toMatch(/Nothing was written/)
  })

  it.each([
    ['equal', () => COMPONENTS_VERSION],
    ['newer', () => newer(COMPONENTS_VERSION)],
  ])('an %s installed version succeeds with no warning', async (_label, version) => {
    await project()
    await install('@llui/components', version())
    await install('@llui/dom', '99.0.0')

    const { code, out, err } = await run('add', 'sonner')

    expect(code).toBe(0)
    expect(err).toBe('')
    expect(out).toMatch(/Wrote src\/components\/ui\/sonner\.ts/)
    // Satisfied, so the install hint stays a bare name: printing `@^<min>` would
    // steer a newer install back DOWN inside a 0.x caret.
    expect(out).toMatch(/^Install: .*@llui\/components(?![@\w])/m)
  })

  it('a missing @llui/components succeeds and the install line carries the minimum', async () => {
    await project()

    const { code, out, err } = await run('add', 'sonner')

    expect(code).toBe(0)
    expect(err).toBe('')
    expect(out).toContain(`@llui/components@^${COMPONENTS_VERSION}`)
    expect(out).toMatch(/^Install: .*@llui\/components@\^/m)
  })

  it('a declared-but-uninstalled range is compared by its minimum satisfying version', async () => {
    await project({ '@llui/components': `^${older(COMPONENTS_VERSION)}` })

    const { code, err } = await run('add', 'sonner')

    expect(code).toBe(1)
    expect(err).toContain(`package.json declares ^${older(COMPONENTS_VERSION)}`)
    expect(await writtenFiles()).toEqual([])
  })

  it('a declared range at the minimum passes without being installed', async () => {
    await project({ '@llui/components': `^${COMPONENTS_VERSION}` })
    const { code, err } = await run('add', 'sonner')
    expect(code).toBe(0)
    expect(err).toBe('')
  })

  it('a range with no determinable floor warns instead of guessing', async () => {
    await project({ '@llui/components': 'latest' })
    const { code, err } = await run('add', 'sonner')
    expect(code).toBe(0)
    expect(err).toMatch(/Could not determine .*@llui\/components.*"latest"/)
  })

  it('the installed package wins over the package.json range', async () => {
    // A stale lockfile-free declaration must not override what Node resolves.
    await project({ '@llui/components': `^${older(COMPONENTS_VERSION)}` })
    await install('@llui/components', COMPONENTS_VERSION)
    const { code } = await run('add', 'sonner')
    expect(code).toBe(0)
  })

  it('finds a package hoisted to an ancestor node_modules, as Node would', async () => {
    const app = path.join(cwd, 'apps', 'web')
    await mkdir(app, { recursive: true })
    await install('@llui/components', older(COMPONENTS_VERSION))
    const config = ConfigSchema.parse({ registry: REGISTRY })
    await expect(add({ cwd: app, config, names: ['sonner'] })).rejects.toBeInstanceOf(
      VersionMismatchError,
    )
  })

  it('--dry-run reports the same mismatch and still exits non-zero', async () => {
    await install('@llui/components', older(COMPONENTS_VERSION))
    const { code, err } = await run('add', 'sonner', '--dry-run')
    expect(code).toBe(1)
    expect(err).toContain(`requires >= ${COMPONENTS_VERSION}`)
  })
})

describe('llui add — fixture registries', () => {
  /** A BUILT-shape local registry: inline content, `^<min>` specs. */
  async function fixtureRegistry(items: unknown[]): Promise<string> {
    const dir = path.join(cwd, '..', `${path.basename(cwd)}-registry`)
    await writeJson(path.join(dir, 'registry.json'), { name: 'fixture', items })
    return dir
  }

  const file = (name: string) => [
    { path: `r/${name}.ts`, type: 'registry:ui', target: `${name}.ts`, content: `// ${name}\n` },
  ]

  afterEach(async () => {
    await rm(path.join(cwd, '..', `${path.basename(cwd)}-registry`), {
      recursive: true,
      force: true,
    })
  })

  it('checks a @llui/* dependency reached ONLY through registryDependencies', async () => {
    const registry = await fixtureRegistry([
      // `top` itself needs no @llui package at all...
      {
        name: 'top',
        type: 'registry:ui',
        dependencies: ['clsx'],
        registryDependencies: ['base'],
        files: file('top'),
      },
      // ...but the item it pulls in does.
      {
        name: 'base',
        type: 'registry:ui',
        dependencies: ['@llui/components@^5.0.0'],
        files: file('base'),
      },
    ])
    await install('@llui/components', '4.9.9')
    const config = ConfigSchema.parse({ registry })

    const failure = await add({ cwd, config, names: ['top'] }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(VersionMismatchError)
    const mismatches = (failure as VersionMismatchError).mismatches
    expect(mismatches.map((m) => [m.name, m.installed, m.minimum, m.requiredBy])).toEqual([
      ['@llui/components', '4.9.9', '5.0.0', ['base']],
    ])
    expect((failure as Error).message).toMatch(
      /@llui\/components: installed 4\.9\.9, requires >= 5\.0\.0 \(base\)/,
    )
    expect(await writtenFiles()).toEqual([])
  })

  it('treats a prerelease BELOW its release: 5.0.0-rc.1 installed fails a 5.0.0 floor', async () => {
    const registry = await fixtureRegistry([
      {
        name: 'x',
        type: 'registry:ui',
        dependencies: ['@llui/components@^5.0.0'],
        files: file('x'),
      },
    ])
    await install('@llui/components', '5.0.0-rc.1')
    const config = ConfigSchema.parse({ registry })
    await expect(add({ cwd, config, names: ['x'] })).rejects.toBeInstanceOf(VersionMismatchError)

    await install('@llui/components', '5.0.1-rc.1')
    await expect(add({ cwd, config, names: ['x'] })).resolves.toBeDefined()
  })

  it('rejects an item whose @llui/* dependency carries no minimum, before writing', async () => {
    const registry = await fixtureRegistry([
      { name: 'old', type: 'registry:ui', dependencies: ['@llui/components'], files: file('old') },
    ])
    const { code, err } = await (async () => {
      const errs: string[] = []
      vi.spyOn(console, 'error').mockImplementation(
        (...a: unknown[]) => void errs.push(a.join(' ')),
      )
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const c = await main(['add', 'old', '--registry', registry, '--cwd', cwd])
      vi.restoreAllMocks()
      return { code: c, err: errs.join('\n') }
    })()
    expect(code).toBe(1)
    expect(err).toMatch(
      /Registry item "old" declares "@llui\/components" without a minimum version/,
    )
    expect(await writtenFiles()).toEqual([])
  })

  it('exposes the requirement, the project version and the install spec on the result', async () => {
    const registry = await fixtureRegistry([
      {
        name: 'x',
        type: 'registry:ui',
        dependencies: ['@llui/components@^5.0.0', '@llui/dom@^2.0.0', 'clsx'],
        files: file('x'),
      },
    ])
    await install('@llui/components', '5.2.0')
    const config = ConfigSchema.parse({ registry })
    const result = await add({ cwd, config, names: ['x'] })
    expect(result.dependencies.map((d) => [d.name, d.minimum])).toEqual([
      ['@llui/components', '5.0.0'],
      ['@llui/dom', '2.0.0'],
      ['clsx', null],
    ])
    expect(result.versions.map((v) => [v.name, v.status])).toEqual([
      ['@llui/components', 'ok'],
      ['@llui/dom', 'missing'],
    ])
    expect(result.install.dependencies).toEqual(['@llui/components', '@llui/dom@^2.0.0', 'clsx'])
    expect(result.mismatches).toEqual([])
  })
})
