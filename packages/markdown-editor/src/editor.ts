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
import { registerMarkdownPaste } from './paste.js'
import { toolbar as renderToolbar } from './surfaces/toolbar.js'
import type { CommandItem, MarkdownPlugin } from './plugins/types.js'
import type { PluginUI } from './plugins/ui.js'
import { buildTransformers } from './transformers/registry.js'
import { mergeTheme } from './theme.js'
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
  readonly?: boolean
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
  /** Convert plain-text Markdown to rich content on paste. Default true.
   * Pastes that carry `text/html` are always left to Lexical's HTML import,
   * regardless of this flag. Set false to paste Markdown as literal text. */
  pasteMarkdown?: boolean
  /** Enable collaborative editing. The editor hands you a markdown `seed` and
   * status sinks; return a binding (build it with `yjsCollab` from
   * `@llui/lexical-collab`, wiring your own provider). Mutually exclusive with
   * `value` — the shared CRDT document, not a markdown signal, owns the content.
   * `defaultValue` becomes the seed the bootstrapping peer writes. */
  collab?: CollabFactory
}

/** Disposer-returning binding the collab layer installs on the live editor.
 * `@llui/lexical-collab`'s `YjsCollab` satisfies this structurally, so
 * `@llui/markdown-editor` needs no Yjs dependency of its own. */
export interface CollabBinding {
  register: (editor: LexicalEditor) => () => void
}

/** Hooks the editor injects into the {@link CollabFactory}: a markdown `seed`
 * (run once by the bootstrapping peer to fill an empty shared doc from
 * `defaultValue`) plus status sinks the editor mirrors into `state.collab`.
 * Spread straight into `yjsCollab({ id, provider, user, ...hooks })`. */
export interface CollabHooks {
  seed: (editor: LexicalEditor) => void
  onStatus: (connected: boolean) => void
  onSync: (synced: boolean) => void
  onPeers: (count: number) => void
}

/** Builds the collab binding from the editor-supplied hooks. */
export type CollabFactory = (hooks: CollabHooks) => CollabBinding

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
  // Share the merged item list with plugins that want it (e.g. the slash menu).
  for (const plugin of plugins) plugin.onItems?.(items)
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

  if (config.collab && config.value) {
    throw new Error(
      'markdownEditor: `collab` and `value` are mutually exclusive — in a collaborative ' +
        'session the shared CRDT document owns the content, not a markdown signal. ' +
        'Use `defaultValue` as the bootstrap seed instead.',
    )
  }

  const collabEnabled = !!config.collab
  const seedValue = config.value ? config.value.peek() : (config.defaultValue ?? '')

  // ── Composed TEA: core + plugin UI slices ──────────────────────────────────
  const composedInit = (): [EditorState, EditorEffect[]] => {
    const [core, effects] = init({
      value: seedValue,
      readonly: config.readonly ?? false,
      collab: collabEnabled,
    })
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
        emit: (msg) => api.send(msg as EditorMsg),
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
    // Build the collab binding (once, at mount) from the consumer's factory,
    // injecting the markdown seed + status sinks that mirror into `state.collab`.
    const collabBinding: CollabBinding | null = config.collab
      ? config.collab({
          seed: () => {
            $convertFromMarkdownString(seedValue, transformers)
            $setSelection(null)
          },
          onStatus: (connected) => send({ type: 'collabStatus', connected }),
          onSync: (synced) => send({ type: 'collabSync', synced }),
          onPeers: (peers) => send({ type: 'collabPeers', peers }),
        })
      : null

    const host = lexicalForeign<EditorOutMsg>({
      namespace: config.namespace ?? 'llui-markdown',
      theme: mergeTheme(config.theme),
      plugins,
      serialize: (editor) =>
        editor.getEditorState().read(() => $convertToMarkdownString(transformers)),
      deserialize: (_editor, value) => {
        $convertFromMarkdownString(value, transformers)
        $setSelection(null)
      },
      // In collab mode the shared CRDT owns the document: the local undo stack
      // and the boot-time seed are disabled — the binding supplies a scoped undo
      // manager and a sync-gated bootstrap instead.
      ...(collabBinding ? { history: false, seedMode: 'deferred' as const } : {}),
      defaultValue: collabBinding || config.value ? undefined : (config.defaultValue ?? ''),
      ...(config.value && !collabBinding ? { value: config.value } : {}),
      readonly: state.at('readonly'),
      ...(config.changeDebounceMs !== undefined
        ? { changeDebounceMs: config.changeDebounceMs }
        : {}),
      register: (editor) => {
        const disposers = [registerMarkdownShortcuts(editor, transformers)]
        if (config.pasteMarkdown !== false)
          disposers.push(registerMarkdownPaste(editor, transformers))
        if (decorators.length > 0) disposers.push(registerDecoratorBridges(editor, decorators))
        if (collabBinding) disposers.push(collabBinding.register(editor))
        return () => {
          for (const dispose of disposers) dispose()
        }
      },
      onReady: (editor) => {
        editorRef = editor
        if (config.placeholder) {
          editor.getRootElement()?.setAttribute('data-placeholder', config.placeholder)
        }
        config.onReady?.(editor)
      },
      onChange: (value) => send({ type: 'markdownChanged', value }),
      onSelectionChange: (ctx) => {
        const format = computeFormatState(ctx.editor, ctx)
        const text = ctx.editor.getEditorState().read(() => $getRoot().getTextContent())
        // Toggle an empty marker so CSS can show the placeholder.
        ctx.editor.getRootElement()?.setAttribute('data-empty', text === '' ? 'true' : 'false')
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
        renderToolbar({ format: state.at('format'), send, items, collab: state.at('collab') }),
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
