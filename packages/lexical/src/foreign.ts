// The load-bearing seam: mount a Lexical editor inside an LLui view via
// `foreign()`. Lexical owns the contentEditable subtree; LLui owns the chrome.
//
// Inbound (controlled): a `value` signal drives the document, echo-suppressed so
// the editor never fights its own emissions. Outbound: a debounced
// update-listener serializes the document and a synchronous one surfaces the
// selection/format. Serialize/deserialize are injected so this stays
// markdown-agnostic — the markdown layer supplies the transformer converters.
//
// This seam is the SOLE authority on echo for the controlled value, in BOTH
// directions, and it answers exactly one question in each:
//
//   inbound  — would applying this value change the document?
//   outbound — does the document now serialize to something the host doesn't have?
//
// The inbound question is asked of the LIVE document (`ForeignController.applyValue`),
// never of a remembered baseline: a baseline goes stale the moment a keystroke
// lands between an emission and the host's echo, and a stale baseline is exactly
// how a real inbound change gets swallowed. The outbound question is the only one
// that needs memory — `hostValue`, the last value this seam and the host
// exchanged. No layer above this one may hold its own equality check on the
// value; every one that did was a second, differently-wrong answer to the same
// question (issue #70).

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
import { createCommitHub } from './commit.js'
import type { LexicalPlugin } from './plugin.js'
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

/** The seam's inbound write path — the ONE place that decides whether a value
 * coming from the host is an echo of the live document.
 *
 * Handed to the host at {@link LexicalForeignOptions.onReady} so an imperative
 * push (a `setValue`-style message) goes through the same authority as the
 * controlled `value` signal. A host that writes markdown into the editor any
 * other way has re-opened the seam and owns the consequences. */
export interface ForeignController {
  /** Apply `value` to the document unless the document already holds it —
   * "already holds it" meaning `value` deserializes to the same document, not
   * that it is the same string. Returns whether the document was written. */
  applyValue: (value: string) => boolean
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
  /** Serialize the live document → string (runs in a read context the seam
   * opens, so bare `$` helpers are fine and no read of its own is needed).
   * Called with the editor whose document the seam is asking about — usually the
   * live one, but on the inbound path also a scratch editor holding a candidate
   * document, so read through the argument rather than a captured editor. */
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
  /** Receives the live editor at mount (host dispatches commands through it),
   * plus the seam's {@link ForeignController} — the only sanctioned way for the
   * host to push a value into the document. */
  onReady?: (editor: LexicalEditor, controller: ForeignController) => void
  /** Extra registration after rich-text (e.g. markdown shortcuts). Disposer. */
  register?: (editor: LexicalEditor) => () => void
  onError?: (error: Error) => void
}

/** The booted editor + the single inbound write path, shared by both control modes. */
interface BootResult {
  editor: LexicalEditor
  controller: ForeignController
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

    // The last value this seam and the host exchanged — set when we emit, rebased
    // from the document after every programmatic write. It gates the OUTBOUND
    // direction only (don't tell the host what it already has); the inbound gate
    // asks the live document instead, so it can't be poisoned by a stale baseline.
    let hostValue = opts.value ? opts.value.peek() : (opts.defaultValue ?? '')
    let canUndo = false
    let canRedo = false

    // ── The echo authority ────────────────────────────────────────────────────
    // Authored surface forms already PROVEN — by an actual write, or by a
    // `normalize` hit — to describe the document that serializes to `aliasOf`.
    // Every remembered form is dropped the moment the document moves, so this is
    // a memo of a decision the seam already made, not a second authority.
    //
    // It is also the only thing that can recognise a value the live document
    // cannot round-trip. `normalize` below parses into a scratch editor that has
    // the same node set but NONE of the live editor's registered node transforms
    // (in @llui/markdown-editor the link sanitizer is one: it unwraps a
    // `javascript:` href on import). Such a value's normalized form can never
    // equal the live serialization, so without this memo it would re-apply on
    // every push and the document would never converge — issue #71's bug
    // reappearing inside issue #71's fix.
    let aliasOf: string | null = null
    const aliases = new Set<string>()
    /** Record that `authored` describes the document serializing to `docForm`. */
    const rememberAlias = (docForm: string, authored: string): void => {
      if (aliasOf !== docForm) {
        aliasOf = docForm
        aliases.clear()
      }
      // One document has few authored spellings in practice; the cap only stops
      // a pathological host from growing the set without bound between edits.
      if (aliases.size >= 8) aliases.clear()
      aliases.add(authored)
    }

    // A scratch editor whose only job is to answer "what document does this
    // string describe?". Built from the SAME node set as the live editor (so its
    // vocabulary can't drift) but with no root element, no plugins and no
    // listeners — it never renders and must never have a side effect. Lazily
    // created: a host that only ever echoes byte-identical values never pays for
    // it, because the identity check below short-circuits first.
    //
    // COST: a host that re-authors the value (house style, so the identity check
    // never hits) pays a full deserialize + serialize per push on a memo miss —
    // and a keystroke invalidates the memo, so in a controlled typing loop that
    // is O(document) main-thread work per keystroke. Acceptable for now (the
    // pre-#70 code never converged in this scenario at all), but the standing
    // fix is to widen `serialize` to `(editor, state?)` so the seam can normalize
    // through `editor.parseEditorState` and delete this scratch editor entirely.
    let scratch: LexicalEditor | null = null
    /** `value` rendered into the serializer's normal form, or `null` when it
     * cannot be parsed — an unparseable value is never treated as an echo. */
    const normalize = (value: string): string | null => {
      try {
        scratch ??= createEditor({
          namespace: `${opts.namespace}:normalize`,
          nodes,
          onError: (error: Error) => {
            throw error
          },
        })
        const s = scratch
        s.update(() => opts.deserialize(s, value), { discrete: true })
        // `serialize` is documented to run in a read context the SEAM provides
        // (see {@link LexicalForeignOptions.serialize}) — a consumer may write it
        // with bare `$` helpers. Every call site here owes it one, including this
        // one against the scratch editor.
        return s.read(() => opts.serialize(s))
      } catch {
        return null
      }
    }

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

