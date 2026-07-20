/**
 * `@llui/lexical-loro` — Loro CRDT binding for the LLui ↔ Lexical editor.
 *
 * Start at {@link loroCollab}: it composes everything below into a
 * `register(editor)` plus an `externalUndo(editor)` you hand to
 * `lexicalForeign({ seedMode: 'deferred', register, externalUndo })`, and it
 * satisfies `@llui/markdown-editor`'s `CollabBinding` structurally.
 *
 * - `schema.ts`     — the Loro container shape mirroring a Lexical EditorState
 * - `order.ts`      — fractional indexing: sibling order as a sortable property
 * - `mapping.ts`    — the ContainerID ↔ NodeKey registry (the core invariant)
 * - `text.ts`       — format-bitmask ↔ named-mark conversion, the run diff, and
 *                     the cursor-biased text diff
 * - `to-loro.ts`    — Lexical → Loro: the update-listener-driven mirror
 * - `to-lexical.ts` — Loro → Lexical: the persistent, in-place mirror
 * - `seed.ts`       — boot: seed an empty shared document, or adopt a populated one
 * - `undo.ts`       — peer-scoped, CRDT-aware undo/redo over Loro's `UndoManager`
 * - `binding.ts`    — `loroCollab`: both directions plus the echo guards
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 *
 * DOCUMENT SYNC plus LOCAL-ONLY UNDO. Undo is owned by this binding
 * (`LoroCollab.externalUndo`), so a host MUST disable `@lexical/history` —
 * `lexicalForeign` does that automatically once `externalUndo` is passed. Still
 * out of scope: presence and remote cursors (additive, over Loro's
 * `EphemeralStore`), and text-node `style` / `mode` / `detail` — the run model
 * is `{text, format}`.
 *
 * ── Echo suppression ───────────────────────────────────────────────────────
 *
 * Three independent layers are ALL required; see `binding.ts` for where each
 * one lives and what breaks without it. The one with no code to enforce it:
 * this binding NEVER emits `PROGRAMMATIC_TAG`, because
 * `packages/lexical/src/foreign.ts` reads that tag as "the host pushed content —
 * cancel pending outbound work", which would make the host's persistence go dark
 * whenever a peer types.
 *
 * `test/expand-semantics.test.ts` (51 tests) is the specification for the
 * text-format half; read it before touching `text.ts`. `test/network.ts` is the
 * multi-peer convergence harness, driven by `test/convergence.test.ts`.
 */

export {
  ROOT_CONTAINER,
  KEY_TYPE,
  KEY_PROPS,
  KEY_CHILDREN,
  KEY_UUID,
  KEY_POS,
  KEY_KIND,
  KEY_TEXT,
  DECORATOR_TYPE,
  KEY_BRIDGE_TYPE,
  KEY_DATA,
  ROOT_TYPE,
  TEXT_MARK_EXPAND,
  initDoc,
  newUuid,
  createElementChild,
  createTextChild,
  setChildPosition,
  deleteChild,
  orderedChildren,
  childCount,
  elementType,
  elementProps,
  elementChildren,
  isElementContainer,
  isTextContainer,
  isDecoratorElement,
  containerId,
  containerIsLive,
  type PropValue,
  type PropsContainer,
  type ElementContainer,
  type ElementShape,
  type ChildrenContainer,
  type ChildContainer,
  type ChildCarrier,
  type CarrierShape,
  type TextCarrier,
  type TextCarrierShape,
  type ChildEntry,
  type ChildKind,
  type ExpandType,
} from './schema.js'

export { DIGITS, between, allocate, allocateAt, jitterFor, comparePositions } from './order.js'

export { ContainerNodeMap, type MappingEntry, type LivenessProbe } from './mapping.js'

export {
  LORO_TEXT_FORMATS,
  FORMAT_BITS,
  KNOWN_FORMAT_MASK,
  formatBit,
  formatsFromBitmask,
  bitmaskFromFormats,
  bitmaskFromAttributes,
  runsText,
  normalizeRuns,
  runsFromDelta,
  runsFromText,
  diffRunFormats,
  applyMarkOps,
  diffTextWithCursor,
  diffText,
  applyTextDiff,
  type LoroTextFormat,
  type TextRun,
  type TextDeltaItem,
  type MarkOp,
  type TextDiff,
} from './text.js'

export {
  OUTBOUND_ORIGIN,
  OUTBOUND_SKIP_TAGS,
  syncLexicalToLoro,
  seedLoroFromLexical,
  longestIncreasingSubsequence,
  type OutboundTarget,
  type OutboundUpdate,
} from './to-loro.js'

export {
  INBOUND_TAGS,
  applyLoroToLexical,
  adoptLoroDocument,
  type InboundTarget,
} from './to-lexical.js'

export {
  bootstrapDocument,
  isSharedDocumentEmpty,
  type BootstrapOutcome,
  type BootstrapTarget,
} from './seed.js'

export {
  LORO_UNDO_ORIGIN,
  UNDO_ORIGINS,
  DEFAULT_MERGE_INTERVAL,
  DEFAULT_MAX_UNDO_STEPS,
  registerLoroUndo,
  type LoroUndoOptions,
} from './undo.js'

export { loroCollab, type LoroCollab, type LoroCollabConfig } from './binding.js'

/**
 * Agent-write: apply an LLM's full-document markdown REWRITE to the shared
 * document by CONTENT, so unchanged blocks keep their `ContainerID`s (hence their
 * `NodeKey`s and mounted decorator sub-apps, and any concurrent peer edit into
 * them) instead of being recreated wholesale.
 *
 * `reconcileTargetIntoLoro` is a SIBLING to `syncLexicalToLoro`: it writes Loro
 * directly under {@link AGENT_WRITE_ORIGIN} and does NOT consult the
 * `ContainerNodeMap` (content matching is the point; the mapping self-heals on
 * the inbound bounce into any live editor). The caller owns the markdown → target
 * parse with its own `@lexical/markdown` transformer set — this package never
 * depends on `@lexical/markdown` — and projects the parsed editor state with
 * {@link targetFromEditorState} / {@link projectTarget}.
 *
 * Guarantees and the documented DUPLICATE-BLOCK caveat live on the functions and
 * in the README.
 */
export {
  AGENT_WRITE_ORIGIN,
  reconcileTargetIntoLoro,
  projectTarget,
  targetFromEditorState,
  type TargetElement,
  type TargetText,
  type TargetChild,
} from './agent-write.js'
