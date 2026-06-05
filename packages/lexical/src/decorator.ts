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
import type { DecoratorApi, DecoratorBridge } from './plugin.js'

export type SerializedLLuiDecoratorNode = Spread<
  { bridgeType: string; data: unknown },
  SerializedLexicalNode
>

const REGISTRIES = new WeakMap<LexicalEditor, Map<string, DecoratorBridge>>()
const MOUNTS = new WeakMap<LexicalEditor, Map<NodeKey, () => void>>()

function mountsFor(editor: LexicalEditor): Map<NodeKey, () => void> {
  let mounts = MOUNTS.get(editor)
  if (!mounts) {
    mounts = new Map()
    MOUNTS.set(editor, mounts)
  }
  return mounts
}

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
    const container = document.createElement('div')
    const bridge = REGISTRIES.get(editor)?.get(this.__bridgeType)
    if (!bridge) return container

    const key = this.getKey()
    const api: DecoratorApi<unknown> = {
      editor,
      update: (next) =>
        editor.update(() => {
          const node = $getNodeByKey(key)
          if ($isLLuiDecoratorNode(node)) node.setData(next)
        }),
    }

    const mounts = mountsFor(editor)
    // Re-decoration (data change): tear the previous sub-app down first.
    mounts.get(key)?.()
    mounts.set(key, bridge.mount(container, this.getData(), api))
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
  // Merge into any existing registry so multiple decorator plugins compose.
  const registry = REGISTRIES.get(editor) ?? new Map<string, DecoratorBridge>()
  for (const bridge of bridges) registry.set(bridge.type, bridge)
  REGISTRIES.set(editor, registry)

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
    const mounts = MOUNTS.get(editor)
    if (!mounts) return
    for (const [key, kind] of mutations) {
      if (kind === 'destroyed') {
        mounts.get(key)?.()
        mounts.delete(key)
      }
    }
  })

  return () => {
    unregisterDecorator()
    unregisterMutation()
    const mounts = MOUNTS.get(editor)
    if (mounts) {
      for (const dispose of mounts.values()) dispose()
      mounts.clear()
    }
    REGISTRIES.delete(editor)
  }
}
