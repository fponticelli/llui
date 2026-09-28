/**
 * Component discovery and styling documentation, GENERATED from the canonical product contract
 * (#269).
 *
 * `registry/registry.json#productContract` is the one owner of product metadata: which
 * components exist, their category, whether a headless machine exists and where it is imported
 * from, which `llui add` names copy source into an app, which of those are aliases, and how far
 * each styling path covers each product. Every count, inventory, alias table and gallery link a
 * reader sees in the docs is rendered here from that value — never typed by hand — and spliced
 * into marker-delimited regions of the target files:
 *
 *   <!-- product-contract:<fragment>:start … -->
 *   …generated…
 *   <!-- product-contract:<fragment>:end -->
 *
 * The stylesheet fragment is derived the same way from what actually ships: the `./styles/*.css`
 * exports of `@llui/components`, the `@import` order of `theme.css` / `tokens.css`, and the
 * `data-scope` selectors and media queries inside each module.
 *
 * This module is pure (no filesystem, no process): `generate-component-docs.ts` reads the inputs
 * and writes the files, and `test/component-docs.test.ts` re-renders every target and fails on
 * drift. `pnpm check:generated` regenerates and diffs the same files.
 */
import type {
  PresentationCoverage,
  ProductCategory,
  ProductContract,
  ProductEntry,
} from '@llui/cli'
import { GALLERY_PATH_LABELS, PUBLIC_GALLERY_BASE, galleryHref } from '@llui/cli/gallery'

/** Where llui.dev lives. Links in files rendered OUTSIDE the site (READMEs, skills) use it. */
export const SITE_ORIGIN = 'https://llui.dev'

/** Site route of the generated component catalog page. */
export const CATALOG_ROUTE = '/component-catalog'

/** Site route of the `@llui/components` API reference. */
export const COMPONENTS_API_ROUTE = '/api/components'

export const FRAGMENT_IDS = [
  'summary',
  'coverage',
  'inventory',
  'aliases',
  'name-differences',
  'machine-free',
  'machine-imports',
  'entry-points',
  'stylesheets',
] as const

export type FragmentId = (typeof FRAGMENT_IDS)[number]

/**
 * `site`: the file is rendered by llui.dev, so links are site-relative.
 * `absolute`: the file is read on GitHub / npm / by an agent, so links carry `SITE_ORIGIN`.
 */
export type LinkStyle = 'site' | 'absolute'

export interface DocTarget {
  /** Repo-relative path. */
  readonly path: string
  readonly links: LinkStyle
  /** Exactly the fragments this file carries — the markers present must equal this set. */
  readonly fragments: readonly FragmentId[]
}

/**
 * Every file that carries generated component facts. The order of `fragments` is not
 * significant; the test asserts the markers in each file equal this set in both directions.
 */
export const COMPONENT_DOC_TARGETS: readonly DocTarget[] = [
  {
    path: 'site/content/component-catalog.md',
    links: 'site',
    fragments: [
      'summary',
      'coverage',
      'inventory',
      'aliases',
      'name-differences',
      'machine-free',
      'entry-points',
    ],
  },
  { path: 'site/content/components.md', links: 'site', fragments: ['summary'] },
  { path: 'site/content/styling.md', links: 'site', fragments: ['stylesheets'] },
  { path: 'site/content/migration.md', links: 'site', fragments: ['aliases'] },
  {
    path: 'site/content/api/components.md',
    links: 'site',
    fragments: ['summary', 'machine-imports'],
  },
  { path: 'README.md', links: 'absolute', fragments: ['summary'] },
  {
    path: 'packages/components/README.md',
    links: 'absolute',
    fragments: ['summary', 'machine-imports', 'stylesheets'],
  },
  {
    path: 'packages/cli/README.md',
    links: 'absolute',
    fragments: ['summary', 'aliases', 'name-differences'],
  },
  {
    path: '.claude/skills/llui-app-dev/references/components.md',
    links: 'absolute',
    fragments: ['summary', 'aliases', 'name-differences'],
  },
  {
    path: '.agents/skills/llui-app-dev/references/components.md',
    links: 'absolute',
    fragments: ['summary', 'aliases', 'name-differences'],
  },
]

// ── Inputs ─────────────────────────────────────────────────────────

