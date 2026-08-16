import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { LLuiDecoratorNode } from '@llui/lexical'
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical'

import { loroCollab } from '../src/index.js'
import { Network, type Peer } from './network.js'

// This is the one registered-node and binding contract for collaboration tests
// that exercise arbitrary/deep document shapes. Keeping it beside the Network
// harness prevents normal and stress lanes from silently testing different
// bindings or forgetting a node class used by their generated workloads.
const COLLABORATION_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LLuiDecoratorNode,
] as const

export function collabNetwork(names?: readonly string[]): Network {
  return new Network({
    ...(names ? { names } : {}),
    nodes: COLLABORATION_NODES,
    bind: (editor, doc) => {
      const collab = loroCollab({ doc, shouldBootstrap: false })
      return { dispose: collab.register(editor) }
    },
  })
}

/** Run one discrete local editor update through the real binding. */
export function edit(peer: Peer, fn: (editor: LexicalEditor) => void): void {
  peer.editor.update(() => fn(peer.editor), { discrete: true })
}

/** Replace a peer's root with text-only paragraphs to establish a baseline. */
export function setParagraphs(peer: Peer, texts: readonly string[]): void {
  edit(peer, () => {
    const root = $getRoot()
    root.clear()
    for (const text of texts) root.append($createParagraphNode().append($createTextNode(text)))
  })
}
