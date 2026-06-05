// `markdownEditor(config)` — the high-level component. Lexical owns the live
// document; this wires the foreign seam to the markdown transformer converters,
// surfaces the format state for the chrome, routes command intents back to the
// live editor through effects, and COMPOSES plugin UI extensions (each plugin's
// state slice + reducer + view + effects) into the single component.

import { $getRoot, $setSelection, type EditorThemeClasses, type LexicalEditor } from 'lexical'
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
import { linkPlugin } from './plugins/link.js'
import { toolbar as renderToolbar } from './surfaces/toolbar.js'
import type { CommandItem, MarkdownPlugin } from './plugins/types.js'
import type { PluginUI } from './plugins/ui.js'
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
   * Defaults to `[corePlugin(), linkPlugin()]` so the minimal editor has GFM + links. */
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

/** Default plugin set when the consumer supplies none. */
function defaultPlugins(): MarkdownPlugin[] {
  return [corePlugin(), linkPlugin()]
}

/**
 * Build the markdown editor component. Embed it with `mountApp(el, markdownEditor(...))`
 * or compose it inside a larger component.
 */
export function markdownEditor(
  config: EditorConfig = {},
): SignalComponentDef<EditorState, EditorMsg, EditorEffect> {
  const plugins = config.plugins && config.plugins.length > 0 ? config.plugins : defaultPlugins()
  const transformers = buildTransformers(plugins)

  const items: CommandItem[] = plugins.flatMap((p) => p.items ?? [])
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const decorators: DecoratorBridge[] = plugins.flatMap((p) => p.decorators ?? [])
  const pluginUIs: Array<{ name: string; ui: PluginUI }> = plugins
    .filter((p): p is MarkdownPlugin & { ui: PluginUI } => p.ui !== undefined)
    .map((p) => ({ name: p.name, ui: p.ui }))
  const pluginUIByName = new Map(pluginUIs.map((p) => [p.name, p.ui]))

  // The live editor, captured at mount; effects dispatch through it.
  let editorRef: LexicalEditor | null = null
  const getEditor = (): LexicalEditor | null => editorRef

  const baseOnEffect = makeOnEffect(getEditor, itemsById, {
    onChange: config.onChange,
    onFormatChange: config.onFormatChange,
    applyValue: (editor, value) =>
      editor.update(
        () => {
          $convertFromMarkdownString(value, transformers)
          // Clear selection so the reconciler doesn't pull DOM focus into the
          // editor on an external push (e.g. typing in a bound source textarea).
          $setSelection(null)
        },
        { tag: PROGRAMMATIC_TAG },
      ),
  })

  const seedValue = config.value ? config.value.peek() : (config.defaultValue ?? '')

  // ── Composed TEA: core + plugin UI slices ──────────────────────────────────
  const composedInit = (): [EditorState, EditorEffect[]] => {
    const [core, effects] = init({ value: seedValue, readOnly: config.readOnly ?? false })
    const slices: Record<string, unknown> = {}
    for (const { name, ui } of pluginUIs) slices[name] = ui.init()
    return [{ ...core, plugins: slices }, effects]
  }

  const composedUpdate = (state: EditorState, msg: EditorMsg): [EditorState, EditorEffect[]] => {
    if (msg.type === 'plugin') {
      const ui = pluginUIByName.get(msg.name)
      if (!ui?.update) return [state, []]
      const result = ui.update(state.plugins[msg.name], msg.msg)
      const [slice, effects] = (Array.isArray(result) ? result : [result, []]) as [
        unknown,
        unknown[],
      ]
      return [
        { ...state, plugins: { ...state.plugins, [msg.name]: slice } },
        effects.map((effect) => ({ type: 'pluginEffect' as const, name: msg.name, effect })),
      ]
    }
    return update(state, msg)
  }

  const composedOnEffect = (
    effect: EditorEffect,
    api: { send: (msg: EditorMsg) => void; state: Signal<EditorState> },
  ): void => {
    if (effect.type === 'pluginEffect') {
      const ui = pluginUIByName.get(effect.name)
      ui?.onEffect?.(effect.effect, {
        editor: getEditor,
        send: (msg) => api.send({ type: 'plugin', name: effect.name, msg }),
      })
      return
    }
    baseOnEffect(effect, api)
  }

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
      deserialize: (_editor, value) => {
        $convertFromMarkdownString(value, transformers)
        $setSelection(null)
      },
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

    // Plugin view contributions (overlays/panels) — each gets its own slice + send.
    const pluginViews: Renderable = pluginUIs.flatMap(({ name, ui }) => {
      if (!ui.view) return []
      const rendered = ui.view({
        state: state.at(`plugins.${name}`),
        send: (msg) => send({ type: 'plugin', name, msg }),
        editor: getEditor,
      })
      return Array.isArray(rendered) ? rendered : [rendered]
    })

    if (!config.toolbar) return [host, ...pluginViews]
    return [
      div({ 'data-scope': 'md-editor', 'data-part': 'root' }, [
        renderToolbar({ format: state.at('format'), send, items }),
        div({ 'data-scope': 'md-editor', 'data-part': 'surface' }, [host]),
      ]),
      ...pluginViews,
    ]
  }

  return component<EditorState, EditorMsg, EditorEffect>({
    name: 'MarkdownEditor',
    init: composedInit,
    update: composedUpdate,
    view,
    onEffect: composedOnEffect,
  })
}