export interface StylesheetSource {
  /** File name under `@llui/components/styles/`, e.g. `theme.css`. */
  readonly file: string
  readonly source: string
}

export interface ComponentDocsInput {
  /** Already validated through `ProductContractSchema`. */
  readonly contract: ProductContract
  /** Keys of `@llui/components`'s `package.json#exports`, e.g. `./accordion`, `./styles/theme.css`. */
  readonly componentExports: readonly string[]
  /** Source of every exported stylesheet. */
  readonly stylesheets: readonly StylesheetSource[]
}

// ── Labels (vocabulary, not facts) ─────────────────────────────────

/** Same labels the Component Gallery shows, in the contract's category order. */
export const CATEGORY_LABELS: Readonly<Record<ProductCategory, string>> = {
  controls: 'Controls',
  forms: 'Forms',
  navigation: 'Navigation',
  overlays: 'Overlays',
  feedback: 'Feedback',
  'data-display': 'Data display',
  layout: 'Layout',
  media: 'Media',
  patterns: 'Patterns',
  utilities: 'Utilities',
}

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as ProductCategory[]

const COVERAGE_LABELS: Readonly<Record<PresentationCoverage['mode'], string>> = {
  styled: 'styled',
  partial: 'partial',
  composed: 'composed',
  styleless: 'styleless',
  'not-applicable': '—',
}

const KIND_LABELS: Readonly<Record<ProductEntry['artifactKind'], string>> = {
  machine: 'machine',
  pattern: 'pattern',
  presentational: 'presentational',
  skin: 'skin, app-owned state',
}

/**
 * The role of every stylesheet `@llui/components` exports. CLOSED AT BOTH ENDS: rendering throws
 * when an exported stylesheet has no entry here, or an entry names a stylesheet that is not
 * exported — so a new module cannot ship undocumented and a removed one cannot linger.
 */
export type StylesheetKind = 'complete' | 'tokens' | 'foundation' | 'family' | 'motion' | 'registry'

export interface StylesheetRole {
  /**
   * `complete`: the one-import Baseline theme. `tokens` / `foundation`: what every family module
   * assumes is loaded first. `family`: one component family. `motion`: keyframes, loaded last.
   * `registry`: the Tailwind v4 entries of the Registry skins path.
   */
  readonly kind: StylesheetKind
  readonly role: string
}

export const STYLESHEET_ROLES: Readonly<Record<string, StylesheetRole>> = {
  'theme.css': {
    kind: 'complete',
    role: 'The complete Baseline theme: every module below, in dependency order.',
  },
  'semantic-tokens.css': {
    kind: 'tokens',
    role: 'Light semantic tokens — the shadcn/ui names (`--background`, `--primary`, `--radius`, …) plus the `--llui-*` scales. Values only, no selectors.',
  },
  'semantic-tokens-dark.css': {
    kind: 'tokens',
    role: "Dark values for the base tokens, active under `[data-theme='dark']`, `.dark` and `prefers-color-scheme: dark`.",
  },
  'foundation.css': {
    kind: 'foundation',
    role: 'Cross-family rules every module relies on: focus ring, disabled state, reduced motion, forced colors and the `.btn` classes.',
  },
  'form-controls.css': { kind: 'family', role: 'Form controls.' },
  'disclosure-navigation.css': { kind: 'family', role: 'Disclosure and navigation.' },
  'menus-overlays.css': { kind: 'family', role: 'Menus, overlays and transient surfaces.' },
  'data-display.css': { kind: 'family', role: 'Data display and status.' },
  'specialized-tools.css': {
    kind: 'family',
    role: 'Pickers, editors, upload and canvas tools, and utilities.',
  },
  'motion.css': { kind: 'motion', role: 'Enter/exit keyframes and component motion.' },
  'tokens.css': {
    kind: 'registry',
    role: 'The Registry skins entry for your Tailwind v4 stylesheet: the semantic tokens plus `tailwind.css`.',
  },
  'tokens-dark.css': { kind: 'registry', role: 'Dark values for the Registry skins entry.' },
  'tailwind.css': {
    kind: 'registry',
    role: 'The `@theme inline` mapping of the semantic tokens into Tailwind utility namespaces (reached through `tokens.css`).',
  },
}

