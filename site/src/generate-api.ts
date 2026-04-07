/**
 * Auto-generates API reference markdown for @llui packages by parsing
 * TypeScript source with the TS Compiler API. Outputs to site/content/api/.
 *
 * Run as part of the build: `tsx src/generate-api.ts`
 */
import * as ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync } from 'fs'
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

function getLeadingComment(node: ts.Node, sf: ts.SourceFile): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart())
  if (!ranges || ranges.length === 0) return undefined
  const last = ranges[ranges.length - 1]!
  const raw = sf.text.slice(last.pos, last.end)
  // Strip /** ... */ or // ...
  const cleaned = raw
    .replace(/^\/\*\*?\s*/, '')
    .replace(/\s*\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '')
    .trim()
  // Skip section separators like "// ── Foo ──"
  if (/^──/.test(cleaned) || /^─/.test(cleaned)) return undefined
  return cleaned
}

function printNode(node: ts.Node, sf: ts.SourceFile): string {
  return sf.text.slice(node.getStart(sf), node.getEnd()).trim()
}

// ── Component API Generator ──────────────────────────────────────

interface ComponentInfo {
  name: string
  stateType: string
  stateFields: { name: string; type: string; comment?: string }[]
  msgType: string
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
    msgType: '',
    msgVariants: [],
    initParams: '',
    connectParams: '',
    parts: [],
    extras: [],
  }

  ts.forEachChild(sf, (node) => {
    // Find State interface
    if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('State')) {
      info.stateType = node.name.text
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) {
          const mName = member.name.getText(sf)
          const mType = member.type ? printNode(member.type, sf) : 'unknown'
          const comment = getLeadingComment(member, sf)
          info.stateFields.push({ name: mName, type: mType, comment })
        }
      }
    }

    // Handle re-exported State type aliases (e.g., alert-dialog re-exports DialogState)
    if (ts.isTypeAliasDeclaration(node) && node.name.text.endsWith('State') && !info.stateType) {
      info.stateType = node.name.text
    }

    // Handle `export type { Foo as BarState }` re-exports
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const spec of node.exportClause.elements) {
        const exported = spec.name.text
        if (exported.endsWith('State') && !info.stateType) {
          info.stateType = exported
          // Fields come from the source type; note "see X" for the docs
        }
        if (exported.endsWith('Msg') && !info.msgType) {
          info.msgType = exported
        }
      }
    }

    // Find Msg type
    if (ts.isTypeAliasDeclaration(node) && node.name.text.endsWith('Msg')) {
      info.msgType = node.name.text
      if (ts.isUnionTypeNode(node.type)) {
        for (const member of node.type.types) {
          if (ts.isTypeLiteralNode(member)) {
            const typeProp = member.members.find(
              (m) => ts.isPropertySignature(m) && m.name?.getText(sf) === 'type',
            )
            if (typeProp && ts.isPropertySignature(typeProp) && typeProp.type) {
              const val = printNode(typeProp.type, sf).replace(/['"]/g, '')
              info.msgVariants.push(val)
            }
          }
        }
      }
    }

    // Find Init interface
    if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith('Init')) {
      const fields: string[] = []
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) {
          const mName = member.name.getText(sf)
          const optional = member.questionToken ? '?' : ''
          const mType = member.type ? printNode(member.type, sf) : 'unknown'
          fields.push(`${mName}${optional}: ${mType}`)
        }
      }
      info.initParams = fields.join(', ')
    }

    // Find connect function
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'connect') {
      // Look for ConnectOptions param or opts param
      const params = node.parameters
      if (params.length >= 3) {
        const optsParam = params[2]!
        if (optsParam.type) {
          // Extract the type inline or referenced
          if (ts.isTypeLiteralNode(optsParam.type)) {
            const fields: string[] = []
            for (const member of optsParam.type.members) {
              if (ts.isPropertySignature(member) && member.name) {
                const mName = member.name.getText(sf)
                const optional = member.questionToken ? '?' : ''
                const mType = member.type ? printNode(member.type, sf) : 'unknown'
                fields.push(`${mName}${optional}: ${mType}`)
              }
            }
            info.connectParams = fields.join(', ')
          } else {
            info.connectParams = printNode(optsParam.type, sf)
          }
        }
      }

      // Extract return type to find parts
      if (node.body) {
        const returnStmt = findReturn(node.body)
        if (returnStmt && ts.isObjectLiteralExpression(returnStmt)) {
          for (const prop of returnStmt.properties) {
            if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
              info.parts.push(prop.name?.getText(sf) ?? '')
            } else if (ts.isMethodDeclaration(prop)) {
              info.parts.push(prop.name?.getText(sf) ?? '')
            }
          }
        }
      }
    }

    // Find extra exported functions
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      !['init', 'update', 'connect'].includes(node.name.text) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      info.extras.push(node.name.text)
    }

    // Find exported const that references extra functions (e.g., export const tabs = { ..., watchTabIndicator })
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer) &&
          decl.name.getText(sf) === name
        ) {
          for (const prop of decl.initializer.properties) {
            const propName = prop.name?.getText(sf) ?? ''
            if (!['init', 'update', 'connect'].includes(propName) && propName) {
              if (!info.extras.includes(propName)) {
                info.extras.push(propName)
              }
            }
          }
        }
      }
    }
  })

  // If we didn't find parts from the return statement, try from a Parts interface
  if (info.parts.length === 0) {
    ts.forEachChild(sf, (node) => {
      if (
        ts.isInterfaceDeclaration(node) &&
        node.name.text.endsWith('Parts') &&
        !node.name.text.includes('Item')
      ) {
        for (const member of node.members) {
          if (ts.isPropertySignature(member) && member.name) {
            info.parts.push(member.name.getText(sf))
          }
          if (ts.isMethodSignature(member) && member.name) {
            info.parts.push(member.name.getText(sf) + '()')
          }
        }
      }
    })
  }

  return info.stateType ? info : null
}

