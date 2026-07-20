/**
 * Agent-write: content-keyed reconcile of an LLM's full-document markdown
 * rewrite. When an agent hands us a whole new markdown string, the resulting Loro
 * edit MUST preserve the `ContainerID`s of unchanged blocks so concurrent edits
 * from other windows merge and mounted decorator sub-apps are not torn down.
 *
 * The bar is loro-prosemirror's guarantee (content-equality match), reproduced in
 * this binding's schema. Each test measures ContainerID SURVIVAL per edit kind;
 * the acid test proves a concurrent live edit in another window survives; the
 * bounce test proves an agent write replicates into a live editor on the SAME
 * document while keeping its `NodeKey`s; and the duplicate-block tests pin both
 * the position-bias improvement and its honest residual.
 *
 * ── The @lexical/markdown boundary ─────────────────────────────────────────
 *
 * `@lexical/markdown` and `@lexical/headless` are used ONLY in this test's
 * `targetFromMarkdown` helper — the CALLER's job. The production API
 * (`reconcileTargetIntoLoro`) takes an already-parsed target tree, so the package
 * itself never depends on `@lexical/markdown` at runtime.
 */

import { describe, expect, it } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import { $getRoot, type Klass, type LexicalEditor, type LexicalNode } from 'lexical'
import { LoroDoc, LoroText, type ContainerID } from 'loro-crdt'

import {
  AGENT_WRITE_ORIGIN,
  ContainerNodeMap,
  LORO_TEXT_FORMATS,
  applyLoroToLexical,
  containerId,
  deleteChild,
  elementChildren,
  initDoc,
  orderedChildren,
  projectTarget,
  reconcileTargetIntoLoro,
  seedLoroFromLexical,
  syncLexicalToLoro,
  targetFromEditorState,
  type ElementContainer,
  type TargetElement,
} from '../src/index.js'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const NODES: readonly Klass<LexicalNode>[] = [HeadingNode, QuoteNode, ListNode, ListItemNode]

function headless(): LexicalEditor {
  return createHeadlessEditor({
    namespace: 'agent-write-test',
    nodes: [...NODES],
    onError: (error: Error) => {
      throw error
    },
  })
}

/**
 * Parse `markdown` to a target tree — the CALLER's responsibility, kept out of
 * `src/`. This is the only place `@lexical/markdown`/`@lexical/headless` are used,
 * proving the production API needs neither. A real caller (lance) uses its own
 * custom nodes and transformer set here.
 */
function targetFromMarkdown(markdown: string, nodes: readonly Klass<LexicalNode>[]): TargetElement {
  const editor = createHeadlessEditor({
    namespace: 'agent-write-parse',
    nodes: [...nodes],
    onError: (error: Error) => {
      throw error
    },
  })
  editor.update(() => $convertFromMarkdownString(markdown, TRANSFORMERS), { discrete: true })
  return targetFromEditorState(editor.getEditorState())
}

/** A Loro document seeded from `markdown`, exactly as a bootstrapping peer would. */
function seedDoc(markdown: string, peerId: bigint): { doc: LoroDoc; root: ElementContainer } {
  const doc = new LoroDoc()
  doc.setPeerId(peerId)
  const root = initDoc(doc, LORO_TEXT_FORMATS)
  doc.commit()
  const editor = headless()
  editor.update(() => $convertFromMarkdownString(markdown, TRANSFORMERS), { discrete: true })
  seedLoroFromLexical({ doc, root, mapping: new ContainerNodeMap() }, editor.getEditorState())
  return { doc, root }
}

/** Import a snapshot into a fresh peer with a distinct id. */
function forkDoc(snapshot: Uint8Array, peerId: bigint): { doc: LoroDoc; root: ElementContainer } {
  const doc = new LoroDoc()
  doc.setPeerId(peerId)
  const root = initDoc(doc, LORO_TEXT_FORMATS)
  doc.import(snapshot)
  return { doc, root }
}

