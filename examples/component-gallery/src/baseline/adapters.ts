/**
 * The Baseline theme document's renderers, one lazy chunk per presentation
 * family. Exported apart from the entry module so the gallery's coverage
 * test can load exactly what the document loads.
 *
 * Each loader binds the family's TYPED adapter map to its TYPED catalog
 * (`bindScenarioAdapters`): that is where every adapter is checked against
 * its own scenario's case inputs, and the binding it returns is the
 * family-agnostic shape the document dispatches through — no erasing cast.
 */
import { bindScenarioAdapters } from '@llui/cli/presentation-scenarios'
import type { PathDocumentOptions } from '../shared/document'
import { formsControlsAdapters } from '../shared/adapters'
import {
  FORMS_CONTROLS_CATALOG,
  MENUS_OVERLAYS_CATALOG,
  NAVIGATION_DATA_CATALOG,
  SPECIALIZED_TOOLS_CATALOG,
} from '../shared/catalogs'

export const BASELINE_ADAPTER_LOADERS: PathDocumentOptions['adapters'] = {
  'forms-controls': async () =>
    bindScenarioAdapters(
      FORMS_CONTROLS_CATALOG,
      formsControlsAdapters(
        (
          await import('../../../../packages/components/test/styles/forms-controls-baseline-renderer')
        ).BASELINE_ADAPTERS,
      ),
    ),
  'navigation-data': async () =>
    bindScenarioAdapters(
      NAVIGATION_DATA_CATALOG,
      (
        await import('../../../../packages/components/test/styles/navigation-data-baseline-renderer')
      ).BASELINE_ADAPTERS,
    ),
  'menus-overlays': async () =>
    bindScenarioAdapters(
      MENUS_OVERLAYS_CATALOG,
      (await import('../../../../packages/components/test/styles/menus-overlays-baseline-renderer'))
        .BASELINE_ADAPTERS,
    ),
  'specialized-tools': async () =>
    bindScenarioAdapters(
      SPECIALIZED_TOOLS_CATALOG,
      (
        await import('../../../../packages/components/test/styles/specialized-tools-baseline-renderer')
      ).BASELINE_ADAPTERS,
    ),
}