function findReturn(block: ts.Block): ts.Expression | null {
  for (const stmt of block.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      return stmt.expression
    }
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

  let md = ''

  md += `## Component Reference\n\n`
  md += `All ${components.length} components follow the same pattern:\n\n`
  md += '```typescript\n'
  md += `import { componentName } from '@llui/components/component-name'\n\n`
  md += `// State machine\n`
  md += `const state = componentName.init({ /* options */ })\n`
  md += `const [newState, effects] = componentName.update(state, msg)\n\n`
  md += `// Connect to DOM\n`
  md += `const parts = componentName.connect<State>(s => s.field, send, { id: '...' })\n`
  md += `// Use parts: div({ ...parts.root }, [button({ ...parts.trigger }, [...])])\n`
  md += '```\n\n'

  md += '---\n\n'

  for (const c of components) {
    md += `### ${toTitle(c.name)}\n\n`

    // State fields
    if (c.stateFields.length > 0) {
      md += `**State** (\`${c.stateType}\`):\n\n`
      md += `| Field | Type |\n|---|---|\n`
      for (const f of c.stateFields) {
        const type = f.type.replace(/\|/g, '\\|')
        md += `| \`${f.name}\` | \`${type}\` |\n`
      }
      md += '\n'
    }

    // Messages
    if (c.msgVariants.length > 0) {
      md += `**Messages:** ${c.msgVariants.map((v) => `\`${v}\``).join(', ')}\n\n`
    }

    // Init options
    if (c.initParams) {
      md += `**Init options:** \`${c.initParams}\`\n\n`
    }

    // Connect options
    if (c.connectParams) {
      md += `**Connect options:** \`${c.connectParams}\`\n\n`
    }

    // Parts
    if (c.parts.length > 0) {
      md += `**Parts:** ${c.parts.map((p) => `\`${p}\``).join(', ')}\n\n`
    }

    // Extras
    if (c.extras.length > 0) {
      md += `**Utilities:** ${c.extras.map((e) => `\`${e}()\``).join(', ')}\n\n`
    }

    md += '---\n\n'
  }

  return md
}

// ── Effects API Generator ────────────────────────────────────────

function generateEffectsDoc(): string {
  const effectsPath = resolve(root, 'packages/effects/src/index.ts')
  const sf = readSource(effectsPath)

  let md = '## Type Reference\n\n'

  // Extract all exported interfaces and type aliases
  ts.forEachChild(sf, (node) => {
    if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
      const name = node.name.text
      const comment = getLeadingComment(node, sf)
      md += `### \`${name}\`\n\n`
      if (comment) md += `${comment}\n\n`
      md += '```typescript\n'
      md += printNode(node, sf) + '\n'
      md += '```\n\n'
    }

    if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
      const name = node.name.text
      const comment = getLeadingComment(node, sf)
      md += `### \`${name}\`\n\n`
      if (comment) md += `${comment}\n\n`
      md += '```typescript\n'
      md += printNode(node, sf) + '\n'
      md += '```\n\n'
    }
  })

  return md
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    : false
}

// ── Main ─────────────────────────────────────────────────────────

function injectSection(filePath: string, marker: string, content: string): void {
  const existing = readFileSync(filePath, 'utf-8')
  const startMarker = `<!-- ${marker}:start -->`
  const endMarker = `<!-- ${marker}:end -->`

  let output: string
  if (existing.includes(startMarker)) {
    // Replace between markers
    const re = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`, 'g')
    output = existing.replace(re, `${startMarker}\n\n${content}\n${endMarker}`)
  } else {
    // Append at end
    output = existing.trimEnd() + `\n\n${startMarker}\n\n${content}\n${endMarker}\n`
  }

  writeFileSync(filePath, output)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Generate components
console.log('Generating component API reference...')
const componentsDoc = generateComponentsDoc()
injectSection(resolve(contentDir, 'components.md'), 'auto-api', componentsDoc)
console.log('  → components.md updated')

// Generate effects types
console.log('Generating effects type reference...')
const effectsDoc = generateEffectsDoc()
injectSection(resolve(contentDir, 'effects.md'), 'auto-api', effectsDoc)
console.log('  → effects.md updated')

console.log('Done.')
