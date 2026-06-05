// The load-bearing seam: mount a Lexical editor inside an LLui view via
// `foreign()`. Lexical owns the contentEditable subtree; LLui owns the chrome.
//
// Inbound (controlled): a `value` signal drives the document, echo-suppressed so
// the editor never fights its own emissions. Outbound: a debounced
// update-listener serializes the document and a synchronous one surfaces the
// selection/format. Serialize/deserialize are injected so this stays
// markdown-agnostic — the markdown layer supplies the transformer converters.

import {
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  createEditor,
  type EditorThemeClasses,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { registerRichText } from '@lexical/rich-text'
import { registerHistory, createEmptyHistoryState } from '@lexical/history'
import { mergeRegister } from '@lexical/utils'
import { foreign, type Mountable, type Signal } from '@llui/dom'
import type { LexicalPlugin, PluginContext } from './plugin.js'
import { registerShortcuts } from './register.js'

/** Lexical update tag marking a programmatic write (seed / controlled setValue),
 * so the outbound change listener doesn't echo it back to the host. */
export const PROGRAMMATIC_TAG = '@llui/lexical:programmatic'

/** Context handed to the selection callback on every commit. */
export interface SelectionContext {
  editor: LexicalEditor
  canUndo: boolean
  canRedo: boolean
}

export interface LexicalForeignOptions<Emit = unknown> {
  /** Editor namespace (instance isolation; required for distinct editors). */
  namespace: string
  theme?: EditorThemeClasses
  /** Node classes registered in addition to the plugins' own nodes. */
  nodes?: ReadonlyArray<Klass<LexicalNode>>
  /** Plugins: their `nodes` are merged, `register`/`shortcuts` wired at mount. */
  plugins?: ReadonlyArray<LexicalPlugin<Emit>>
  /** Serialize the live document → string (runs in a read context). */
  serialize: (editor: LexicalEditor) => string
  /** Deserialize a string into the document (runs in an update context). */
  deserialize: (editor: LexicalEditor, value: string) => void
  /** Initial document (uncontrolled) — ignored when `value` is provided. */
  defaultValue?: string
  /** Controlled document signal; the editor follows it (echo-guarded). */
  value?: Signal<string>
  /** Reactive read-only flag (always supplied by the host's state). */
  readOnly: Signal<boolean>
  /** Debounce window (ms) for outbound serialization. Default 300. */
  changeDebounceMs?: number
  /** Outbound: serialized document changed (debounced, real edits only). */
  onChange?: (value: string) => void
  /** Outbound: selection / format / structure changed (every commit). */
  onSelectionChange?: (ctx: SelectionContext) => void
  /** Host emit, handed to each plugin's `register` context. */
  emit?: (msg: Emit) => void
  /** Receives the live editor at mount (host dispatches commands through it). */
  onReady?: (editor: LexicalEditor) => void
  /** Extra registration after rich-text (e.g. markdown shortcuts). Disposer. */
  register?: (editor: LexicalEditor) => () => void
  onError?: (error: Error) => void
}

/** The booted editor + echo-guard accessors, shared by both control modes. */
interface BootResult {
  editor: LexicalEditor
  getLastEmitted: () => string
  setLastEmitted: (value: string) => void
  /** Tear down listeners, history, plugins, and the pending debounce timer. */
  dispose: () => void
}

/** The `foreign` instance — only a disposer is needed at unmount. */
interface ForeignInst {
  dispose: () => void
}

/** Mount Lexical into an LLui view. Returns a `Mountable` placed in the view
 * array; Lexical is created on mount and destroyed on the component's dispose. */
export function lexicalForeign<Emit = unknown>(opts: LexicalForeignOptions<Emit>): Mountable {
  const debounceMs = opts.changeDebounceMs ?? 300

  const boot = (el: Element): BootResult => {
    // De-duplicate node classes by reference: registering the same Klass twice
    // (e.g. two decorator plugins sharing LLuiDecoratorNode) throws in Lexical.
    const nodeSet = new Set<Klass<LexicalNode>>(opts.nodes ?? [])
    for (const plugin of opts.plugins ?? []) {
      for (const node of plugin.nodes ?? []) nodeSet.add(node)
    }
    const nodes = [...nodeSet]

    const editor = createEditor({
      namespace: opts.namespace,
      nodes,
      theme: opts.theme,
      editable: !opts.readOnly.peek(),
      onError: (error: Error) => {
        if (opts.onError) opts.onError(error)
        else throw error
      },
    })
    // Vanilla Lexical does NOT make the root editable — the caller must set
    // `contenteditable` (the React `<ContentEditable>` does this). Without it the
    // browser shows no caret and ignores typing.
    el.setAttribute('contenteditable', opts.readOnly.peek() ? 'false' : 'true')
    editor.setRootElement(el as HTMLElement)
    opts.onReady?.(editor)

    let lastEmitted = opts.value ? opts.value.peek() : (opts.defaultValue ?? '')
    let canUndo = false
    let canRedo = false
    let debounceTimer: ReturnType<typeof setTimeout> | undefined

    // Seed the initial document (programmatic — not echoed outbound). Discrete so
    // the host is populated synchronously at mount (before the first paint/read).
    // NB: seeding happens AFTER registration below, so plugins/decorator bridges
    // are live when the seed document is built (e.g. a callout in the seed needs
    // its bridge registered to decorate).

    const ctx: PluginContext<Emit> = { emit: (msg) => opts.emit?.(msg) }
    const pluginDisposers = (opts.plugins ?? []).map((plugin) => {
      const reg = plugin.register?.(editor, ctx) ?? (() => {})
      const shortcuts = plugin.shortcuts ? registerShortcuts(editor, plugin.shortcuts) : () => {}
      return () => {
        reg()
        shortcuts()
      }
    })

    const emitSelection = (): void => opts.onSelectionChange?.({ editor, canUndo, canRedo })

    const baseDispose = mergeRegister(
      registerRichText(editor),
      registerHistory(editor, createEmptyHistoryState(), 1000),
      opts.register?.(editor) ?? (() => {}),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload: boolean) => {
          canUndo = payload
          emitSelection()
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload: boolean) => {
          canRedo = payload
          emitSelection()
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerUpdateListener(({ editorState, tags }) => {
        emitSelection()
        if (tags.has(PROGRAMMATIC_TAG)) return
        if (debounceTimer !== undefined) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          editorState.read(() => {
            const next = opts.serialize(editor)
            lastEmitted = next
            opts.onChange?.(next)
          })
        }, debounceMs)
      }),
      ...pluginDisposers,
    )

    // Seed now that rich-text, history, plugins, and decorator bridges are live.
    editor.update(() => opts.deserialize(editor, lastEmitted), {
      tag: PROGRAMMATIC_TAG,
      discrete: true,
    })

    return {
      editor,
      getLastEmitted: () => lastEmitted,
      setLastEmitted: (value) => {
        lastEmitted = value
      },
      dispose: () => {
        if (debounceTimer !== undefined) clearTimeout(debounceTimer)
        baseDispose()
      },
    }
  }

  const readOnly = opts.readOnly
  const controlled = opts.value

  if (controlled) {
    return foreign<ForeignInst, { value: Signal<string>; readOnly: Signal<boolean> }>({
      tag: 'div',
      state: { value: controlled, readOnly },
      mount: ({ el, state }) => {
        const b = boot(el)
        const unbindValue = state.value.bind((incoming) => {
          if (incoming === b.getLastEmitted()) return
          b.editor.update(() => opts.deserialize(b.editor, incoming), { tag: PROGRAMMATIC_TAG })
          b.setLastEmitted(incoming)
        })
        const unbindReadOnly = state.readOnly.bind((ro) => {
          b.editor.setEditable(!ro)
          el.setAttribute('contenteditable', ro ? 'false' : 'true')
        })
        return {
          dispose: () => {
            unbindValue()
            unbindReadOnly()
            b.dispose()
          },
        }
      },
      unmount: (inst) => inst.dispose(),
    })
  }

  return foreign<ForeignInst, { readOnly: Signal<boolean> }>({
    tag: 'div',
    state: { readOnly },
    mount: ({ el, state }) => {
      const b = boot(el)
      const unbindReadOnly = state.readOnly.bind((ro) => {
        b.editor.setEditable(!ro)
        ;(el as HTMLElement).contentEditable = ro ? 'false' : 'true'
      })
      return {
        dispose: () => {
          unbindReadOnly()
          b.dispose()
        },
      }
    },
    unmount: (inst) => inst.dispose(),
  })
}
