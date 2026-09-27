/**
 * Every presentation family's deterministic scenario catalog, compiled
 * against the canonical contract. This is the ONLY place the gallery learns
 * which cases a product has, and it learns it from the family definitions
 * the renderers and browser suites already share (#263–#266) — never from a
 * list of its own. `compileScenarioFamily` throws on any disagreement between
 * a family's keys and the contract, so a stale catalog cannot load.
 *
 * Shared by the shell and both path documents: it carries contract data and
 * scenario data only, never a renderer.
 */
import type { ProductEntry } from '@llui/cli'
import {
  decodeScenarioFamily,
  type CompiledPresentationScenario,
  type CompiledPresentationScenarioFamily,
} from '@llui/cli/presentation-scenarios'
import { FORMS_CONTROLS_DEFINITIONS } from '../../../../packages/components/test/styles/forms-controls-scenarios'
import { MENUS_OVERLAYS_DEFINITIONS } from '../../../../packages/components/test/styles/menus-overlays-scenarios'
import { NAVIGATION_DATA_DEFINITIONS } from '../../../../packages/components/test/styles/navigation-data-scenarios'
import { SPECIALIZED_TOOLS_DEFINITIONS } from '../../../../packages/components/test/styles/specialized-tools-scenarios'
import { GALLERY_CONTRACT } from './contract'

/**
 * Compiled through `decodeScenarioFamily` — the same validation and join as
 * each family's typed `compile…Catalog`, returning the ERASED catalog shape
 * the gallery works in (it handles every family generically, so the
 * per-scenario literal types would only have to be erased again).
 */
export const GALLERY_CATALOGS: readonly CompiledPresentationScenarioFamily[] = [
  decodeScenarioFamily(GALLERY_CONTRACT, 'forms-controls', FORMS_CONTROLS_DEFINITIONS),
  decodeScenarioFamily(GALLERY_CONTRACT, 'navigation-data', NAVIGATION_DATA_DEFINITIONS),
  decodeScenarioFamily(GALLERY_CONTRACT, 'menus-overlays', MENUS_OVERLAYS_DEFINITIONS),
  decodeScenarioFamily(GALLERY_CONTRACT, 'specialized-tools', SPECIALIZED_TOOLS_DEFINITIONS),
]

const scenarioByProduct = new Map<string, CompiledPresentationScenario>()
const catalogByProduct = new Map<string, CompiledPresentationScenarioFamily>()
for (const catalog of GALLERY_CATALOGS) {
  for (const scenario of catalog.scenarios) {
    scenarioByProduct.set(scenario.productId, scenario)
    catalogByProduct.set(scenario.productId, catalog)
  }
}

/** The compiled scenario (cases, default case) for a canonical product. */
export function scenarioFor(productId: string): CompiledPresentationScenario | undefined {
  return scenarioByProduct.get(productId)
}

/** The compiled family catalog that owns a canonical product. */
export function catalogFor(productId: string): CompiledPresentationScenarioFamily | undefined {
  return catalogByProduct.get(productId)
}

/** A path draws a product only when its coverage is visual on that path. */
export function isVisuallyAvailable(
  mode: ProductEntry['presentation']['baseline']['mode'],
): boolean {
  return mode === 'styled' || mode === 'partial' || mode === 'composed'
}
