/**
 * The Baseline theme document's renderers, one lazy chunk per presentation
 * family. Exported apart from the entry module so the gallery's coverage
 * test can load exactly what the document loads.
 */
import type { PathDocumentOptions } from '../shared/document'
import { eraseAdapters, formsControlsAdapters } from '../shared/adapters'

export const BASELINE_ADAPTER_LOADERS: PathDocumentOptions['adapters'] = {
  'forms-controls': async () =>
    formsControlsAdapters(
      (await import('../../../../packages/components/test/styles/forms-controls-baseline-renderer'))
        .BASELINE_ADAPTERS,
    ),
  'navigation-data': async () =>
    eraseAdapters(
      (
        await import('../../../../packages/components/test/styles/navigation-data-baseline-renderer')
      ).BASELINE_ADAPTERS,
    ),
  'menus-overlays': async () =>
    eraseAdapters(
      (await import('../../../../packages/components/test/styles/menus-overlays-baseline-renderer'))
        .BASELINE_ADAPTERS,
    ),
  'specialized-tools': async () =>
    eraseAdapters(
      (
        await import('../../../../packages/components/test/styles/specialized-tools-baseline-renderer')
      ).BASELINE_ADAPTERS,
    ),
}
