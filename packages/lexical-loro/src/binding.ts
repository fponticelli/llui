/**
 * `loroCollab(config)` — the binding that drives both directions.
 *
 * It composes `to-loro.ts` (Lexical → Loro), `to-lexical.ts` (Loro → Lexical)
 * and `seed.ts` (boot) into one `register(editor)` step you hand to
 * `lexicalForeign({ history: false, seedMode: 'deferred', register })`. The
 * returned handle satisfies `@llui/markdown-editor`'s `CollabBinding`
 * structurally, so that package needs no Loro dependency of its own.
 *
 * ── Transport ──────────────────────────────────────────────────────────────
 *
 * There is none, deliberately. `LoroDoc` already exposes the whole wire surface
 * (`subscribeLocalUpdates` / `import` / `export`), so a transport is a dozen
 * lines the consumer writes against their own websocket, WebRTC channel or
 * `loro-websocket` provider — and baking one in would make this package own a
 * connection lifecycle it has no way to test honestly. Pass the same `LoroDoc`
 * to your provider and to `loroCollab`.
 *
 * ── The three echo layers, and where each one lives ────────────────────────
 *
 * All three are required; any one missing produces an infinite loop or, worse,
 * a silent data-loss bug:
 *
 *  a. Loro → us. A LOCAL Loro batch is our own outbound write completing its
 *     commit. `applyLoroToLexical` drops it (`to-lexical.ts`). Without this the
 *     binding re-enters `editor.update` from inside a Lexical update listener.
 *  b. us → Lexical → us. Our inbound writeback is tagged `COLLABORATION_TAG`,
 *     which `syncLexicalToLoro` skips (`to-loro.ts`). Without this every remote
 *     keystroke is echoed straight back to its sender.
 *  c. THE SEAM. This binding NEVER emits `PROGRAMMATIC_TAG`.
 *     `packages/lexical/src/foreign.ts` treats that tag as "the host pushed new
 *     content — cancel pending outbound work and rebase", so a remote writeback
 *     carrying it would cancel the local user's in-flight debounced `onChange`
 *     and the host's persistence would go dark whenever a peer types. There is
 *     no code here to enforce this; there is simply no line that emits it, and
 *     `test/to-lexical.test.ts` pins that.
 *
 * ── Undo (v1) ──────────────────────────────────────────────────────────────
 *
 * Undo stays LEXICAL'S LOCAL HISTORY. This binding does not install an
 * `externalUndo` owner, because there is no CRDT-aware undo manager for it to
 * own — a Loro `UndoManager` is additive, later work. Consequently a host must
 * NOT disable its built-in history for this binding the way it would for a
 * CRDT-owned one; see the note on `LoroCollab.externalUndo`.
 *
 * KNOWN LIMITATION, and hosts should surface it rather than be surprised by it:
 * Lexical's history is SNAPSHOT-based and is not collaboration-aware
 * (`@lexical/history` 0.48 has no notion of `COLLABORATION_TAG`, so our inbound
 * writeback is recorded as though the local user had typed it). Undoing after a
 * remote edit therefore re-applies a snapshot taken BEFORE that edit, which
 * rewinds the REMOTE change — and, since the outbound sync replays the snapshot
 * faithfully, removes it for every peer. Same-parent moves, deletes and text
 * edits all undo correctly when no remote edit has interleaved.
 *
 * This is a property of snapshot-based undo, not of tagging: no update tag
 * avoids it (merging folds the remote state into the current entry and the next
 * undo still pops past it). Only an operation-based, CRDT-aware undo manager
 * fixes it. The behaviour and its blast radius — it stays CONVERGENT, every peer
 * agrees — are pinned in `test/harden.test.ts`.
 */

import type { LexicalEditor } from 'lexical'
import { LoroDoc } from 'loro-crdt'

import { ContainerNodeMap } from './mapping.js'
import { bootstrapDocument, type BootstrapOutcome } from './seed.js'
import { initDoc, type ElementContainer } from './schema.js'
import { LORO_TEXT_FORMATS } from './text.js'
import { applyLoroToLexical } from './to-lexical.js'
import { OUTBOUND_ORIGIN, syncLexicalToLoro } from './to-loro.js'

