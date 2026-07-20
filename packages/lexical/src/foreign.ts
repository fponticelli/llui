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
  type LexicalEditor,
  type LexicalNodeConfig,
} from 'lexical'
import { registerRichText } from '@lexical/rich-text'
import { registerHistory, createEmptyHistoryState } from '@lexical/history'
import { mergeRegister } from '@lexical/utils'
import { foreign, type LiveSignal, type Mountable, type Signal } from '@llui/dom'
import type { LexicalPlugin, PluginContext } from './plugin.js'
import { registerShortcuts } from './register.js'
import { createWidgetRuntime, type NodeWidget } from './nodewidget.js'

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
  nodes?: ReadonlyArray<LexicalNodeConfig>
  /** Plugins: their `nodes` are merged, `register`/`shortcuts` wired at mount. */
  plugins?: ReadonlyArray<LexicalPlugin<Emit>>
  /** Non-document overlay DOM registrations, composed with the plugins' own
   * `widgets`. See {@link nodeWidget}. When the composed list is EMPTY the
   * editor is created exactly as it was before this option existed — no
   * render-config override, no experimental API in play. */
  widgets?: ReadonlyArray<NodeWidget>
  /** Serialize the live document → string (runs in a read context). */
  serialize: (editor: LexicalEditor) => string
  /** Deserialize a string into the document (runs in an update context). */
  deserialize: (editor: LexicalEditor, value: string) => void
  /** Initial document (uncontrolled) — ignored when `value` is provided. */
  defaultValue?: string
  /** Controlled document signal; the editor follows it (echo-guarded). */
  value?: Signal<string>
  /** Reactive read-only flag (always supplied by the host's state). */
  readonly: Signal<boolean>
  /** Debounce window (ms) for outbound serialization. Default 300. */
  changeDebounceMs?: number
  /** Register the built-in `@lexical/history` undo stack. Default `true`.
   * Set `false` when an external owner provides history (e.g. a CRDT undo
   * manager in collab mode) — a local stack would shadow it and cross peers.
   * Prefer {@link ForeignOptions.externalUndo} over setting this manually:
   * it owns undo AND disables the built-in stack in one place, so the two
   * can't both be live. */
  history?: boolean
  /** An external owner of the undo/redo stack (e.g. `@llui/lexical-collab`'s
   * CRDT undo manager). When set, the built-in `@lexical/history` stack is
   * **forced off** — so a collab consumer cannot accidentally run both and
   * double-apply undo (the conflict is unrepresentable, not a doc footnote).
   * Registered after rich-text like {@link ForeignOptions.register}; return
   * a disposer. Setting `externalUndo` together with `history: true` is a
   * configuration error and is reported. */
  externalUndo?: (editor: LexicalEditor) => () => void
  /** When the document is seeded. `'auto'` (default) seeds from
   * `value`/`defaultValue` at mount. `'deferred'` skips the boot-time seed so an
   * external owner controls it (e.g. collab seeds once, gated on provider sync,
   * only if the shared doc is still empty). */
  seedMode?: 'auto' | 'deferred'
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
  /** Apply a controlled `value` push to the document (programmatic, echo-guarded). */
  pushProgrammatic: (value: string) => void
  /** Flush any pending edit, tear down listeners/history/plugins/timer, and
   * detach the editor root (releases the document selectionchange listener). */
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
    const nodeSet = new Set<LexicalNodeConfig>(opts.nodes ?? [])
    for (const plugin of opts.plugins ?? []) {
      for (const node of plugin.nodes ?? []) nodeSet.add(node)
    }
    const nodes = [...nodeSet]

    // Overlay widgets, composed across the direct option and every plugin. The
    // runtime is built ONLY when at least one is registered: with none, `dom`
    // stays `undefined` and `createEditor` is called byte-for-byte as before,
    // so no existing consumer is exposed to the experimental render config.
    const widgets: NodeWidget[] = [...(opts.widgets ?? [])]
    for (const plugin of opts.plugins ?? []) widgets.push(...(plugin.widgets ?? []))
    const widgetRuntime = widgets.length > 0 ? createWidgetRuntime(widgets) : null

    const editor = createEditor({
      namespace: opts.namespace,
      nodes,
      theme: opts.theme,
      editable: !opts.readonly.peek(),
      ...(widgetRuntime ? { dom: widgetRuntime.domConfig } : {}),
      onError: (error: Error) => {
        if (opts.onError) opts.onError(error)
        else throw error
      },
    })
    // Before `setRootElement` — that triggers the first reconcile, and the
    // teardown listeners must already be live for nodes created by it.
    const disposeWidgets = widgetRuntime ? widgetRuntime.attach(editor) : () => {}
    // Vanilla Lexical does NOT make the root editable — the caller must set
    // `contenteditable` (the React `<ContentEditable>` does this). Without it the
    // browser shows no caret and ignores typing.
    el.setAttribute('contenteditable', opts.readonly.peek() ? 'false' : 'true')
    editor.setRootElement(el as HTMLElement)

    let lastEmitted = opts.value ? opts.value.peek() : (opts.defaultValue ?? '')
    let canUndo = false
    let canRedo = false

    // ── Outbound serialization debounce, modelled as a tiny state machine ──────
    // A user edit arms `debounceTimer` and records `pendingFlush` (the closure
    // that serializes + emits the CURRENT editor state). Two transitions keep it
    // honest:
    //   • a PROGRAMMATIC update (seed / controlled push / collab writeback) cancels
    //     any armed timer and resyncs `lastEmitted` from a fresh serialize — so a
    //     stale timer can never emit programmatic content back to the host as a
    //     user edit, and pending keystrokes superseded by a push are dropped
    //     deterministically rather than silently racing.
    //   • dispose (below) flushes `pendingFlush` synchronously, so edits typed
    //     within the debounce window survive an unmount (show/branch remount).
    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let pendingFlush: (() => void) | undefined
    const clearPending = (): void => {
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer)
        debounceTimer = undefined
      }
      pendingFlush = undefined
    }

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

    // An external undo owner (CRDT/collab) forces the built-in history
    // stack off — running both double-applies undo. Requesting both
    // explicitly is a misconfiguration; surface it loudly rather than
    // silently letting them fight.
    if (opts.externalUndo && opts.history === true) {
      console.error(
        'lexicalForeign: `externalUndo` owns the undo stack, so `history: true` is ignored — remove it to silence this.',
      )
    }
    const builtInHistory = opts.externalUndo ? false : opts.history !== false

    const baseDispose = mergeRegister(
      registerRichText(editor),
      builtInHistory ? registerHistory(editor, createEmptyHistoryState(), 1000) : () => {},
      opts.register?.(editor) ?? (() => {}),
      opts.externalUndo?.(editor) ?? (() => {}),
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
        if (tags.has(PROGRAMMATIC_TAG)) {
          // Programmatic write already committed to the doc: drop any pending
          // user serialization and rebase the echo-guard baseline onto the doc's
          // serialized form (so the next controlled push echo-suppresses cleanly
          // and a leftover timer can't re-emit this content).
          clearPending()
          lastEmitted = editorState.read(() => opts.serialize(editor))
          return
        }
        if (debounceTimer !== undefined) clearTimeout(debounceTimer)
        const flush = (): void => {
          debounceTimer = undefined
          pendingFlush = undefined
          editorState.read(() => {
            const next = opts.serialize(editor)
            lastEmitted = next
            opts.onChange?.(next)
          })
        }
        pendingFlush = flush
        debounceTimer = setTimeout(flush, debounceMs)
      }),
      ...pluginDisposers,
    )

    // Seed now that rich-text, history, plugins, and decorator bridges are live.
    // Skipped in `'deferred'` mode: an external owner (e.g. the collab binding)
    // seeds the shared document itself, gated on its own readiness signal.
    if (opts.seedMode !== 'deferred') {
      editor.update(() => opts.deserialize(editor, lastEmitted), {
        tag: PROGRAMMATIC_TAG,
        discrete: true,
      })
    }

    // Hand the host a fully-wired editor: rich-text, history/plugins/decorator
    // bridges, and the seed document are all live, so commands dispatched from
    // `onReady` hit a real, populated editor rather than an empty shell.
    opts.onReady?.(editor)

    return {
      editor,
      getLastEmitted: () => lastEmitted,
      pushProgrammatic: (value) => {
        // Controlled push: overwrite the doc programmatically. The update
        // listener's PROGRAMMATIC branch cancels any pending user timer and
        // rebases `lastEmitted`, so this is the single write path.
        editor.update(() => opts.deserialize(editor, value), { tag: PROGRAMMATIC_TAG })
      },
      dispose: () => {
        // Flush a user edit still inside the debounce window BEFORE teardown so
        // keystrokes aren't lost on unmount; a programmatic last-update leaves
        // `pendingFlush` cleared, so nothing spurious is emitted.
        pendingFlush?.()
        clearPending()
        baseDispose()
        // Release the document-level selectionchange listener and detach the
        // editor's DOM subtree; without this every remount leaks both.
        editor.setRootElement(null)
        // Drop every live widget record + its host. After `setRootElement(null)`
        // the reconciler won't fire again, so this is the only remaining owner.
        disposeWidgets()
      },
    }
  }

  // ONE mount body for both control modes. `readonly` always binds; the
  // controlled `value` (present only in controlled mode) binds conditionally.
  // A single dispose path unbinds and tears the editor down — so the leak /
  // debounce / contenteditable fixes above live in exactly one place and the two
  // modes can't drift apart. (The two `foreign` wrappers below differ only in the
  // state shape they declare, which the type system forces; they carry no logic.)
  const readonly = opts.readonly
  const controlled = opts.value

  const mountEditor = (
    el: Element,
    readonlyLive: LiveSignal<boolean>,
    valueLive: LiveSignal<string> | undefined,
  ): ForeignInst => {
    const b = boot(el)
    const unbinds: Array<() => void> = []
    if (valueLive) {
      unbinds.push(
        valueLive.bind((incoming) => {
          if (incoming === b.getLastEmitted()) return
          b.pushProgrammatic(incoming)
        }),
      )
    }
    unbinds.push(
      readonlyLive.bind((ro) => {
        b.editor.setEditable(!ro)
        el.setAttribute('contenteditable', ro ? 'false' : 'true')
      }),
    )
    return {
      dispose: () => {
        for (const unbind of unbinds) unbind()
        b.dispose()
      },
    }
  }

  if (controlled) {
    return foreign<ForeignInst, { readonly: Signal<boolean>; value: Signal<string> }>({
      tag: 'div',
      state: { readonly, value: controlled },
      mount: ({ el, state }) => mountEditor(el, state.readonly, state.value),
      unmount: (inst) => inst.dispose(),
    })
  }

  return foreign<ForeignInst, { readonly: Signal<boolean> }>({
    tag: 'div',
    state: { readonly },
    mount: ({ el, state }) => mountEditor(el, state.readonly, undefined),
    unmount: (inst) => inst.dispose(),
  })
}
