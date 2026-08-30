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
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const entry = pkg.exports?.['.']?.style ?? pkg.style ?? pkg.main
  if (entry === undefined) throw new Error(`No CSS entry for "${id}"`)
  return path.resolve(dir, entry)
}

/**
 * The path half of `loadStylesheet`, exported so an `@import` WALK resolves ids
 * exactly the way the compile does. `scripts/test/token-contrast.test.ts`
 * discovers its inputs by walking imports from each app entry; a second,
 * lookalike resolver there would answer "does this entry reach the tokens?"
 * against different rules than the compile that then measures it.
 */
export function resolveCssId(id, base) {
  if (id.startsWith('.') || path.isAbsolute(id)) return path.resolve(base, id)
  const workspace = WORKSPACE_CSS.exec(id)
  if (workspace) return path.join(ROOT, 'packages', workspace[1], 'src', workspace[2])
  if (id === 'tailwindcss') return fileURLToPath(import.meta.resolve('tailwindcss/index.css'))
  return resolvePackageCss(id)
}

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
 * one function serves both inputs above. */
export function selectorFor(candidate) {
  let out = ''
  for (const ch of candidate) out += /[A-Za-z0-9_-]/.test(ch) ? ch : `\\${ch}`
  return `.${out}`
}

/** `group/<name>` and `peer/<name>` are MARKER classes: Tailwind emits no rule
 * for them, because their only job is to be referenced by a
 * `group-…/<name>:` or `peer-…/<name>:` variant on a descendant. (Bare `group`
 * and `peer` DO emit a rule, so they are not markers.) */
export function markerName(candidate) {
  const m = /^(group|peer)\/([A-Za-z0-9_-]+)$/.exec(candidate)
  return m === null ? null : m[2]
}

/** The `<name>` a `group-…/<name>:` or `peer-…/<name>:` variant references. */
export function markerReferences(candidate) {
  const out = []
  for (const m of candidate.matchAll(/\b(?:group|peer)-[^\s:]*?\/([A-Za-z0-9_-]+):/g))
    out.push(m[1])
  return out
}
