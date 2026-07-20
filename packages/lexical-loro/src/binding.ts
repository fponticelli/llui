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
 * ── Undo ───────────────────────────────────────────────────────────────────
 *
 * This binding OWNS undo, via `externalUndo` (`undo.ts`, a Loro `UndoManager`
 * scoped to this peer). Hosts must therefore turn their built-in
 * `@lexical/history` stack off — `lexicalForeign` does that for you the moment
 * `externalUndo` is present, so the two can never both be live.
 *
 * Loro's manager is operation-based and PeerID-scoped: undo reverts exactly the
 * local user's own last change and never a peer's, which snapshot-based history
 * cannot do at any tag setting. See `undo.ts` for why, and for the echo seam the
 * undo batches travel through.
 */

import type { LexicalEditor } from 'lexical'
import { LoroDoc } from 'loro-crdt'

import { AGENT_WRITE_ORIGIN } from './agent-write.js'
import { ContainerNodeMap } from './mapping.js'
import { bootstrapDocument, type BootstrapOutcome } from './seed.js'
import { initDoc, type ElementContainer } from './schema.js'
import { LORO_TEXT_FORMATS } from './text.js'
import { applyLoroToLexical } from './to-lexical.js'
import { OUTBOUND_ORIGIN, syncLexicalToLoro } from './to-loro.js'
import { registerLoroUndo, UNDO_ORIGINS, type LoroUndoOptions } from './undo.js'

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
  /**
   * Tuning for the peer-scoped undo manager installed by
   * {@link LoroCollab.externalUndo} — merge window, stack depth, excluded
   * origins. Defaults are in `undo.ts`; the `doc` is supplied by the binding.
   */
  readonly undo?: Omit<LoroUndoOptions, 'doc'>
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
   * Install this binding's CRDT-aware undo/redo on the editor; pass as
   * `lexicalForeign({ externalUndo })`. Returns a disposer.
   *
   * Undo is LOCAL-ONLY: it reverts this peer's own commits and leaves every
   * other peer's concurrent edits standing (`undo.ts`). Registering it forces
   * `lexicalForeign`'s built-in `@lexical/history` stack off, which is the point
   * — a snapshot-based local stack would rewind remote work for everyone.
   *
   * Registration is SEPARATE from {@link LoroCollab.register} so a host that
   * genuinely wants its own undo owner can decline it. Do not register it twice.
   */
  readonly externalUndo: (editor: LexicalEditor) => () => void
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
    // `localOrigins` are the local batches the inbound path must still APPLY
    // rather than drop as an echo (see `to-lexical.ts`). Both are passed
    // unconditionally: only a Loro `UndoManager` produces `UNDO_ORIGINS` and only
    // `reconcileTargetIntoLoro` produces `AGENT_WRITE_ORIGIN`, so listing them is
    // inert until one occurs — and the inbound path stays independent of whether
    // `externalUndo` was registered or an agent write ever happens.
    const localOrigins = [...UNDO_ORIGINS, AGENT_WRITE_ORIGIN]
    const inboundTarget = { doc, root, mapping, editor, localOrigins }

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

  const externalUndo = (editor: LexicalEditor): (() => void) =>
    registerLoroUndo({ doc, ...config.undo }, editor)

  return { register, doc, root, mapping, bootstrap, externalUndo }
}
