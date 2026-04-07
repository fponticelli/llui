/**
 * Auto-generates API reference markdown for all @llui packages by parsing
 * TypeScript source with the TS Compiler API. Outputs to site/content/api/.
 *
 * Run as part of the build: `tsx src/generate-api.ts`
 */
import * as ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { resolve, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..', '..')
const contentDir = resolve(__dirname, '..', 'content', 'api')

// ── Helpers ──────────────────────────────────────────────────────

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

// ── Generic Package API Extractor ────────────────────────────────

interface ExportedItem {
  kind: 'function' | 'interface' | 'type' | 'class' | 'const'
  name: string
  doc?: string
  signature: string
}

function extractPackageExports(pkgDir: string, sourceFiles?: string[]): ExportedItem[] {
  const srcDir = resolve(pkgDir, 'src')
  const entryFiles = sourceFiles ?? readdirSync(srcDir).filter((f) => f.endsWith('.ts'))

  // Resolve re-exports: follow `export { X } from './module'` to find source files
  const filesToParse = new Set<string>()
  const reExportedNames = new Map<string, Set<string>>() // file → names to extract

  for (const file of entryFiles) {
    const filePath = resolve(srcDir, file)
    if (!existsSync(filePath)) continue
    const sf = readSource(filePath)

    let hasDirectExports = false
    ts.forEachChild(sf, (node) => {
      // Re-export: `export { X, Y } from './module'` or `export type { X } from './module'`
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        let target = node.moduleSpecifier.text
        if (target.startsWith('.')) {
          target = resolve(srcDir, target)
          if (!target.endsWith('.ts')) target += '.ts'
          filesToParse.add(target)
          if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            const names = reExportedNames.get(target) ?? new Set()
            for (const spec of node.exportClause.elements) {
              names.add(spec.propertyName?.text ?? spec.name.text)
            }
            reExportedNames.set(target, names)
          }
        }
      }
      // Direct export in this file
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isVariableStatement(node)) &&
        hasExportModifier(node)
      ) {
        hasDirectExports = true
      }
    })

    if (hasDirectExports) filesToParse.add(filePath)
  }

  const items: ExportedItem[] = []
  const seen = new Set<string>()
  const overloadMap = new Map<string, string[]>()

  for (const filePath of filesToParse) {
    if (!existsSync(filePath)) continue
    const sf = readSource(filePath)
    const allowedNames = reExportedNames.get(filePath) // undefined = take all exports

    const isAllowed = (name: string) => !allowedNames || allowedNames.has(name)

    // First pass: collect overload signatures
    ts.forEachChild(sf, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name && !node.body) {
        const name = node.name.text
        if (!isAllowed(name)) return
        const sigs = overloadMap.get(name) ?? []
        sigs.push(printNode(node, sf))
        overloadMap.set(name, sigs)
      }
    })

    // Second pass: collect exports
    ts.forEachChild(sf, (node) => {
      // Functions (with body)
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const name = node.name.text
        if (!isAllowed(name)) return
        if (seen.has(name)) return
        seen.add(name)

        const doc = getJSDoc(node, sf)
        const overloads = overloadMap.get(name)

        if (overloads && overloads.length > 0) {
          items.push({ kind: 'function', name, doc, signature: overloads.join('\n') })
        } else {
          const params = node.parameters.map((p) => printNode(p, sf)).join(', ')
          const ret = node.type ? `: ${printNode(node.type, sf)}` : ''
          const tp = node.typeParameters
            ? `<${node.typeParameters.map((t) => printNode(t, sf)).join(', ')}>`
            : ''
          items.push({
            kind: 'function',
            name,
            doc,
            signature: `function ${name}${tp}(${params})${ret}`,
          })
        }
      }

      // Interfaces
      if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text
        if (!isAllowed(name)) return
        if (seen.has(name)) return
        seen.add(name)
        items.push({
          kind: 'interface',
          name,
          doc: getJSDoc(node, sf),
          signature: printNode(node, sf),
        })
      }

      // Type aliases
      if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text
        if (!isAllowed(name)) return
        if (seen.has(name)) return
        seen.add(name)
        items.push({ kind: 'type', name, doc: getJSDoc(node, sf), signature: printNode(node, sf) })
      }

      // Classes
      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text
        if (!isAllowed(name)) return
        if (seen.has(name)) return
        seen.add(name)
        // Extract class with method signatures but no bodies
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
        items.push({ kind: 'class', name, doc: getJSDoc(node, sf), signature: classSig })
      }

      // Exported const/let
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          const name = decl.name.getText(sf)
          if (!isAllowed(name)) continue
          if (seen.has(name)) continue
          // Skip namespace objects like `export const tabs = { init, update, connect }`
          if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) continue
          seen.add(name)
          const type = decl.type ? `: ${printNode(decl.type, sf)}` : ''
          items.push({
            kind: 'const',
            name,
            doc: getJSDoc(node, sf),
            signature: `const ${name}${type}`,
          })
        }
      }
    })
  }

  return items
}

