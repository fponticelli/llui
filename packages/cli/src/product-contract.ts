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
    scenarioId: z.string().min(1),
  })
  .strict()

export const ProductAliasSchema = z
  .object({
    name: z.string().regex(PRODUCT_NAME),
    canonicalName: z.string().regex(PRODUCT_NAME),
  })
  .strict()

export const ProductContractSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(ProductEntrySchema),
    aliases: z.array(ProductAliasSchema),
  })
  .strict()
  .superRefine((contract, context) => {
    const names = new Set<string>()
    const scenarioIds = new Set<string>()
    const machineImports = new Set<string>()
    const copiedArtifactOwners = new Map<string, string>()

    for (const entry of contract.entries) {
      if (names.has(entry.name)) {
        addIssue(context, `Duplicate canonical identity "${entry.name}".`, ['entries'])
      }
      names.add(entry.name)

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
export type PublicMachine = z.infer<typeof PublicMachineSchema>
export type MachineFree = z.infer<typeof MachineFreeSchema>
export type CopiedArtifact = z.infer<typeof CopiedArtifactSchema>
export type ProductEntry = z.infer<typeof ProductEntrySchema>
export type ProductAlias = z.infer<typeof ProductAliasSchema>
export type ProductContract = z.infer<typeof ProductContractSchema>
