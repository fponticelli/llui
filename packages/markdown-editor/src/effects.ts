// Effect handler: the only place TEA reaches back into the live Lexical editor.
// `execCommand` looks an id up in the merged command-item map and runs it on the
// editor captured at mount; emit* forward to the consumer's callbacks.

import type { LexicalEditor } from 'lexical'
import type { CommandItem } from './plugins/types.js'
import type { EditorEffect, EditorMsg, FormatState } from './state.js'

/** The api the component passes to `onEffect` (send + state). */
export interface EffectApi {
  send: (msg: EditorMsg) => void
}

export interface EffectConfig {
  onFormatChange?: (format: FormatState) => void
  /** Push markdown into the live editor (deserialize), without echoing onChange. */
  applyValue: (editor: LexicalEditor, value: string) => void
}

/** Build the component's `onEffect`. `resolveEditor` maps the per-mount effect
 * `api` (whose `send` identifies the mount) to that mount's live editor — so two
 * mounts of one definition dispatch to their own editors; `items` is the merged
 * id → command map. */
export function makeOnEffect(
  resolveEditor: (api: EffectApi) => LexicalEditor | null,
  items: ReadonlyMap<string, CommandItem>,
  config: EffectConfig,
): (effect: EditorEffect, api: EffectApi) => void {
  return (effect, api) => {
    switch (effect.type) {
      case 'execCommand': {
        const editor = resolveEditor(api)
        const item = items.get(effect.id)
        if (editor && item) item.run(editor, { send: api.send })
        return
      }
      case 'applyValue': {
        const editor = resolveEditor(api)
        if (editor) config.applyValue(editor, effect.value)
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