/**
 * Every public `@llui/components` entry point that is NOT a contract machine import and NOT a
 * stylesheet. Closed at both ends, like `STYLESHEET_ROLES`.
 */
export const ENTRY_POINT_ROLES: Readonly<Record<string, { heading: string; role: string }>> = {
  '.': {
    heading: '@llui/components',
    role: 'Root barrel: every component object, plus the locale surface (`en`, `LocaleContext`) and the format helpers. Prefer a subpath in new code.',
  },
  './patterns': {
    heading: '@llui/components/patterns',
    role: 'Barrel of the composed patterns.',
  },
  './utils': {
    heading: '@llui/components/utils',
    role: 'Shared helpers the machines are built from (typeahead, tree collection, focus trap, dismissable layers, floating, …).',
  },
  './utils/*': {
    heading: '@llui/components/utils',
    role: 'One shared helper per subpath, e.g. `@llui/components/utils/typeahead`.',
  },
  './format/*': {
    heading: '@llui/components/format/index',
    role: 'Locale-aware formatting helpers (`formatDate`, `formatNumber`, `formatRelativeTime`, …), one per subpath.',
  },
  './styles': {
    heading: '@llui/components/styles',
    role: 'JavaScript styling helpers for your own recipes: `createVariants`, `cx`, `chipHue`. Not a stylesheet.',
  },
  './icon': {
    heading: '@llui/components/icon',
    role: 'Any Iconify glyph as a real `<svg>`, on either styling path.',
  },
}

// ── Link helpers ───────────────────────────────────────────────────

function sitePrefix(links: LinkStyle): string {
  return links === 'absolute' ? SITE_ORIGIN : ''
}

function galleryBase(links: LinkStyle): string {
  return `${sitePrefix(links)}${PUBLIC_GALLERY_BASE}`
}

/**
 * The heading id rehype-slug / GitHub give `` ### `@llui/components/x` `` in the API reference:
 * lowercased, punctuation other than `-` and `_` dropped. The docs link test resolves every
 * anchor this produces against the real rendered headings, so a drift here fails a test rather
 * than shipping a dead link.
 */
export function apiAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-')
}

function apiLink(heading: string, links: LinkStyle): string {
  return `${sitePrefix(links)}${COMPONENTS_API_ROUTE}#${apiAnchor(heading)}`
}

function code(value: string): string {
  return `\`${value}\``
}

function importLink(importPath: string, links: LinkStyle): string {
  return `[${code(importPath)}](${apiLink(importPath, links)})`
}

function galleryLink(contract: ProductContract, name: string, links: LinkStyle): string {
  return galleryHref(contract, name, { base: galleryBase(links) })
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|')
}