    // One update listener + one editor-state read per commit, shared by every
    // plugin that subscribes (issue #74). Lazy: with no subscriber the hub never
    // registers anything, so an editor without such plugins pays nothing.
    const ctx = createCommitHub<Emit>(editor, (msg) => opts.emit?.(msg))
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
          // user serialization and rebase the host baseline onto the doc's
          // serialized form (a programmatic write is not an outbound change, and
          // a leftover timer must not re-emit this content).
          clearPending()
          hostValue = editorState.read(() => opts.serialize(editor))
          return
        }
        if (debounceTimer !== undefined) clearTimeout(debounceTimer)
        const flush = (): void => {
          debounceTimer = undefined
          pendingFlush = undefined
          editorState.read(() => {
            const next = opts.serialize(editor)
            // Outbound half of the one authority: a commit that doesn't move the
            // serialized document is not a change to the host. Every commit arms
            // this timer — including selection-only ones — so without this gate a
            // bare caret move would surface as an `onChange`, and every layer
            // above would need its own dedupe to survive it.
            if (next === hostValue) return
            hostValue = next
            opts.onChange?.(next)
          })
        }
        pendingFlush = flush
        debounceTimer = setTimeout(flush, debounceMs)
      }),
      ...pluginDisposers,
      ctx.dispose,
    )

    // Seed now that rich-text, history, plugins, and decorator bridges are live.
    // Skipped in `'deferred'` mode: an external owner (e.g. the collab binding)
    // seeds the shared document itself, gated on its own readiness signal.
    if (opts.seedMode !== 'deferred') {
      editor.update(() => opts.deserialize(editor, hostValue), {
        tag: PROGRAMMATIC_TAG,
        discrete: true,
      })
    }

    const controller: ForeignController = {
      applyValue: (value) => {
        // Inbound half of the one authority. The question is NOT "is this string
        // the one we last emitted" (a value authored in a different-but-equivalent
        // surface form never matches that, and re-applying it resets the caret on
        // every keystroke — issue #71). The question is "would applying this
        // change the live document", and it is asked of the live document:
        //   • identical to what the document serializes to → nothing to do;
        //   • already proven to describe THIS document → nothing to do;
        //   • parses to the same document → nothing to do, whatever it looks like;
        //   • otherwise it is a real change and must be written.
        // Every one of those is asked of the live document (the memo is keyed on
        // its serialization and dropped when it moves), so no STALE baseline can
        // suppress a real change — there is no baseline left to go stale.
        //
        // The remaining precondition is the third branch, and it is a precondition
        // rather than a theorem: `normalize` parses in a scratch editor without
        // the live editor's node transforms, so its verdict only matches the live
        // one while those transforms are idempotent and the live document is
        // already a fixed point of them (true of @llui/markdown-editor's link
        // sanitizer and underline blocker). A transform that violates that could
        // suppress a value the live import would have rewritten. The alias memo
        // is the mirror-image patch for the same asymmetry in the other direction.
        //
        // `editor.read` both supplies the read context `serialize` is promised
        // and flushes any queued update first, so "the live document" means the
        // fully committed, reconciled one — the decision below is only sound if
        // the document it is taken against is the one the value would replace.
        const current = editor.read(() => opts.serialize(editor))
        if (value === current) return false
        if (aliasOf === current && aliases.has(value)) return false
        if (normalize(value) === current) {
          rememberAlias(current, value)
          return false
        }
        // A real change: overwrite the doc programmatically. The update listener's
        // PROGRAMMATIC branch cancels any pending user timer and rebases
        // `hostValue`, so this stays the single write path.
        //
        // DISCRETE, like the boot seed: this whole decision is a function of the
        // LIVE document, so the write must be committed by the time the call
        // returns. A deferred commit (Lexical schedules one in a microtask) would
        // leave the authority answering against a document it has already decided
        // to replace — a second push in the same tick would re-apply the same
        // value, and the post-transform serialization read below would still be
        // the OLD document, so the memo would remember a form against the wrong
        // key and never fire.
        editor.update(() => opts.deserialize(editor, value), {
          tag: PROGRAMMATIC_TAG,
          discrete: true,
        })
        // The write itself is the strongest possible proof that `value` describes
        // the document it produced — including when a node transform rewrote the
        // content on import, which is precisely the case `normalize` cannot see.
        rememberAlias(
          editor.read(() => opts.serialize(editor)),
          value,
        )
        return true
      },
    }

    // Hand the host a fully-wired editor: rich-text, history/plugins/decorator
    // bridges, and the seed document are all live, so commands dispatched from
    // `onReady` hit a real, populated editor rather than an empty shell. The
    // controller rides along so an imperative host push uses the same authority.
    opts.onReady?.(editor, controller)

    return {
      editor,
      controller,
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
      // The controlled signal has no privileged path: it asks the controller the
      // same question an imperative push does.
      unbinds.push(valueLive.bind((incoming) => void b.controller.applyValue(incoming)))
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
