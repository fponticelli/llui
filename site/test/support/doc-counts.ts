/**
 * Manual-count detection for the docs integrity test (#269). Counts of components, machines,
 * skins, aliases or stylesheets belong inside a generated region, where they are derived from
 * the product contract; anywhere else they go stale the moment the contract changes.
 */
import { generatedRegions } from '../../src/component-docs.js'

/**
 * A number glued to an inventory noun: "66 headless components", "Components (66)", "~68
 * machines", "85 items". Counts belong inside a generated region, where they are derived.
 */
export const MANUAL_COUNT =
  /(?<![\w.#/-])~?\d+\+?\s+(?:(?:headless|ui|state|registry|copied|styled|canonical|public|shadcn(?:\/ui)?|component|stylesheet)\s+)*(?:components?|machines?|skins?|registry items|presentational items|patterns|aliases|component groups|stylesheets|subpaths|recipes)\b|\bComponents \(\d+\)/i

/** Replace generated regions (product-contract and auto-api) with blank lines. */
export function handWritten(text: string): string {
  let out = text
  for (const region of generatedRegions(text).reverse()) {
    const blank = text.slice(region.start, region.end).replace(/[^\n]/g, '')
    out = out.slice(0, region.start) + blank + out.slice(region.end)
  }
  return out.replace(/<!-- auto-api:start -->[\s\S]*?<!-- auto-api:end -->/g, (block) =>
    block.replace(/[^\n]/g, ''),
  )
}

export function manualCounts(file: string, text: string): string[] {
  const lines = handWritten(text).split('\n')
  const hits: string[] = []
  let fenced = false
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    // Emphasis must not hide a count: `~66 **headless** components`.
    const match = MANUAL_COUNT.exec(line.replace(/\*\*|__|(?<!\w)[*_]|[*_](?!\w)/g, ''))
    if (match !== null)
      hits.push(`${file}:${index + 1}: "${match[0]}"${fenced ? ' (in code)' : ''}`)
  })
  return hits
}
