import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type Config, targetDir } from './config.js'
import { rewriteImports } from './rewrite.js'
import {
  collectDependencies,
  isRemote,
  loadRegistry,
  loadRemoteItem,
  resolveItems,
  type DependencyRequirement,
  type RegistryFile,
  type RegistryItem,
} from './registry.js'
import {
  VersionMismatchError,
  checkVersions,
  installCommand,
  mismatchesOf,
  upgradeCommandFor,
  type VersionCheck,
  type VersionMismatch,
} from './versions.js'

export { VersionMismatchError, type VersionCheck, type VersionMismatch } from './versions.js'

export interface AddOptions {
  cwd: string
  config: Config
  names: readonly string[]
  /** Replace files that already exist. Default false — see `AddResult.skipped`. */
  overwrite?: boolean
  /**
   * Copy even when an installed `@llui/*` package is older than an item needs.
   * Default false — `add` then throws `VersionMismatchError` before writing.
   * With it, the mismatches are returned in `AddResult.mismatches` instead.
   */
  force?: boolean
  /** Resolve and report without touching the filesystem. */
  dryRun?: boolean
}

export interface AddResult {
  written: string[]
  /** Files that already existed and were LEFT ALONE. */
  skipped: string[]
  items: RegistryItem[]
  /** Every npm package the items need, including via `registryDependencies`. */
  dependencies: DependencyRequirement[]
  devDependencies: DependencyRequirement[]
  /** One check per `@llui/*` requirement, against the project's version. */
  versions: VersionCheck[]
  /** Installed packages older than required. Non-empty only under `force`. */
  mismatches: VersionMismatch[]
  /** Install-command arguments: a bare name when the project already satisfies
   * it, `name@^<min>` when it is missing or too old. */
  install: { dependencies: string[]; devDependencies: string[] }
  /** The command that upgrades every mismatch, or `null` when there are none. */
  upgradeCommand: string | null
}

interface PlannedFile {
  file: RegistryFile
  dest: string
  rel: string
  skip: boolean
}

interface PlannedItem {
  source: RegistryItem
  files: PlannedFile[]
}

/** The index and full record must describe the same item before either is trusted for a copy. */
function itemManifest(item: RegistryItem): object {
  return {
    name: item.name,
    type: item.type,
    title: item.title,
    description: item.description,
    dependencies: item.dependencies,
    devDependencies: item.devDependencies,
    registryDependencies: item.registryDependencies,
    files: item.files.map(({ path, type, target }) => ({ path, type, target })),
  }
}

function assertSameItem(listed: RegistryItem, full: RegistryItem): void {
  if (JSON.stringify(itemManifest(listed)) !== JSON.stringify(itemManifest(full))) {
    throw new Error(
      `Registry item "${listed.name}" differs between the index and its full record. ` +
        'Nothing was written. Retry when the registry serves a consistent version.',
    )
  }
}

/**
 * Copy registry items into the project.
 *
 * Not overwriting by default is the whole safety story of this command: the
 * point of the registry model is that the copied file becomes the consumer's
 * source, which they are expected to edit. A second `llui add button` after
 * those edits must not silently discard them, so an existing file is reported
 * as skipped and `--overwrite` is the explicit opt-in.
 *
 * The version pre-flight runs before the first write for the same reason: a
 * skin built against a newer `@llui/components` copies cleanly and then fails
 * at runtime, and a half-installed set of files is worse than none. `--force`
 * is its opt-in, mirroring `--overwrite`.
 */
export async function add(options: AddOptions): Promise<AddResult> {
  const { cwd, config, names, overwrite = false, force = false, dryRun = false } = options
  const registry = await loadRegistry(config.registry)
  const items = resolveItems(registry, names)
  const { dependencies, devDependencies } = collectDependencies(items)

  const versions = await checkVersions(cwd, [...dependencies, ...devDependencies])
  const mismatches = mismatchesOf(versions)
  const upgradeCommand =
    mismatches.length === 0 ? null : upgradeCommandFor(await installCommand(cwd), mismatches)
  if (upgradeCommand !== null && !force) throw new VersionMismatchError(mismatches, upgradeCommand)

  // Resolve every file decision and full remote record before the first write.
  // A registry deploy or cache can serve an older index alongside newer item
  // records; checking only the index's minimum would then approve newer source
  // for an older app. The same preflight prevents a later bad record from
  // leaving earlier items half-copied.
  const plans: PlannedItem[] = []
  for (const listed of items) {
    const files: PlannedFile[] = []
    for (const file of listed.files) {
      const dir = targetDir(config, file.type)
      const dest = path.join(cwd, dir, file.target)
      files.push({
        file,
        dest,
        rel: path.relative(cwd, dest).split(path.sep).join('/'),
        skip: !overwrite && (await exists(dest)),
      })
    }
    let source = listed
    if (
      !dryRun &&
      files.some(({ skip }) => !skip) &&
      isRemote(config.registry) &&
      listed.files.some(({ content }) => content === undefined)
    ) {
      source = await loadRemoteItem(config.registry, listed.name)
      assertSameItem(listed, source)
      for (const [index, planned] of files.entries()) {
        if (!planned.skip && source.files[index]?.content === undefined) {
          throw new Error(
            `Remote registry item "${listed.name}" has no content for "${planned.file.path}". ` +
              'Nothing was written.',
          )
        }
      }
    }
    plans.push({ source, files })
  }

  const written: string[] = []
  const skipped: string[] = []

  for (const { source, files } of plans) {
    for (const [index, { file, dest, rel, skip }] of files.entries()) {
      if (skip) {
        skipped.push(rel)
        continue
      }
      if (!dryRun) {
        await mkdir(path.dirname(dest), { recursive: true })
        const content = await contentOf(source.files[index] ?? file, config.registry)
        await writeFile(dest, rewriteImports(content, targetDir(config, file.type), config), 'utf8')
      }
      written.push(rel)
    }
  }

  const satisfied = new Set(versions.filter((v) => v.status === 'ok').map((v) => v.name))
  const installArgs = (reqs: readonly DependencyRequirement[]): string[] =>
    // A satisfied `@llui/*` stays bare: `^<min>` would steer a newer 0.x
    // install back DOWN inside the caret. Third-party specs are relayed as-is.
    reqs.map((r) => (r.minimum !== null && satisfied.has(r.name) ? r.name : r.spec))

  return {
    written,
    skipped,
    items,
    dependencies,
    devDependencies,
    versions,
    mismatches,
    install: {
      dependencies: installArgs(dependencies),
      devDependencies: installArgs(devDependencies),
    },
    upgradeCommand,
  }
}

/**
 * A built registry inlines `content`; the source `registry.json` in this repo
 * does not, and instead points `path` at a real file. Supporting both is what
 * lets `llui add --registry ./registry` work against a checkout with no build
 * step — which is also how the CLI's own tests run.
 */
async function contentOf(file: RegistryFile, registrySource: string): Promise<string> {
  if (file.content !== undefined) return file.content
  if (isRemote(registrySource)) {
    throw new Error(
      `Remote registry item file "${file.path}" has no inlined content even after ` +
        'fetching the item record. The registry host must serve built items ' +
        '(run `node scripts/build-registry.mjs`).',
    )
  }
  const root = registrySource.endsWith('.json') ? path.dirname(registrySource) : registrySource
  // `file.path` is repo-root-relative (`registry/llui/ui/button.ts`); the local
  // registry source points at the `registry/` directory itself, so resolve from
  // its PARENT rather than from the directory holding registry.json.
  return readFile(path.resolve(root, '..', file.path), 'utf8')
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file)
    return true
  } catch {
    return false
  }
}
