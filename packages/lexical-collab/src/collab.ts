// `yjsCollab(config)` — framework-agnostic collaborative editing for the LLui ↔
// Lexical seam. It composes `@lexical/yjs`'s primitives (the same wiring the
// official React `CollaborationPlugin` performs) into a single `register(editor)`
// step you hand to `lexicalForeign({ history: false, seedMode: 'deferred',
// register })`. The CRDT document — not a markdown string — becomes the source
// of truth, so the seam's built-in history and boot-time seed MUST be disabled;
// this module supplies a scoped Yjs `UndoManager` and a sync-gated bootstrap
// instead. The network provider is injected (bring `y-websocket` / `y-webrtc` /
// `@hocuspocus/provider`), so this package stays transport-agnostic.

import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  BLUR_COMMAND,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
  HISTORY_MERGE_TAG,
  REDO_COMMAND,
  SKIP_COLLAB_TAG,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical'
import {
  CONNECTED_COMMAND,
  createBinding,
  createUndoManager,
  initLocalState,
  setLocalStateFocus,
  syncCursorPositions,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  TOGGLE_CONNECT_COMMAND,
  type Binding,
  type ExcludedProperties,
  type Provider,
} from '@lexical/yjs'
import { Doc as YDoc, UndoManager as YUndoManager } from 'yjs'

/** Compose teardown functions into one disposer (last-registered first). */
function mergeDisposers(disposers: ReadonlyArray<() => void>): () => void {
  return () => {
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]!()
  }
}

/** `editor.getRootElement()` throws in headless mode; return null there. */
function safeRootElement(editor: LexicalEditor): HTMLElement | null {
  try {
    return editor.getRootElement()
  } catch {
    return null
  }
}

/** A Yjs network/transport provider. Structurally identical to `@lexical/yjs`'s
 * `Provider`; re-exported so consumers type their factory without reaching into
 * `@lexical/yjs` directly. `y-websocket` / `y-webrtc` / `@hocuspocus/provider`
 * all satisfy it. */
export type CollabProvider = Provider

/** Local presence identity broadcast to peers (name + caret colour). */
export interface CollabUser {
  /** Display name shown on the remote caret. */
  name: string
  /** Caret / selection colour (any CSS colour). */
  color: string
  /** Arbitrary extra data merged into this client's awareness state. */
  awarenessData?: Record<string, unknown>
}

export interface YjsCollabConfig {
  /** Shared document id (room name). Must match across peers. */
  id: string
  /** The shared Yjs document. Created if omitted (and registered in `docMap`). */
  doc?: YDoc
  /** Doc registry shared with the provider factory. Created if omitted. */
  docMap?: Map<string, YDoc>
  /** A ready provider. Mutually exclusive with `providerFactory`. */
  provider?: CollabProvider
  /** Factory building the provider from the (id, docMap). Preferred — it lets
   * this module own doc creation/registration before the provider binds. */
  providerFactory?: (id: string, docMap: Map<string, YDoc>) => CollabProvider
  /** Local presence identity. Presence is disabled when omitted. */
  user?: CollabUser
  /** Whether THIS peer may seed an empty shared document. Default `true`.
   * In a multi-peer app exactly one peer should bootstrap (e.g. the creator);
   * the seed only runs if the shared doc is still empty after first sync. */
  shouldBootstrap?: boolean
  /** Seed an empty shared document (runs once, inside an editor update, only on
   * the bootstrapping peer). Without it an empty paragraph is inserted. */
  seed?: (editor: LexicalEditor) => void
  /** Overlay element that hosts remote carets. Created over the editor when
   * omitted; its offsetParent is made `position: relative` if it is static. */
  cursorsContainer?: HTMLElement
  /** Per-node properties excluded from CRDT sync (advanced). */
  excludedProperties?: ExcludedProperties
  /** Connect the provider at mount. Default `true`. */
  autoConnect?: boolean
  /** Connection status changed (`'connected'` ⇄ disconnected). */
  onStatus?: (connected: boolean) => void
  /** Provider sync state changed (initial document handshake complete). */
  onSync?: (synced: boolean) => void
  /** Remote peer count changed (distinct awareness states, excluding self). */
  onPeers?: (count: number) => void
}

/** Live handle returned by {@link yjsCollab}. */
export interface YjsCollab {
  /** Wire the binding onto an editor; pass as `lexicalForeign({ register })`.
   * Returns a disposer that tears down every listener, the provider connection,
   * and the cursors overlay. */
  register: (editor: LexicalEditor) => () => void
  /** The shared Yjs document. */
  readonly doc: YDoc
  /** The network provider. */
  readonly provider: CollabProvider
  /** Connect the provider (no-op if `autoConnect` already connected). */
  connect: () => void
  /** Disconnect the provider. */
  disconnect: () => void
}

