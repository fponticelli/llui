import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

/**
 * Registry schema — a deliberate subset of shadcn/ui's `registry-item.json`, with
 * the same field names and semantics so an LLui item is readable by anyone who
 * has seen a shadcn one (and so a future shadcn-CLI-compatible host stays an
 * option). Fields shadcn defines that LLui has no use for — `registry:hook`,
 * `tailwind`, `docs`, `meta` — are simply not modelled; unknown keys are
 * IGNORED rather than rejected, because a registry is a remote document whose
 * author may be ahead of this CLI, and failing closed on an unread key would
 * make every additive registry change a breaking one.
 */
export const RegistryFileSchema = z.object({
  path: z.string().min(1),
  type: z.string().min(1),
  /** Path INSIDE the destination directory for this file's type. Relative,
   * never absolute and never containing `..` — see `assertSafeTarget`. */
  target: z.string().min(1),
  /** Present in a built registry (the file's content, inlined); absent in the
   * source `registry.json`, where `path` still points at a real file on disk. */
  content: z.string().optional(),
})

export const RegistryItemSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  devDependencies: z.array(z.string()).default([]),
  registryDependencies: z.array(z.string()).default([]),
  files: z.array(RegistryFileSchema).min(1),
})

export const RegistrySchema = z.object({
  name: z.string().min(1),
  homepage: z.string().optional(),
  items: z.array(RegistryItemSchema),
})

export type RegistryFile = z.infer<typeof RegistryFileSchema>
export type RegistryItem = z.infer<typeof RegistryItemSchema>
export type Registry = z.infer<typeof RegistrySchema>

/**
 * A registry target is written INTO a directory the CLI chose, so it must not be
 * able to escape it. `..` and absolute paths are rejected at LOAD time rather
 * than at write time: a registry is remote, third-party content, and the write
 * site is several calls away from the place a reviewer would think to look.
 */
export function assertSafeTarget(target: string, itemName: string): void {
  if (path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) {
    throw new Error(
      `Registry item "${itemName}" declares an unsafe file target ${JSON.stringify(target)}. ` +
        'Targets must be relative and must not contain "..".',
    )
  }
}

/**
 * Load a registry INDEX from an https URL or a local path.
 *
 * `registry.json` is appended for BOTH — a `registry` setting names the registry,
 * not one file in it, and the documented default (`https://llui.dev/r`) is a
 * directory. Appending only for local paths made every remote install 404 on the
 * default value. A source that already ends in `.json` is taken as-is, so a host
 * that publishes its index under another name still works.
 */
export async function loadRegistry(source: string): Promise<Registry> {
  const raw = isRemote(source)
    ? await fetchJson(resolveRemote(source))
    : JSON.parse(await readFile(resolveLocal(source), 'utf8'))
  const registry = RegistrySchema.parse(raw)
  for (const item of registry.items) {
    for (const file of item.files) assertSafeTarget(file.target, item.name)
  }
  return registry
}

function resolveLocal(source: string): string {
  return source.endsWith('.json') ? source : path.join(source, 'registry.json')
}

function resolveRemote(source: string): string {
  return source.endsWith('.json') ? source : `${source.replace(/\/+$/, '')}/registry.json`
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Registry request failed: ${res.status} ${res.statusText} (${url})`)
  return res.json()
}

export function isRemote(source: string): boolean {
  return /^https?:\/\//.test(source)
}

/**
 * Fetch ONE item's full record, with its file contents inlined.
 *
 * The index deliberately strips file bodies — `llui list` only needs to name
 * things, and inlining every component into the index would make the common
 * case the largest download. So an item resolved from the index carries the file
 * LIST but no content, and installing it needs this second request. A local
 * registry needs no equivalent: its `path` still points at a real file on disk.
 */
export async function loadRemoteItem(source: string, name: string): Promise<RegistryItem> {
  const base = source.replace(/\/+$/, '')
  const item = RegistryItemSchema.parse(await fetchJson(`${base}/${name}.json`))
  for (const file of item.files) assertSafeTarget(file.target, item.name)
  return item
}

/**
 * Resolve the requested names plus everything they depend on, in dependency-first
 * order.
 *
 * Cycles are TOLERATED, not rejected: `visiting` short-circuits a name already on
 * the stack, so a registry whose items reference each other still installs every
 * file exactly once instead of recursing forever. A registry author's mistake
 * should not be a crash in someone else's install.
 */
export function resolveItems(registry: Registry, names: readonly string[]): RegistryItem[] {
  const byName = new Map(registry.items.map((i) => [i.name, i]))
  const out: RegistryItem[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()

  const visit = (name: string, from: string | null): void => {
    if (done.has(name) || visiting.has(name)) return
    const item = byName.get(name)
    if (!item) {
      const known = [...byName.keys()].sort().join(', ')
      throw new Error(
        from === null
          ? `Unknown registry item "${name}". Available: ${known}`
          : `Registry item "${from}" depends on "${name}", which this registry does not define.`,
      )
    }
    visiting.add(name)
    for (const dep of item.registryDependencies) visit(dep, name)
    visiting.delete(name)
    done.add(name)
    out.push(item)
  }

  for (const name of names) visit(name, null)
  return out
}

/** Collect the npm packages the given items need, deduped and sorted. */
export function collectDependencies(items: readonly RegistryItem[]): {
  dependencies: string[]
  devDependencies: string[]
} {
  const deps = new Set<string>()
  const dev = new Set<string>()
  for (const item of items) {
    for (const d of item.dependencies) deps.add(d)
    for (const d of item.devDependencies) dev.add(d)
  }
  return { dependencies: [...deps].sort(), devDependencies: [...dev].sort() }
}
