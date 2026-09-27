// Pin each registry item's `@llui/*` dependencies to a minimum version (#273).
//
// The SOURCE registry (`registry/registry.json`) writes every `@llui/*`
// dependency as `@llui/<pkg>@workspace:^` — pnpm's own protocol for "this
// workspace's version" — and never a version: a hand-maintained floor drifts the
// first time someone forgets to bump it. The build replaces the protocol with
// `^<version>` read from that package's `package.json` in `packages/`, exactly
// as `pnpm publish` rewrites `workspace:^` in a manifest. So the floor a served
// item carries is the version of the package it was built against, and
// `llui add` refuses to copy it into a project with an older one installed.
//
// Why `name@^version` in the existing string array rather than an object form:
// it is shadcn's `registry-item.json` shape unchanged (shadcn's CLI passes each
// entry straight to the package manager, `name@range` included), so the item
// stays readable by anyone — and any tool — that knows shadcn's format, and it
// is also exactly what `llui add` prints in its Install line for a missing
// package. Non-`@llui` dependencies are relayed untouched.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const LLUI_SCOPE = '@llui/'
export const WORKSPACE_SPEC = 'workspace:^'

/**
 * `name -> version` for every workspace package under `<root>/packages/`.
 * @param {string} root
 * @returns {Promise<Map<string, string>>}
 */
export async function workspaceVersions(root) {
  /** @type {Map<string, string>} */
  const versions = new Map()
  const dir = path.join(root, 'packages')
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let raw
    try {
      raw = await readFile(path.join(dir, entry.name, 'package.json'), 'utf8')
    } catch {
      continue
    }
    /** @type {unknown} */
    const parsed = JSON.parse(raw)
    const pkg = /** @type {{ name?: unknown, version?: unknown }} */ (parsed)
    if (typeof pkg.name === 'string' && typeof pkg.version === 'string') {
      versions.set(pkg.name, pkg.version)
    }
  }
  return versions
}

/**
 * Split `clsx`, `clsx@^2` or `@llui/dom@workspace:^` into name and range. A
 * scoped name's leading `@` belongs to the name.
 * @param {string} spec
 * @returns {{ name: string, range: string | null }}
 */
export function parseSpec(spec) {
  const at = spec.indexOf('@', 1)
  return at === -1
    ? { name: spec, range: null }
    : { name: spec.slice(0, at), range: spec.slice(at + 1) }
}

/**
 * Replace every `@llui/<pkg>@workspace:^` in `specs` with `@llui/<pkg>@^<v>`.
 * Anything else under `@llui/` is an authoring error and THROWS: a bare name
 * would ship an item with no floor, and a written-out version is precisely the
 * hand-maintained number this build exists to derive.
 * @param {readonly string[]} specs
 * @param {ReadonlyMap<string, string>} versions
 * @param {string} itemName
 * @returns {string[]}
 */
export function pinSpecs(specs, versions, itemName) {
  return specs.map((spec) => {
    const { name, range } = parseSpec(spec)
    if (!name.startsWith(LLUI_SCOPE)) return spec
    if (range !== WORKSPACE_SPEC) {
      throw new Error(
        `registry item "${itemName}": write ${JSON.stringify(`${name}@${WORKSPACE_SPEC}`)}, ` +
          `not ${JSON.stringify(spec)}. The build derives every @llui/* minimum from the ` +
          'workspace package version; it is never written by hand.',
      )
    }
    const version = versions.get(name)
    if (version === undefined) {
      throw new Error(
        `registry item "${itemName}": ${name} is not a workspace package under packages/, ` +
          'so there is no version to derive its minimum from.',
      )
    }
    return `${name}@^${version}`
  })
}

/**
 * @template {{ name: string, dependencies?: string[], devDependencies?: string[] }} T
 * @param {T} item
 * @param {ReadonlyMap<string, string>} versions
 * @returns {T}
 */
export function pinItemDependencies(item, versions) {
  const out = { ...item }
  if (item.dependencies !== undefined) {
    out.dependencies = pinSpecs(item.dependencies, versions, item.name)
  }
  if (item.devDependencies !== undefined) {
    out.devDependencies = pinSpecs(item.devDependencies, versions, item.name)
  }
  return out
}