function table(headings: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.map(cell).join(' | ')} |`
  return [line(headings), line(headings.map(() => '---')), ...rows.map(line)].join('\n')
}

// ── Derived facts ──────────────────────────────────────────────────

function machineImport(entry: ProductEntry): string | undefined {
  return entry.machine.kind === 'public' ? entry.machine.importPath : undefined
}

function aliasNames(contract: ProductContract): ReadonlySet<string> {
  return new Set(contract.aliases.map(({ name }) => name))
}

function entriesByCategory(contract: ProductContract): [ProductCategory, ProductEntry[]][] {
  return CATEGORY_ORDER.map((category): [ProductCategory, ProductEntry[]] => [
    category,
    contract.entries
      .filter((entry) => entry.category === category)
      .sort((a, b) => a.name.localeCompare(b.name)),
  ]).filter(([, entries]) => entries.length > 0)
}

/** What a copied artifact of each kind is, in a sentence. */
const COPIED_KIND_LABELS: Readonly<Record<'skin' | 'pattern' | 'presentational', string>> = {
  skin: 'skin',
  pattern: 'pattern adapter',
  presentational: 'presentational item',
}

function coverageLabel(coverage: PresentationCoverage): string {
  if (coverage.mode === 'composed') {
    return `composed from ${coverage.products.map(code).join(', ')}`
  }
  return COVERAGE_LABELS[coverage.mode]
}

function addNamesCell(entry: ProductEntry, aliases: ReadonlySet<string>): string {
  if (entry.copiedArtifacts.length === 0) return '—'
  return entry.copiedArtifacts
    .map(({ name }) => (aliases.has(name) ? `${code(name)} (alias)` : code(name)))
    .join(', ')
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

// ── Fragments ──────────────────────────────────────────────────────

interface RenderContext {
  readonly input: ComponentDocsInput
  readonly links: LinkStyle
  readonly target: string
}

function renderSummary({ input, links, target }: RenderContext): string {
  const { contract } = input
  const kinds: ProductEntry['artifactKind'][] = ['machine', 'pattern', 'presentational', 'skin']
  const copiedNames = contract.entries.flatMap(({ copiedArtifacts }) => copiedArtifacts)
  const rows = kinds
    .map((kind) => {
      const entries = contract.entries.filter((entry) => entry.artifactKind === kind)
      const withImport = entries.filter((entry) => machineImport(entry) !== undefined).length
      const withCopy = entries.filter((entry) => entry.copiedArtifacts.length > 0).length
      return { kind, entries: entries.length, withImport, withCopy }
    })
    .filter(({ entries }) => entries > 0)
  const totalImports = contract.entries.filter((entry) => machineImport(entry) !== undefined).length
  const catalog = `${sitePrefix(links)}${CATALOG_ROUTE}`
  const isCatalog = target === 'site/content/component-catalog.md'

  return [
    `The product contract lists **${count(contract.entries.length, 'component')}**. ` +
      `\`@llui/components/<name>\` imports a component's **headless machine** (behaviour, state, ` +
      `ARIA) when it has one; \`llui add <name>\` **copies styled source** into your app. They are ` +
      `different artifacts, and a component may have either, both, or names that differ between ` +
      `the two.`,
    '',
    table(
      ['Kind', 'Components', 'Headless import', 'Copied by `llui add`'],
      [
        ...rows.map(({ kind, entries, withImport, withCopy }) => [
          KIND_LABELS[kind],
          String(entries),
          withImport === 0 ? 'none, by design' : String(withImport),
          String(withCopy),
        ]),
        [
          '**all**',
          `**${contract.entries.length}**`,
          `**${totalImports}**`,
          `**${count(copiedNames.length, 'add name')}**, ${count(contract.aliases.length, 'alias', 'aliases')} among them`,
        ],
      ],
    ),
    '',
    isCatalog
      ? `Every component below has a stable page in the [Component Gallery](${galleryBase(links)}), ` +
        `rendered on the ${GALLERY_PATH_LABELS.baseline} and ${GALLERY_PATH_LABELS.registryTailwind} ` +
        `paths in isolated documents.`
      : `Every component, with its import, add names, styling support and a stable ` +
        `[Component Gallery](${galleryBase(links)}) link, is in the [component catalog](${catalog}).`,
    '',
  ].join('\n')
}

function renderCoverage({ input }: RenderContext): string {
  const { contract } = input
  const modes: PresentationCoverage['mode'][] = [
    'styled',
    'partial',
    'composed',
    'styleless',
    'not-applicable',
  ]
  const countOf = (path: 'baseline' | 'registryTailwind', mode: PresentationCoverage['mode']) =>
    String(contract.entries.filter((entry) => entry.presentation[path].mode === mode).length)
  return (
    table(
      ['Coverage', GALLERY_PATH_LABELS.baseline, GALLERY_PATH_LABELS.registryTailwind],
      modes.map((mode) => [
        mode === 'not-applicable' ? 'not applicable (—)' : mode,
        countOf('baseline', mode),
        countOf('registryTailwind', mode),
      ]),
    ) + '\n'
  )
}

function renderInventory({ input, links }: RenderContext): string {
  const { contract } = input
  const aliases = aliasNames(contract)
  const sections = entriesByCategory(contract).map(([category, entries]) =>
    [
      `### ${CATEGORY_LABELS[category]}`,
      '',
      table(
        [
          'Component',
          'Kind',
          'Headless import',
          '`llui add`',
          GALLERY_PATH_LABELS.baseline,
          GALLERY_PATH_LABELS.registryTailwind,
          'Gallery',
        ],
        entries.map((entry) => {
          const machine = machineImport(entry)
          return [
            `**${entry.displayName}** (${code(entry.name)})`,
            KIND_LABELS[entry.artifactKind],
            machine === undefined ? '—' : importLink(machine, links),
            addNamesCell(entry, aliases),
            coverageLabel(entry.presentation.baseline),
            coverageLabel(entry.presentation.registryTailwind),
            `[open](${galleryLink(contract, entry.name, links)})`,
          ]
        }),
      ),
    ].join('\n'),
  )
  return sections.join('\n\n') + '\n'
}

