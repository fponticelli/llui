// Read the BASELINE stylesheet: `theme.css` plus the ordered family modules it
// `@import`s. Shared by every guard that judges the plain-CSS baseline (the
// dead-attribute check in `registry-attrs.test.ts`, the overlay motion policy)
// so the set of files each one reads cannot drift apart.
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The concatenated source of every module `theme.css` imports, in order.
 * Comments inside `theme.css` are stripped first so a commented-out import is
 * not read.
 *
 * @param {string} stylesDir absolute path to `packages/components/src/styles`
 * @returns {string}
 */
export function readBaselineCss(stylesDir) {
  const entry = readFileSync(path.join(stylesDir, 'theme.css'), 'utf8')
  return [...entry.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@import ['"]\.\/([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((file) => file !== undefined)
    .map((file) => readFileSync(path.join(stylesDir, file), 'utf8'))
    .join('\n')
}

/**
 * The flat (non-nested) rule blocks of `css`, comments stripped, as
 * `{ selectors, body }` with each comma-separated selector trimmed. At-rule
 * wrappers (`@media … {`) are dropped from the selector text so a rule inside
 * one is still reported with its own selectors.
 *
 * @param {string} css
 * @returns {{ selectors: string[], body: string }[]}
 */
export function cssRules(css) {
  /** @type {{ selectors: string[], body: string }[]} */
  const out = []
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const block of stripped.split('}')) {
    const open = block.lastIndexOf('{')
    if (open < 0) continue
    const head = block.slice(0, open)
    const selectorText = head.slice(head.lastIndexOf('{') + 1)
    const selectors = selectorText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !s.startsWith('@'))
    if (selectors.length === 0) continue
    out.push({ selectors, body: block.slice(open + 1) })
  }
  return out
}
