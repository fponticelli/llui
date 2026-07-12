// The DecoratorNode ↔ LLui sub-view bridge.
//
// `LLuiDecoratorNode` is a single generic node class: it stores a `bridgeType`
// + serialized `data` (so it round-trips through markdown) and, when decorated,
// mounts the matching {@link DecoratorBridge}'s LLui sub-app into its DOM. Each
// sub-app is an independent TEA loop with its own `send`/state. Registries and
// live mount disposers are keyed per-editor (no module-global mutable state, so
// multiple editors and SSR stay isolated).

import {
  $getNodeByKey,
  DecoratorNode,
  type DOMConversionMap,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import type { DecoratorApi, DecoratorBridge, DecoratorMount } from './plugin.js'

export type SerializedLLuiDecoratorNode = Spread<
  { bridgeType: string; data: unknown },
  SerializedLexicalNode
>

/** Per-editor decorator wiring, shared across composed `registerDecoratorBridges`
 * calls and reference-counted so each call owns only what it contributed.
 *  - `registry`  — the merged type→bridge lookup used by `decorate`.
 *  - `typeRefs`  — how many active registrations own each type-id (a type leaves
 *                  the registry only when its last owner disposes).
 *  - `mounts`    — live sub-app instances (dispose + reactive data-push +
 *                  their container), keyed by decorator node.
 *  - `registrations` — active `registerDecoratorBridges` calls on this editor;
 *                  the shared decorator/mutation listeners are wired on the first
 *                  and torn down on the last.
 */
/** A live decorator instance plus the DOM container it owns, kept so a re-decorate
 * of the same key pushes data into it and returns the same container (no remount). */
interface MountRecord extends DecoratorMount {
  container: HTMLElement
}

interface EditorDecoratorState {
  registry: Map<string, DecoratorBridge>
  typeRefs: Map<string, number>
  mounts: Map<NodeKey, MountRecord>
  registrations: number
  disposeListeners: () => void
}

const EDITOR_STATE = new WeakMap<LexicalEditor, EditorDecoratorState>()

/** A generic decorator node that mounts an LLui sub-view via a registered
 * {@link DecoratorBridge}. */
export class LLuiDecoratorNode extends DecoratorNode<HTMLElement> {
  __bridgeType: string
  __data: unknown

  static override getType(): string {
    return 'llui-decorator'
  }

  static override clone(node: LLuiDecoratorNode): LLuiDecoratorNode {
    return new LLuiDecoratorNode(node.__bridgeType, node.__data, node.__key)
  }

  constructor(bridgeType: string, data: unknown, key?: NodeKey) {
    super(key)
    this.__bridgeType = bridgeType
    this.__data = data
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-llui-decorator', this.__bridgeType)
    return el
  }

  override updateDOM(): false {
    return false
  }

  /** LLui decorators are block-level (callouts, math/mermaid blocks, embeds). */
  override isInline(): false {
    return false
  }

  static override importDOM(): DOMConversionMap | null {
    return null
  }

  /** The bridge type id this node renders (used by markdown transformers). */
  getBridgeType(): string {
    return this.getLatest().__bridgeType
  }

  /** Read the latest serialized data (for the sub-view). */
  getData(): unknown {
    return this.getLatest().__data
  }

  /** Persist new data into the node (markdown-serializable). */
  setData(data: unknown): void {
    this.getWritable().__data = data
  }

  override decorate(editor: LexicalEditor): HTMLElement {
    const state = EDITOR_STATE.get(editor)
    const bridge = state?.registry.get(this.__bridgeType)
    if (!state || !bridge) return document.createElement('div')

    const key = this.getKey()

    // Re-decoration (a data commit — badge click, inline edit, collab remote
    // edit): the sub-app is ALREADY mounted for this key. Push the new data
    // through its reactive update channel and return the SAME container, so
    // nothing remounts — focus, selection, and any editable island survive, and
    // we skip a full TEA init. Dispose stays tied to the `'destroyed'` mutation.
    const existing = state.mounts.get(key)
    if (existing) {
      existing.update(this.getData())
      return existing.container
    }

    const container = document.createElement('div')
    const api: DecoratorApi<unknown> = {
      editor,
      update: (next) =>
        editor.update(() => {
          const node = $getNodeByKey(key)
          if ($isLLuiDecoratorNode(node)) node.setData(next)
        }),
    }
    const mount = bridge.mount(container, this.getData(), api)
    state.mounts.set(key, { ...mount, container })
    return container
  }

  override exportJSON(): SerializedLLuiDecoratorNode {
    return {
      ...super.exportJSON(),
      type: 'llui-decorator',
      version: 1,
      bridgeType: this.__bridgeType,
      data: this.__data,
    }
  }

  static override importJSON(json: SerializedLLuiDecoratorNode): LLuiDecoratorNode {
    return new LLuiDecoratorNode(json.bridgeType, json.data)
  }
}

/** Create a decorator node for `bridgeType` carrying `data`. */
export function $createLLuiDecoratorNode(bridgeType: string, data: unknown): LLuiDecoratorNode {
  return new LLuiDecoratorNode(bridgeType, data)
}

export function $isLLuiDecoratorNode(
  node: LexicalNode | null | undefined,
): node is LLuiDecoratorNode {
  return node instanceof LLuiDecoratorNode
}

/**
 * Wire decorator bridges onto an editor: register the bridge registry, place
 * each decoration element into its node's DOM, and dispose sub-apps when their
 * nodes are destroyed. Returns a disposer that tears down all live sub-apps.
 * Typically called from a plugin's `register`.
 */
export function registerDecoratorBridges(
  editor: LexicalEditor,
  bridges: readonly DecoratorBridge[],
): () => void {
  let state = EDITOR_STATE.get(editor)
  if (!state) {
    state = {
      registry: new Map<string, DecoratorBridge>(),
      typeRefs: new Map<string, number>(),
      mounts: new Map<NodeKey, MountRecord>(),
      registrations: 0,
      disposeListeners: () => {},
    }
    EDITOR_STATE.set(editor, state)
  }
  const s = state

  // Wire the shared listeners exactly once (on the first registration); later
  // composed registrations reuse them and only add their own bridges/refs.
  if (s.registrations === 0) {
    const unregisterDecorator = editor.registerDecoratorListener<HTMLElement>((decorators) => {
      for (const key of Object.keys(decorators)) {
        const decoration = decorators[key]
        const host = editor.getElementByKey(key)
        if (host && decoration && decoration.parentElement !== host) {
          host.replaceChildren(decoration)
        }
      }
    })
    const unregisterMutation = editor.registerMutationListener(LLuiDecoratorNode, (mutations) => {
      for (const [key, kind] of mutations) {
        if (kind === 'destroyed') {
          s.mounts.get(key)?.dispose()
          s.mounts.delete(key)
        }
      }
    })
    s.disposeListeners = () => {
      unregisterDecorator()
      unregisterMutation()
    }
  }
  s.registrations++

  // Record the type-ids THIS registration contributes (ref-counted so a type
  // survives in the merged registry until its last owner disposes).
  const ownedTypes = bridges.map((b) => b.type)
  for (const bridge of bridges) {
    s.registry.set(bridge.type, bridge)
    s.typeRefs.set(bridge.type, (s.typeRefs.get(bridge.type) ?? 0) + 1)
  }

  return () => {
    // Dispose only the mounts backing nodes whose bridge type THIS registration
    // owns — composed registrations keep their own live sub-apps.
    const ownedKeys = editor.getEditorState().read(() =>
      [...s.mounts.keys()].filter((key) => {
        const node = $getNodeByKey(key)
        return $isLLuiDecoratorNode(node) && ownedTypes.includes(node.getBridgeType())
      }),
    )
    for (const key of ownedKeys) {
      s.mounts.get(key)?.dispose()
      s.mounts.delete(key)
    }

    // Release this registration's hold on its type-ids.
    for (const type of ownedTypes) {
      const refs = (s.typeRefs.get(type) ?? 0) - 1
      if (refs <= 0) {
        s.typeRefs.delete(type)
        s.registry.delete(type)
      } else {
        s.typeRefs.set(type, refs)
      }
    }

    // Last registration on this editor: tear down the shared listeners and drop
    // the per-editor state (disposing any stragglers defensively).
    s.registrations--
    if (s.registrations <= 0) {
      s.disposeListeners()
      for (const record of s.mounts.values()) record.dispose()
      s.mounts.clear()
      EDITOR_STATE.delete(editor)
    }
  }
}
