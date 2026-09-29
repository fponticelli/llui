import { formsControlsCaseInput } from '../../../../packages/components/test/styles/forms-controls-scenarios'
import type { FormsControlsCaseInput } from '../../../../packages/components/test/styles/forms-controls-scenarios'
import type { PresentationScenarioJsonSnapshot } from '@llui/cli/presentation-scenarios'
import type { GalleryRenderContext } from './document'

type FormsControlsAdapter = (
  host: HTMLElement,
  input: FormsControlsCaseInput,
  ctx: GalleryRenderContext,
) => { dispose(): void }

type DecodingAdapter = (
  host: HTMLElement,
  input: PresentationScenarioJsonSnapshot,
  ctx: GalleryRenderContext,
) => { dispose(): void }

/**
 * The forms-controls family's definitions are DERIVED (string-keyed), so its
 * catalog is the erased one and its adapters take one decoded input shape:
 * each is wrapped to decode the case input through `formsControlsCaseInput`
 * (which fails loudly on a malformed one) instead of trusting it.
 */
export function formsControlsAdapters(
  map: Readonly<Record<string, FormsControlsAdapter>>,
): Readonly<Record<string, DecodingAdapter>> {
  return Object.fromEntries(
    Object.entries(map).map(([scenarioId, adapter]): [string, DecodingAdapter] => [
      scenarioId,
      (host, input, ctx) => adapter(host, formsControlsCaseInput(input), ctx),
    ]),
  )
}
