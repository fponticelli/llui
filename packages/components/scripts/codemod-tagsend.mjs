#!/usr/bin/env node
/**
 * Codemod: wrap inline event-handler arrows in component connect()
 * implementations with `tagSend(send, [variants], arrow)`.
 *
 * Why: components are precompiled to dist/ via tsc, so the
 * vite-plugin's universal tagger never sees them. App code that
 * uses these components with translator-style `send` (e.g.
 * `(m) => dispatch({type: 'X'})`) needs the components to
 * propagate the translator's tag via the runtime `tagSend` helper.
 * Plain `Object.assign(arrow, {__lluiVariants})` would always pick
 * the library's variants — wrong when a translator is in play.
 *
 * Implementation: find arrow positions via AST, splice the source
 * text. We don't re-emit through TS's printer because that would
 * reformat single quotes / semicolons / trailing commas in ways
 * that fight the project's prettier config.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const componentsDir = path.resolve(__dirname, '../src/components')

const files = fs
  .readdirSync(componentsDir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
  .map((f) => path.join(componentsDir, f))

const DISPATCHER_RE = /^(send|dispatch)/i

let totalSites = 0
let totalFiles = 0

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  // Quick filter — file must contain a send({...}) literal somewhere.
  if (!/send\(\s*\{/.test(source)) continue

  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)

  /**
   * Stops at nested function boundaries — same semantics as the
   * universal tagger.
   */
  function collectVariants(body) {
    const seen = new Set()
    const out = []
    function visit(n) {
      if (
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n)
      ) {
        return
      }
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        const first = n.arguments[0]
        if (
          callee &&
          ts.isIdentifier(callee) &&
          DISPATCHER_RE.test(callee.text) &&
          first &&
          ts.isObjectLiteralExpression(first)
        ) {
          for (const prop of first.properties) {
            if (!ts.isPropertyAssignment(prop)) continue
            if (!prop.name) continue
            const nameOk =
              (ts.isIdentifier(prop.name) && prop.name.text === 'type') ||
              (ts.isStringLiteral(prop.name) && prop.name.text === 'type')
            if (!nameOk) continue
            const init = prop.initializer
            if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
              if (!seen.has(init.text)) {
                seen.add(init.text)
                out.push(init.text)
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(body)
    return out
  }

  function isEventHandlerKey(name) {
    if (ts.isIdentifier(name)) return /^on[A-Z]/.test(name.text)
    if (ts.isStringLiteral(name)) return /^on[A-Z]/.test(name.text)
    return false
  }

  /** Collect text-span edits as `[start, end, replacement]` tuples. */
  const edits = []

  function walk(node) {
    if (ts.isPropertyAssignment(node) && isEventHandlerKey(node.name)) {
      const init = node.initializer
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        const variants = collectVariants(init.body)
        if (variants.length > 0) {
          // Splice tagSend(send, [...], <existing arrow source>) in
          // place of just <existing arrow source>. Preserves the
          // arrow's verbatim source — quotes, comments, formatting.
          const start = init.getStart(sf)
          const end = init.getEnd()
          const arrowSrc = source.slice(start, end)
          const variantsSrc = variants.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ')
          const replacement = `tagSend(send, [${variantsSrc}], ${arrowSrc})`
          edits.push([start, end, replacement])
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)

  if (edits.length === 0) continue

  // Apply edits in reverse position order so earlier indices stay
  // valid as later ranges are replaced.
  edits.sort((a, b) => b[0] - a[0])
  let output = source
  for (const [start, end, replacement] of edits) {
    output = output.slice(0, start) + replacement + output.slice(end)
  }

  // Add `tagSend` to the @llui/dom import. Components universally
  // import from `@llui/dom`; the codemod just needs to add the
  // identifier to the existing brace list, or fall back to a new
  // import line if for some reason there isn't one.
  if (!/[{,\s]tagSend[,}\s]/.test(output)) {
    const importMatch = output.match(/import\s*\{\s*([^}]*?)\s*\}\s*from\s*'@llui\/dom'/)
    if (importMatch) {
      const names = importMatch[1].trim().replace(/,$/, '')
      const newImport = `import { ${names}, tagSend } from '@llui/dom'`
      output = output.replace(importMatch[0], newImport)
    } else {
      output = `import { tagSend } from '@llui/dom'\n` + output
    }
  }

  fs.writeFileSync(file, output)
  totalSites += edits.length
  totalFiles++
  console.log(`${path.basename(file)}: ${edits.length} sites wrapped`)
}

console.log(`\nTotal: ${totalSites} sites across ${totalFiles} files`)
