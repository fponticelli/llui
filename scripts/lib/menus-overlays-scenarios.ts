import type { ProductContract, ProductEntry } from '../../packages/cli/src/product-contract.js'

export const MENUS_OVERLAYS_ENVIRONMENTS = [
  'light',
  'dark',
  'rtl',
  'narrow',
  'reduced-motion',
  'forced-colors',
] as const

export type MenusOverlaysEnvironment = (typeof MENUS_OVERLAYS_ENVIRONMENTS)[number]

export interface MenusOverlaysScenario {
  /** Stable canonical ProductContract identity. */
  readonly productId: string
  /** Stable scenario identity shared by independent renderers. */
  readonly scenarioId: string
  readonly displayName: string
  readonly artifactKind: ProductEntry['artifactKind']
  readonly machineImport: string | null
  readonly presentation: ProductEntry['presentation']
  readonly copiedArtifacts: readonly {
    readonly name: string
    readonly scenarioId: string
  }[]
}

export interface MenusOverlaysScenarioSet {
  readonly family: 'menus-overlays'
  readonly environments: readonly MenusOverlaysEnvironment[]
  /** Canonical registry order for deterministic gallery navigation. */
  readonly productIds: readonly string[]
  /** Exact lookup for renderer-independent baseline/registry grouping. */
  readonly byProductId: Readonly<Record<string, MenusOverlaysScenario>>
}

/**
 * Project the canonical ProductContract into the menus/overlays family.
 *
 * This intentionally accepts the validated contract rather than owning names,
 * modes, or copied-artifact relationships. A demo renderer chooses the
 * component-appropriate states; this module owns only exact family selection,
 * stable identity, and the environment matrix every renderer shares.
 */
export function menusOverlaysScenarios(contract: ProductContract): MenusOverlaysScenarioSet {
  const scenarios = contract.entries
    .filter((entry) => entry.presentation.family === 'menus-overlays')
    .map(
      (entry): MenusOverlaysScenario => ({
        productId: entry.name,
        scenarioId: entry.scenarioId,
        displayName: entry.displayName,
        artifactKind: entry.artifactKind,
        machineImport: entry.machine.kind === 'public' ? entry.machine.importPath : null,
        presentation: entry.presentation,
        copiedArtifacts: entry.copiedArtifacts.map((artifact) => ({
          name: artifact.name,
          scenarioId: artifact.scenarioId ?? entry.scenarioId,
        })),
      }),
    )

  return {
    family: 'menus-overlays',
    environments: MENUS_OVERLAYS_ENVIRONMENTS,
    productIds: scenarios.map(({ productId }) => productId),
    byProductId: Object.fromEntries(scenarios.map((scenario) => [scenario.productId, scenario])),
  }
}
