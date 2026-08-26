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
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const STYLES = path.join(ROOT, 'packages/components/src/styles')

/** The package theme alone — the correct input for REGISTRY classes, which are
 * Tailwind utilities by policy and have no other stylesheet to come from. */
export const THEME_ONLY = [
  '@import "tailwindcss";',
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

async function loadStylesheet(id, base) {
  let file
  if (id.startsWith('.') || path.isAbsolute(id)) {
    file = path.resolve(base, id)
  } else {
    const workspace = WORKSPACE_CSS.exec(id)
    file = workspace
      ? path.join(ROOT, 'packages', workspace[1], 'src', workspace[2])
      : fileURLToPath(import.meta.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id))
  }
  return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') }
}

/**
 * @param {readonly string[]} candidates
 * @returns {Promise<{ css: string, dead: string[] }>} `dead` lists candidates
 *   that produced no rule — in source order, so a failure names the first one.
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