/** Resolve doc + provider from the config, honouring mutual exclusivity. */
function resolveTransport(config: YjsCollabConfig): {
  doc: YDoc
  docMap: Map<string, YDoc>
  provider: CollabProvider
} {
  if (config.provider && config.providerFactory) {
    throw new Error('yjsCollab: pass either `provider` or `providerFactory`, not both')
  }
  if (!config.provider && !config.providerFactory) {
    throw new Error('yjsCollab: a `provider` or `providerFactory` is required')
  }
  const docMap = config.docMap ?? new Map<string, YDoc>()
  let doc = config.doc ?? docMap.get(config.id)
  if (!doc) {
    doc = new YDoc()
  }
  docMap.set(config.id, doc)
  const provider = config.provider ?? config.providerFactory!(config.id, docMap)
  // The factory may have created/registered its own doc for the id; adopt it so
  // the binding and the provider share one document.
  doc = docMap.get(config.id) ?? doc
  return { doc, docMap, provider }
}

/** Build (but do not yet bind) a collaborative editing handle. */
export function yjsCollab(config: YjsCollabConfig): YjsCollab {
  const { doc, docMap, provider } = resolveTransport(config)
  const shouldBootstrap = config.shouldBootstrap ?? true
  const autoConnect = config.autoConnect ?? true
  const user = config.user

  const register = (editor: LexicalEditor): (() => void) => {
    const binding = createBinding(
      editor,
      provider,
      config.id,
      doc,
      docMap,
      config.excludedProperties,
    )

    // ── Remote-caret overlay ────────────────────────────────────────────────
    const cursorsOverlay = setupCursorsContainer(editor, binding, config.cursorsContainer)

    // ── Outbound: local edits → Yjs (skip our own collab/undo writebacks) ────
    const removeUpdateListener = editor.registerUpdateListener(
      ({ prevEditorState, editorState, dirtyLeaves, dirtyElements, normalizedNodes, tags }) => {
        if (tags.has(SKIP_COLLAB_TAG)) return
        syncLexicalUpdateToYjs(
          binding,
          provider,
          prevEditorState,
          editorState,
          dirtyElements,
          dirtyLeaves,
          normalizedNodes,
          tags,
        )
      },
    )

    // ── Inbound: remote Yjs changes → local editor ───────────────────────────
    const sharedRoot = binding.root.getSharedType()
    type ObserveDeepHandler = Parameters<typeof sharedRoot.observeDeep>[0]
    const onYjsTreeChanges: ObserveDeepHandler = (events, transaction): void => {
      if (transaction.origin === binding) return
      const isFromUndoManager = transaction.origin instanceof YUndoManager
      syncYjsChangesToLexical(binding, provider, events, isFromUndoManager, syncCursorPositions)
    }
    sharedRoot.observeDeep(onYjsTreeChanges)

    // ── Scoped undo/redo (replaces @lexical/history; local-origin only) ───────
    const undoManager = createUndoManager(binding, sharedRoot)
    const pushUndoRedoState = (): void => {
      editor.dispatchCommand(CAN_UNDO_COMMAND, undoManager.undoStack.length > 0)
      editor.dispatchCommand(CAN_REDO_COMMAND, undoManager.redoStack.length > 0)
    }
    undoManager.on('stack-item-added', pushUndoRedoState)
    undoManager.on('stack-item-popped', pushUndoRedoState)
    undoManager.on('stack-cleared', pushUndoRedoState)

    // ── Presence: focus tracking ──────────────────────────────────────────────
    const removeCommands = mergeDisposers([
      editor.registerCommand(
        UNDO_COMMAND,
        () => {
          undoManager.undo()
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        REDO_COMMAND,
        () => {
          undoManager.redo()
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          if (user)
            setLocalStateFocus(provider, user.name, user.color, true, user.awarenessData ?? {})
          return false
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          if (user)
            setLocalStateFocus(provider, user.name, user.color, false, user.awarenessData ?? {})
          return false
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        TOGGLE_CONNECT_COMMAND,
        (shouldConnect: boolean) => {
          if (shouldConnect) provider.connect()
          else provider.disconnect()
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    ])

    // ── Provider: status / sync / awareness ───────────────────────────────────
    let bootstrapped = false
    const bootstrap = (): void => {
      if (bootstrapped) return
      // Only the designated peer seeds, and only while the shared doc is empty.
      if (!shouldBootstrap || !binding.root.isEmpty() || binding.root._xmlText._length !== 0) return
      bootstrapped = true
      editor.update(
        () => {
          const root = $getRoot()
          if (!root.isEmpty()) return
          if (config.seed) {
            config.seed(editor)
          } else {
            const paragraph = $createParagraphNode()
            root.append(paragraph)
            if ($getSelection() !== null) paragraph.select()
          }
        },
        { tag: HISTORY_MERGE_TAG },
      )
    }

    const onStatus = (payload: { status: string }): void => {
      const connected = payload.status === 'connected'
      editor.dispatchCommand(CONNECTED_COMMAND, connected)
      config.onStatus?.(connected)
    }
    const onSync = (isSynced: boolean): void => {
      config.onSync?.(isSynced)
      if (isSynced) bootstrap()
    }
    const onAwarenessUpdate = (): void => {
      // Only render remote carets when there is somewhere to put them (a mounted
      // editor with a cursors overlay) — skips work during SSR / pre-mount.
      if (binding.cursorsContainer !== null && safeRootElement(editor) !== null) {
        syncCursorPositions(binding, provider)
      }
      if (config.onPeers) {
        const states = provider.awareness.getStates()
        config.onPeers(Math.max(0, states.size - (states.has(doc.clientID) ? 1 : 0)))
      }
    }

    provider.on('status', onStatus)
    provider.on('sync', onSync)
    provider.awareness.on('update', onAwarenessUpdate)

    if (user) {
      const focusing =
        typeof document !== 'undefined' && document.activeElement === safeRootElement(editor)
      initLocalState(provider, user.name, user.color, focusing, user.awarenessData ?? {})
    }

    if (autoConnect) provider.connect()

    // ── Clear awareness immediately on tab close (avoids ghost cursors) ───────
    const clearAwareness = (): void => {
      try {
        provider.awareness.setLocalState(null)
      } catch {
        // provider may already be torn down
      }
    }
    const hasWindow = typeof window !== 'undefined'
    if (hasWindow) {
      window.addEventListener('beforeunload', clearAwareness)
      window.addEventListener('pagehide', clearAwareness)
    }

    return () => {
      if (hasWindow) {
        window.removeEventListener('beforeunload', clearAwareness)
        window.removeEventListener('pagehide', clearAwareness)
      }
      provider.awareness.off('update', onAwarenessUpdate)
      provider.off('sync', onSync)
      provider.off('status', onStatus)
      undoManager.off('stack-item-added', pushUndoRedoState)
      undoManager.off('stack-item-popped', pushUndoRedoState)
      undoManager.off('stack-cleared', pushUndoRedoState)
      undoManager.destroy()
      sharedRoot.unobserveDeep(onYjsTreeChanges)
      removeCommands()
      removeUpdateListener()
      cursorsOverlay.dispose()
      clearAwareness()
      try {
        provider.disconnect()
      } catch {
        // already disconnected
      }
    }
  }

  return {
    register,
    doc,
    provider,
    connect: () => provider.connect(),
    disconnect: () => provider.disconnect(),
  }
}

/** Attach a cursors overlay to the binding. Reuses a caller-supplied container,
 * otherwise creates one over the editor and ensures a positioned offsetParent so
 * the absolutely-positioned remote carets land in the right place. */
function setupCursorsContainer(
  editor: LexicalEditor,
  binding: Binding,
  provided: HTMLElement | undefined,
): { dispose: () => void } {
  if (provided) {
    binding.cursorsContainer = provided
    return {
      dispose: () => {
        binding.cursorsContainer = null
      },
    }
  }
  const root = safeRootElement(editor)
  const parent = root?.parentElement ?? root
  if (!parent || typeof document === 'undefined') {
    return { dispose: () => {} }
  }
  // The carets position against the container's offsetParent; give them a
  // positioned ancestor when the editor sits in a statically-positioned box.
  let resetPosition: (() => void) | undefined
  if (getComputedStyle(parent).position === 'static') {
    const prev = parent.style.position
    parent.style.position = 'relative'
    resetPosition = () => {
      parent.style.position = prev
    }
  }
  const container = document.createElement('div')
  container.className = 'llui-collab-cursors'
  parent.appendChild(container)
  binding.cursorsContainer = container
  return {
    dispose: () => {
      binding.cursorsContainer = null
      container.remove()
      resetPosition?.()
    },
  }
}
