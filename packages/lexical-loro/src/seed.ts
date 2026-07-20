/**
 * Boot: seed an empty shared document, or adopt a populated one.
 *
 * This is the shortest file in the package and the one with the most damaging
 * failure mode. Getting the branch backwards means the SECOND peer to open a
 * document "seeds" it — writing its local default over content everyone else is
 * already editing. So the decision is made against the SHARED document's own
 * emptiness, never against the local editor's, and both orders are pinned by
 * tests (`test/seed.test.ts`).
 *
 * ── Why the seed suppresses the outbound listener ──────────────────────────
 *
 * The seed runs as a Lexical update, which would ordinarily be mirrored by the
 * registered outbound listener. It is tagged `COLLABORATION_TAG` so that does
 * NOT happen, and `seedLoroFromLexical` writes the shared document explicitly
 * instead. One write path rather than two means the seed cannot half-land if the
 * binding's listener registration order ever changes, and the mapping is
 * populated by the same walk that writes the containers.
 *
 * ── Concurrent seeding ─────────────────────────────────────────────────────
 *
 * Two peers can each find the shared document empty before hearing from one
 * another. Nothing can arbitrate that without a coordinator, so the requirement
 * is CONVERGENCE, not deduplication: both seeds merge and every peer ends up
 * with both blocks. `initDoc`'s `ensureMergeable*` root containers are what make
 * that merge possible — with a plain `setContainer` the map slot's
 * last-writer-wins would silently discard one peer's entire document. Apps that
 * need exactly one bootstrapper should elect one and pass `shouldBootstrap`
 * accordingly.
 */

import { $getRoot, COLLABORATION_TAG, HISTORY_MERGE_TAG, type LexicalEditor } from 'lexical'
import type { LoroDoc } from 'loro-crdt'

import type { ContainerNodeMap } from './mapping.js'
import { childCount, type ElementContainer } from './schema.js'
import { adoptLoroDocument } from './to-lexical.js'
import { seedLoroFromLexical } from './to-loro.js'

/** What {@link bootstrapDocument} did. */
export type BootstrapOutcome =
  /** The shared document was empty and this peer filled it from `seed`. */
  | 'seeded'
  /** The shared document had content; the editor now mirrors it. */
  | 'adopted'
  /** Empty document, but this peer is not allowed to bootstrap it. */
  | 'waiting'

export interface BootstrapTarget {
  readonly doc: LoroDoc
  /** The root element container, as returned by `initDoc`. */
  readonly root: ElementContainer
  readonly mapping: ContainerNodeMap
  readonly editor: LexicalEditor
  /**
   * Fill an EMPTY editor with this peer's default content. Runs inside a Lexical
   * update, at most once, and only when the shared document is empty.
   */
  readonly seed?: ((editor: LexicalEditor) => void) | undefined
  /**
   * Whether this peer may bootstrap an empty shared document. Default `true`.
   * Set `false` on peers that join rather than create — with a real transport,
   * "empty" before the first sync is indistinguishable from "genuinely empty",
   * and a joining peer that seeds races the document it was about to receive.
   */
  readonly shouldBootstrap?: boolean | undefined
}

/** Whether the shared document holds any content at all. */
export function isSharedDocumentEmpty(root: ElementContainer): boolean {
  return childCount(root) === 0
}

/**
 * Bring the editor and the shared document into agreement at boot.
 *
 * Idempotent: calling it again on a populated document adopts (writing nothing
 * and churning no NodeKeys), so a binding may safely call it on every sync
 * event without tracking whether it already ran.
 */
export function bootstrapDocument(target: BootstrapTarget): BootstrapOutcome {
  if (!isSharedDocumentEmpty(target.root)) {
    adoptLoroDocument(target)
    return 'adopted'
  }
  if (target.shouldBootstrap === false) return 'waiting'

  const seed = target.seed
  if (seed !== undefined) {
    target.editor.update(
      () => {
        // Only fill a genuinely empty editor: a remount over a live editor must
        // not have its content replaced by the default.
        if (!$getRoot().isEmpty()) return
        seed(target.editor)
      },
      {
        // Suppress the outbound listener — the shared document is written below,
        // by one explicit path. `HISTORY_MERGE_TAG` keeps the seed out of the
        // user's undo stack, so the first Cmd+Z cannot empty the document.
        tag: [COLLABORATION_TAG, HISTORY_MERGE_TAG],
        discrete: true,
      },
    )
  }

  seedLoroFromLexical(
    { doc: target.doc, root: target.root, mapping: target.mapping },
    target.editor.getEditorState(),
  )
  return 'seeded'
}
