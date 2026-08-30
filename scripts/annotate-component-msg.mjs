#!/usr/bin/env node
/**
 * One-shot sweep: annotate every variant of every component's Msg
 * union in @llui/components with @intent / @humanOnly JSDoc.
 *
 * Heuristics (variant name → classification):
 *   - focus* / highlight* — keyboard-only; agents can't drive a focus
 *     model, mark @humanOnly
 *   - setItems / setOptions / setDisabled / setLoading / setReadOnly /
 *     setError / setValid / setScroll* / setHovered — programmatic
 *     configuration or DOM-event echoes, host-driven, @humanOnly
 *   - *KeyDown / *KeyUp / *MouseDown / *MouseUp / *Pointer* — DOM
 *     events, @humanOnly
 *   - everything else — @intent("<verb-cased name>")
 *
 * The intent text is approximate: title-cased variant name. Maintainers
 * can polish individual variants without re-running this script. The
 * goal is to get every variant past the agent-missing-intent rule
 * without leaving Claude with synthesized labels.
 *
 * Idempotent — skips variants that already have a JSDoc tag (any of
 * @intent, @humanOnly, @agentOnly, @requiresConfirm, @alwaysAffordable).
 *
 * Handles three variant shapes:
 *   1. Single-line:    `| { type: 'foo'; ... }`
 *   2. Multi-line:     `| {\n      type: 'foo'\n      ...\n    }`
 *   3. Bare line:      (multiple variants with line comments between)
 *
 * Continues across non-variant lines inside a union (line comments,
 * existing JSDoc) instead of breaking — only stops at the first
 * top-level statement (`export`, `interface`, `function`) or end of
 * file.
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
  /^setScroll/,
  /^setHovered/,
  /^setScrolling/,
  /^.*KeyDown$/,
  /^.*KeyUp$/,
  /^.*MouseDown$/,
  /^.*MouseUp$/,
  /^.*Pointer/,
]

/**
 * @param {string} variantName
 * @returns {'humanOnly' | 'intent'}
 */
function classify(variantName) {
  for (const re of HUMAN_ONLY_PATTERNS) {
    if (re.test(variantName)) return 'humanOnly'
  }
  return 'intent'
}

/**
 * @param {string} variant
 * @returns {string}
 */
function intentText(variant) {
  return variant
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (/** @type {string} */ c) => c.toUpperCase())
    .trim()
}

const TAG_RE = /@intent\b|@humanOnly\b|@agentOnly\b|@requiresConfirm\b|@alwaysAffordable\b/

/**
 * One union's rewrite: the emitted lines, how many source lines were consumed,
 * and how many annotations were inserted.
 * @typedef {object} UnionRewrite
 * @property {string[]} rewritten
 * @property {number} consumed
 * @property {number} edits
 */

/**
 * Scan a Msg union starting at lines[startIdx] (the line after `export
 * type XxxMsg =`). Returns the rewritten lines and edit count.
 * @param {string[]} lines
 * @param {number} startIdx
 * @returns {UnionRewrite}
 */
function annotateUnion(lines, startIdx) {
  /** @type {string[]} */
  const out = []
  let i = startIdx
  let edits = 0
  // pending tracks comment/JSDoc lines accumulated since the last variant
  // — these are what we look at for an existing tag.
  /** @type {string[]} */
  let pending = []

  while (i < lines.length) {
    const cur = lines[i]
    if (cur === undefined) break
    const trimmed = cur.trim()

    // Stop at top-level statements.
    if (/^(export|interface|function)\s/.test(cur) || /^type\s/.test(cur)) {
      // Flush pending and return.
      out.push(...pending)
      return { rewritten: out, consumed: i - startIdx, edits }
    }

    // Single-line variant
    const single = /^(\s*)\|\s*\{\s*type:\s*['"]([^'"]+)['"]/.exec(cur)
    // Multi-line variant header (` | {` on its own line)
    const multi = /^(\s*)\|\s*\{\s*$/.test(cur)

    /** @type {string | null} */
    let typeName = null
    let indent = ''
    let multiTypeIdx = -1
    if (single) {
      // Both groups always participate when the pattern matches; `?? null` /
      // `?? ''` keep the pre-existing falsy handling below rather than inventing
      // a variant name.
      typeName = single[2] ?? null
      indent = single[1] ?? ''
    } else if (multi) {
      indent = /^(\s*)/.exec(cur)?.[1] ?? ''
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const candidate = lines[j]
        if (candidate === undefined) break
        const tm = /^\s*type:\s*['"]([^'"]+)['"]/.exec(candidate)
        if (tm) {
          typeName = tm[1] ?? null
          multiTypeIdx = j
          break
        }
      }
    }

    if (typeName) {
      const pendingText = pending.join('\n')
      const hasTag = TAG_RE.test(pendingText)
      // Flush any pending comment lines verbatim
      out.push(...pending)
      pending = []
      if (!hasTag) {
        const kind = classify(typeName)
        const tag =
          kind === 'humanOnly' ? '/** @humanOnly */' : `/** @intent("${intentText(typeName)}") */`
        out.push(`${indent}${tag}`)
        edits++
      }
      // Emit the variant. For multi-line variants, emit the whole block.
      out.push(cur)
      i++
      if (multi && multiTypeIdx >= 0) {
        // Find the closing brace of the multi-line variant
        let depth = 1
        while (i < lines.length && depth > 0) {
          const ln = lines[i]
          if (ln === undefined) break
          for (const ch of ln) {
            if (ch === '{') depth++
            else if (ch === '}') depth--
          }
          out.push(ln)
          i++
          if (depth === 0) break
        }
      }
      continue
    }

    // Not a variant. If it's a comment/JSDoc, accumulate. If blank, drop pending. Else flush.
    if (/^\/\*\*|^\*|^\*\/|^\/\//.test(trimmed) && trimmed !== '') {
      pending.push(cur)
    } else if (trimmed === '') {
      // Blank line — flush pending verbatim, reset.
      out.push(...pending)
      pending = []
      out.push(cur)
    } else {
      // Other content — likely the union's right-hand-side has ended (e.g. a
      // type expression on its own line). Flush and stop.
      out.push(...pending)
      out.push(cur)
      i++
      return { rewritten: out, consumed: i - startIdx, edits }
    }
    i++
  }

  out.push(...pending)
  return { rewritten: out, consumed: i - startIdx, edits }
}

/**
 * @param {string} source
 * @returns {{ source: string, edits: number }}
 */
function annotateFile(source) {
  const lines = source.split('\n')
  /** @type {string[]} */
  const out = []
  let i = 0
  let totalEdits = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break
    if (/^export type \w+Msg(<[^>]*>)?\s*=\s*$/.test(line.trim())) {
      out.push(line)
      i++
      const { rewritten, consumed, edits } = annotateUnion(lines, i)
      out.push(...rewritten)
      i += consumed
      totalEdits += edits
    } else {
      out.push(line)
      i++
    }
  }

  return { source: out.join('\n'), edits: totalEdits }
}

const files = readdirSync(componentsDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
let totalEdits = 0
let touchedFiles = 0
for (const file of files) {
  const path = join(componentsDir, file)
  const source = readFileSync(path, 'utf8')
  if (!/export type \w+Msg(<[^>]*>)?\s*=/.test(source)) continue
  const { source: rewritten, edits } = annotateFile(source)
  if (edits > 0) {
    writeFileSync(path, rewritten)
    console.log(`${file}: ${edits} variant${edits === 1 ? '' : 's'} annotated`)
    totalEdits += edits
    touchedFiles++
  }
}
console.log(`\nTotal: ${totalEdits} variants across ${touchedFiles} files`)
