// Tier-coverage scan: classify every authoring `each(` site in a
// consumer codebase by the tier the compiler lowers it to, and surface the
// phase-3 candidates — rows that DELEGATE to an imported (cross-file/cross-
// package) helper, which no current tier can compile to a RowFactory.
//
// Usage: node packages/compiler/scripts/tier-coverage.mjs <src-root> [--json]
// Prereq: the compiler must be built (pnpm --filter @llui/compiler build).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import ts from 'typescript'
import { transformSignalComponentSource } from '../dist/signals/transform-component.js'

const root = process.argv[2]
if (!root) {
  console.error('usage: node tier-coverage.mjs <src-root> [--json]')
  process.exit(1)
}
const asJson = process.argv.includes('--json')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage', '.next'])
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(p)
    } else if (
      (extname(name) === '.ts' || extname(name) === '.tsx') &&
      !name.endsWith('.d.ts') &&
      !name.includes('.test.') &&
      !name.includes('.spec.')
    ) {
      yield p
    }
  }
}

// Mirror the vite-plugin routing predicate: a file is compiler-eligible when it
// imports from @llui/dom AND contains component( or each(.
function routed(src) {
  return (
    /from\s+['"]@llui\/dom['"]/.test(src) &&
    (/\bcomponent\s*\(/.test(src) || /\beach\s*\(/.test(src))
  )
}

/** All authoring `each(items, key, render)` call sites in a file (AST, so no
 * false hits on eachDirect/forEach/comments), with delegation analysis on the
 * render arg: which identifiers called in the returned array are imported, and
 * from where. */
function analyzeSites(fileName, src) {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const imports = new Map() // local name -> module specifier
  const localTopDecls = new Set() // top-level function/const names (same-file helpers)
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause) {
      const mod = st.moduleSpecifier.getText(sf).slice(1, -1)
      const { name, namedBindings } = st.importClause
      if (name) imports.set(name.text, mod)
      if (namedBindings && ts.isNamedImports(namedBindings))
        for (const el of namedBindings.elements) imports.set(el.name.text, mod)
    }
    if (ts.isFunctionDeclaration(st) && st.name) localTopDecls.add(st.name.text)
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) localTopDecls.add(d.name.text)
  }

  const sites = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'each' &&
      node.arguments.length === 2 &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      // authoring signature: each(items, { key, render })
      const renderProp = node.arguments[1].properties.find(
        (p) =>
          (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) &&
          p.name &&
          ts.isIdentifier(p.name) &&
          p.name.text === 'render',
      )
      const render = renderProp
        ? ts.isPropertyAssignment(renderProp)
          ? renderProp.initializer
          : renderProp
        : undefined
      if (!render) {
        ts.forEachChild(node, visit)
        return
      }
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      const site = {
        pos: node.getStart(sf),
        line: line + 1,
        delegates: [], // { helper, from: 'same-file' | <module> | 'unknown' }
        renderHead: render.getText(sf).replace(/\s+/g, ' ').slice(0, 90),
      }
      // collect call-targets inside the render body's returned expression(s)
      if (
        ts.isArrowFunction(render) ||
        ts.isFunctionExpression(render) ||
        ts.isMethodDeclaration(render)
      ) {
        const collectCalls = (n) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
            const name = n.expression.text
            if (imports.has(name)) site.delegates.push({ helper: name, from: imports.get(name) })
            else if (localTopDecls.has(name))
              site.delegates.push({ helper: name, from: 'same-file' })
          }
          ts.forEachChild(n, collectCalls)
        }
        collectCalls(render.body)
      }
      sites.push(site)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return sites
}

const ELEMENT_HELPERS = new Set([
  // not delegation: dom element/structural helpers called inside rows
  'div',
  'span',
  'button',
  'a',
  'ul',
  'ol',
  'li',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'input',
  'label',
  'select',
  'option',
  'textarea',
  'form',
  'img',
  'svg',
  'path',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'text',
  'show',
  'branch',
  'each',
  'eachDirect',
  'eachArm',
  'unsafeHtml',
  'lazy',
  'virtualEach',
  'foreign',
  'portal',
  'provide',
  'onMount',
  'fragment',
  'code',
  'pre',
  'strong',
  'em',
  'small',
  'dl',
  'dt',
  'dd',
  'hr',
  'br',
  'canvas',
  'video',
  'audio',
  'i',
  'b',
  'figure',
  'figcaption',
  'blockquote',
  'summary',
  'details',
  'dialog',
  'fieldset',
  'legend',
])

