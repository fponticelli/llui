/**
 * Auto-generates API reference markdown for all @llui packages.
 *
 * The generic package surface is extracted with a real `ts.Program` +
 * `TypeChecker`: for each package we resolve its public entrypoints from
 * `package.json#exports`, then enumerate `checker.getExportsOfModule(...)`. That
 * follows `export *`, re-export chains, and aliases through the type system, so
 * there is no hand-maintained per-file allowlist to drift — the single package
 * registry is `pages/api/@pkg/packages.ts` (also driving routes, nav, llms.txt).
 *
 * Every prior soft-skip is now a hard failure: a package that is publishable but
 * missing from the registry, a documented package with zero extractable exports,
 * and a package whose seed `content/api/<slug>.md` is absent all throw. Output is
 * deterministic — exports are sorted by name within each kind section.
 *
 * `components` is special: its per-component state-machine shape is extracted
 * directly (see `generateComponentsDoc`).
 *
 * Run as part of the build: `tsx src/generate-api.ts`
 */
import * as ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { resolve, basename, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PACKAGE_SLUGS } from '../pages/api/@pkg/packages.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..', '..')
const contentDir = resolve(__dirname, '..', 'content', 'api')
const packagesDir = resolve(root, 'packages')

// ── Shared helpers ───────────────────────────────────────────────

function readSource(path: string): ts.SourceFile {
  const text = readFileSync(path, 'utf-8')
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
}

function getJSDoc(node: ts.Node, sf: ts.SourceFile): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart())
  if (!ranges || ranges.length === 0) return undefined
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i]!
    const raw = sf.text.slice(range.pos, range.end)
    if (!raw.startsWith('/**')) continue
    const cleaned = raw
      .replace(/^\/\*\*\s*/, '')
      .replace(/\s*\*\/$/, '')
      .replace(/^\s*\*\s?/gm, '')
      .trim()
    if (/^[─—]/.test(cleaned)) return undefined
    return cleaned
  }
  return undefined
}

function printNode(node: ts.Node, sf: ts.SourceFile): string {
  return sf.text.slice(node.getStart(sf), node.getEnd()).trim()
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    : false
}

// ── Generic Package API Extractor (ts.Program + TypeChecker) ──────

interface ExportedItem {
  kind: 'function' | 'interface' | 'type' | 'class' | 'const'
  name: string
  doc?: string
  signature: string
}

/**
 * Resolve a package's public entrypoint source files from `package.json#exports`.
 * Prefer the curated `.` barrel; if a package has no `.` entry (e.g. `@llui/agent`
 * splits its surface across `./server`, `./client`, …), union every non-CSS
 * subpath entry. Each `dist/*.d.ts` target maps back to its `src/*.ts` source.
 */
