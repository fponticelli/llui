// Compile a set of class candidates with the REAL Tailwind build, against the
// repo's own theme, and report which produce no CSS.
//
// This exists because string assertions cannot see a dead utility. The layer this
// replaced had 62 test files asserting `expect(cls).toContain('max-w-lg')` over
// class strings that were never compiled, and 116 utility occurrences across 55
// of them emitted nothing at all: `duration-fast` and `z-dialog`/`z-popover`/
// `z-tooltip` were spelled against `--duration-*` / `--z-*`, which are not
// Tailwind namespaces (`--transition-duration-*` and `--z-index-*` are). Every
// transition was instant and every overlay unstacked, and the suite was green.
import { compile } from 'tailwindcss'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const STYLES = path.join(ROOT, 'packages/components/src/styles')

/** The package theme alone — the correct input for REGISTRY classes, which are
 * Tailwind utilities by policy and have no other stylesheet to come from. */
export const THEME_ONLY = [
  '@import "tailwindcss";',
  // shadcn's recipes use `animate-in` / `fade-in-0` / `slide-in-from-top-2`,
  // which come from `tw-animate-css`, not Tailwind core. The registry declares
  // it as a dependency, so the check must resolve it too — otherwise every
  // ported overlay recipe reports as dead CSS.
  '@import "tw-animate-css";',
  `@import "${path.join(STYLES, 'theme.css')}";`,
  `@import "${path.join(STYLES, 'theme-dark.css')}";`,
].join('\n')

/**
 * An APP's real entry CSS. App code legitimately mixes utilities with its own
 * hand-written classes, so checking it against the theme alone reports every
 * plain class as dead. Compiling the entry the app actually ships means a class
 * counts as live if ANY rule defines it — utility or hand-written — which is
 * exactly the question being asked.
 *
 * @param {string} cssFile an ABSOLUTE path to the app's entry stylesheet
 * @returns {string} a CSS entry to hand to `compileCandidates`
 */
export const appEntry = (cssFile) => `@import "${cssFile}";`

/**
 * Resolve an `@import`. Relative and absolute ids are paths; a bare specifier is
 * a package — an app's entry CSS legitimately says
 * `@import '@llui/components/styles/theme.css'`, which resolved as a path would
 * be looked for inside the app's own `src/`.
 *
 * `@llui/*` specifiers are redirected to the workspace SOURCE rather than
 * resolved through node, deliberately. Node resolution lands on `dist/`, so the
 * check would pass or fail against whatever was last BUILT — a stale build could
 * hide a broken theme or invent a broken one, and the whole point of this check
 * is to describe the tree as committed.
 */
const WORKSPACE_CSS = /^@llui\/([a-z-]+)\/(.+)$/

/**
 * Resolve a bare CSS specifier the way a CSS bundler does — through the `style`
 * export condition, then `main`.
 *
 * `import.meta.resolve` uses the `import` condition, and a CSS-only package can
 * legitimately publish nothing under it: `tw-animate-css` exports exactly
 * `{ ".": { "style": "./dist/tw-animate.css" } }`. Resolving its `package.json`
 * and reading the condition directly is what Tailwind's own loader does.
 *
 * @param {string} id a bare package specifier, e.g. `tw-animate-css`
 * @returns {string} an absolute path to that package's CSS entry
 */
function resolvePackageCss(id) {
  // Read the manifest off disk rather than through `import.meta.resolve`: a
  // CSS-only package legitimately exports NOTHING to Node. `tw-animate-css`
  // publishes exactly `{ ".": { "style": "./dist/tw-animate.css" } }`, so both
  // `import(id)` and `resolve(id + '/package.json')` throw
  // ERR_PACKAGE_PATH_NOT_EXPORTED. This is repo tooling running against the
  // repo's own install, so the workspace root's `node_modules` is the honest
  // place to look — a bundler would resolve the `style` condition instead.
  const dir = path.join(ROOT, 'node_modules', id)
  /**
   * Only the three fields a CSS entry can come from. Narrower than a real
   * manifest on purpose: anything else here would be read without being
   * declared, and `JSON.parse` hands back `any`.
   *
   * @typedef {{
   *   exports?: { '.'?: { style?: string } | string },
   *   style?: string,
   *   main?: string,
   * }} CssEntryManifest
   */
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const pkg = /** @type {CssEntryManifest} */ (parsed)
  const dot = pkg.exports?.['.']
  const entry = (typeof dot === 'object' ? dot?.style : undefined) ?? pkg.style ?? pkg.main
  if (entry === undefined) throw new Error(`No CSS entry for "${id}"`)
  return path.resolve(dir, entry)
}

