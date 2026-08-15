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
 * Run as part of the build: `tsx src/generate-api.ts`. The generation itself is
 * behind an entry-point guard at the bottom, so the extraction helpers can be
 * imported and unit-tested (`test/generate-api.test.ts`) without writing files.
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

export function getJSDoc(node: ts.Node, sf: ts.SourceFile): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart())
  if (!ranges || ranges.length === 0) return undefined
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i]!
    const raw = sf.text.slice(range.pos, range.end)
    if (!raw.startsWith('/**')) continue
    const cleaned = raw
      .replace(/^\/\*\*\s*/, '')
      .replace(/\s*\*\/$/, '')
      // Strip each line's leading ` * ` gutter. The horizontal-only classes are
      // load-bearing (issue #148): with `\s` the trailing optional character
      // matched a NEWLINE, so a blank comment line (` *`) lost its own line
      // break and every JSDoc PARAGRAPH BREAK was erased — prose following a
      // bulleted list got swallowed into the last bullet.
      .replace(/^[ \t]*\*[ \t]?/gm, '')
      // A lone `@example` tag line is JSDoc syntax, not prose: rendered as-is
      // it either sits on the page as a stray `@example` (router.md) or — when
      // the preceding block is a list — gets swallowed into the last bullet
      // (`…equally valid M['type'].  @example`, dom.md). The fenced code block
      // that follows already reads as an example, so drop the tag and keep a
      // paragraph break in its place.
      .replace(/^[ \t]*@example[ \t]*$/gm, '')
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

/**
 * A component's public surface beyond the `init`/`update`/`connect` triple —
 * both the extra members of its namespace object and its module-level exports.
 *
 * The `kind` is what issue #151 was about: this list used to be bare names
 * rendered with a hardcoded `()`, so `combobox`'s string sentinel shipped as
 * `CREATE_OPTION_VALUE()`. The generic package extractor has always classified
 * (`renderExport` + `formatExports`); this mirrors it for the components page.
 */
export interface ComponentMember {
  name: string
  kind: 'function' | 'const'
}

/** Markdown reference for one member — only functions get call parens. */
export function memberRef(m: ComponentMember): string {
  return m.kind === 'function' ? `\`${m.name}()\`` : `\`${m.name}\``
}

interface ComponentInfo {
  name: string
  stateType: string
  stateFields: { name: string; type: string }[]
  msgVariants: string[]
  initParams: string
  connectParams: string
  parts: string[]
  extras: ComponentMember[]
}

/** Members the page documents through the shared pattern preamble, not the lists. */
const STANDARD_MEMBERS = ['init', 'update', 'connect']

/**
 * Reads a module reachable from `fromId` by a relative specifier, so a name a
 * component re-exports from a sibling (`alert-dialog`'s `isMounted`, which is
 * `dialog`'s function) can still be classified. Returning `undefined` — the
 * default — simply leaves such a name unclassified.
 */
export type ModuleReader = (fromId: string, specifier: string) => ModuleSource | undefined
export interface ModuleSource {
  id: string
  text: string
}

/** How a module binds one name locally: to a kind, or to another name. */
type LocalBinding =
  | { kind: 'function' | 'const' }
  | { alias: string }
  | { from: string; imported: string }

interface ModuleFacts {
  bindings: Map<string, LocalBinding>
  /** Names this module exports with a LOCAL declaration, in source order. */
  exportedLocals: string[]
}

/**
 * Classifies exported names across the component modules, following local
 * aliases (`export const isMounted = isPresent`) and relative re-exports one
 * module at a time.
 *
 * Only a syntactically obvious function counts as a function; a name this pass
 * cannot resolve at all stays `undefined` and the caller decides. The asymmetry
 * is deliberate — a missing `()` merely under-advertises a name, while a
 * spurious one asserts something false about it, which is what shipped as
 * `CREATE_OPTION_VALUE()` (#151).
 */
class KindResolver {
  private readonly facts = new Map<string, ModuleFacts>()

  constructor(private readonly read: ModuleReader) {}

  factsFor(id: string, text?: string): ModuleFacts {
    const cached = this.facts.get(id)
    if (cached) return cached
    const facts = collectModuleFacts(
      ts.createSourceFile(id, text ?? '', ts.ScriptTarget.Latest, true),
    )
    this.facts.set(id, facts)
    return facts
  }

  kindOf(id: string, name: string, seen = new Set<string>()): ComponentMember['kind'] | undefined {
    const key = `${id}#${name}`
    if (seen.has(key)) return undefined
    seen.add(key)
    const binding = this.facts.get(id)?.bindings.get(name)
    if (!binding) return undefined
    if ('kind' in binding) return binding.kind
    if ('alias' in binding) return this.kindOf(id, binding.alias, seen)
    const source = this.read(id, binding.from)
    if (!source) return undefined
    this.factsFor(source.id, source.text)
    return this.kindOf(source.id, binding.imported, seen)
  }
}

