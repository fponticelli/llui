import { formsControlsCaseInput } from '../../../../packages/components/test/styles/forms-controls-scenarios'
import type { FormsControlsCaseInput } from '../../../../packages/components/test/styles/forms-controls-scenarios'
import type { GalleryAdapter, GalleryAdapterMap, GalleryRenderContext } from './document'

/**
 * Erase one family's typed adapter map to the document's lookup shape.
 *
 * Each family types its map per scenario (`Adapter<AccordionInput>`, …), and
 * a function type is contravariant in its parameters, so no per-scenario
 * adapter is assignable to "takes any case input". The erasure is safe for
 * the one way the document calls it: it looks the adapter up by the
 * `scenarioId` of a selection the protocol RESOLVED against that same
 * family's compiled catalog, whose case inputs are exactly that scenario's
 * definition inputs. This is the single place that relies on that join.
 */
export function eraseAdapters(map: object): GalleryAdapterMap {
  const erased: Record<string, GalleryAdapter> = {}
  for (const [scenarioId, adapter] of Object.entries(map)) {
    if (typeof adapter !== 'function') {
      throw new TypeError(`adapter for ${scenarioId} is not a function`)
    }
    erased[scenarioId] = adapter as GalleryAdapter
  }
  return erased
}

type FormsControlsAdapter = (
  host: HTMLElement,
  input: FormsControlsCaseInput,
  ctx: GalleryRenderContext,
) => { dispose(): void }

/** The forms-controls family decodes its one input shape instead of erasing it. */
export function formsControlsAdapters(
  map: Readonly<Record<string, FormsControlsAdapter>>,
): GalleryAdapterMap {
  return Object.fromEntries(
    Object.entries(map).map(([scenarioId, adapter]): [string, GalleryAdapter] => [
      scenarioId,
      (host, input, ctx) => adapter(host, formsControlsCaseInput(input), ctx),
    ]),
  )
}
