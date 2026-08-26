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
  type RegistryFile,
  type RegistryItem,
} from './registry.js'

export interface AddOptions {
  cwd: string
  config: Config
  names: readonly string[]
  /** Replace files that already exist. Default false — see `AddResult.skipped`. */
  overwrite?: boolean
  /** Resolve and report without touching the filesystem. */
  dryRun?: boolean
}

export interface AddResult {
  written: string[]
  /** Files that already existed and were LEFT ALONE. */
  skipped: string[]
  items: RegistryItem[]
  dependencies: string[]
  devDependencies: string[]
}

/**
 * Copy registry items into the project.
 *
 * Not overwriting by default is the whole safety story of this command: the
 * point of the registry model is that the copied file becomes the consumer's
 * source, which they are expected to edit. A second `llui add button` after
 * those edits must not silently discard them, so an existing file is reported
 * as skipped and `--overwrite` is the explicit opt-in.
 */
export async function add(options: AddOptions): Promise<AddResult> {
  const { cwd, config, names, overwrite = false, dryRun = false } = options
  const registry = await loadRegistry(config.registry)
  const items = resolveItems(registry, names)

  const written: string[] = []
  const skipped: string[] = []

  for (const listed of items) {
    // Hydration is DEFERRED until a file is actually about to be written. The
    // remote index strips file bodies but keeps the file LIST, so targets, skip
    // decisions and the whole dry-run plan are answerable without it — and a
    // preview that touches the network is not much of a preview. It is also
    // resolved once per item, not once per file.
    let hydrated: RegistryItem | null = null
    const full = async (): Promise<RegistryItem> => {
      if (hydrated === null) {
        hydrated =
          isRemote(config.registry) && listed.files.some((f) => f.content === undefined)
            ? await loadRemoteItem(config.registry, listed.name)
            : listed
      }
      return hydrated
    }

    for (const [index, file] of listed.files.entries()) {
      const dir = targetDir(config, file.type)
      const dest = path.join(cwd, dir, file.target)
      const rel = path.relative(cwd, dest).split(path.sep).join('/')

      if (!overwrite && (await exists(dest))) {
        skipped.push(rel)
        continue
      }
      if (!dryRun) {
        await mkdir(path.dirname(dest), { recursive: true })
        // Index and record list the same files in the same order, so the record's
        // entry at this index is this file. Fall back to the index entry if a
        // registry ever disagrees — `contentOf` then reports the missing body
        // rather than writing the wrong one.
        const source = (await full()).files[index] ?? file
        const content = await contentOf(source, config.registry)
        await writeFile(dest, rewriteImports(content, dir, config), 'utf8')
      }
      written.push(rel)
    }
  }

  return { written, skipped, items, ...collectDependencies(items) }
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
