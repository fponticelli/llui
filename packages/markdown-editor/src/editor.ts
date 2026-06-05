// `markdownEditor(config)` — the high-level component. Lexical owns the live
// document; this wires the foreign seam to the markdown transformer converters,
// surfaces the format state for the chrome, and routes command intents back to
// the live editor through effects.

import { $getRoot, type EditorThemeClasses, type LexicalEditor } from 'lexical'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  registerMarkdownShortcuts,
} from '@lexical/markdown'
import { component, div, type Renderable, type Signal, type SignalComponentDef } from '@llui/dom'
import {
  lexicalForeign,
  registerDecoratorBridges,
  PROGRAMMATIC_TAG,
  type DecoratorBridge,
} from '@llui/lexical'
import { corePlugin } from './plugins/core.js'
import { toolbar as renderToolbar } from './surfaces/toolbar.js'
import type { CommandItem, MarkdownPlugin } from './plugins/types.js'
import { buildTransformers } from './transformers/registry.js'
import { computeFormatState } from './format.js'
import { makeOnEffect } from './effects.js'
import {
  countWords,
  init,
  update,
  type EditorEffect,
  type EditorMsg,
  type EditorOutMsg,
  type EditorState,
  type FormatState,
} from './state.js'

export interface EditorConfig {
  /** Plugins composing the feature set; order defines transformer precedence.
   * Defaults to `[corePlugin()]` so the minimal editor still has full GFM. */
  plugins?: readonly MarkdownPlugin[]
  /** Initial markdown (uncontrolled seed). */
  defaultValue?: string
  /** Controlled: the consumer owns this signal; the editor follows it. */
  value?: Signal<string>
  /** Debounced markdown-emission window (ms). Default 300. */
  changeDebounceMs?: number
  placeholder?: string
  readOnly?: boolean
  /** Lexical theme class map. */
  theme?: EditorThemeClasses
  /** Editor namespace (instance isolation). */
  namespace?: string
  /** Outbound markdown (after debounce). */
  onChange?: (markdown: string) => void
  /** Outbound format surface (for chrome built outside this package). */
  onFormatChange?: (format: FormatState) => void
  /** Receives the live Lexical editor at mount (imperative access, collab hooks). */
  onReady?: (editor: LexicalEditor) => void
  /** Render the built-in toolbar above the editor. Default false (minimal). */
  toolbar?: boolean
}

/** Hooks the chrome layer (toolbar/menus) uses to compose around the editor. */
export interface EditorParts {
  /** The merged, surface-filtered command items. */
  items: readonly CommandItem[]
  /** Reactive format signal for `connect`-style toolbars. */
  format: Signal<FormatState>
}

/**
 * Build the markdown editor component. Embed it with `mountApp(el, markdownEditor(...))`
 * or compose it inside a larger component.
 */
export function markdownEditor(
  config: EditorConfig = {},
): SignalComponentDef<EditorState, EditorMsg, EditorEffect> {
  const plugins = config.plugins && config.plugins.length > 0 ? config.plugins : [corePlugin()]
  const transformers = buildTransformers(plugins)

  const items: CommandItem[] = plugins.flatMap((p) => p.items ?? [])
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const decorators: DecoratorBridge[] = plugins.flatMap((p) => p.decorators ?? [])

  // The live editor, captured at mount; effects dispatch through it.
  let editorRef: LexicalEditor | null = null

  const onEffect = makeOnEffect(() => editorRef, itemsById, {
    onChange: config.onChange,
    onFormatChange: config.onFormatChange,
    applyValue: (editor, value) =>
      editor.update(() => $convertFromMarkdownString(value, transformers), {
        tag: PROGRAMMATIC_TAG,
      }),
  })

  const seedValue = config.value ? config.value.peek() : (config.defaultValue ?? '')

  const view = ({
    state,
    send,
  }: {
    state: Signal<EditorState>
    send: (msg: EditorMsg) => void
  }): Renderable => {
    const host = lexicalForeign<EditorOutMsg>({
      namespace: config.namespace ?? 'llui-markdown',
      theme: config.theme,
      plugins,
      serialize: (editor) =>
        editor.getEditorState().read(() => $convertToMarkdownString(transformers)),
      deserialize: (_editor, value) => $convertFromMarkdownString(value, transformers),
      defaultValue: config.value ? undefined : (config.defaultValue ?? ''),
      ...(config.value ? { value: config.value } : {}),
      readOnly: state.at('readOnly'),
      ...(config.changeDebounceMs !== undefined
        ? { changeDebounceMs: config.changeDebounceMs }
        : {}),
      register: (editor) => {
        const disposers = [registerMarkdownShortcuts(editor, transformers)]
        if (decorators.length > 0) disposers.push(registerDecoratorBridges(editor, decorators))
        return () => {
          for (const dispose of disposers) dispose()
        }
      },
      onReady: (editor) => {
        editorRef = editor
        config.onReady?.(editor)
      },
      onChange: (value) => send({ type: 'markdownChanged', value }),
      onSelectionChange: (ctx) => {
        const format = computeFormatState(ctx.editor, ctx)
        const text = ctx.editor.getEditorState().read(() => $getRoot().getTextContent())
        send({ type: 'formatChanged', format, wordCount: countWords(text), charCount: text.length })
      },
      emit: (msg) => send(msg),
    })
    if (!config.toolbar) return [host]
    return [
      div({ 'data-scope': 'md-editor', 'data-part': 'root' }, [
        renderToolbar({ format: state.at('format'), send, items }),
        div({ 'data-scope': 'md-editor', 'data-part': 'surface' }, [host]),
      ]),
    ]
  }

  return component<EditorState, EditorMsg, EditorEffect>({
    name: 'MarkdownEditor',
    init: () => init({ value: seedValue, readOnly: config.readOnly ?? false }),
    update,
    view,
    onEffect,
  })
}
