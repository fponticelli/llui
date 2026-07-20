/**
 * A two-or-more-peer in-memory Loro network for convergence testing.
 *
 * Convergence tests are the only thing that gives real confidence in this class
 * of code, so this harness exists BEFORE the sync directions it will test. Its
 * job is to make the nasty cases cheap to write:
 *
 * - edits interleaved arbitrarily across peers
 * - updates DELAYED (held in a peer's inbox while it keeps editing)
 * - updates REORDERED (delivered out of the order they were produced)
 * - a peer offline for a while, then catching up
 *
 * …and then to assert that every peer holds an IDENTICAL document, with a
 * failure report a human can read.
 *
 * ── The binding seam ───────────────────────────────────────────────────────
 *
 * A `Peer` owns a headless `LexicalEditor` and a `LoroDoc`. How the two are
 * connected is injected via {@link NetworkOptions.bind}, because that binding is
 * exactly what later agents implement. With no `bind`, peers are raw Loro docs
 * with an unconnected editor — enough to test the harness itself and any
 * Loro-level convergence property. Once `loroCollab()` exists, pass it as `bind`
 * and every test here starts exercising the real thing unchanged.
 */

import { createHeadlessEditor } from '@lexical/headless'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { LoroDoc } from 'loro-crdt'

import {
  childCount,
  initDoc,
  LORO_TEXT_FORMATS,
  normalizeRuns,
  ROOT_CONTAINER,
  type ElementContainer,
  type TextRun,
} from '../src/index.js'

// ---------------------------------------------------------------------------
// Document projection
// ---------------------------------------------------------------------------

/**
 * A normalized, comparable projection of an editor state.
 *
 * Deliberately EXCLUDES NodeKeys: they are per-session counters, so two peers
 * that converged perfectly still hold different keys. Including them would make
 * every assertion fail; excluding them is what makes "identical document" the
 * right question. Text is projected as coalesced runs so a difference in where
 * Lexical happened to split TextNodes — a rendering detail — does not read as
 * divergence.
 */
export type DocProjection = ElementProjection

export interface ElementProjection {
  readonly type: string
  readonly props: Readonly<Record<string, unknown>>
  readonly children: readonly ChildProjection[]
}

export type ChildProjection = ElementProjection | TextProjection

export interface TextProjection {
  readonly type: '#text'
  readonly runs: readonly TextRun[]
}

/**
 * Narrow a child projection to a text run group.
 *
 * Structural, not a `type` comparison: `ElementProjection.type` is an open
 * `string`, so `child.type === '#text'` does not narrow the union.
 */
export function isTextProjection(child: ChildProjection): child is TextProjection {
  return 'runs' in child
}

/** Narrow a child projection to an element. */
export function isElementProjection(child: ChildProjection): child is ElementProjection {
  return !isTextProjection(child)
}

/**
 * Node props that carry no document meaning and would otherwise create false
 * divergence (or noise) in a report.
 */
const IGNORED_PROPS = new Set([
  'type',
  'version',
  'children',
  'text',
  'format',
  'style',
  'mode',
  'detail',
])

function projectElement(node: LexicalNode): ElementProjection {
  const json = node.exportJSON() as Record<string, unknown>
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(json)) {
    if (IGNORED_PROPS.has(key)) continue
    props[key] = value
  }

  const children: ChildProjection[] = []
  if ($isElementNode(node)) {
    // Collapse each maximal run of adjacent TextNodes into ONE text child —
    // the same unit the Loro schema stores (one LoroText per run).
    let pending: TextRun[] = []
    const flush = (): void => {
      if (pending.length === 0) return
      const runs = normalizeRuns(pending)
      pending = []
      if (runs.length > 0) children.push({ type: '#text', runs })
    }
    for (const child of node.getChildren()) {
      if ($isTextNode(child)) {
        pending.push({ text: child.getTextContent(), format: child.getFormat() })
      } else {
        flush()
        children.push(projectElement(child))
      }
    }
    flush()
  }

  return { type: node.getType(), props, children }
}

/** Project an editor's current state. Safe to call outside an update. */
export function projectEditor(editor: LexicalEditor): DocProjection {
  let projection: DocProjection | undefined
  editor.getEditorState().read(() => {
    projection = projectElement($getRoot())
  })
  if (projection === undefined) throw new Error('network: failed to project editor state')
  return projection
}

/** Render an editor to markdown — the human-readable half of a divergence report. */
export function editorMarkdown(editor: LexicalEditor): string {
  let markdown = ''
  editor.getEditorState().read(() => {
    markdown = $convertToMarkdownString(TRANSFORMERS)
  })
  return markdown
}