function entrySourceFiles(pkgDir: string): string[] {
  const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8')) as {
    exports?: Record<string, unknown>
  }
  const exp = pkg.exports ?? {}
  const keys = exp['.'] !== undefined ? ['.'] : Object.keys(exp)
  const out: string[] = []
  for (const key of keys) {
    const val = exp[key]
    const target =
      typeof val === 'string'
        ? val
        : val && typeof val === 'object'
          ? ((val as Record<string, unknown>).types ?? (val as Record<string, unknown>).import)
          : undefined
    if (typeof target !== 'string' || target.endsWith('.css')) continue
    const rel = target
      .replace(/^\.\//, '')
      .replace(/^dist\//, 'src/')
      .replace(/\.d\.ts$/, '.ts')
      .replace(/\.js$/, '.ts')
    const abs = resolve(pkgDir, rel)
    if (existsSync(abs)) out.push(abs)
  }
  return out
}

function reconstructFunction(name: string, funcs: ts.FunctionDeclaration[]): string {
  // Overload set: print each signature-only declaration verbatim (keeps the
  // source `export function …` form). Single impl: reconstruct a body-less sig.
  const overloads = funcs.filter((d) => !d.body)
  if (overloads.length > 0) {
    return overloads.map((d) => printNode(d, d.getSourceFile())).join('\n')
  }
  const d = funcs[0]!
  const sf = d.getSourceFile()
  const params = d.parameters.map((p) => printNode(p, sf)).join(', ')
  const ret = d.type ? `: ${printNode(d.type, sf)}` : ''
  const tp = d.typeParameters ? `<${d.typeParameters.map((t) => printNode(t, sf)).join(', ')}>` : ''
  return `function ${name}${tp}(${params})${ret}`
}

function reconstructClass(name: string, node: ts.ClassDeclaration): string {
  const sf = node.getSourceFile()
  let classSig = `class ${name}`
  if (node.heritageClauses) {
    classSig += ' ' + node.heritageClauses.map((h) => printNode(h, sf)).join(' ')
  }
  classSig += ' {\n'
  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      const params = member.parameters.map((p) => printNode(p, sf)).join(', ')
      classSig += `  constructor(${params})\n`
    } else if (ts.isMethodDeclaration(member) && member.name) {
      const mName = member.name.getText(sf)
      const params = member.parameters.map((p) => printNode(p, sf)).join(', ')
      const ret = member.type ? `: ${printNode(member.type, sf)}` : ''
      const tp = member.typeParameters
        ? `<${member.typeParameters.map((t) => printNode(t, sf)).join(', ')}>`
        : ''
      classSig += `  ${mName}${tp}(${params})${ret}\n`
    } else if (ts.isPropertyDeclaration(member) && member.name) {
      const mName = member.name.getText(sf)
      const mType = member.type ? `: ${printNode(member.type, sf)}` : ''
      classSig += `  ${mName}${mType}\n`
    }
  }
  classSig += '}'
  return classSig
}

function renderExport(
  exportName: string,
  sym: ts.Symbol,
  checker: ts.TypeChecker,
): ExportedItem | null {
  let s = sym
  if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s)
  const decls = s.getDeclarations() ?? []
  if (decls.length === 0) return null

  const funcs = decls.filter(ts.isFunctionDeclaration)
  if (funcs.length > 0) {
    return {
      kind: 'function',
      name: exportName,
      doc: getJSDoc(funcs[0]!, funcs[0]!.getSourceFile()),
      signature: reconstructFunction(exportName, funcs),
    }
  }

  const iface = decls.find(ts.isInterfaceDeclaration)
  if (iface) {
    return {
      kind: 'interface',
      name: exportName,
      doc: getJSDoc(iface, iface.getSourceFile()),
      signature: printNode(iface, iface.getSourceFile()),
    }
  }

  const alias = decls.find(ts.isTypeAliasDeclaration)
  if (alias) {
    return {
      kind: 'type',
      name: exportName,
      doc: getJSDoc(alias, alias.getSourceFile()),
      signature: printNode(alias, alias.getSourceFile()),
    }
  }

  const enumDecl = decls.find(ts.isEnumDeclaration)
  if (enumDecl) {
    return {
      kind: 'type',
      name: exportName,
      doc: getJSDoc(enumDecl, enumDecl.getSourceFile()),
      signature: printNode(enumDecl, enumDecl.getSourceFile()),
    }
  }

  const cls = decls.find(ts.isClassDeclaration)
  if (cls) {
    return {
      kind: 'class',
      name: exportName,
      doc: getJSDoc(cls, cls.getSourceFile()),
      signature: reconstructClass(exportName, cls),
    }
  }

  const varDecl = decls.find(ts.isVariableDeclaration)
  if (varDecl) {
    // Skip namespace objects like `export const tabs = { init, update, connect }`.
    if (varDecl.initializer && ts.isObjectLiteralExpression(varDecl.initializer)) return null
    const sf = varDecl.getSourceFile()
    const stmt = varDecl.parent.parent // VariableDeclarationList → VariableStatement
    const type = varDecl.type ? `: ${printNode(varDecl.type, sf)}` : ''
    return {
      kind: 'const',
      name: exportName,
      doc: getJSDoc(stmt, sf),
      signature: `const ${exportName}${type}`,
    }
  }

  return null
}

