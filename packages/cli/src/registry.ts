import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { ProductContractSchema } from './product-contract.js'
import { compareVersions, parseVersion } from './semver.js'
import { findInstalled } from './versions.js'

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
  /** LLui registries publish the relationship between copied source and public
   * machine imports. Optional so additive metadata does not break compatible
   * third-party registries that only implement the item protocol. */
  productContract: ProductContractSchema.optional(),
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
  const remote = isRemote(source)
  const raw: unknown = remote
    ? await fetchJson(resolveRemote(source))
    : JSON.parse(await readFile(resolveLocal(source), 'utf8'))
  const registry = RegistrySchema.parse(raw)
  for (const item of registry.items) {
    for (const file of item.files) assertSafeTarget(file.target, item.name)
    assertDependencySpecs(item, remote ? 'built' : 'workspace')
  }
  if (remote) return registry
  return {
    ...registry,
    items: await pinWorkspaceSpecs(registry.items, path.dirname(resolveLocal(source))),
  }
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
  assertDependencySpecs(item, 'built')
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

/** The npm scope whose packages registry items must declare with a minimum. */
export const LLUI_SCOPE = '@llui/'

/** The source-registry spec `scripts/build-registry.mjs` replaces with `^<workspace version>`. */
export const WORKSPACE_SPEC = 'workspace:^'

/**
 * Split an npm dependency spec (`clsx`, `clsx@^2`, `@llui/dom@^0.14.0`) into its
 * package name and the range after the `@`, if any. A scoped name's leading `@`
 * is part of the NAME, so the separator is the first `@` after position 0.
 */
export function parseDependencySpec(spec: string): { name: string; range: string | null } {
  const at = spec.indexOf('@', 1)
  return at === -1
    ? { name: spec, range: null }
    : { name: spec.slice(0, at), range: spec.slice(at + 1) }
}

/** The floor of a BUILT `@llui/*` spec (`^0.20.1` -> `0.20.1`), or `null` if it has none. */
function caretFloor(range: string | null): string | null {
  if (range === null || !range.startsWith('^')) return null
  const floor = range.slice(1)
  // `parseVersion` tolerates a leading `v`/`=` for installed versions; a
  // registry spec must be the bare version the build writes.
  return /^\d/.test(floor) && parseVersion(floor) !== null ? floor : null
}

/**
 * Every `@llui/*` dependency must say which version its item was written
 * against, as `@llui/<pkg>@^<version>`. A skin that uses something new in
 * `@llui/components` (a token, a part attribute, a floating CSS variable)
 * otherwise copies cleanly into a project on an older release and breaks
 * silently at runtime — which is why `llui add` checks that floor before it
 * writes anything, and why an item that does not declare one is REJECTED here
 * rather than waved through unchecked.
 *
 * The form is shadcn's own: a `dependencies` entry is an npm spec, and
 * shadcn's CLI passes `name@range` straight to the package manager. Only the
 * caret-on-a-full-version form is accepted, because it is the only one the
 * registry build emits and the only one whose floor is unambiguous. `llui add`
 * reads the caret as a MINIMUM: a newer install passes even past the caret's
 * upper bound. Non-`@llui` entries are relayed untouched.
 *
 * `kind` says where the item came from. A `'workspace'` registry — an unbuilt
 * `registry/registry.json` read from a local path — may instead say
 * `@llui/<pkg>@workspace:^`, pnpm's protocol for "this workspace's version",
 * which the loader then resolves exactly as the build does. A `'built'`
 * registry (anything fetched) must never carry that source form.
 */
export function assertDependencySpecs(item: RegistryItem, kind: 'built' | 'workspace'): void {
  for (const spec of [...item.dependencies, ...item.devDependencies]) {
    const { name, range } = parseDependencySpec(spec)
    if (!name.startsWith(LLUI_SCOPE)) continue
    if (range === WORKSPACE_SPEC) {
      if (kind === 'workspace') continue
      throw new Error(
        `Registry item "${item.name}" declares ${JSON.stringify(spec)}, an unbuilt source spec. ` +
          'A served registry must be built first (node scripts/build-registry.mjs), which ' +
          `replaces it with ${name}@^<version>.`,
      )
    }
    if (range === null) {
      throw new Error(
        `Registry item "${item.name}" declares ${JSON.stringify(name)} without a minimum version. ` +
          `Every @llui/* dependency must be written ${name}@^<version> — the version the item ` +
          'was built against. This registry predates that rule; rebuild it with ' +
          'node scripts/build-registry.mjs.',
      )
    }
    if (caretFloor(range) === null) {
      throw new Error(
        `Registry item "${item.name}" declares ${JSON.stringify(spec)}, which is not a minimum ` +
          `version. Every @llui/* dependency must be written ${name}@^<version> with a full ` +
          'semver version (e.g. ^0.20.1).',
      )
    }
  }
}

