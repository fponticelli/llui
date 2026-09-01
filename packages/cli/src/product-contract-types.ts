/** Browser-pure structural types for ProductContract and presentation tooling. */

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

/** Single-owner visual-language cohort, independent of user-facing product category. */
export type PresentationFamily =
  | 'forms-controls'
  | 'navigation-data'
  | 'menus-overlays'
  | 'specialized-tools'

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