function extractPackageExports(
  slug: string,
  entryFiles: string[],
  program: ts.Program,
  checker: ts.TypeChecker,
): ExportedItem[] {
  const items: ExportedItem[] = []
  const seen = new Set<string>()

  for (const file of entryFiles) {
    const sf = program.getSourceFile(file)
    if (!sf) throw new Error(`@llui/${slug}: program is missing source file ${file}`)
    const moduleSym = checker.getSymbolAtLocation(sf)
    if (!moduleSym) continue // no module-level symbol (e.g. a script with no exports)
    for (const exp of checker.getExportsOfModule(moduleSym)) {
      const name = exp.getName()
      if (name === 'default' || seen.has(name)) continue
      const item = renderExport(name, exp, checker)
      if (!item) continue
      seen.add(name)
      items.push(item)
    }
  }

  // Deterministic order: alphabetical by name (formatExports groups by kind).
  items.sort((a, b) => a.name.localeCompare(b.name))
  return items
}

function formatExports(items: ExportedItem[]): string {
  if (items.length === 0) return ''

  let md = ''
  const section = (title: string, kind: ExportedItem['kind']) => {
    const list = items.filter((i) => i.kind === kind)
    if (list.length === 0) return
    md += `## ${title}\n\n`
    for (const item of list) {
      const backtick = item.kind === 'function' ? `\`${item.name}()\`` : `\`${item.name}\``
      md += `### ${backtick}\n\n`
      if (item.doc) md += `${item.doc}\n\n`
      md += '```typescript\n' + item.signature + '\n```\n\n'
    }
  }

  section('Functions', 'function')
  section('Types', 'type')
  section('Interfaces', 'interface')
  section('Classes', 'class')
  section('Constants', 'const')

  return md
}

// ── Component API Generator (special-cased) ──────────────────────

interface ComponentInfo {
  name: string
  stateType: string
  stateFields: { name: string; type: string }[]
  msgVariants: string[]
  initParams: string
  connectParams: string
  parts: string[]
  extras: string[]
}

function extractComponent(filePath: string): ComponentInfo | null {
  const sf = readSource(filePath)
  const name = basename(filePath, '.ts')
  if (name === 'index') return null

  const info: ComponentInfo = {
    name,
    stateType: '',
    stateFields: [],
    msgVariants: [],
    initParams: '',
    connectParams: '',
    parts: [],
    extras: [],
  }

  ts.forEachChild(sf, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('State')) {
      info.stateType = node.name.text
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) {
          info.stateFields.push({
            name: member.name.getText(sf),
            type: member.type ? printNode(member.type, sf) : 'unknown',
          })
        }
      }
    }

    if (ts.isTypeAliasDeclaration(node) && node.name.text.endsWith('State') && !info.stateType) {
      info.stateType = node.name.text
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const spec of node.exportClause.elements) {
        if (spec.name.text.endsWith('State') && !info.stateType) info.stateType = spec.name.text
      }
    }

    if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text.endsWith('Msg') &&
      ts.isUnionTypeNode(node.type)
    ) {
      for (const member of node.type.types) {
        if (ts.isTypeLiteralNode(member)) {
          const typeProp = member.members.find(
            (m) => ts.isPropertySignature(m) && m.name?.getText(sf) === 'type',
          )
          if (typeProp && ts.isPropertySignature(typeProp) && typeProp.type) {
            info.msgVariants.push(printNode(typeProp.type, sf).replace(/['"]/g, ''))
          }
        }
      }
    }

    if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Init')) {
      const fields: string[] = []
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) {
          const opt = member.questionToken ? '?' : ''
          fields.push(
            `${member.name.getText(sf)}${opt}: ${member.type ? printNode(member.type, sf) : 'unknown'}`,
          )
        }
      }
      info.initParams = fields.join(', ')
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'connect' &&
      node.parameters.length >= 3
    ) {
      const optsParam = node.parameters[2]!
      if (optsParam.type) {
        if (ts.isTypeLiteralNode(optsParam.type)) {
          const fields: string[] = []
          for (const member of optsParam.type.members) {
            if (ts.isPropertySignature(member) && member.name) {
              const opt = member.questionToken ? '?' : ''
              fields.push(
                `${member.name.getText(sf)}${opt}: ${member.type ? printNode(member.type, sf) : 'unknown'}`,
              )
            }
          }
          info.connectParams = fields.join(', ')
        } else {
          info.connectParams = printNode(optsParam.type, sf)
        }
      }
      if (node.body) {
        const ret = findReturn(node.body)
        if (ret && ts.isObjectLiteralExpression(ret)) {
          for (const prop of ret.properties) {
            const pName = prop.name?.getText(sf)
            if (pName) info.parts.push(pName)
          }
        }
      }
    }

    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer) &&
          decl.name.getText(sf) === name
        ) {
          for (const prop of decl.initializer.properties) {
            const pName = prop.name?.getText(sf) ?? ''
            if (!['init', 'update', 'connect'].includes(pName) && pName) {
              if (!info.extras.includes(pName)) info.extras.push(pName)
            }
          }
        }
      }
    }
  })

  if (info.parts.length === 0) {
    ts.forEachChild(sf, (node) => {
      if (
        ts.isInterfaceDeclaration(node) &&
        node.name.text.endsWith('Parts') &&
        !node.name.text.includes('Item')
      ) {
        for (const member of node.members) {
          if ((ts.isPropertySignature(member) || ts.isMethodSignature(member)) && member.name) {
            info.parts.push(member.name.getText(sf))
          }
        }
      }
    })
  }

  return info.stateType ? info : null
}