function collectModuleFacts(sf: ts.SourceFile): ModuleFacts {
  const bindings = new Map<string, LocalBinding>()
  const exportedLocals: string[] = []

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      bindings.set(stmt.name.text, { kind: 'function' })
      if (hasExportModifier(stmt)) exportedLocals.push(stmt.name.text)
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const init = decl.initializer
        bindings.set(
          decl.name.text,
          init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
            ? { kind: 'function' }
            : init && ts.isIdentifier(init)
              ? { alias: init.text }
              : { kind: 'const' },
        )
        if (hasExportModifier(stmt)) exportedLocals.push(decl.name.text)
      }
    } else if (ts.isImportDeclaration(stmt) && stmt.importClause?.namedBindings) {
      const from = (stmt.moduleSpecifier as ts.StringLiteral).text
      const named = stmt.importClause.namedBindings
      if (ts.isNamedImports(named) && !stmt.importClause.isTypeOnly) {
        for (const spec of named.elements) {
          if (spec.isTypeOnly) continue
          bindings.set(spec.name.text, { from, imported: (spec.propertyName ?? spec.name).text })
        }
      }
    } else if (ts.isExportDeclaration(stmt) && stmt.exportClause && !stmt.isTypeOnly) {
      // `export { a as b } from './x'` binds `b`; a local `export { a }` is
      // already bound by its declaration, it only becomes an EXPORT here.
      if (!ts.isNamedExports(stmt.exportClause)) continue
      const from = stmt.moduleSpecifier
        ? (stmt.moduleSpecifier as ts.StringLiteral).text
        : undefined
      for (const spec of stmt.exportClause.elements) {
        if (spec.isTypeOnly) continue
        const local = (spec.propertyName ?? spec.name).text
        if (from) bindings.set(spec.name.text, { from, imported: local })
        else if (spec.propertyName) bindings.set(spec.name.text, { alias: local })
      }
    }
  }

  return { bindings, exportedLocals }
}

/**
 * The component's namespace object, identified by SHAPE rather than by name.
 * Name-matching against the file's basename silently missed every multi-word
 * component (`alert-dialog` exports `alertDialog`) and `switch` (which exports
 * `switchMachine`), so their namespace members were never collected — and, once
 * module-level exports were emitted, the object itself was listed as a constant.
 */
/**
 * Classify one property of a component's namespace object. Shorthand and plain
 * identifier values resolve through `kindOf`; an inline function is a function;
 * anything else is a value.
 */
function memberKind(
  prop: ts.ObjectLiteralElementLike,
  kindOf: (name: string) => ComponentMember['kind'] | undefined,
): ComponentMember['kind'] | undefined {
  if (ts.isMethodDeclaration(prop)) return 'function'
  if (ts.isShorthandPropertyAssignment(prop)) return kindOf(prop.name.text)
  if (ts.isPropertyAssignment(prop)) {
    const value = prop.initializer
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return 'function'
    if (ts.isIdentifier(value)) return kindOf(value.text)
    return 'const'
  }
  return undefined
}

function isNamespaceObject(init: ts.ObjectLiteralExpression, sf: ts.SourceFile): boolean {
  const props = new Set(init.properties.map((p) => p.name?.getText(sf) ?? ''))
  return props.has('connect') || (props.has('init') && props.has('update'))
}

const NO_MODULES: ModuleReader = () => undefined

function extractComponent(filePath: string): ComponentInfo | null {
  const name = basename(filePath, '.ts')
  if (name === 'index') return null
  return extractComponentFromText(name, readFileSync(filePath, 'utf-8'), siblingReader, filePath)
}

/** Resolve a relative `./x.js` specifier back to its `src/x.ts` sibling. */
const siblingReader: ModuleReader = (fromId, specifier) => {
  if (!specifier.startsWith('.')) return undefined
  const id = resolve(dirname(fromId), specifier.replace(/\.js$/, '.ts'))
  if (!existsSync(id)) return undefined
  return { id, text: readFileSync(id, 'utf-8') }
}

export function extractComponentFromText(
  name: string,
  text: string,
  read: ModuleReader = NO_MODULES,
  id = `${name}.ts`,
): ComponentInfo | null {
  const sf = ts.createSourceFile(id, text, ts.ScriptTarget.Latest, true)

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

  // Pre-pass: what every top-level binding IS, so a namespace member written in
  // shorthand (`export const table = { …, HEADER_ROW_INDEX }`) can be classified
  // and module-level exports can be emitted alongside it (#151).
  const resolver = new KindResolver(read)
  const facts = resolver.factsFor(id, text)
  const kindOf = (memberName: string) => resolver.kindOf(id, memberName)

  const excluded = new Set(STANDARD_MEMBERS)
  const addExtra = (memberName: string, kind: ComponentMember['kind'] | undefined) => {
    if (excluded.has(memberName)) return
    if (info.extras.some((e) => e.name === memberName)) return
    // An unresolved name is one re-exported through a module this pass could not
    // read. Every such name in this package is a helper function, and the shape
    // that made #151 visible (a module's own sentinel constant) always resolves
    // locally — so `function` is the right fallback here.
    info.extras.push({ name: memberName, kind: kind ?? 'function' })
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
          isNamespaceObject(decl.initializer, sf)
        ) {
          excluded.add(decl.name.getText(sf))
          for (const prop of decl.initializer.properties) {
            const pName = prop.name?.getText(sf) ?? ''
            if (!pName) continue
            addExtra(pName, memberKind(prop, kindOf))
          }
        }
      }
    }
  })

  // Module-level exports the namespace object does not carry. Before #151 these
  // were dropped entirely, which is why `HEADER_ROW_INDEX` — moved out of the
  // `table` object in PR #134 precisely to dodge the `()` bug — appeared nowhere
  // in the docs at all.
  for (const exported of facts.exportedLocals) {
    addExtra(exported, kindOf(exported))
  }

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
    const utilities = c.extras.filter((e) => e.kind === 'function')
    const constants = c.extras.filter((e) => e.kind === 'const')
    if (utilities.length > 0) md += `**Utilities:** ${utilities.map(memberRef).join(', ')}\n\n`
    if (constants.length > 0) md += `**Constants:** ${constants.map(memberRef).join(', ')}\n\n`
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

/**
 * Regenerate every `content/api/*.md`. Guarded behind the entry-point check
 * below so the extraction helpers above can be imported (and unit-tested)
 * without the module writing to disk as a side effect of the import.
 */
function main(): void {
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
      throw new Error(
        `@llui/${slug} is in the registry but packages/${slug} does not exist on disk.`,
      )
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
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
