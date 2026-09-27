/**
 * The Registry skins document's renderers, one lazy chunk per presentation
 * family. Exported apart from the entry module so the gallery's coverage
 * test can load exactly what the document loads.
 */
import type { PathDocumentOptions } from '../shared/document'
import { eraseAdapters, formsControlsAdapters } from '../shared/adapters'

export const REGISTRY_ADAPTER_LOADERS: PathDocumentOptions['adapters'] = {
  'forms-controls': async () =>
    formsControlsAdapters(
      (await import('../../../../registry/test/forms-controls-scenario-renderer'))
        .REGISTRY_ADAPTERS,
    ),
  'navigation-data': async () =>
    eraseAdapters(
      (await import('../../../../registry/test/navigation-data-scenario-renderer'))
        .REGISTRY_ADAPTERS,
    ),
  'menus-overlays': async () =>
    eraseAdapters(
      (await import('../../../../registry/test/menus-overlays-scenario-renderer'))
        .REGISTRY_ADAPTERS,
    ),
  'specialized-tools': async () =>
    eraseAdapters(
      (await import('../../../../registry/test/specialized-tools-scenario-renderer'))
        .REGISTRY_ADAPTERS,
    ),
}