/** Every ContainerID in the subtree, in no particular order. */
function collectIds(element: ElementContainer): Set<ContainerID> {
  const out = new Set<ContainerID>()
  const walk = (el: ElementContainer): void => {
    for (const entry of orderedChildren(el)) {
      out.add(containerId(entry.container))
      if (entry.kind === 'element') walk(entry.container as ElementContainer)
    }
  }
  walk(element)
  return out
}

/** Fraction of `before`'s ids still present in `after`. */
function survival(before: ReadonlySet<ContainerID>, after: ReadonlySet<ContainerID>): number {
  if (before.size === 0) return 1
  let kept = 0
  for (const id of before) if (after.has(id)) kept++
  return kept / before.size
}

/** The LoroText of a top-level block's first text run. */
function blockText(root: ElementContainer, index: number): LoroText {
  const block = orderedChildren(root)[index]
  if (block === undefined || block.kind !== 'element') throw new Error(`no element block ${index}`)
  const textEntry = orderedChildren(block.container as ElementContainer).find(
    (e) => e.kind === 'text',
  )
  if (textEntry === undefined || !(textEntry.container instanceof LoroText)) {
    throw new Error(`block ${index} has no text run`)
  }
  return textEntry.container
}

/** The element ContainerID of a top-level block. */
function blockId(root: ElementContainer, index: number): ContainerID {
  const block = orderedChildren(root)[index]
  if (block === undefined) throw new Error(`no block ${index}`)
  return containerId(block.container)
}

const PARAS = 'Alpha.\n\nBeta.\n\nGamma.\n'

// ---------------------------------------------------------------------------
// Baseline: the naive path this design replaces (REFUTED reference)
// ---------------------------------------------------------------------------

