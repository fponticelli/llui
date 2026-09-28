/**
 * Every presentation family's deterministic scenario catalog, compiled
 * against the canonical contract. This is the ONLY place the gallery learns
 * which cases a product has, and it learns it from the family definitions
 * the renderers and browser suites already share (#263–#266) — never from a
 * list of its own. Each family's `compile…Catalog` goes through
 * `compileScenarioFamily`, which throws on any disagreement between a
 * family's keys and the contract, so a stale catalog cannot load.
 *
 * Shared by the shell and both path documents: it carries contract data and
 * scenario data only, never a renderer.
 */
import type { ProductEntry } from '@llui/cli'
import type {
  CompiledPresentationScenario,
  CompiledPresentationScenarioFamily,
} from '@llui/cli/presentation-scenarios'
import { compileFormsControlsCatalog } from '../../../../packages/components/test/styles/forms-controls-scenarios'
import { compileMenusOverlaysCatalog } from '../../../../packages/components/test/styles/menus-overlays-scenarios'
import { compileNavigationDataCatalog } from '../../../../packages/components/test/styles/navigation-data-scenarios'
import { compileSpecializedToolsCatalog } from '../../../../packages/components/test/styles/specialized-tools-scenarios'
import { GALLERY_CONTRACT } from './contract'

/**
 * The families' own TYPED catalogs, held as the ERASED catalog type with no
 * cast: every typed catalog is a subtype of `CompiledPresentationScenarioFamily`
 * (pinned by `packages/cli/test/presentation-scenarios-erasure-types.ts`). The
 * gallery handles every family generically, so it reads them through the
 * erased shape; the definitions are in-repo typed modules, not serialized
 * input, so there is nothing for `decodeScenarioFamily` to decode here — and
 * the runtime validation and contract join are the same either way.
 */
export const GALLERY_CATALOGS: readonly CompiledPresentationScenarioFamily[] = [
  compileFormsControlsCatalog(GALLERY_CONTRACT),
  compileNavigationDataCatalog(GALLERY_CONTRACT),
  compileMenusOverlaysCatalog(GALLERY_CONTRACT),
  compileSpecializedToolsCatalog(GALLERY_CONTRACT),
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
