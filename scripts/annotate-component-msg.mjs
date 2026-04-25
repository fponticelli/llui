#!/usr/bin/env node
/**
 * One-shot sweep: annotate every variant of every component's Msg
 * union in @llui/components with @intent / @humanOnly JSDoc.
 *
 * Heuristics (variant name → classification):
 *   - focus* / highlight* — keyboard-only; agents can't drive a focus
 *     model, mark @humanOnly
 *   - setItems / setOptions / setDisabled / setLoading / setReadOnly /
 *     setError / setValid — programmatic configuration, host-driven,
 *     @humanOnly
 *   - *KeyDown / *KeyUp / *MouseDown / *MouseUp — DOM events,
 *     @humanOnly
 *   - everything else — @intent("<verb-cased name>")
 *
 * The intent text is approximate: title-cased variant name. Maintainers
 * can polish individual variants without re-running this script. The
 * goal is to get every variant past the agent-missing-intent rule
 * without leaving Claude with synthesized labels.
 *
 * Idempotent — skips variants that already have a JSDoc tag (any of
 * @intent, @humanOnly, @agentOnly, @requiresConfirm, @alwaysAffordable).
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const componentsDir = join(__dirname, '..', 'packages', 'components', 'src', 'components')

const HUMAN_ONLY_PATTERNS = [
  /^focus[A-Z]/,
  /^highlight([A-Z]|$)/,
  /^setItems$/,
  /^setOptions$/,
  /^setDisabled$/,
  /^setLoading$/,
  /^setReadOnly$/,
  /^setError$/,
  /^setValid$/,
  /^setRequired$/,
  /^setReadonly$/,
  /^.*KeyDown$/,
  /^.*KeyUp$/,
  /^.*MouseDown$/,
  /^.*MouseUp$/,
  /^.*Pointer/,
]

function classify(variantName) {
  for (const re of HUMAN_ONLY_PATTERNS) {
    if (re.test(variantName)) return 'humanOnly'
  }
  return 'intent'
}

function intentText(variant) {
  // camelCase → "Camel case" (rough; user can polish individual cases).
  return variant
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

/**
 * Parse a Msg union, find each variant, and rewrite the source with
 * JSDoc annotations inserted before each variant. Preserves existing
 * JSDoc that contains LAP tags.
 */
function annotateFile(source) {
  // Find every `export type XxxMsg = | { type: 'foo', ... } | { type: 'bar' }`.
  // We process each Msg union independently. Inside the union, we
  // walk variant by variant, looking at the comment that precedes it.
  const lines = source.split('\n')
  const out = []
  let i = 0
  let edits = 0

  while (i < lines.length) {
    const line = lines[i]
    const isMsgUnionStart = /^export type \w+Msg\s*=\s*$/.test(line.trim())
    if (!isMsgUnionStart) {
      out.push(line)
      i++
      continue
    }
    out.push(line) // keep the `export type ... =` line

    i++
    while (i < lines.length) {
      const cur = lines[i]
      // A variant line looks like: `  | { type: 'xxx'; ... }` or just
      // `  | { type: 'xxx' }`. Stop when we leave the union.
      const variantMatch = /^(\s*)\| \{ type: ['"]([^'"]+)['"]/.exec(cur)
      if (!variantMatch) {
        // End of union (next is a blank line, another statement, etc.)
        break
      }
      const indent = variantMatch[1]
      const variantName = variantMatch[2]

      // Look back through `out` for an existing JSDoc immediately
      // above this variant. If present and contains an LAP tag, don't
      // re-annotate.
      let lookback = out.length - 1
      let existingDoc = ''
      while (lookback >= 0 && /^\s*\*/.test(out[lookback])) lookback--
      if (lookback >= 0 && /^\s*\/\*\*/.test(out[lookback])) {
        existingDoc = out.slice(lookback).join('\n')
      } else if (lookback >= 0 && /^\s*\/\*\*[^*]*\*\/$/.test(out[lookback])) {
        existingDoc = out[lookback]
      }
      const hasLapTag =
        /@intent\b|@humanOnly\b|@agentOnly\b|@requiresConfirm\b|@alwaysAffordable\b/.test(
          existingDoc,
        )
      if (hasLapTag) {
        out.push(cur)
        i++
        continue
      }

      // Insert JSDoc before this variant.
      const kind = classify(variantName)
      const tag =
        kind === 'humanOnly' ? '/** @humanOnly */' : `/** @intent("${intentText(variantName)}") */`
      out.push(`${indent}${tag}`)
      out.push(cur)
      edits++
      i++
    }
  }

  return { source: out.join('\n'), edits }
}

const files = readdirSync(componentsDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
let totalEdits = 0
let touchedFiles = 0
for (const file of files) {
  const path = join(componentsDir, file)
  const source = readFileSync(path, 'utf8')
  if (!/export type \w+Msg\s*=/.test(source)) continue
  const { source: rewritten, edits } = annotateFile(source)
  if (edits > 0) {
    writeFileSync(path, rewritten)
    console.log(`${file}: ${edits} variant${edits === 1 ? '' : 's'} annotated`)
    totalEdits += edits
    touchedFiles++
  }
}
console.log(`\nTotal: ${totalEdits} variants across ${touchedFiles} files`)
