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
  onChange?: (markdown: string) => void
  onFormatChange?: (format: FormatState) => void
  /** Push markdown into the live editor (deserialize), without echoing onChange. */
  applyValue: (editor: LexicalEditor, value: string) => void
}

/** Build the component's `onEffect`. `getEditor` returns the live editor (set at
 * mount via the foreign `onReady`); `items` is the merged id → command map. */
export function makeOnEffect(
  getEditor: () => LexicalEditor | null,
  items: ReadonlyMap<string, CommandItem>,
  config: EffectConfig,
): (effect: EditorEffect, api: EffectApi) => void {
  return (effect, api) => {
    switch (effect.type) {
      case 'execCommand': {
        const editor = getEditor()
        const item = items.get(effect.id)
        if (editor && item) item.run(editor, { send: api.send })
        return
      }
      case 'applyValue': {
        const editor = getEditor()
        if (editor) config.applyValue(editor, effect.value)
        return
      }
      case 'emitChange': {
        config.onChange?.(effect.value)
        return
      }
      case 'emitFormat': {
        config.onFormatChange?.(effect.format)
        return
      }
    }
  }
}