export interface LoroCollabConfig {
  /** The shared document. Created if omitted — pass your provider's doc. */
  readonly doc?: LoroDoc
  /**
   * Whether THIS peer may seed an empty shared document. Default `true`.
   * Set `false` on peers that join rather than create, and on any peer whose
   * transport has not completed its first sync — an unsynced document looks
   * empty, and seeding one races the content about to arrive.
   */
  readonly shouldBootstrap?: boolean
  /**
   * Fill an empty shared document with this peer's default content. Runs once,
   * inside a Lexical update. `@llui/markdown-editor` supplies this as
   * `CollabHooks.seed`, which converts its `defaultValue` markdown.
   */
  readonly seed?: (editor: LexicalEditor) => void
  /** Commit origin stamped on this binding's writes. Defaults to `'lexical-loro'`. */
  readonly origin?: string
  /** Called after boot with what happened — seeded, adopted, or still waiting. */
  readonly onBootstrap?: (outcome: BootstrapOutcome) => void
}

/** Live handle returned by {@link loroCollab}. */
export interface LoroCollab {
  /**
   * Wire the binding onto an editor; pass as `lexicalForeign({ register })`.
   * Returns a disposer that unsubscribes both directions.
   *
   * Satisfies `@llui/markdown-editor`'s `CollabBinding` structurally.
   */
  register: (editor: LexicalEditor) => () => void
  /** The shared document. Hand this to your transport. */
  readonly doc: LoroDoc
  /** The root element container mirroring Lexical's `RootNode`. */
  readonly root: ElementContainer
  /** The ContainerID ↔ NodeKey registry. Exposed for tests and diagnostics. */
  readonly mapping: ContainerNodeMap
  /**
   * Always `undefined` in v1 — this binding does NOT own the undo stack.
   *
   * Declared so the field is part of the contract rather than an omission a host
   * has to guess about: `lexicalForeign` turns its built-in history off when an
   * `externalUndo` owner is present, and a host that disables history for this
   * binding leaves the user with NO undo at all. When a Loro `UndoManager`
   * lands, this becomes the registration function and hosts need no change.
   */
  readonly externalUndo?: undefined
  /** Re-run the boot decision — call after your transport's first sync. */
  bootstrap: (editor: LexicalEditor) => BootstrapOutcome
}

/**
 * Build a collaborative-editing binding over a Loro document.
 *
 * The document is configured for this package's schema (`initDoc`) immediately,
 * not at `register` time, so a transport may be attached to `collab.doc` before
 * any editor exists.
 */
export function loroCollab(config: LoroCollabConfig = {}): LoroCollab {
  const doc = config.doc ?? new LoroDoc()
  // Must run on EVERY peer: `configTextStyle` is local configuration, not
  // replicated state, and a peer that skips it resolves marks under different
  // expand rules and diverges. Idempotent, so a shared doc may be passed to
  // more than one binding.
  const root = initDoc(doc, LORO_TEXT_FORMATS)
  const mapping = new ContainerNodeMap()
  const origin = config.origin ?? OUTBOUND_ORIGIN

  const bootstrap = (editor: LexicalEditor): BootstrapOutcome => {
    const outcome = bootstrapDocument({
      doc,
      root,
      mapping,
      editor,
      seed: config.seed,
      shouldBootstrap: config.shouldBootstrap,
    })
    config.onBootstrap?.(outcome)
    return outcome
  }

  const register = (editor: LexicalEditor): (() => void) => {
    const outboundTarget = { doc, root, mapping, origin }
    const inboundTarget = { doc, root, mapping, editor }

    // Inbound BEFORE outbound: the subscription must be live before the
    // bootstrap writes anything, or a document arriving mid-boot is missed.
    const unsubscribe = doc.subscribe((batch) => {
      applyLoroToLexical(inboundTarget, batch)
    })
    const unregister = editor.registerUpdateListener((payload) => {
      syncLexicalToLoro(outboundTarget, payload)
    })

    bootstrap(editor)

    return () => {
      unregister()
      unsubscribe()
    }
  }

  return { register, doc, root, mapping, bootstrap, externalUndo: undefined }
}