function renderAliases({ input, links }: RenderContext): string {
  const { contract } = input
  const rows = [...contract.aliases]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((alias) => {
      const canonical = contract.entries.find(({ name }) => name === alias.canonicalName)
      const artifact = canonical?.copiedArtifacts.find(({ name }) => name === alias.name)
      if (canonical === undefined || artifact === undefined) {
        throw new Error(`alias ${alias.name} does not resolve to a copied artifact`)
      }
      const machine = machineImport(canonical)
      return {
        alias,
        canonical,
        artifact,
        machine,
        row: [
          code(alias.name),
          COPIED_KIND_LABELS[artifact.artifactKind],
          `${canonical.displayName} (${code(canonical.name)})`,
          machine === undefined ? '—' : importLink(machine, links),
          `[open](${galleryLink(contract, alias.name, links)})`,
        ],
      }
    })
  const width = Math.max(...rows.map(({ alias }) => `llui add ${alias.name}`.length))
  const examples = rows.map(({ alias, canonical, artifact, machine }) => {
    const what = `copies the ${canonical.displayName} ${COPIED_KIND_LABELS[artifact.artifactKind]}`
    const state = machine === undefined ? 'no machine to import' : `its machine is ${machine}`
    return `${`llui add ${alias.name}`.padEnd(width)}  # ${what}; ${state}`
  })
  return [
    table(
      ['`llui add` alias', 'Installs', 'Canonical component', 'Headless import', 'Gallery'],
      rows.map(({ row }) => row),
    ),
    '',
    '```bash',
    ...examples,
    '```',
    '',
  ].join('\n')
}

/**
 * Components whose import and add names are not simply `<name>` on both surfaces: aliases,
 * extra copied variants, pattern adapters, and machines with nothing to copy. Machine-free items
 * are listed separately (`machine-free`).
 */
function renderNameDifferences({ input, links }: RenderContext): string {
  const { contract } = input
  const aliases = aliasNames(contract)
  const productNames = new Map(contract.entries.map((entry) => [entry.name, entry]))
  const rows = contract.entries
    .filter((entry) => machineImport(entry) !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const machine = machineImport(entry)!
      const leaf = machine.slice(machine.lastIndexOf('/') + 1)
      const names = entry.copiedArtifacts.map(({ name }) => name)
      const plain = names.length === 1 && names[0] === entry.name && leaf === entry.name
      if (plain) return []
      const notes: string[] = []
      if (names.length === 0) {
        const registry = entry.presentation.registryTailwind
        const baseline = entry.presentation.baseline
        notes.push(
          registry.mode === 'composed'
            ? `nothing to copy: on ${GALLERY_PATH_LABELS.registryTailwind} it is composed from ${registry.products.map(code).join(', ')}`
            : baseline.mode === 'styled' || baseline.mode === 'partial'
              ? `nothing to copy: the ${GALLERY_PATH_LABELS.baseline} styles it; with ${GALLERY_PATH_LABELS.registryTailwind}, style its parts yourself`
              : 'nothing to copy: a behaviour-only machine with no surface to style',
        )
      }
      for (const artifact of entry.copiedArtifacts) {
        const other = productNames.get(artifact.name)
        if (aliases.has(artifact.name)) {
          notes.push(`${code(artifact.name)} is an alias of ${code(entry.name)}`)
        } else if (other !== undefined && other !== entry) {
          const otherMachine = machineImport(other)
          notes.push(
            `${code(`llui add ${artifact.name}`)} copies this ${COPIED_KIND_LABELS[artifact.artifactKind]}` +
              (otherMachine === undefined
                ? `, not the ${other.displayName} component`
                : `; ${code(otherMachine)} is the separate ${other.displayName} machine`),
          )
        } else if (artifact.name !== entry.name) {
          notes.push(
            `${code(artifact.name)} is a separate copied ${COPIED_KIND_LABELS[artifact.artifactKind]}`,
          )
        }
      }
      if (leaf !== entry.name) notes.push(`imported from ${code(machine)}`)
      return [
        [
          `${entry.displayName} (${code(entry.name)})`,
          importLink(machine, links),
          addNamesCell(entry, aliases),
          notes.join('; '),
        ],
      ]
    })
  return table(['Component', 'Headless import', '`llui add`', 'Why it differs'], rows) + '\n'
}