/** Project a `LoroDoc` to plain JSON — for asserting the CRDT layer directly. */
export function projectDoc(doc: LoroDoc): unknown {
  return doc.toJSON()
}

/**
 * How many top-level blocks a peer's DOCUMENT holds, as the projection sees it.
 *
 * NOT readable from `toJSON()`: under the carrier schema `children` serializes as
 * a uuid-KEYED MAP, so it has no `.length` and no inherent order. The count must
 * come from {@link orderedChildren}, which is also the function the inbound walk
 * uses — so a test comparing this against the editor is comparing the editor to
 * the same rule that built it, which is the point.
 */
export function documentBlockCount(doc: LoroDoc): number {
  return childCount(doc.getMap(ROOT_CONTAINER) as ElementContainer)
}

// ---------------------------------------------------------------------------
// Peers
// ---------------------------------------------------------------------------

/** What a binding must return so the harness can tear it down. */
export interface PeerBinding {
  dispose(): void
}

/**
 * Connects an editor to a Loro doc. This is the seam the real
 * `loroCollab()` binding plugs into — see the file header.
 */
export type BindingFactory = (editor: LexicalEditor, doc: LoroDoc) => PeerBinding

/** One update in flight, as produced by a peer's local commits. */
interface Envelope {
  /** Monotonic id across the whole network — the order updates were PRODUCED. */
  readonly seq: number
  readonly from: string
  readonly bytes: Uint8Array
}

export interface PeerOptions {
  readonly name: string
  readonly peerId: bigint
  readonly nodes: readonly Klass<LexicalNode>[]
  readonly bind?: BindingFactory
}

/** A single participant: a headless Lexical editor over its own `LoroDoc`. */
export class Peer {
  readonly name: string
  readonly doc: LoroDoc
  readonly editor: LexicalEditor
  /** Updates received but not yet applied — the "network delay" buffer. */
  readonly inbox: Envelope[] = []
  /** Whether this peer currently receives broadcasts. */
  online = true

  readonly #binding: PeerBinding | undefined

  constructor(options: PeerOptions) {
    this.name = options.name
    this.doc = new LoroDoc()
    this.doc.setPeerId(options.peerId)
    initDoc(this.doc, LORO_TEXT_FORMATS)
    this.editor = createHeadlessEditor({
      namespace: `loro-network-${options.name}`,
      nodes: [...options.nodes],
      onError: (error: Error) => {
        throw error
      },
    })
    this.#binding = options.bind?.(this.editor, this.doc)
  }

  /** Apply every buffered update, in the order it was received. */
  flushInbox(): void {
    const pending = this.inbox.splice(0, this.inbox.length)
    for (const envelope of pending) this.doc.import(envelope.bytes)
  }

  /**
   * Apply buffered updates in an EXPLICIT order — the reordering knob.
   *
   * @param order indices into the current inbox, e.g. `[2, 0, 1]`. Any index
   * omitted stays buffered, so this also expresses partial delivery.
   */
  flushInboxInOrder(order: readonly number[]): void {
    const pending = [...this.inbox]
    const seen = new Set<number>()
    for (const index of order) {
      const envelope = pending[index]
      if (envelope === undefined) throw new Error(`network: no inbox entry at index ${index}`)
      if (seen.has(index)) throw new Error(`network: inbox index ${index} delivered twice`)
      seen.add(index)
      this.doc.import(envelope.bytes)
    }
    this.inbox.length = 0
    for (let i = 0; i < pending.length; i++) if (!seen.has(i)) this.inbox.push(pending[i]!)
  }

