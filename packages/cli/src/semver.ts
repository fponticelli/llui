/**
 * The small slice of semver `llui add` needs: parse a version, order two of
 * them, and find the lowest version a `package.json` range admits.
 *
 * Hand-written rather than a dependency on purpose — the CLI's only runtime
 * dependency is zod, and the question it asks is narrow: "is the installed
 * `@llui/*` package at least as new as the one this registry item was built
 * against?". That is an ORDERING question (semver 2.0 §11 precedence), not a
 * range-satisfaction one, so npm's rule that a range excludes prereleases of
 * other tuples does not apply: `0.21.0-beta.0` installed against a `0.20.1`
 * floor is newer, and passes.
 */

export interface Version {
  major: number
  minor: number
  patch: number
  /** Dot-separated identifiers; numeric ones are numbers. Empty = release. */
  prerelease: (string | number)[]
}

const NUM = '0|[1-9]\\d*'
const PRE_ID = `(?:${NUM}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`
const BUILD_ID = '[0-9a-zA-Z-]+'
const VERSION_RE = new RegExp(
  `^[=v]?(${NUM})\\.(${NUM})\\.(${NUM})` +
    `(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?` +
    `(?:\\+${BUILD_ID}(?:\\.${BUILD_ID})*)?$`,
)

/** Parse a FULL version (`1.2.3`, `1.2.3-rc.1+build`), or `null`. */
export function parseVersion(text: string): Version | null {
  const m = VERSION_RE.exec(text.trim())
  if (m === null) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease:
      m[4] === undefined ? [] : m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)),
  }
}

function mustParse(text: string): Version {
  const v = parseVersion(text)
  if (v === null) throw new Error(`${JSON.stringify(text)} is not a valid semver version.`)
  return v
}

function cmp(a: number | string, b: number | string): -1 | 0 | 1 {
  // §11.4.3: numeric identifiers always rank below alphanumeric ones.
  if (typeof a === 'number' && typeof b === 'string') return -1
  if (typeof a === 'string' && typeof b === 'number') return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semver 2.0 precedence: -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`. Build metadata is ignored. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = mustParse(a)
  const y = mustParse(b)
  for (const key of ['major', 'minor', 'patch'] as const) {
    const c = cmp(x[key], y[key])
    if (c !== 0) return c
  }
  // A release outranks any prerelease of the same tuple.
  if (x.prerelease.length === 0 || y.prerelease.length === 0) {
    return x.prerelease.length === y.prerelease.length ? 0 : x.prerelease.length === 0 ? 1 : -1
  }
  const n = Math.max(x.prerelease.length, y.prerelease.length)
  for (let i = 0; i < n; i++) {
    const p = x.prerelease[i]
    const q = y.prerelease[i]
    // A shorter identifier list ranks lower when every shared field is equal.
    if (p === undefined) return -1
    if (q === undefined) return 1
    const c = cmp(p, q)
    if (c !== 0) return c
  }
  return 0
}

/** Lower bound of a partial like `1`, `1.2`, `1.x`, `1.2.*`, `1.2.3-rc.1`; `null` for `*`/`x`. */
function floorOfPartial(text: string): string | null {
  const t = text.replace(/^[=v]+/, '')
  if (parseVersion(t) !== null) return t
  const m = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(t)
  if (m === null) return null
  const part = (s: string | undefined): string => (s === undefined || /[xX*]/.test(s) ? '0' : s)
  const floor = `${m[1]}.${part(m[2])}.${part(m[3])}`
  return parseVersion(floor) === null ? null : floor
}

function maxOf(versions: string[]): string {
  return versions.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b))
}

function minOf(versions: string[]): string {
  return versions.reduce((a, b) => (compareVersions(a, b) <= 0 ? a : b))
}

/** Floor of ONE comparator set (space-separated, no `||`), or `null`. */
function floorOfSet(set: string): string | null {
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set)
  if (hyphen !== null) return floorOfPartial(hyphen[1]!)

  // `>= 1.2.3` is legal npm syntax; glue the operator back onto its operand.
  const comparators = set.replace(/(>=|<=|>|<|=|\^|~>?)\s+/g, '$1').split(/\s+/)
  const floors: string[] = []
  for (const comparator of comparators) {
    const m = /^(>=|<=|>|<|=|\^|~>?)?(.*)$/.exec(comparator)!
    const op = m[1] ?? ''
    // An upper bound says nothing about the floor.
    if (op === '<' || op === '<=') continue
    // `>1.2.3` has no representable least member; do not round it to 1.2.3.
    if (op === '>') return null
    const floor = floorOfPartial(m[2]!)
    if (floor === null) return null
    floors.push(floor)
  }
  return floors.length === 0 ? null : maxOf(floors)
}

/**
 * The lowest version a `package.json` dependency range admits, or `null` when
 * that is not determinable (`*`, `latest`, `>1.2.3`, an upper bound alone, a
 * git/file/link/URL spec, `workspace:*`).
 *
 * This is how `llui add` compares a DECLARED-but-not-installed dependency
 * against a registry minimum: a project whose `package.json` says `^0.19.0`
 * may resolve 0.19.0 on a fresh install, so 0.19.0 is the version it can
 * promise. `workspace:` and `npm:<name>@` prefixes are unwrapped; `a || b`
 * takes the lower of the two floors, and a compound set (`>=1.2.3 <2`) the
 * highest lower bound in it.
 */
export function minimumOfRange(range: string): string | null {
  let r = range.trim()
  if (r.startsWith('workspace:')) r = r.slice('workspace:'.length)
  if (r.startsWith('npm:')) {
    const at = r.lastIndexOf('@')
    if (at <= 'npm:'.length) return null
    r = r.slice(at + 1)
  }
  const sets = r.split('||').map((s) => s.trim())
  const floors: string[] = []
  for (const set of sets) {
    if (set === '') return null
    const floor = floorOfSet(set)
    if (floor === null) return null
    floors.push(floor)
  }
  return floors.length === 0 ? null : minOf(floors)
}