const files = []
let totals = { sites: 0, direct: 0, arm: 0, signalEach: 0, verbatim: 0 }
const verbatimReasons = new Map()
const delegationSites = []

for (const f of walk(root)) {
  const src = readFileSync(f, 'utf8')
  if (!routed(src)) continue
  const rel = relative(root, f)
  const bails = []
  const diags = []
  let out
  try {
    out = transformSignalComponentSource(src, {
      fileName: rel,
      onLowerBail: (b) => bails.push(b),
      onPerfDiagnostic: (d) => diags.push(d),
    })
  } catch (e) {
    files.push({ file: rel, error: String(e && e.message) })
    continue
  }
  const sites = analyzeSites(rel, src)
  if (sites.length === 0 && diags.length === 0) continue

  // tier counts from emitted output (helpers only the compiler emits)
  const count = (re) => (out.match(re) ?? []).length
  const direct = count(/\bsignalEachDirect\s*\(/g) + count(/\beachDirect\s*\(/g)
  const arm = count(/\beachArm\s*\(/g)
  const sEach = count(/\bsignalEach\s*\(/g)
  const verbatim = diags.length

  totals.sites += sites.length
  totals.direct += direct
  totals.arm += arm
  totals.signalEach += sEach
  totals.verbatim += verbatim

  for (const d of diags) {
    const m = d.message.match(/`?([a-z0-9-]+)`? — /) // leading reason token in detail
    const reasons = [...d.message.matchAll(/\b([a-z][a-z0-9]*(?:-[a-z0-9:]+)+)\b/g)].map(
      (x) => x[1],
    )
    for (const r of new Set(reasons)) verbatimReasons.set(r, (verbatimReasons.get(r) ?? 0) + 1)
    void m
  }

  for (const s of sites) {
    const real = s.delegates.filter((d) => !ELEMENT_HELPERS.has(d.helper) && d.from !== '@llui/dom')
    if (real.length > 0) {
      // which tier did this site land on? correlate with verbatim diagnostics by position
      const isVerbatim = diags.some(
        (d) => Math.abs((d.location?.range?.start?.line ?? -99) + 1 - s.line) <= 1,
      )
      delegationSites.push({
        file: rel,
        line: s.line,
        helpers: real,
        verbatim: isVerbatim,
        renderHead: s.renderHead,
      })
    }
  }

  files.push({
    file: rel,
    sites: sites.length,
    direct,
    arm,
    signalEach: sEach,
    verbatim,
    bails: bails.map((b) => `${b.kind}:${b.reason}`),
  })
}

if (asJson) {
  console.log(
    JSON.stringify(
      { totals, verbatimReasons: [...verbatimReasons], delegationSites, files },
      null,
      2,
    ),
  )
} else {
  console.log(`\n== tier coverage: ${root} ==`)
  console.log(
    `each sites: ${totals.sites}  | direct: ${totals.direct}  arm: ${totals.arm}  signalEach: ${totals.signalEach}  verbatim: ${totals.verbatim}`,
  )
  console.log('\n-- verbatim reason tokens --')
  for (const [r, n] of [...verbatimReasons].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)}  ${r}`)
  console.log(
    '\n-- delegation sites (phase-3 candidates: row calls an imported/same-file helper) --',
  )
  for (const d of delegationSites) {
    const hs = d.helpers.map((h) => `${h.helper}←${h.from}`).join(', ')
    console.log(`  ${d.file}:${d.line}  ${d.verbatim ? '[VERBATIM]' : '[lowered/arm]'}  ${hs}`)
    console.log(`      render: ${d.renderHead}`)
  }
  console.log('\n-- per file --')
  for (const f of files) {
    if (f.error) {
      console.log(`  ${f.file}  ERROR: ${f.error}`)
      continue
    }
    console.log(
      `  ${f.file}  sites:${f.sites} direct:${f.direct} arm:${f.arm} sEach:${f.signalEach} verbatim:${f.verbatim}${f.bails.length ? '  bails: ' + f.bails.join(' ') : ''}`,
    )
  }
}