  dispose(): void {
    this.#binding?.dispose()
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export interface NetworkOptions {
  /** Peer names. Defaults to two peers, `a` and `b`. */
  readonly names?: readonly string[]
  /** Extra node classes registered on every peer's editor. */
  readonly nodes?: readonly Klass<LexicalNode>[]
  /** Connects each peer's editor to its doc — the binding under test. */
  readonly bind?: BindingFactory
}

/**
 * An in-memory broadcast network over `LoroDoc`s.
 *
 * Updates are captured per peer via `subscribeLocalUpdates` and queued in every
 * other online peer's inbox. Nothing is applied until a test asks for it, which
 * is what makes delay and reordering expressible.
 */
export class Network {
  readonly peers: readonly Peer[]
  #seq = 0

  constructor(options: NetworkOptions = {}) {
    const names = options.names ?? ['a', 'b']
    const nodes = options.nodes ?? [HeadingNode, QuoteNode]
    this.peers = names.map(
      (name, index) => new Peer({ name, peerId: BigInt(index + 1), nodes, bind: options.bind }),
    )
    for (const peer of this.peers) {
      peer.doc.subscribeLocalUpdates((bytes: Uint8Array) => {
        const envelope: Envelope = { seq: this.#seq++, from: peer.name, bytes }
        for (const other of this.peers) {
          if (other !== peer && other.online) other.inbox.push(envelope)
        }
      })
    }
  }

  /** Look a peer up by name. */
  peer(name: string): Peer {
    const found = this.peers.find((p) => p.name === name)
    if (found === undefined) throw new Error(`network: no peer named '${name}'`)
    return found
  }

  /** Convenience accessors for the common two-peer case. */
  get a(): Peer {
    return this.peers[0]!
  }
  get b(): Peer {
    return this.peers[1]!
  }

  /**
   * Deliver every buffered update everywhere, repeating until quiescent.
   *
   * Repeating matters: applying an update can make a bound editor react and
   * produce its own local update, which must in turn be delivered before the
   * network is settled.
   */
  settle(maxRounds = 20): void {
    for (let round = 0; round < maxRounds; round++) {
      if (this.peers.every((peer) => peer.inbox.length === 0)) return
      for (const peer of this.peers) peer.flushInbox()
    }
    throw new Error(`network: did not settle within ${maxRounds} rounds — updates keep echoing`)
  }

  /** Take a peer offline: it stops receiving broadcasts (its own edits queue up). */
  disconnect(name: string): void {
    this.peer(name).online = false
  }

  /**
   * Bring a peer back online and catch it up with a full state exchange —
   * what a real provider does on reconnect. Uses snapshots rather than the
   * missed update stream, since those were never queued while offline.
   */
  reconnect(name: string): void {
    const peer = this.peer(name)
    peer.online = true
    for (const other of this.peers) {
      if (other === peer) continue
      peer.doc.import(other.doc.export({ mode: 'snapshot' }))
      other.doc.import(peer.doc.export({ mode: 'snapshot' }))
    }
  }

  dispose(): void {
    for (const peer of this.peers) peer.dispose()
  }
}

// ---------------------------------------------------------------------------
// Convergence assertions
// ---------------------------------------------------------------------------

const stable = (value: unknown): string => JSON.stringify(value, null, 2)

/**
 * Assert every peer's Loro document is identical.
 *
 * This is the CRDT-level question and holds even with no binding attached.
 */
export function expectDocsConverged(network: Network): void {
  const [first, ...rest] = network.peers
  if (first === undefined) throw new Error('network: no peers')
  const expected = stable(projectDoc(first.doc))
  for (const peer of rest) {
    const actual = stable(projectDoc(peer.doc))
    if (actual !== expected) {
      throw new Error(
        `Loro documents diverged between '${first.name}' and '${peer.name}':\n\n` +
          `── ${first.name} ──\n${expected}\n\n── ${peer.name} ──\n${actual}\n`,
      )
    }
  }
}

/**
 * Assert every peer's EDITOR converged, comparing the normalized projection and
 * reporting markdown alongside it.
 *
 * The projection is the assertion (it is exact); the markdown is there so the
 * failure is readable — a structural JSON diff of two paragraph trees tells you
 * almost nothing about what actually went wrong.
 */
export function expectEditorsConverged(network: Network): void {
  const [first, ...rest] = network.peers
  if (first === undefined) throw new Error('network: no peers')
  const expected = stable(projectEditor(first.editor))
  const expectedMarkdown = editorMarkdown(first.editor)
  for (const peer of rest) {
    const actual = stable(projectEditor(peer.editor))
    if (actual === expected) continue
    const actualMarkdown = editorMarkdown(peer.editor)
    throw new Error(
      `Editors diverged between '${first.name}' and '${peer.name}'.\n\n` +
        `── ${first.name} (markdown) ──\n${expectedMarkdown}\n\n` +
        `── ${peer.name} (markdown) ──\n${actualMarkdown}\n\n` +
        `── ${first.name} (projection) ──\n${expected}\n\n` +
        `── ${peer.name} (projection) ──\n${actual}\n`,
    )
  }
}

/** Assert both the CRDT layer and the editor layer converged. */
export function expectConverged(network: Network): void {
  expectDocsConverged(network)
  expectEditorsConverged(network)
}
