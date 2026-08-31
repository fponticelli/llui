import {
  resolveCopiedArtifact,
  type CopiedArtifact,
  type ProductAlias,
  type ProductContract,
  type ProductEntry,
  type StylingSupport,
} from './product-contract.js'
import type { Registry } from './registry.js'

type ProductListRow = {
  addName: string
  productName: string
  displayName: string
  category: string
  artifact: string
  machineImport: string
  styling: string
}

const NONE = '—'

/**
 * Render registry discovery without collapsing copied source and package
 * machines into one misleading "component" list.
 *
 * Registries without LLui's additive product metadata keep the historical
 * name/description output, which preserves third-party compatibility.
 */
export function formatProductList(registry: Registry): string {
  const contract = registry.productContract
  if (contract === undefined) return formatLegacyItems(registry)

  const rows = contract.entries.flatMap((entry) => rowsForEntry(entry, contract)).sort(compareRows)
  const table = formatTable(rows)
  const supportFiles = registry.items
    .filter(({ type }) => type !== 'registry:ui')
    .map(({ name }) => name)
    .sort()

  return [
    '`llui add <name>` copies registry/Tailwind source into your app.',
    '`@llui/components/*` imports headless state machines.',
    'Skins and machines are related artifacts, not interchangeable commands.',
    '',
    table,
    ...(supportFiles.length === 0
      ? []
      : ['', `Registry support files: ${supportFiles.join(', ')}`]),
  ].join('\n')
}

function rowsForEntry(entry: ProductEntry, contract: ProductContract): ProductListRow[] {
  const machineImport = entry.machine.kind === 'public' ? entry.machine.importPath : NONE
  const base = {
    productName: entry.name,
    displayName: entry.displayName,
    category: entry.category,
    machineImport,
  }
  const machineRows: ProductListRow[] =
    entry.machine.kind === 'public'
      ? [
          {
            ...base,
            addName: NONE,
            artifact: entry.artifactKind === 'pattern' ? 'pattern' : 'machine',
            styling: formatMachineStyling(entry.styling),
          },
        ]
      : []
  const copiedRows = entry.copiedArtifacts.map(({ name }) => {
    const resolved = resolveCopiedArtifact(contract, name)
    if (resolved === undefined) throw new Error(`Unresolvable copied artifact: ${name}`)
    return {
      ...base,
      addName: resolved.artifact.name,
      displayName: resolved.artifact.displayName,
      artifact: formatCopiedArtifact(entry, resolved.artifact, resolved.alias),
      styling: formatCopiedStyling(resolved.artifact.styling),
    }
  })
  return [...machineRows, ...copiedRows]
}

function formatCopiedArtifact(
  entry: ProductEntry,
  artifact: Pick<CopiedArtifact, 'artifactKind'>,
  alias: ProductAlias | undefined,
): string {
  if (alias !== undefined) return `alias ${artifact.artifactKind} → ${alias.canonicalName}`
  switch (artifact.artifactKind) {
    case 'skin':
      return entry.machine.kind === 'none' ? 'skin (application-owned state)' : 'skin'
    case 'pattern':
      return 'pattern adapter'
    case 'presentational':
      return 'presentational'
  }
}

function formatMachineStyling(styling: StylingSupport): string {
  return [styling.baseline ? 'baseline' : undefined, styling.styleless ? 'styleless' : undefined]
    .filter((mode): mode is string => mode !== undefined)
    .join(', ')
}

function formatCopiedStyling(styling: StylingSupport): string {
  return [
    styling.baseline ? 'baseline' : undefined,
    styling.registryTailwind ? 'registry/Tailwind' : undefined,
    styling.styleless ? 'styleless' : undefined,
  ]
    .filter((mode): mode is string => mode !== undefined)
    .join(', ')
}

function compareRows(left: ProductListRow, right: ProductListRow): number {
  const leftKey = left.addName === NONE ? left.productName : left.addName
  const rightKey = right.addName === NONE ? right.productName : right.addName
  return leftKey.localeCompare(rightKey) || left.addName.localeCompare(right.addName)
}

function formatTable(rows: readonly ProductListRow[]): string {
  const headings: ProductListRow = {
    addName: 'ADD NAME',
    productName: 'PRODUCT',
    displayName: 'DISPLAY NAME',
    category: 'CATEGORY',
    artifact: 'ARTIFACT',
    machineImport: 'MACHINE IMPORT',
    styling: 'STYLING MODES',
  }
  const allRows = [headings, ...rows]
  const widths = {
    addName: maxWidth(allRows, 'addName'),
    productName: maxWidth(allRows, 'productName'),
    displayName: maxWidth(allRows, 'displayName'),
    category: maxWidth(allRows, 'category'),
    artifact: maxWidth(allRows, 'artifact'),
    machineImport: maxWidth(allRows, 'machineImport'),
  }

  return allRows
    .map(
      (row) =>
        `${row.addName.padEnd(widths.addName)}  ${row.productName.padEnd(widths.productName)}  ` +
        `${row.displayName.padEnd(widths.displayName)}  ${row.category.padEnd(widths.category)}  ` +
        `${row.artifact.padEnd(widths.artifact)}  ${row.machineImport.padEnd(widths.machineImport)}  ` +
        row.styling,
    )
    .join('\n')
}

function maxWidth(rows: readonly ProductListRow[], field: keyof ProductListRow): number {
  return Math.max(...rows.map((row) => row[field].length))
}

function formatLegacyItems(registry: Registry): string {
  const width = Math.max(0, ...registry.items.map(({ name }) => name.length))
  return registry.items
    .map((item) => `  ${item.name.padEnd(width)}  ${item.description ?? ''}`)
    .join('\n')
}
