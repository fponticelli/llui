/**
 * Whether an `npm` install actually landed — the check `scripts/setup-bench.ts`
 * runs after every install, extracted so it can be unit-tested against a
 * synthetic tree instead of a 600 MB benchmark clone.
 *
 * The rule: an install is complete when every `node_modules/...` path its
 * `package-lock.json` declares physically exists. npm's exit code is not
 * evidence (`npm ci --omit=dev` exits 0 on a tree with no devDependencies), and
 * neither is a direct-dependency spot check — a missing TRANSITIVE package
 * leaves all direct ones in place and still breaks the consumer at require
 * time, which is how "jfb server failed to start on port 8080" outlived its
 * cause for a whole issue (#81).
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export type InstallState = 'ok' | 'incomplete' | 'stale' | 'absent'

/** Direct dependency names declared by a package manifest. */
export function directDependencies(pkgDir: string): readonly string[] {
  const parsed: unknown = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) return []
  const manifest = parsed as Record<string, unknown>
  const names: string[] = []
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const section = manifest[field]
    if (typeof section !== 'object' || section === null) continue
    names.push(...Object.keys(section))
  }
  return names
}

/**
 * Every `node_modules/...` path `package-lock.json` says the install must
 * produce — the whole tree, not just the direct deps. Optional and
 * platform-gated entries (esbuild's per-arch binaries, fsevents, …) are
 * excluded because npm legitimately skips them on this machine; the jfb
 * `server/` and `webdriver-ts/` locks carry 27 and 34 of them respectively.
 */
export function expectedPackages(pkgDir: string): readonly string[] {
  const parsed: unknown = JSON.parse(readFileSync(resolve(pkgDir, 'package-lock.json'), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null) return []
  const packages = (parsed as Record<string, unknown>)['packages']
  if (typeof packages !== 'object' || packages === null) return []
  const entries = packages as Record<string, unknown>
  const paths: string[] = []
  for (const path of Object.keys(entries)) {
    if (!path.startsWith('node_modules/')) continue
    const entry = entries[path]
    if (typeof entry !== 'object' || entry === null) continue
    const meta = entry as Record<string, unknown>
    if (meta['optional'] === true || meta['devOptional'] === true) continue
    if (meta['os'] !== undefined || meta['cpu'] !== undefined) continue
    paths.push(path)
  }
  return paths
}

/** Lockfile entries that are NOT physically on disk. */
export function missingPackages(pkgDir: string): readonly string[] {
  return expectedPackages(pkgDir).filter(
    (path) => !existsSync(resolve(pkgDir, path, 'package.json')),
  )
}

/**
 * `ok` = matches the lockfile and is no older than it; anything else means the
 * caller should reinstall. `node_modules/.package-lock.json` is npm's own
 * record of the tree it wrote, so its mtime is the honest install timestamp.
 */
export function installState(pkgDir: string): InstallState {
  const stamp = resolve(pkgDir, 'node_modules', '.package-lock.json')
  if (!existsSync(stamp)) return 'absent'
  const lock = resolve(pkgDir, 'package-lock.json')
  if (statSync(lock).mtimeMs > statSync(stamp).mtimeMs) return 'stale'
  return missingPackages(pkgDir).length > 0 ? 'incomplete' : 'ok'
}
