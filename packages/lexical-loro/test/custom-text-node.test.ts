// A custom TextNode SUBCLASS (e.g. the wikilink token, mentions) carries state
// beyond text + format. It must NOT be merged into a plain-text LoroText run —
// that would rebuild it as bare text on projection, dropping its custom fields.
// It rides the carrier path (exportJSON → importJSON) like a decorator leaf.

import { describe, expect, it } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  TextNode,
  type LexicalEditor,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from 'lexical'
import { LoroDoc } from 'loro-crdt'

import {
  ContainerNodeMap,
  LORO_TEXT_FORMATS,
  adoptLoroDocument,
  initDoc,
  reconcileTargetIntoLoro,
  targetFromEditorState,
} from '../src/index.js'

type SerializedTokenNode = Spread<{ ref: string }, SerializedTextNode>

/** A minimal token-mode TextNode subclass with a custom `__ref` field. */
class TokenNode extends TextNode {
  __ref: string
  static getType(): string {
    return 'test-token'
  }
  static clone(node: TokenNode): TokenNode {
    return new TokenNode(node.__ref, node.__text, node.__key)
  }
  constructor(ref: string, text?: string, key?: NodeKey) {
    super(text ?? ref, key)
    this.__ref = ref
  }
  static importJSON(json: SerializedTokenNode): TokenNode {
    return new TokenNode(json.ref).updateFromJSON(json)
  }
  exportJSON(): SerializedTokenNode {
    return { ...super.exportJSON(), type: 'test-token', ref: this.__ref }
  }
  getRef(): string {
    return this.getLatest().__ref
  }
}
const $createTokenNode = (ref: string): TokenNode =>
  $applyNodeReplacement(new TokenNode(ref).setMode('token'))
const $isTokenNode = (n: unknown): n is TokenNode => n instanceof TokenNode

const makeEditor = (): LexicalEditor =>
  createHeadlessEditor({
    namespace: 'token-test',
    nodes: [TokenNode],
    onError: (e) => {
      throw e
    },
  })

describe('custom TextNode subclass round-trip', () => {
  it('keeps its type and custom props through Loro (not flattened to text)', () => {
    const a = makeEditor()
    a.update(
      () => {
        const p = $createParagraphNode()
        p.append($createTextNode('see '), $createTokenNode('doc-42'), $createTextNode(' end'))
        $getRoot().clear().append(p)
      },
      { discrete: true },
    )

    const doc = new LoroDoc()
    const root = initDoc(doc, LORO_TEXT_FORMATS)
    reconcileTargetIntoLoro(doc, root, targetFromEditorState(a.getEditorState()))

    // Project into a fresh editor (the inverse direction).
    const b = makeEditor()
    adoptLoroDocument({
      doc,
      root: initDoc(doc, LORO_TEXT_FORMATS),
      mapping: new ContainerNodeMap(),
      editor: b,
    })

    const result = b.getEditorState().read(() => {
      const para = $getRoot().getFirstChild()
      const kids = $isElementNode(para) ? para.getChildren() : []
      const token = kids.find($isTokenNode)
      return {
        text: kids.map((k) => k.getTextContent()).join(''),
        tokenRef: token?.getRef() ?? null,
        // The surrounding plain text stays as ordinary TextNodes.
        plainCount: kids.filter((k) => $isTextNode(k) && !$isTokenNode(k)).length,
      }
    })

    expect(result.text).toBe('see doc-42 end')
    expect(result.tokenRef).toBe('doc-42') // custom __ref survived
    expect(result.plainCount).toBe(2) // "see " and " end"
  })
})
