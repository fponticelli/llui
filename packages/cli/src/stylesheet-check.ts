import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Detect the one configuration that silently breaks registry components:
 * importing the BASELINE stylesheet alongside them.
 *
 * `@llui/components/styles/theme.css` is a complete look built from
 * `[data-scope][data-part]` rules, for apps that want components to look
 * finished without Tailwind. Those rules are UNLAYERED, and unlayered CSS beats
 * `@layer utilities` — so with both imported, every recipe `llui add` copies
 * loses to the baseline. Both stylesheets are present and correct; the wrong one
 * wins, with no error anywhere.
 *
 * It is not a specificity problem a consumer can out-write: layer precedence
 * ignores specificity entirely. The only fix is to import ONE of them, which is
 * why this warns rather than trying to reconcile them.
 *
 * Measured, not theorised: the registry `Switch`'s thumb rendered at the
 * baseline's 20px and ignored its own `size-4` until the demo's import was
 * narrowed to `tokens.css`.
 */

const BASELINE = /@import\s+['"][^'"]*@llui\/components\/styles\/theme(-dark)?\.css['"]/
const TOKENS = /@import\s+['"][^'"]*@llui\/components\/styles\/tokens(-dark)?\.css['"]/

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage'])

/** CSS files under `cwd`, a few levels deep — enough to find an app entry
 * without walking a monorepo. */
async function cssFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...(await cssFiles(full, depth + 1)))
    } else if (entry.name.endsWith('.css')) {
      out.push(full)
    }
  }
  return out
}

/** Files that import the baseline stylesheet, relative to `cwd`. Empty when the
 * project is on the registry path (or has no CSS yet). */
export async function findBaselineImports(cwd: string): Promise<string[]> {
  const hits: string[] = []
  for (const file of await cssFiles(cwd)) {
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    if (BASELINE.test(source)) hits.push(path.relative(cwd, file))
  }
  return hits
}

/** Whether any CSS file already imports the tokens — used only to phrase the
 * warning, since a project with neither is simply not set up yet. */
export async function hasTokensImport(cwd: string): Promise<boolean> {
  for (const file of await cssFiles(cwd)) {
    try {
      if (TOKENS.test(await readFile(file, 'utf8'))) return true
    } catch {
      continue
    }
  }
  return false
}

/** The warning text, or null when there is nothing to warn about. */
export function baselineWarning(files: readonly string[]): string | null {
  if (files.length === 0) return null
  return [
    '',
    '⚠  This project imports the BASELINE stylesheet:',
    ...files.map((f) => `     ${f}`),
    '',
    '   `styles/theme.css` styles components with unlayered [data-scope][data-part]',
    '   rules, and unlayered CSS beats @layer utilities — so every recipe you copy',
    '   here will LOSE to it. Nothing errors; the wrong stylesheet just wins.',
    '',
    '   Pick one:',
    '     • registry path — replace theme.css with styles/tokens.css (+ tokens-dark.css)',
    '     • baseline path — keep theme.css and do not use `llui add`',
    '',
    '   https://llui.dev/components#choosing-a-styling-path',
    '',
  ].join('\n')
}
