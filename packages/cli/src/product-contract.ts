import { z } from 'zod'

const PRODUCT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PUBLIC_MACHINE_IMPORT = /^@llui\/components\/(?:patterns\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/

export const StylingSupportSchema = z
  .object({
    baseline: z.boolean(),
    registryTailwind: z.boolean(),
    styleless: z.boolean(),
  })
  .strict()

export const ProductCategorySchema = z.enum([
  'controls',
  'forms',
  'navigation',
  'overlays',
  'feedback',
  'data-display',
  'layout',
  'media',
  'patterns',
  'utilities',
])

/** Single-owner visual-language cohort. This is independent of the user-facing product category. */
export const PresentationFamilySchema = z.enum([
  'forms-controls',
  'navigation-data',
  'menus-overlays',
  'specialized-tools',
])

const PresentationRationaleSchema = z
  .string()
  .trim()
  .min(1, 'Presentation rationale must contain non-whitespace text.')

/** The product directly supplies the path's complete default visual treatment. */
export const StyledPresentationCoverageSchema = z.object({ mode: z.literal('styled') }).strict()

/** The product directly supplies meaningful styling but names the presentation boundary it leaves open. */
export const PartialPresentationCoverageSchema = z
  .object({
    mode: z.literal('partial'),
    rationale: PresentationRationaleSchema,
  })
  .strict()

/** The product owns no styling on this path; its presentation is composed from canonical products. */
export const ComposedPresentationCoverageSchema = z
  .object({
    mode: z.literal('composed'),
    products: z
      .array(z.string().regex(PRODUCT_NAME))
      .min(1, 'Composed presentation coverage must reference at least one canonical product.'),
    rationale: PresentationRationaleSchema,
  })
  .strict()

/** A public package machine or pattern that remains useful without owned visual treatment. */
export const StylelessPresentationCoverageSchema = z
  .object({
    mode: z.literal('styleless'),
    rationale: PresentationRationaleSchema,
  })
  .strict()

/** A machine-free canonical product with no public headless artifact. */
export const NotApplicablePresentationCoverageSchema = z
  .object({
    mode: z.literal('not-applicable'),
    rationale: PresentationRationaleSchema,
  })
  .strict()

/** One path's explicit visual-coverage classification. */
export const PresentationCoverageSchema = z.discriminatedUnion('mode', [
  StyledPresentationCoverageSchema,
  PartialPresentationCoverageSchema,
  ComposedPresentationCoverageSchema,
  StylelessPresentationCoverageSchema,
  NotApplicablePresentationCoverageSchema,
])

/** Canonical family ownership and baseline/registry coverage for one product. */
export const ProductPresentationSchema = z
  .object({
    family: PresentationFamilySchema,
    baseline: PresentationCoverageSchema,
    registryTailwind: PresentationCoverageSchema,
  })
  .strict()

export const PublicMachineSchema = z
  .object({
    kind: z.literal('public'),
    importPath: z.string().regex(PUBLIC_MACHINE_IMPORT),
  })
  .strict()

export const MachineFreeSchema = z
  .object({
    kind: z.literal('none'),
    reason: z.enum(['presentational', 'application-owned-state']),
  })
  .strict()

export const CopiedArtifactSchema = z
  .object({
    /** The install identity accepted by `llui add`. */
    name: z.string().regex(PRODUCT_NAME),
    /** Omit only when the copied artifact intentionally shares the product display name. */
    displayName: z.string().min(1).optional(),
    artifactKind: z.enum(['skin', 'presentational', 'pattern']),
    /** Copied artifacts classify styling independently from their related package artifact. */
    styling: StylingSupportSchema,
    /** Omit only when the copied artifact intentionally shares the product scenario. */
    scenarioId: z.string().min(1).optional(),
  })
  .strict()

export const ProductEntrySchema = z
  .object({
    name: z.string().regex(PRODUCT_NAME),
    displayName: z.string().min(1),
    category: ProductCategorySchema,
    artifactKind: z.enum(['machine', 'skin', 'presentational', 'pattern']),
    machine: z.discriminatedUnion('kind', [PublicMachineSchema, MachineFreeSchema]),
    copiedArtifacts: z.array(CopiedArtifactSchema),
    styling: StylingSupportSchema,
    /** Aliases and copied artifacts inherit this canonical profile through resolution. */
    presentation: ProductPresentationSchema,
    scenarioId: z.string().min(1),
  })
  .strict()

export const ProductAliasSchema = z
  .object({
    name: z.string().regex(PRODUCT_NAME),
    canonicalName: z.string().regex(PRODUCT_NAME),
  })
  .strict()

/** Canonical v2 product inventory, including presentation ownership and validated composition. */
export const ProductContractSchema = z
  .object({
    version: z.literal(2),
    entries: z.array(ProductEntrySchema),
    aliases: z.array(ProductAliasSchema),
  })
  .strict()
  .superRefine((contract, context) => {
    const names = new Set<string>()
    const scenarioIds = new Set<string>()
    const machineImports = new Set<string>()
    const copiedArtifactOwners = new Map<string, string>()
    const canonicalEntries = new Map<string, IndexedProductEntry>()

    for (const [entryIndex, entry] of contract.entries.entries()) {
      if (names.has(entry.name)) {
        addIssue(context, `Duplicate canonical identity "${entry.name}".`, ['entries'])
      }
      names.add(entry.name)
      if (!canonicalEntries.has(entry.name)) {
        canonicalEntries.set(entry.name, { entry, index: entryIndex })
      }

      if (scenarioIds.has(entry.scenarioId)) {
        addIssue(context, `Duplicate scenario identity "${entry.scenarioId}".`, ['entries'])
      }
      scenarioIds.add(entry.scenarioId)

      if (entry.machine.kind === 'public') {
        if (machineImports.has(entry.machine.importPath)) {
          addIssue(
            context,
            `Public machine import "${entry.machine.importPath}" is owned by more than one canonical entry.`,
            ['entries'],
          )
        }
        machineImports.add(entry.machine.importPath)
      }

      for (const artifact of entry.copiedArtifacts) {
        const owner = copiedArtifactOwners.get(artifact.name)
        if (owner !== undefined) {
          addIssue(
            context,
            owner === entry.name
              ? `Copied artifact "${artifact.name}" is declared more than once by "${entry.name}".`
              : `Copied artifact "${artifact.name}" is owned by more than one canonical entry.`,
            ['entries'],
          )
        } else {
          copiedArtifactOwners.set(artifact.name, entry.name)
        }
      }

      validateArtifact(entry, context)
      validateStyling(entry, context)
    }

    for (const [entryIndex, entry] of contract.entries.entries()) {
      validatePresentation(entry, entryIndex, canonicalEntries, context)
    }
    validatePresentationCycles(canonicalEntries, context)

    const aliasNames = new Set(contract.aliases.map(({ name }) => name))
    const seenAliases = new Set<string>()
    for (const alias of contract.aliases) {
      if (seenAliases.has(alias.name)) {
        addIssue(context, `Duplicate alias identity "${alias.name}".`, ['aliases'])
      }
      seenAliases.add(alias.name)

      if (names.has(alias.name)) {
        addIssue(context, `Alias "${alias.name}" collides with a canonical identity.`, ['aliases'])
      }

      if (aliasNames.has(alias.canonicalName)) {
        addIssue(
          context,
          `Alias "${alias.name}" targets alias "${alias.canonicalName}"; aliases must target canonical identities directly.`,
          ['aliases'],
        )
      } else if (!names.has(alias.canonicalName)) {
        addIssue(
          context,
          `Alias "${alias.name}" targets unknown canonical identity "${alias.canonicalName}".`,
          ['aliases'],
        )
      } else {
        const owner = copiedArtifactOwners.get(alias.name)
        if (owner === undefined) {
          addIssue(
            context,
            `Alias "${alias.name}" is not a copied artifact of "${alias.canonicalName}".`,
            ['aliases'],
          )
        } else if (owner !== alias.canonicalName) {
          addIssue(
            context,
            `Alias "${alias.name}" is owned by canonical entry "${owner}", not "${alias.canonicalName}".`,
            ['aliases'],
          )
        }
      }
    }
  })

const PRESENTATION_PATHS = ['baseline', 'registryTailwind'] as const
type PresentationPath = (typeof PRESENTATION_PATHS)[number]
type ParsedProductEntry = z.infer<typeof ProductEntrySchema>
type IndexedProductEntry = { entry: ParsedProductEntry; index: number }

function validatePresentation(
  entry: ParsedProductEntry,
  entryIndex: number,
  canonicalEntries: ReadonlyMap<string, IndexedProductEntry>,
  context: z.RefinementCtx,
): void {
  for (const path of PRESENTATION_PATHS) {
    const coverage = entry.presentation[path]
    const ownsStyles = coverage.mode === 'styled' || coverage.mode === 'partial'
    const modePath = presentationModePath(entryIndex, path)

    if (ownsStyles && !entry.styling[path]) {
      addIssue(
        context,
        `Product "${entry.name}" presentation ${path} mode "${coverage.mode}" requires styling.${path} to be true.`,
        modePath,
      )
    }
    if (!ownsStyles && entry.styling[path]) {
      addIssue(
        context,
        `Product "${entry.name}" presentation ${path} mode "${coverage.mode}" requires styling.${path} to be false.`,
        modePath,
      )
    }
    if (coverage.mode === 'styleless' && !entry.styling.styleless) {
      addIssue(
        context,
        `Product "${entry.name}" presentation ${path} is styleless, but styling.styleless is false.`,
        modePath,
      )
    }

    if (coverage.mode === 'styleless' && entry.machine.kind !== 'public') {
      addIssue(
        context,
        `Product "${entry.name}" presentation ${path} mode "styleless" requires machine.kind to be "public".`,
        modePath,
      )
    }
    if (coverage.mode === 'not-applicable' && entry.machine.kind !== 'none') {
      addIssue(
        context,
        `Product "${entry.name}" presentation ${path} mode "not-applicable" requires machine.kind to be "none".`,
        modePath,
      )
    }

    if (coverage.mode !== 'composed') continue

    const seenProducts = new Set<string>()
    for (const [productIndex, product] of coverage.products.entries()) {
      const productPath = presentationProductPath(entryIndex, path, productIndex)
      if (seenProducts.has(product)) {
        addIssue(
          context,
          `Product "${entry.name}" presentation ${path} composes canonical product "${product}" more than once.`,
          productPath,
        )
        continue
      }
      seenProducts.add(product)

      if (product === entry.name) {
        addIssue(
          context,
          `Product "${entry.name}" presentation ${path} cannot compose itself.`,
          productPath,
        )
        continue
      }

      const composedProduct = canonicalEntries.get(product)
      if (composedProduct === undefined) {
        addIssue(
          context,
          `Product "${entry.name}" presentation ${path} references unknown canonical product "${product}".`,
          productPath,
        )
        continue
      }

      if (!isVisuallyAvailable(composedProduct.entry.presentation[path])) {
        addIssue(
          context,
          `Product "${entry.name}" presentation ${path} composes "${product}", whose ${path} coverage is not visually available.`,
          productPath,
        )
      }
    }
  }
}

function presentationModePath(entryIndex: number, path: PresentationPath): readonly PropertyKey[] {
  return ['entries', entryIndex, 'presentation', path, 'mode']
}

function presentationProductPath(
  entryIndex: number,
  path: PresentationPath,
  productIndex: number,
): readonly PropertyKey[] {
  return ['entries', entryIndex, 'presentation', path, 'products', productIndex]
}

function isVisuallyAvailable(coverage: z.infer<typeof PresentationCoverageSchema>): boolean {
  return coverage.mode === 'styled' || coverage.mode === 'partial' || coverage.mode === 'composed'
}

function validatePresentationCycles(
  canonicalEntries: ReadonlyMap<string, IndexedProductEntry>,
  context: z.RefinementCtx,
): void {
  for (const path of PRESENTATION_PATHS) {
    const states = new Map<string, 'visiting' | 'visited'>()
    const stack: string[] = []
    const reportedCycles = new Set<string>()

    const visit = (name: string): void => {
      const state = states.get(name)
      if (state === 'visited') return
      if (state === 'visiting') return

      const indexedEntry = canonicalEntries.get(name)
      if (indexedEntry === undefined || indexedEntry.entry.presentation[path].mode !== 'composed') {
        return
      }

      states.set(name, 'visiting')
      stack.push(name)
      for (const [productIndex, product] of indexedEntry.entry.presentation[
        path
      ].products.entries()) {
        const target = canonicalEntries.get(product)
        if (
          target !== undefined &&
          target.entry.presentation[path].mode === 'composed' &&
          product !== name
        ) {
          if (states.get(product) === 'visiting') {
            const cycleStart = stack.indexOf(product)
            const cycle = [...stack.slice(cycleStart), product]
            const signature = [...new Set(cycle.slice(0, -1))].sort().join('\0')
            if (!reportedCycles.has(signature)) {
              reportedCycles.add(signature)
              addIssue(
                context,
                `Presentation composition cycle on ${path}: ${cycle.join(' -> ')}.`,
                presentationProductPath(indexedEntry.index, path, productIndex),
              )
            }
          } else {
            visit(product)
          }
        }
      }
      stack.pop()
      states.set(name, 'visited')
    }

    for (const name of canonicalEntries.keys()) visit(name)
  }
}

function addIssue(context: z.RefinementCtx, message: string, path: readonly PropertyKey[]): void {
  context.addIssue({ code: 'custom', message, path: [...path] })
}

function validateArtifact(
  entry: z.infer<typeof ProductEntrySchema>,
  context: z.RefinementCtx,
): void {
  if (entry.artifactKind === 'machine' && entry.machine.kind !== 'public') {
    addIssue(context, `Machine "${entry.name}" must reference its public package import.`, [
      'entries',
    ])
  }
  if (entry.artifactKind === 'pattern' && entry.machine.kind !== 'public') {
    addIssue(context, `Pattern "${entry.name}" must reference its public package import.`, [
      'entries',
    ])
  }
  if (
    entry.artifactKind === 'presentational' &&
    (entry.machine.kind !== 'none' || entry.machine.reason !== 'presentational')
  ) {
    addIssue(context, `Presentational item "${entry.name}" must be explicitly machine-free.`, [
      'entries',
    ])
  }
  if (
    (entry.artifactKind === 'presentational' || entry.artifactKind === 'skin') &&
    entry.copiedArtifacts.length === 0
  ) {
    const label = entry.artifactKind === 'presentational' ? 'Presentational item' : 'Skin'
    addIssue(context, `${label} "${entry.name}" must declare at least one copied artifact.`, [
      'entries',
    ])
  }
  if (
    entry.artifactKind === 'skin' &&
    entry.machine.kind === 'none' &&
    entry.machine.reason !== 'application-owned-state'
  ) {
    addIssue(
      context,
      `Interactive skin "${entry.name}" without a public machine must declare application-owned state.`,
      ['entries'],
    )
  }

  const copiedKind =
    entry.artifactKind === 'machine'
      ? 'skin'
      : entry.artifactKind === 'pattern'
        ? 'pattern'
        : entry.artifactKind
  for (const artifact of entry.copiedArtifacts) {
    if (artifact.artifactKind !== copiedKind) {
      addIssue(
        context,
        `Copied artifact "${artifact.name}" is classified as ${artifact.artifactKind}, but product "${entry.name}" requires ${copiedKind}.`,
        ['entries'],
      )
    }
    if (entry.copiedArtifacts.length > 1 && artifact.scenarioId === undefined) {
      addIssue(
        context,
        `Copied artifact "${artifact.name}" in multi-artifact product "${entry.name}" must declare its scenario identity explicitly.`,
        ['entries'],
      )
    }
  }
}

function validateStyling(
  entry: z.infer<typeof ProductEntrySchema>,
  context: z.RefinementCtx,
): void {
  const hasCopiedArtifact = entry.copiedArtifacts.length > 0
  if (entry.styling.registryTailwind && !hasCopiedArtifact) {
    addIssue(
      context,
      `Product "${entry.name}" declares registry/Tailwind support but has no copied artifact.`,
      ['entries'],
    )
  }
  if (!entry.styling.registryTailwind && hasCopiedArtifact) {
    addIssue(
      context,
      `Product "${entry.name}" has a copied artifact but does not declare registry/Tailwind support.`,
      ['entries'],
    )
  }
  if (!entry.styling.baseline && !entry.styling.registryTailwind && !entry.styling.styleless) {
    addIssue(context, `Product "${entry.name}" does not support any styling mode.`, ['entries'])
  }

  for (const artifact of entry.copiedArtifacts) {
    if (!artifact.styling.registryTailwind) {
      addIssue(
        context,
        `Copied artifact "${artifact.name}" must declare registry/Tailwind support.`,
        ['entries'],
      )
    }
    if (
      !artifact.styling.baseline &&
      !artifact.styling.registryTailwind &&
      !artifact.styling.styleless
    ) {
      addIssue(context, `Copied artifact "${artifact.name}" does not support any styling mode.`, [
        'entries',
      ])
    }
  }
}

export type ResolvedProductIdentity = {
  canonical: ProductEntry
  alias?: ProductAlias
}

export type ResolvedCopiedArtifact = {
  canonical: ProductEntry
  artifact: Omit<CopiedArtifact, 'displayName' | 'scenarioId'> & {
    displayName: string
    scenarioId: string
  }
  alias?: ProductAlias
}

export function resolveProductIdentity(
  contract: ProductContract,
  name: string,
): ResolvedProductIdentity | undefined {
  const canonical = contract.entries.find((entry) => entry.name === name)
  if (canonical !== undefined) return { canonical }

  const alias = contract.aliases.find((candidate) => candidate.name === name)
  if (alias === undefined) return undefined
  const aliasTarget = contract.entries.find((entry) => entry.name === alias.canonicalName)
  if (aliasTarget === undefined) return undefined
  return {
    canonical: aliasTarget,
    alias,
  }
}

/** Resolve an `llui add` name without confusing it with an equal package name. */
export function resolveCopiedArtifact(
  contract: ProductContract,
  target: string,
): ResolvedCopiedArtifact | undefined {
  const canonical = contract.entries.find(({ copiedArtifacts }) =>
    copiedArtifacts.some(({ name }) => name === target),
  )
  if (canonical === undefined) return undefined
  const copied = canonical.copiedArtifacts.find(({ name }) => name === target)
  if (copied === undefined) return undefined
  const artifact = {
    ...copied,
    displayName: copied.displayName ?? canonical.displayName,
    scenarioId: copied.scenarioId ?? canonical.scenarioId,
  }
  const alias = contract.aliases.find(({ name }) => name === target)
  return alias === undefined ? { canonical, artifact } : { canonical, artifact, alias }
}

export type StylingSupport = z.infer<typeof StylingSupportSchema>
export type ProductCategory = z.infer<typeof ProductCategorySchema>
export type PresentationFamily = z.infer<typeof PresentationFamilySchema>
export type StyledPresentationCoverage = z.infer<typeof StyledPresentationCoverageSchema>
export type PartialPresentationCoverage = z.infer<typeof PartialPresentationCoverageSchema>
export type ComposedPresentationCoverage = z.infer<typeof ComposedPresentationCoverageSchema>
export type StylelessPresentationCoverage = z.infer<typeof StylelessPresentationCoverageSchema>
export type NotApplicablePresentationCoverage = z.infer<
  typeof NotApplicablePresentationCoverageSchema
>
export type PresentationCoverage = z.infer<typeof PresentationCoverageSchema>
export type ProductPresentation = z.infer<typeof ProductPresentationSchema>
export type PublicMachine = z.infer<typeof PublicMachineSchema>
export type MachineFree = z.infer<typeof MachineFreeSchema>
export type CopiedArtifact = z.infer<typeof CopiedArtifactSchema>
export type ProductEntry = z.infer<typeof ProductEntrySchema>
export type ProductAlias = z.infer<typeof ProductAliasSchema>
export type ProductContract = z.infer<typeof ProductContractSchema>