function findReturn(block: ts.Block): ts.Expression | null {
  for (const stmt of block.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) return stmt.expression
  }
  return null
}

function toTitle(kebab: string): string {
  return kebab
    .split('-')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

function generateComponentsDoc(): string {
  const componentsDir = resolve(packagesDir, 'components/src/components')
  const files = readdirSync(componentsDir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .sort()

  const components: ComponentInfo[] = []
  for (const file of files) {
    const info = extractComponent(resolve(componentsDir, file))
    if (info) components.push(info)
  }

  let md = `## Component Reference\n\n`
  md += `All ${components.length} components follow the same pattern:\n\n`
  md += '```typescript\n'
  md += `import { componentName } from '@llui/components/component-name'\n\n`
  md += `// State machine\n`
  md += `const state = componentName.init({ /* options */ })\n`
  md += `const [newState, effects] = componentName.update(state, msg)\n\n`
  md += `// Connect to DOM\n`
  md += `const parts = componentName.connect<State>(s => s.field, send, { id: '...' })\n`
  md += `// Use parts: div({ ...parts.root }, [button({ ...parts.trigger }, [...])])\n`
  md += '```\n\n---\n\n'

  for (const c of components) {
    md += `### ${toTitle(c.name)}\n\n`

    if (c.stateFields.length > 0) {
      md += `**State** (\`${c.stateType}\`):\n\n| Field | Type |\n|---|---|\n`
      for (const f of c.stateFields)
        md += `| \`${f.name}\` | \`${f.type.replace(/\|/g, '\\|')}\` |\n`
      md += '\n'
    } else if (c.stateType) {
      md += `**State:** \`${c.stateType}\` (see parent component)\n\n`
    }

    if (c.msgVariants.length > 0)
      md += `**Messages:** ${c.msgVariants.map((v) => `\`${v}\``).join(', ')}\n\n`
    if (c.initParams) md += `**Init options:** \`${c.initParams}\`\n\n`
    if (c.connectParams) md += `**Connect options:** \`${c.connectParams}\`\n\n`
    if (c.parts.length > 0) md += `**Parts:** ${c.parts.map((p) => `\`${p}\``).join(', ')}\n\n`
    if (c.extras.length > 0)
      md += `**Utilities:** ${c.extras.map((e) => `\`${e}()\``).join(', ')}\n\n`
    md += '---\n\n'
  }
  return md
}

// ── Injection ────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function injectSection(filePath: string, marker: string, content: string): void {
  const existing = readFileSync(filePath, 'utf-8')
  const startMarker = `<!-- ${marker}:start -->`
  const endMarker = `<!-- ${marker}:end -->`

  let output: string
  if (existing.includes(startMarker)) {
    const re = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`, 'g')
    // Use a replacer FUNCTION, not a string: a string replacement interprets
    // `$&`/`` $` ``/`$'`/`$n` patterns, and generated API docs legitimately contain
    // `` `$` `` (e.g. JSDoc "calls `$`-prefixed APIs"), which would otherwise splice
    // the pre-match text into the output and corrupt the page.
    output = existing.replace(re, () => `${startMarker}\n\n${content}\n${endMarker}`)
  } else {
    output = existing.trimEnd() + `\n\n${startMarker}\n\n${content}\n${endMarker}\n`
  }
  writeFileSync(filePath, output)
}