function renderMachineFree({ input, links }: RenderContext): string {
  const { contract } = input
  const aliases = aliasNames(contract)
  const rows = contract.entries
    .filter((entry) => entry.machine.kind === 'none')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => [
      `**${entry.displayName}** (${code(entry.name)})`,
      addNamesCell(entry, aliases),
      entry.machine.kind === 'none' && entry.machine.reason === 'application-owned-state'
        ? 'interactive skin; your application owns its state'
        : 'presentational: a styled element with no state',
      coverageLabel(entry.presentation.baseline),
      `[open](${galleryLink(contract, entry.name, links)})`,
    ])
  return (
    table(
      ['Component', '`llui add`', 'Why no machine', GALLERY_PATH_LABELS.baseline, 'Gallery'],
      rows,
    ) + '\n'
  )
}

function renderMachineImports({ input, links }: RenderContext): string {
  const { contract } = input
  const lines = entriesByCategory(contract).flatMap(([category, entries]) => {
    const imports = entries.flatMap((entry) => {
      const machine = machineImport(entry)
      return machine === undefined ? [] : [machine]
    })
    if (imports.length === 0) return []
    const items = imports.map(
      (machine) =>
        `[${code(machine.replace('@llui/components/', ''))}](${apiLink(machine, links)})`,
    )
    return [`- **${CATEGORY_LABELS[category]}** — ${items.join(', ')}`]
  })
  const total = contract.entries.filter((entry) => machineImport(entry) !== undefined).length
  return [
    `${count(total, 'headless machine and pattern subpath', 'headless machine and pattern subpaths')}, ` +
      `each imported as \`@llui/components/<subpath>\`, grouped by category:`,
    '',
    ...lines,
    '',
  ].join('\n')
}

function nonProductExports(input: ComponentDocsInput): string[] {
  const machines = new Set(
    input.contract.entries.flatMap((entry) => {
      const machine = machineImport(entry)
      return machine === undefined ? [] : [`./${machine.replace('@llui/components/', '')}`]
    }),
  )
  return input.componentExports.filter(
    (key) => !machines.has(key) && !/^\.\/styles\/[^/]+\.css$/.test(key),
  )
}

function assertClosed(label: string, documented: Iterable<string>, actual: Iterable<string>): void {
  const doc = new Set(documented)
  const act = new Set(actual)
  const undocumented = [...act].filter((key) => !doc.has(key)).sort()
  const stale = [...doc].filter((key) => !act.has(key)).sort()
  if (undocumented.length > 0 || stale.length > 0) {
    throw new Error(
      `${label} out of sync with what @llui/components exports.` +
        (undocumented.length > 0 ? `\n  undocumented: ${undocumented.join(', ')}` : '') +
        (stale.length > 0 ? `\n  documented but not exported: ${stale.join(', ')}` : ''),
    )
  }
}

function renderEntryPoints({ input, links }: RenderContext): string {
  const keys = nonProductExports(input)
  assertClosed('ENTRY_POINT_ROLES', Object.keys(ENTRY_POINT_ROLES), keys)
  const rows = keys.map((key) => {
    const { heading, role } = ENTRY_POINT_ROLES[key]!
    const specifier = key === '.' ? '@llui/components' : `@llui/components/${key.slice(2)}`
    return [`[${code(specifier)}](${apiLink(heading, links)})`, role]
  })
  return table(['Entry point', 'What it is'], rows) + '\n'
}

// ── Stylesheets ────────────────────────────────────────────────────

export function stylesheetImports(source: string): string[] {
  return [...source.matchAll(/@import\s+['"]\.\/([^'"]+)['"]/g)].map((match) => match[1]!)
}