/**
 * The path half of `loadStylesheet`, exported so an `@import` WALK resolves ids
 * exactly the way the compile does. `scripts/test/token-contrast.test.ts`
 * discovers its inputs by walking imports from each app entry; a second,
 * lookalike resolver there would answer "does this entry reach the tokens?"
 * against different rules than the compile that then measures it.
 *
 * @param {string} id the `@import` specifier as written
 * @param {string} base the directory the importing stylesheet lives in
 * @returns {string} an absolute path
 */
export function resolveCssId(id, base) {
  if (id.startsWith('.') || path.isAbsolute(id)) return path.resolve(base, id)
  const workspace = WORKSPACE_CSS.exec(id)
  if (workspace) {
    const [, pkg, rest] = workspace
    if (pkg === undefined || rest === undefined) throw new Error(`unreadable @llui/* id: ${id}`)
    return path.join(ROOT, 'packages', pkg, 'src', rest)
  }
  if (id === 'tailwindcss') return fileURLToPath(import.meta.resolve('tailwindcss/index.css'))
  return resolvePackageCss(id)
}

/**
 * @param {string} id
 * @param {string} base
 * @returns {Promise<{ path: string, base: string, content: string }>}
 */
async function loadStylesheet(id, base) {
  const file = resolveCssId(id, base)
  return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') }
}

/**
 * @param {readonly string[]} candidates
 * @param {string} [input] CSS entry to compile against — `THEME_ONLY` for
 *   registry classes, `appEntry(file)` for an app that mixes utilities with its
 *   own hand-written rules.
 * @returns {Promise<{ css: string, dead: string[] }>} `dead` lists candidates
 *   that produced no rule, in source order, so a failure names the first one.
 */
export async function compileCandidates(candidates, input = THEME_ONLY) {
  const compiler = await compile(input, { base: ROOT, loadStylesheet })
  const css = compiler.build([...candidates])
  const dead = candidates.filter((c) => !css.includes(selectorFor(c)))
  return { css, dead }
}

/** Tailwind escapes every non-`[A-Za-z0-9_-]` character in a generated selector.
 * The same escaping is what a hand-written rule in an app stylesheet needs, so
 * one function serves both inputs above.
 *
 * @param {string} candidate a class name as written in source
 * @returns {string} the escaped class SELECTOR, `.` included
 */
export function selectorFor(candidate) {
  let out = ''
  for (const ch of candidate) out += /[A-Za-z0-9_-]/.test(ch) ? ch : `\\${ch}`
  return `.${out}`
}

/** `group/<name>` and `peer/<name>` are MARKER classes: Tailwind emits no rule
 * for them, because their only job is to be referenced by a
 * `group-…/<name>:` or `peer-…/<name>:` variant on a descendant. (Bare `group`
 * and `peer` DO emit a rule, so they are not markers.)
 *
 * @param {string} candidate
 * @returns {string | null} the `<name>`, or `null` if this is not a marker
 */
export function markerName(candidate) {
  const m = /^(group|peer)\/([A-Za-z0-9_-]+)$/.exec(candidate)
  // Group 2 is unconditional in that pattern, so `?? null` only ever answers
  // for a non-match — it does not widen the "is this a marker" question.
  return m?.[2] ?? null
}

/**
 * The `<name>` a `group-…/<name>:` or `peer-…/<name>:` variant references.
 *
 * @param {string} candidate
 * @returns {string[]} every referenced `<name>`, in source order
 */
export function markerReferences(candidate) {
  /** @type {string[]} */
  const out = []
  for (const m of candidate.matchAll(/\b(?:group|peer)-[^\s:]*?\/([A-Za-z0-9_-]+):/g)) {
    // As above: the single capture group is unconditional on a match.
    const name = m[1]
    if (name !== undefined) out.push(name)
  }
  return out
}