describe('naive $convertFromMarkdownString rewrite (the refuted baseline)', () => {
  it('recreates every container even for IDENTICAL markdown (0% survival)', () => {
    const doc = new LoroDoc()
    doc.setPeerId(1n)
    const root = initDoc(doc, LORO_TEXT_FORMATS)
    doc.commit()
    const editor = headless()
    const target = { doc, root, mapping: new ContainerNodeMap() }
    editor.registerUpdateListener((payload) => {
      syncLexicalToLoro(target, payload)
    })

    editor.update(() => $convertFromMarkdownString(PARAS, TRANSFORMERS), { discrete: true })
    const before = collectIds(root)
    expect(before.size).toBeGreaterThan(0)

    // The naive agent write: reparse the SAME markdown into the live editor.
    editor.update(() => $convertFromMarkdownString(PARAS, TRANSFORMERS), { discrete: true })
    const after = collectIds(root)

    expect(survival(before, after)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Content-keyed reconcile — the supported entry point
// ---------------------------------------------------------------------------

describe('reconcileTargetIntoLoro — per-edit ContainerID survival', () => {
  it('identical markdown: 100% survival, ZERO ops', () => {
    const { doc, root } = seedDoc(PARAS, 1n)
    const before = collectIds(root)

    const ops = reconcileTargetIntoLoro(doc, root, targetFromMarkdown(PARAS, NODES))

    expect(ops).toBe(0)
    expect(collectIds(root)).toEqual(before)
    expect(survival(before, collectIds(root))).toBe(1)
  })

  it('edit one paragraph: only that text container changes, all ids survive', () => {
    const { doc, root } = seedDoc(PARAS, 1n)
    const before = collectIds(root)
    const betaId = containerId(blockText(root, 1))

    const ops = reconcileTargetIntoLoro(
      doc,
      root,
      targetFromMarkdown('Alpha.\n\nBeta edited.\n\nGamma.\n', NODES),
    )

    // 100% survival — the edited paragraph keeps ITS text container too.
    expect(survival(before, collectIds(root))).toBe(1)
    expect(containerId(blockText(root, 1))).toBe(betaId)
    expect(blockText(root, 1).toString()).toBe('Beta edited.')
    // Untouched blocks read unchanged.
    expect(blockText(root, 0).toString()).toBe('Alpha.')
    expect(blockText(root, 2).toString()).toBe('Gamma.')
    // A text splice (delete+insert) plus nothing else — no pos writes, no recreates.
    expect(ops).toBeLessThanOrEqual(2)
  })

  it('append a block: previous ids all survive, only a new carrier appears', () => {
    const { doc, root } = seedDoc(PARAS, 1n)
    const before = collectIds(root)

    reconcileTargetIntoLoro(doc, root, targetFromMarkdown(`${PARAS}\nDelta.\n`, NODES))

    expect(survival(before, collectIds(root))).toBe(1)
    expect(orderedChildren(root)).toHaveLength(4)
    expect(blockText(root, 3).toString()).toBe('Delta.')
  })

  it('prepend a block: previous ids all survive, no survivor is repositioned', () => {
    const { doc, root } = seedDoc(PARAS, 1n)
    const before = collectIds(root)

    reconcileTargetIntoLoro(doc, root, targetFromMarkdown(`Zero.\n\n${PARAS}`, NODES))

    expect(survival(before, collectIds(root))).toBe(1)
    expect(orderedChildren(root)).toHaveLength(4)
    expect(blockText(root, 0).toString()).toBe('Zero.')
    expect(blockText(root, 1).toString()).toBe('Alpha.')
  })

  it('delete a block: only the removed carriers disappear', () => {
    const { doc, root } = seedDoc(PARAS, 1n)
    const alphaId = blockId(root, 0)
    const gammaId = blockId(root, 2)
    const betaTextId = containerId(blockText(root, 1))

    reconcileTargetIntoLoro(doc, root, targetFromMarkdown('Alpha.\n\nGamma.\n', NODES))

    const after = collectIds(root)
    expect(after.has(alphaId)).toBe(true)
    expect(after.has(gammaId)).toBe(true)
    expect(after.has(betaTextId)).toBe(false)
    expect(orderedChildren(root)).toHaveLength(2)
  })

  it('move a block: every id survives, only displaced pos keys are written', () => {
    const { doc, root } = seedDoc(PARAS, 1n)
    const before = collectIds(root)
    const ids = [blockId(root, 0), blockId(root, 1), blockId(root, 2)]

    // Alpha / Beta / Gamma -> Beta / Alpha / Gamma (one block displaced).
    const ops = reconcileTargetIntoLoro(
      doc,
      root,
      targetFromMarkdown('Beta.\n\nAlpha.\n\nGamma.\n', NODES),
    )

    expect(survival(before, collectIds(root))).toBe(1)
    // The move is one pos register write, not a delete+recreate.
    expect(ops).toBe(1)
    // Identity followed the content: Beta's carrier is now first.
    expect(blockId(root, 0)).toBe(ids[1])
    expect(blockId(root, 1)).toBe(ids[0])
    expect(blockId(root, 2)).toBe(ids[2])
  })

  it('unchanged structural block (heading + nested list) keeps its ContainerID', () => {
    const md = '# Heading\n\n- one\n- two\n\nBody.\n'
    const { doc, root } = seedDoc(md, 1n)
    const headingId = blockId(root, 0)
    const listId = blockId(root, 1)
    const listSubtree = collectIds(orderedChildren(root)[1]!.container as ElementContainer)

    // Edit only the trailing paragraph.
    reconcileTargetIntoLoro(
      doc,
      root,
      targetFromMarkdown('# Heading\n\n- one\n- two\n\nEdited.\n', NODES),
    )

    const after = collectIds(root)
    expect(after.has(headingId)).toBe(true)
    expect(after.has(listId)).toBe(true)
    // The whole list subtree (list, items, text runs) is untouched — a mounted
    // sub-app under any of these would not remount.
    for (const id of listSubtree) expect(after.has(id)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Projection: projectTarget / targetFromEditorState
// ---------------------------------------------------------------------------

describe('projectTarget / targetFromEditorState', () => {
  it('projects a parsed editor state to a serializable target tree', () => {
    const editor = headless()
    editor.update(() => $convertFromMarkdownString('# Title\n\nBody.\n', TRANSFORMERS), {
      discrete: true,
    })

    // targetFromEditorState does the read for you.
    const viaState = targetFromEditorState(editor.getEditorState())
    // projectTarget requires an explicit read context.
    let viaProject: TargetElement | undefined
    editor.getEditorState().read(() => {
      viaProject = projectTarget($getRoot())
    })

    expect(viaState).toEqual(viaProject)
    expect(viaState.kind).toBe('element')
    expect(viaState.type).toBe('root')
    expect(viaState.children).toHaveLength(2)
    expect(viaState.children[0]).toMatchObject({ kind: 'element', type: 'heading' })
    expect(viaState.children[1]).toMatchObject({ kind: 'element', type: 'paragraph' })
    // The tree is plain JSON — no Lexical nodes leaked through.
    expect(JSON.parse(JSON.stringify(viaState))).toEqual(viaState)
  })
})

// ---------------------------------------------------------------------------
// THE ACID TEST — a concurrent live edit in another window must survive
// ---------------------------------------------------------------------------

describe('acid test: agent edit in window A vs live edit in window B', () => {
  const SIX = 'B0.\n\nB1.\n\nB2.\n\nB3.\n\nB4.\n\nB5.\n'

  it("B's in-place edit to block 5 survives A's agent rewrite of block 1, both merge orders", () => {
    const seed = seedDoc(SIX, 1n)
    const snapshot = seed.doc.export({ mode: 'snapshot' })

    for (const reverse of [false, true]) {
      const a = forkDoc(snapshot, 2n)
      const b = forkDoc(snapshot, 3n)

      // Window A: the agent rewrites the whole note, changing only block 1.
      reconcileTargetIntoLoro(
        a.doc,
        a.root,
        targetFromMarkdown('B0.\n\nB1 rewritten by agent.\n\nB2.\n\nB3.\n\nB4.\n\nB5.\n', NODES),
      )

      // Window B: a live keystroke edit into block 5's exact LoroText container
      // (this is precisely the op the outbound binding emits for typing).
      const b5 = blockText(b.root, 5)
      b5.insert(b5.length, ' [edited live in B]')
      b.doc.commit({ origin: 'user' })

      // Merge both ways.
      const fromA = a.doc.export({ mode: 'update' })
      const fromB = b.doc.export({ mode: 'update' })
      if (reverse) {
        a.doc.import(fromB)
        b.doc.import(fromA)
      } else {
        b.doc.import(fromA)
        a.doc.import(fromB)
      }

      // Convergence.
      expect(a.doc.toJSON()).toEqual(b.doc.toJSON())

      // A's edit landed AND B's concurrent edit SURVIVED — the whole point.
      expect(blockText(a.root, 1).toString()).toBe('B1 rewritten by agent.')
      expect(blockText(a.root, 5).toString()).toBe('B5. [edited live in B]')
    }
  })

  it("CONTRAST: a delete+recreate of block 5 (the naive shape) LOSES B's edit", () => {
    const seed = seedDoc(SIX, 1n)
    const snapshot = seed.doc.export({ mode: 'snapshot' })
    const a = forkDoc(snapshot, 2n)
    const b = forkDoc(snapshot, 3n)

    // Simulate the naive path's effect at the CRDT level: window A deletes block
    // 5's carrier, then reconciles the same target so block 5 is recreated fresh
    // with a new container — the exact identity break the naive rewrite causes.
    deleteChild(elementChildren(a.root), orderedChildren(a.root)[5]!.uuid)
    a.doc.commit({ origin: 'test' })
    reconcileTargetIntoLoro(a.doc, a.root, targetFromMarkdown(SIX, NODES))

    // Window B edits the ORIGINAL block-5 container concurrently.
    const b5 = blockText(b.root, 5)
    b5.insert(b5.length, ' [edited live in B]')
    b.doc.commit({ origin: 'user' })

    a.doc.import(b.doc.export({ mode: 'update' }))
    b.doc.import(a.doc.export({ mode: 'update' }))

    // The container B wrote into was deleted by A, so B's insertion is gone.
    expect(a.doc.toJSON()).toEqual(b.doc.toJSON())
    expect(blockText(a.root, 5).toString()).toBe('B5.')
  })
})

// ---------------------------------------------------------------------------
// The inbound bounce — an agent write on the SAME doc reaches a live editor
// ---------------------------------------------------------------------------

/** A live editor bound to `doc` in BOTH directions, seeded from `markdown`. */
function boundEditor(
  markdown: string,
  peerId: bigint,
): { doc: LoroDoc; root: ElementContainer; editor: LexicalEditor } {
  const doc = new LoroDoc()
  doc.setPeerId(peerId)
  const root = initDoc(doc, LORO_TEXT_FORMATS)
  doc.commit()
  const mapping = new ContainerNodeMap()
  const editor = headless()

  editor.update(() => $convertFromMarkdownString(markdown, TRANSFORMERS), { discrete: true })
  seedLoroFromLexical({ doc, root, mapping }, editor.getEditorState())
  doc.commit()

  // Outbound (echo layer b skips our own inbound writeback) and inbound (which
  // must APPLY the agent-write local batch — origin on the localOrigins list).
  editor.registerUpdateListener((payload) => {
    syncLexicalToLoro({ doc, root, mapping }, payload)
  })
  doc.subscribe((batch) => {
    applyLoroToLexical({ doc, root, mapping, editor, localOrigins: [AGENT_WRITE_ORIGIN] }, batch)
  })
  return { doc, root, editor }
}

/** The top-level block NodeKeys of a live editor. */
function blockKeys(editor: LexicalEditor): string[] {
  const keys: string[] = []
  editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) keys.push(child.getKey())
  })
  return keys
}

/** The top-level block texts of a live editor. */
function blockTexts(editor: LexicalEditor): string[] {
  const texts: string[] = []
  editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) texts.push(child.getTextContent())
  })
  return texts
}

describe('inbound bounce: an agent write reaches a live editor on the same doc', () => {
  it('replicates into the editor and keeps every unchanged block NodeKey', () => {
    const { doc, root, editor } = boundEditor(PARAS, 1n)
    const keysBefore = blockKeys(editor)
    expect(blockTexts(editor)).toEqual(['Alpha.', 'Beta.', 'Gamma.'])

    // The agent rewrites the whole note, changing only block 1. Because the commit
    // carries AGENT_WRITE_ORIGIN (a local origin the inbound path applies), the
    // change bounces into the editor synchronously.
    reconcileTargetIntoLoro(
      doc,
      root,
      targetFromMarkdown('Alpha.\n\nBeta edited.\n\nGamma.\n', NODES),
    )

    expect(blockTexts(editor)).toEqual(['Alpha.', 'Beta edited.', 'Gamma.'])
    // Every top-level block kept its NodeKey — nothing was rebuilt, so a mounted
    // decorator sub-app under any block would survive the agent write.
    expect(blockKeys(editor)).toEqual(keysBefore)
  })

  it('an agent write that changes nothing bounces no update at all (0 ops)', () => {
    const { doc, root, editor } = boundEditor(PARAS, 1n)
    const keysBefore = blockKeys(editor)

    const ops = reconcileTargetIntoLoro(doc, root, targetFromMarkdown(PARAS, NODES))

    expect(ops).toBe(0)
    expect(blockTexts(editor)).toEqual(['Alpha.', 'Beta.', 'Gamma.'])
    expect(blockKeys(editor)).toEqual(keysBefore)
  })
})

// ---------------------------------------------------------------------------
// Duplicate blocks — the position-bias mitigation and its HONEST residual
// ---------------------------------------------------------------------------

describe('duplicate blocks: position bias reduces, but does not solve, the ambiguity', () => {
  it('IMPROVEMENT: changing the FIRST of two identical blocks keeps identity aligned', () => {
    // Two byte-identical paragraphs — indistinguishable by content alone.
    const { doc, root } = seedDoc('Same.\n\nSame.\n', 1n)
    const id0 = blockId(root, 0)
    const id1 = blockId(root, 1)
    const before = collectIds(root)

    // The user changes the FIRST block and keeps the second.
    reconcileTargetIntoLoro(doc, root, targetFromMarkdown('Changed.\n\nSame.\n', NODES))

    // No container is destroyed — both survive (no hard history break).
    expect(survival(before, collectIds(root))).toBe(1)
    expect(blockText(root, 0).toString()).toBe('Changed.')
    expect(blockText(root, 1).toString()).toBe('Same.')

    // Position bias pairs the still-"Same" target to the SAME-INDEX carrier (id1),
    // freeing id0 — the block the user actually changed — to absorb "Changed". So
    // identity now FOLLOWS intent. (The ordinal spike mis-assigned these: it left
    // id0 backing "Same" and id1 absorbing "Changed".)
    expect(blockId(root, 0)).toBe(id0)
    expect(blockId(root, 1)).toBe(id1)
  })

  it('IMPROVEMENT: a concurrent edit to the OTHER identical block no longer collides', () => {
    const seed = seedDoc('Same.\n\nSame.\n', 1n)
    const snapshot = seed.doc.export({ mode: 'snapshot' })
    const a = forkDoc(snapshot, 2n)
    const b = forkDoc(snapshot, 3n)

    // Window B edits the SECOND identical block in place.
    const b1 = blockText(b.root, 1)
    b1.insert(b1.length, ' <B second>')
    b.doc.commit({ origin: 'user' })

    // Window A's agent changes the FIRST block, keeping the second. Position bias
    // reuses the FIRST block's container for "Changed" and leaves the second's
    // container — the very one B is editing — untouched.
    reconcileTargetIntoLoro(a.doc, a.root, targetFromMarkdown('Changed.\n\nSame.\n', NODES))

    a.doc.import(b.doc.export({ mode: 'update' }))
    b.doc.import(a.doc.export({ mode: 'update' }))
    expect(a.doc.toJSON()).toEqual(b.doc.toJSON())

    // The two edits stayed on SEPARATE blocks — no collision on the wrong one.
    // (The ordinal spike merged both into one container here.)
    expect(blockText(a.root, 0).toString()).toBe('Changed.')
    expect(blockText(a.root, 1).toString()).toBe('Same. <B second>')
  })

  it('RESIDUAL: position bias CANNOT disambiguate true duplicates when the count changes', () => {
    // Three byte-identical paragraphs.
    const { doc, root } = seedDoc('Same.\n\nSame.\n\nSame.\n', 1n)
    const ids = [blockId(root, 0), blockId(root, 1), blockId(root, 2)]

    // The rewrite has only TWO identical paragraphs — one was removed, but content
    // cannot say WHICH: the user may have meant to delete any of the three.
    reconcileTargetIntoLoro(doc, root, targetFromMarkdown('Same.\n\nSame.\n', NODES))

    expect(orderedChildren(root)).toHaveLength(2)
    const after = collectIds(root)

    // Position bias keeps the two LEADING carriers and drops the LAST (id2),
    // regardless of which one the user — or a concurrent peer — considered live.
    // Only NodeKey identity, which the agent path lacks, could resolve this. This
    // is the documented duplicate-block caveat, asserted so a regression is loud.
    expect(after.has(ids[0]!)).toBe(true)
    expect(after.has(ids[1]!)).toBe(true)
    expect(after.has(ids[2]!)).toBe(false)
  })
})