function closure(file: string, sources: ReadonlyMap<string, string>): string[] {
  const out: string[] = []
  const visit = (name: string): void => {
    if (out.includes(name)) return
    out.push(name)
    const source = sources.get(name)
    if (source === undefined) throw new Error(`stylesheet ${name} is imported but not exported`)
    for (const imported of stylesheetImports(source)) visit(imported)
  }
  visit(file)
  return out
}

function scopesOf(source: string): string[] {
  return [
    ...new Set([...source.matchAll(/data-scope=['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]!)),
  ].sort()
}

function renderStylesheets({ input }: RenderContext): string {
  const sources = new Map(input.stylesheets.map(({ file, source }) => [file, source]))
  const exported = input.componentExports
    .map((key) => /^\.\/styles\/([^/]+\.css)$/.exec(key)?.[1])
    .filter((file): file is string => file !== undefined)
  assertClosed('STYLESHEET_ROLES', Object.keys(STYLESHEET_ROLES), exported)
  assertClosed('stylesheet sources', sources.keys(), exported)

  const themeOrder = stylesheetImports(sources.get('theme.css')!)
  const baseline = new Set(closure('theme.css', sources))
  const registry = new Set([
    ...closure('tokens.css', sources),
    ...closure('tokens-dark.css', sources),
  ])
  const pathOf = (file: string): string =>
    baseline.has(file) && registry.has(file)
      ? 'both paths'
      : baseline.has(file)
        ? GALLERY_PATH_LABELS.baseline
        : registry.has(file)
          ? GALLERY_PATH_LABELS.registryTailwind
          : 'neither (unreachable)'
  const kindOf = (file: string): StylesheetKind => STYLESHEET_ROLES[file]!.kind
  // theme.css must load tokens and foundation, then families, then motion — the order a modular
  // bundle is told to copy. A reordering there must be reflected here, not silently documented.
  const rank: Record<StylesheetKind, number> = {
    tokens: 0,
    foundation: 1,
    family: 2,
    motion: 3,
    complete: 9,
    registry: 9,
  }
  themeOrder.forEach((file, index) => {
    const previous = themeOrder[index - 1]
    if (previous !== undefined && rank[kindOf(previous)] > rank[kindOf(file)]) {
      throw new Error(`theme.css imports ${file} after ${previous}; the documented order is wrong`)
    }
  })
  const prefix = themeOrder.filter((file) => rank[kindOf(file)] < rank.family)
  const families = themeOrder.filter((file) => kindOf(file) === 'family')
  const suffix = themeOrder.filter((file) => kindOf(file) === 'motion')
  const ordered = [
    'theme.css',
    ...themeOrder,
    ...Object.keys(STYLESHEET_ROLES).filter(
      (file) => file !== 'theme.css' && !themeOrder.includes(file),
    ),
  ]
  const spec = (file: string): string => `@llui/components/styles/${file}`
  const rows = ordered.map((file) => [code(file), pathOf(file), STYLESHEET_ROLES[file]!.role])
  const withMedia = (query: RegExp): string =>
    themeOrder
      .filter((file) => query.test(sources.get(file)!))
      .map(code)
      .join(', ')

  return [
    `\`theme.css\` is the complete ${GALLERY_PATH_LABELS.baseline}: ordinary CSS, no Tailwind. It imports, in order: ` +
      themeOrder.map(code).join(' → ') +
      '.',
    '',
    table(['Stylesheet (`@llui/components/styles/…`)', 'Path', 'Role'], rows),
    '',
    `A modular ${GALLERY_PATH_LABELS.baseline} bundle keeps that order: ` +
      prefix.map(code).join(', ') +
      ' first, then only the family modules you use, then ' +
      suffix.map(code).join(', ') +
      ':',
    '',
    '```css',
    ...prefix.map((file) => `@import '${spec(file)}';`),
    `@import '${spec(families[0]!)}'; /* …one line per family you use */`,
    ...suffix.map((file) => `@import '${spec(file)}';`),
    '```',
    '',
    'Which component scopes (`data-scope`) each family module styles:',
    '',
    ...families.map(
      (file) => `- ${code(file)} — ${scopesOf(sources.get(file)!).map(code).join(', ')}`,
    ),
    '',
    `Modules carrying \`forced-colors\` rules: ${withMedia(/@media[^{]*forced-colors/)}. ` +
      `Modules carrying \`prefers-reduced-motion\` rules: ${withMedia(/@media[^{]*prefers-reduced-motion/)}.`,
    '',
  ].join('\n')
}

// ── Render + splice ────────────────────────────────────────────────

const RENDERERS: Readonly<Record<FragmentId, (context: RenderContext) => string>> = {
  summary: renderSummary,
  coverage: renderCoverage,
  inventory: renderInventory,
  aliases: renderAliases,
  'name-differences': renderNameDifferences,
  'machine-free': renderMachineFree,
  'machine-imports': renderMachineImports,
  'entry-points': renderEntryPoints,
  stylesheets: renderStylesheets,
}

/** Unformatted Markdown for one fragment as it appears in `target`. */
export function renderFragment(
  id: FragmentId,
  input: ComponentDocsInput,
  target: Pick<DocTarget, 'path' | 'links'>,
): string {
  return RENDERERS[id]({ input, links: target.links, target: target.path })
}

export function startMarker(id: FragmentId): string {
  return `<!-- product-contract:${id}:start — generated by site/src/generate-component-docs.ts; do not edit -->`
}

export function endMarker(id: FragmentId): string {
  return `<!-- product-contract:${id}:end -->`
}

const MARKER = /<!-- product-contract:([a-z-]+):(start|end)\b[^>]*-->/g

export interface GeneratedRegion {
  readonly id: string
  /** Text between the start marker line and the end marker. */
  readonly body: string
  /** Offset of the start marker. */
  readonly start: number
  /** Offset just past the end marker. */
  readonly end: number
}

/**
 * Every generated region in `text`. Throws on an unbalanced, nested, duplicated or unknown
 * marker — a malformed region must fail loudly, never be skipped or half-replaced.
 */
export function generatedRegions(text: string, file = '<text>'): GeneratedRegion[] {
  const regions: GeneratedRegion[] = []
  const seen = new Set<string>()
  let open: { id: string; start: number; bodyStart: number } | undefined
  for (const match of text.matchAll(MARKER)) {
    const whole = match[0]
    const id = match[1]!
    const edge = match[2]
    const at = match.index
    if (!(FRAGMENT_IDS as readonly string[]).includes(id)) {
      throw new Error(`${file}: unknown generated fragment "${id}"`)
    }
    if (edge === 'start') {
      if (open !== undefined) {
        throw new Error(`${file}: fragment "${id}" starts inside unterminated "${open.id}"`)
      }
      if (seen.has(id)) throw new Error(`${file}: fragment "${id}" appears more than once`)
      seen.add(id)
      open = { id, start: at, bodyStart: at + whole.length }
    } else {
      if (open === undefined || open.id !== id) {
        throw new Error(`${file}: end marker for "${id}" without a matching start`)
      }
      regions.push({
        id,
        body: text.slice(open.bodyStart, at),
        start: open.start,
        end: at + whole.length,
      })
      open = undefined
    }
  }
  if (open !== undefined) throw new Error(`${file}: fragment "${open.id}" is never closed`)
  return regions
}

/**
 * Replace every region of `text` with its fragment. `fragments` must cover exactly the regions
 * present and `expected` must equal the ids present — a missing or extra marker throws.
 */
export function spliceFragments(
  text: string,
  fragments: ReadonlyMap<FragmentId, string>,
  expected: readonly FragmentId[],
  file = '<text>',
): string {
  const regions = generatedRegions(text, file)
  const present = regions.map(({ id }) => id).sort()
  const want = [...expected].sort()
  if (present.join() !== want.join()) {
    throw new Error(
      `${file}: generated regions [${present.join(', ')}] do not match the declared fragments [${want.join(', ')}]`,
    )
  }
  let out = ''
  let cursor = 0
  for (const region of regions) {
    const id = region.id as FragmentId
    const body = fragments.get(id)
    if (body === undefined) throw new Error(`${file}: no rendered fragment for "${id}"`)
    out += text.slice(cursor, region.start)
    out += `${startMarker(id)}\n\n${body.trimEnd()}\n\n${endMarker(id)}`
    cursor = region.end
  }
  return out + text.slice(cursor)
}