function formatExports(items: ExportedItem[]): string {
  if (items.length === 0) return ''

  const functions = items.filter((i) => i.kind === 'function')
  const types = items.filter((i) => i.kind === 'type')
  const interfaces = items.filter((i) => i.kind === 'interface')
  const classes = items.filter((i) => i.kind === 'class')
  const consts = items.filter((i) => i.kind === 'const')

  let md = ''

  const section = (title: string, list: ExportedItem[]) => {
    if (list.length === 0) return
    md += `## ${title}\n\n`
    for (const item of list) {
      const backtick = item.kind === 'function' ? `\`${item.name}()\`` : `\`${item.name}\``
      md += `### ${backtick}\n\n`
      if (item.doc) md += `${item.doc}\n\n`
      md += '```typescript\n' + item.signature + '\n```\n\n'
    }
  }

  section('Functions', functions)
  section('Types', types)
  section('Interfaces', interfaces)
  section('Classes', classes)
  if (consts.length > 0) section('Constants', consts)

  return md
}

// ── Component API Generator ──────────────────────────────────────

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
  const componentsDir = resolve(root, 'packages/components/src/components')
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

// ── Main ─────────────────────────────────────────────────────────

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
    output = existing.replace(re, `${startMarker}\n\n${content}\n${endMarker}`)
  } else {
    output = existing.trimEnd() + `\n\n${startMarker}\n\n${content}\n${endMarker}\n`
  }
  writeFileSync(filePath, output)
}

// Packages to generate API docs for
const PACKAGES: { name: string; sourceFiles?: string[] }[] = [
  { name: 'dom', sourceFiles: ['index.ts'] },
  { name: 'effects', sourceFiles: ['index.ts'] },
  { name: 'router', sourceFiles: ['index.ts', 'connect.ts'] },
  { name: 'transitions', sourceFiles: ['index.ts'] },
  { name: 'test', sourceFiles: ['index.ts'] },
  { name: 'vike', sourceFiles: ['on-render-html.ts', 'on-render-client.ts'] },
  { name: 'mcp', sourceFiles: ['index.ts'] },
  { name: 'lint-idiomatic', sourceFiles: ['index.ts'] },
  { name: 'vite-plugin', sourceFiles: ['index.ts'] },
]

// Components are special — use the component extractor
console.log('Generating component API reference...')
const componentsDoc = generateComponentsDoc()
injectSection(resolve(contentDir, 'components.md'), 'auto-api', componentsDoc)
console.log('  → components.md')

// All other packages use the generic extractor
for (const pkg of PACKAGES) {
  const pkgDir = resolve(root, 'packages', pkg.name)
  if (!existsSync(pkgDir)) continue

  const items = extractPackageExports(pkgDir, pkg.sourceFiles)
  if (items.length === 0) {
    console.log(`  → ${pkg.name}.md (no exports found, skipping)`)
    continue
  }

  const md = formatExports(items)
  const contentFile = resolve(contentDir, `${pkg.name}.md`)
  if (existsSync(contentFile)) {
    injectSection(contentFile, 'auto-api', md)
    console.log(`  → ${pkg.name}.md (${items.length} exports)`)
  }
}

console.log('Done.')
