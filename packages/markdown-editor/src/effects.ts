// Effect handler: the only place TEA reaches back into the live Lexical editor.
// `execCommand` looks an id up in the merged command-item map and runs it on the
// editor captured at mount; emit* forward to the consumer's callbacks.

import type { LexicalEditor } from 'lexical'
import type { ForeignController } from '@llui/lexical'
import type { CommandItem } from './plugins/types.js'
import type { EditorEffect, EditorMsg, FormatState } from './state.js'

/** The api the component passes to `onEffect` (send + state). */
export interface EffectApi {
  send: (msg: EditorMsg) => void
}

/** One mount's live seam refs, captured by that mount's `onReady`: the editor
 * commands run against, and the seam controller that owns the single inbound
 * write path for the value. Both are null before `onReady` and after that mount
 * is torn down.
 *
 * There is deliberately NO remembered value here — the seam is the sole
 * authority on whether a value is an echo, in both directions (issue #70), so
 * this layer has nothing to compare against. */
export interface MountRefs {
  editor: LexicalEditor | null
  controller: ForeignController | null
}

export interface EffectConfig {
  onFormatChange?: (format: FormatState) => void
}

/** Build the component's `onEffect`. `resolveMount` maps the per-mount effect
 * `api` (whose `send` identifies the mount) to that mount's live seam refs — so
 * two mounts of one definition dispatch to their own editors; `items` is the
 * merged id → command map. */
export function makeOnEffect(
  resolveMount: (api: EffectApi) => MountRefs,
  items: ReadonlyMap<string, CommandItem>,
  config: EffectConfig,
): (effect: EditorEffect, api: EffectApi) => void {
  return (effect, api) => {
    switch (effect.type) {
      case 'execCommand': {
        const { editor } = resolveMount(api)
        const item = items.get(effect.id)
        if (editor && item) item.run(editor, { send: api.send })
        return
      }
      case 'applyValue': {
        // Hand the value to the seam and let it decide. This layer deliberately
        // knows neither how to write markdown into the document nor whether the
        // value is an echo — both belong to the seam (issue #70).
        //
        // Report the seam's ACTUAL decision back so `state.dirty` can follow the
        // document instead of the push. No controller means no live editor for
        // this mount (before `onReady`, or after teardown), which is a write that
        // did not happen — the same answer, from the same authority's absence.
        const applied = resolveMount(api).controller?.applyValue(effect.value) ?? false
        api.send({ type: 'valueApplied', applied })
        return
      }
      case 'emitChange': {
        // Consumer `onChange` delivery moved to the foreign onChange wrapper (see
        // editor.ts) so it survives dispose — the loop is torn down before the
        // dispose-time debounce flush runs, and a `send`-routed effect would be
        // dropped. This effect now only signals that state changed; no side effect.
        return
      }
      case 'emitFormat': {
        config.onFormatChange?.(effect.format)
        return
      }
    }
  }
}