/**
 * Resolve `@llui/<pkg>@workspace:^` in a local source registry to the version
 * of the package the registry's own workspace links — found by the same
 * node_modules walk `llui add` uses for the consumer, starting from the
 * registry directory. That is the version `scripts/build-registry.mjs` writes,
 * so a checkout and llui.dev enforce the same floor.
 */
async function pinWorkspaceSpecs(
  items: readonly RegistryItem[],
  registryDir: string,
): Promise<RegistryItem[]> {
  const cache = new Map<string, string>()
  const pin = async (spec: string, itemName: string): Promise<string> => {
    const { name, range } = parseDependencySpec(spec)
    if (range !== WORKSPACE_SPEC) return spec
    let version = cache.get(name)
    if (version === undefined) {
      const found = await findInstalled(registryDir, name)
      if (found === null || caretFloor(`^${found.version}`) === null) {
        throw new Error(
          `Registry item "${itemName}" declares ${JSON.stringify(spec)}, but ${name} does not ` +
            `resolve to a valid version from ${registryDir}. Install the registry's workspace ` +
            '(pnpm install), or point --registry at a built registry.',
        )
      }
      version = found.version
      cache.set(name, version)
    }
    return `${name}@^${version}`
  }
  const out: RegistryItem[] = []
  for (const item of items) {
    const pinAll = (specs: readonly string[]): Promise<string[]> =>
      Promise.all(specs.map((s) => pin(s, item.name)))
    out.push({
      ...item,
      dependencies: await pinAll(item.dependencies),
      devDependencies: await pinAll(item.devDependencies),
    })
  }
  return out
}

/** One npm package the resolved items need. */
export interface DependencyRequirement {
  name: string
  /** What to install when the project lacks it (`@llui/dom@^0.14.0`, `clsx`). */
  spec: string
  /** The lowest acceptable version — set for every `@llui/*` package, `null` otherwise. */
  minimum: string | null
  /** The items that declare it, in resolution order. */
  requiredBy: string[]
}

/**
 * Collect the npm packages the given items need — the union over every
 * resolved item, so a package reached only through `registryDependencies` is
 * here too — deduped and sorted by name.
 *
 * An `@llui/*` package is keyed by NAME and carries the highest minimum any
 * item declares (the one floor that satisfies all of them). Anything else is
 * keyed by its whole spec, as before: the CLI relays third-party ranges, it
 * does not interpret them.
 */
export function collectDependencies(items: readonly RegistryItem[]): {
  dependencies: DependencyRequirement[]
  devDependencies: DependencyRequirement[]
} {
  const collect = (pick: (item: RegistryItem) => readonly string[]): DependencyRequirement[] => {
    const byKey = new Map<string, DependencyRequirement>()
    for (const item of items) {
      for (const spec of pick(item)) {
        const { name, range } = parseDependencySpec(spec)
        const minimum = name.startsWith(LLUI_SCOPE) ? caretFloor(range) : null
        const key = minimum === null ? spec : name
        const seen = byKey.get(key)
        if (seen === undefined) {
          byKey.set(key, { name, spec, minimum, requiredBy: [item.name] })
          continue
        }
        if (!seen.requiredBy.includes(item.name)) seen.requiredBy.push(item.name)
        if (
          minimum !== null &&
          seen.minimum !== null &&
          compareVersions(minimum, seen.minimum) > 0
        ) {
          seen.minimum = minimum
          seen.spec = spec
        }
      }
    }
    return [...byKey.values()].sort((a, b) =>
      a.name !== b.name ? (a.name < b.name ? -1 : 1) : a.spec < b.spec ? -1 : 1,
    )
  }
  return {
    dependencies: collect((i) => i.dependencies),
    devDependencies: collect((i) => i.devDependencies),
  }
}
