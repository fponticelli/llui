/**
 * `@llui/lexical-loro` — Loro CRDT binding for the LLui ↔ Lexical editor.
 *
 * Start at {@link loroCollab}: it composes everything below into one
 * `register(editor)` you hand to `lexicalForeign({ history: false,
 * seedMode: 'deferred', register })`, and it satisfies
 * `@llui/markdown-editor`'s `CollabBinding` structurally.
 *
 * - `schema.ts`     — the Loro container shape mirroring a Lexical EditorState
 * - `order.ts`      — fractional indexing: sibling order as a sortable property
 * - `mapping.ts`    — the ContainerID ↔ NodeKey registry (the core invariant)
 * - `text.ts`       — format-bitmask ↔ named-mark conversion, the run diff, and
 *                     the cursor-biased text diff
 * - `to-loro.ts`    — Lexical → Loro: the update-listener-driven mirror
 * - `to-lexical.ts` — Loro → Lexical: the persistent, in-place mirror
 * - `seed.ts`       — boot: seed an empty shared document, or adopt a populated one
 * - `binding.ts`    — `loroCollab`: both directions plus the echo guards
 *
 * ── Scope (v1) ─────────────────────────────────────────────────────────────
 *
 * DOCUMENT SYNC ONLY. No presence, no remote cursors, no CRDT-aware undo — undo
 * stays Lexical's local history, so a host must NOT disable its built-in history
 * for this binding (see `LoroCollab.externalUndo`). Text-node `style`, `mode`
 * and `detail` are not represented: the run model is `{text, format}`. Presence
 * over Loro's `EphemeralStore` is additive, later work.
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

export { loroCollab, type LoroCollab, type LoroCollabConfig } from './binding.js'