// ── Main ─────────────────────────────────────────────────────────

// Every generic package (everything but `components`) is driven straight from
// the single registry in `pages/api/@pkg/packages.ts`.
const genericSlugs = PACKAGE_SLUGS.filter((s) => s !== 'components')

// Guard: any publishable package on disk that is absent from the registry gets
// LOUDLY surfaced (previously such a package silently produced no page). The
// registry lives in `pages/api/@pkg/packages.ts`; add the package there (route +
// nav + llms.txt + this page all key off it) or mark it `private`.
{
  const documented = new Set(PACKAGE_SLUGS)
  const undocumented: string[] = []
  for (const dir of readdirSync(packagesDir)) {
    const pjPath = resolve(packagesDir, dir, 'package.json')
    if (!existsSync(pjPath)) continue
    const pkg = JSON.parse(readFileSync(pjPath, 'utf-8')) as {
      private?: boolean
      exports?: unknown
    }
    const publishable = !pkg.private && pkg.exports !== undefined
    if (publishable && !documented.has(dir)) undocumented.push(dir)
  }
  if (undocumented.length > 0) {
    console.error(
      `\n  ⚠ PUBLISHABLE PACKAGES ABSENT FROM THE API REGISTRY (pages/api/@pkg/packages.ts):\n` +
        undocumented.map((d) => `      - @llui/${d}`).join('\n') +
        `\n    They get NO API page, route, nav entry, or llms.txt line. Register or mark private.\n`,
    )
  }
}

// Resolve entrypoints for every generic package up front, then build ONE program
// spanning them all (transitive re-exports resolve through the type system).
const pkgEntries = new Map<string, string[]>()
for (const slug of genericSlugs) {
  const pkgDir = resolve(packagesDir, slug)
  if (!existsSync(pkgDir)) {
    throw new Error(`@llui/${slug} is in the registry but packages/${slug} does not exist on disk.`)
  }
  const files = entrySourceFiles(pkgDir)
  if (files.length === 0) {
    throw new Error(
      `@llui/${slug}: no resolvable src entrypoints from package.json#exports (mapped dist→src).`,
    )
  }
  pkgEntries.set(slug, files)
}

const program = ts.createProgram([...pkgEntries.values()].flat(), {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  skipLibCheck: true,
  noEmit: true,
  strict: false,
})
const checker = program.getTypeChecker()

// Components are special — use the component extractor.
console.log('Generating component API reference...')
const componentsSeed = resolve(contentDir, 'components.md')
if (!existsSync(componentsSeed)) throw new Error('missing seed content/api/components.md')
injectSection(componentsSeed, 'auto-api', generateComponentsDoc())
console.log('  → components.md')

// All other packages use the generic checker-based extractor.
for (const slug of genericSlugs) {
  const items = extractPackageExports(slug, pkgEntries.get(slug)!, program, checker)
  if (items.length === 0) {
    throw new Error(`@llui/${slug}: zero exports extracted — refusing to emit an empty API page.`)
  }
  const contentFile = resolve(contentDir, `${slug}.md`)
  if (!existsSync(contentFile)) {
    throw new Error(`@llui/${slug}: missing seed content/api/${slug}.md`)
  }
  injectSection(contentFile, 'auto-api', formatExports(items))
  console.log(`  → ${slug}.md (${items.length} exports)`)
}

console.log('Done.')
