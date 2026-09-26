/** Browser-pure structural types for ProductContract and presentation tooling. */

/**
 * Hard cap on a `ProductEntry`'s `name` (which becomes a compiled catalog's `productId`) or its
 * `scenarioId` — the SAME limit `presentation-scenarios.ts`'s `BoundaryDecoder.identifier()`
 * enforces on a serialized catalog's `productId`/`scenarioId` fields, shared from here (a pure,
 * dependency-free module both `product-contract.ts` and `presentation-scenarios.ts` already
 * import from) so the two can never drift apart on what "too long" means. Without this, a
 * contract entry could carry a `name`/`scenarioId` that compiles cleanly — `compiledCatalog`
 * copies these fields into the catalog it builds without decoding them, since a `ProductContract`
 * is caller-trusted, already-validated data, not an untyped boundary — and then FAILS to
 * re-decode the very catalog `compileScenarioFamily` just produced, the moment it is serialized
 * (JSON round trip / `structuredClone`) and handed back through `decodeScenarioSelection`.
 */
export const MAX_PRODUCT_IDENTIFIER_LENGTH = 256

export interface StylingSupport {
  baseline: boolean
  registryTailwind: boolean
  styleless: boolean
}

export type ProductCategory =
  | 'controls'
  | 'forms'
  | 'navigation'
  | 'overlays'
  | 'feedback'
  | 'data-display'
  | 'layout'
  | 'media'
  | 'patterns'
  | 'utilities'

/**
 * Single-owner visual-language cohort, independent of user-facing product category. This is the
 * one canonical tuple: `product-contract.ts` derives `PresentationFamilySchema` from it, and
 * `presentation-scenarios.ts` imports this value directly. That import does not compromise
 * presentation-scenarios.ts's browser-purity contract (no Node/DOM/zod/LLui runtime): THIS module
 * has zero runtime imports of its own, so the import stays transitively pure — the package
 * boundary test asserts both halves (every runtime import from presentation-scenarios.ts
 * resolves only to this file, and this file itself imports nothing). Do not duplicate the
 * literals a second way — extend this tuple only.
 */
export const PRESENTATION_FAMILY_VALUES = [
  'forms-controls',
  'navigation-data',
  'menus-overlays',
  'specialized-tools',
] as const

export type PresentationFamily = (typeof PRESENTATION_FAMILY_VALUES)[number]

export interface StyledPresentationCoverage {
  mode: 'styled'
}

export interface PartialPresentationCoverage {
  mode: 'partial'
  rationale: string
}

export interface ComposedPresentationCoverage {
  mode: 'composed'
  products: string[]
  rationale: string
}

export interface StylelessPresentationCoverage {
  mode: 'styleless'
  rationale: string
}

export interface NotApplicablePresentationCoverage {
  mode: 'not-applicable'
  rationale: string
}

export type PresentationCoverage =
  | StyledPresentationCoverage
  | PartialPresentationCoverage
  | ComposedPresentationCoverage
  | StylelessPresentationCoverage
  | NotApplicablePresentationCoverage

export interface ProductPresentation {
  family: PresentationFamily
  baseline: PresentationCoverage
  registryTailwind: PresentationCoverage
}

export interface PublicMachine {
  kind: 'public'
  importPath: string
}

export interface MachineFree {
  kind: 'none'
  reason: 'presentational' | 'application-owned-state'
}

export interface CopiedArtifact {
  name: string
  displayName?: string
  artifactKind: 'skin' | 'presentational' | 'pattern'
  styling: StylingSupport
  scenarioId?: string
}

export interface ProductEntry {
  name: string
  displayName: string
  category: ProductCategory
  artifactKind: 'machine' | 'skin' | 'presentational' | 'pattern'
  machine: PublicMachine | MachineFree
  copiedArtifacts: CopiedArtifact[]
  styling: StylingSupport
  presentation: ProductPresentation
  scenarioId: string
}

export interface ProductAlias {
  name: string
  canonicalName: string
}

/** Canonical v2 inventory. ProductContract remains the sole product-metadata owner. */
export interface ProductContract {
  version: 2
  entries: ProductEntry[]
  aliases: ProductAlias[]
}
