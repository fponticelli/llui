// The commit hub: ONE `registerUpdateListener` for every plugin that only wants
// to know where the selection is (issue #74).
//
// Before this, each overlay plugin registered its own update listener and opened
// its own `editorState.read()` to walk the selection — six listeners, six reads
// and up to six caret measurements for a single keystroke, all deriving the same
// handful of facts. The hub opens ONE read per commit, derives the facts every
// such plugin shares, and hands each subscriber the same plain {@link CommitFacts}
// object.
//
// Three properties make the plain-object shape work rather than merely look tidy:
//
//   1. **Subscribers run INSIDE the shared read.** A plugin that needs something
//      the facts don't carry (a `$findMatchingParent` walk to a code block, a
//      table-cell lookup) just calls the `$` function directly — it is already in
//      a read context, so the exotic case costs nothing extra and the hub does
//      not have to anticipate it. That is what keeps the facts small AND keeps
//      the hub free of any `@lexical/*` dependency beyond core.
//   2. **`emit` is buffered for the duration of the dispatch.** The read context
//      is read-only; a `send` that reaches a plugin's reducer can commit DOM,
//      which can move focus, which can dispatch a Lexical command back into the
//      editor. Under 0.49 that reroutes through `$beginUpdate` and warns in dev
//      (under 0.48 it silently dropped the write). Buffering makes the
//      read-then-dispatch anti-pattern unrepresentable instead of a rule plugins
//      have to remember.
//   3. **Everything expensive is lazy and memoized per commit.** `caretRect()`
//      measures at most once no matter how many plugins ask, and `selectionOnly`
//      lets an element-anchored plugin skip its measurement entirely on a caret
//      move: a commit that dirtied no node cannot have moved an element's box.
//      The same rule governs the non-geometric work — `textBeforeCaret` is an
//      O(text-node) string copy and `ancestorsOf` a tree climb, so both are
//      derived on first ask and their memos allocated with them. An editor
//      loading only `table` + `code-language` must not pay for the typeaheads'
//      substring, and one loading only the typeaheads must not pay for a rect map.
//
// The listener is registered on the FIRST subscription, so an editor whose
// plugins never call `onCommit` pays nothing at all for the hub's existence.
//
// ## The ordering contract
//
// One commit runs BATCHED, not interleaved: every subscriber refreshes inside the
// one shared read, and only then does every emission drain, in subscription
// order. Six private update listeners used to run A-refresh → A-emit →
// B-refresh → B-emit, so plugin A's overlay had already reconciled by the time
// plugin B measured. Reducer order and synchronicity are unchanged; WHEN a
// reducer runs relative to another plugin's refresh is not.
//
// That is a deliberate behavioural change, and the safer of the two orders (no
// reconcile can move layout under a measurement already taken). It is only
// equivalent for the shipped plugins because nothing they emit during a commit
// carries an effect and every overlay they render is portaled out of the editor's
// flow — both pinned by `@llui/markdown-editor`'s `commit-ordering.test.ts`, and
// the order itself pinned by `test/commit.test.ts` here. A plugin that genuinely
// needs interleaving has to keep its own update listener and say why.

import {
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  type BaseSelection,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import type { PluginContext } from './plugin.js'

/**
 * The selection facts shared by every per-commit plugin, derived once.
 *
 * A facts object is valid ONLY for the duration of the callback it is handed to:
 * it is scoped to one read context, and its geometry memo is scoped to one
 * commit. Do not retain it — copy out the plain values instead.
 */
export interface CommitFacts {
  /** The editor this commit belongs to. */
  editor: LexicalEditor
  /**
   * The commit dirtied no node — a pure selection move.
   *
   * The reconciler wrote nothing, so no element's box can have shifted: an
   * element-anchored overlay whose anchor node is unchanged may skip its
   * `getBoundingClientRect` outright. (Scroll and resize move boxes without any
   * commit at all; those arrive through the host's viewport listener, not here.)
   */
  selectionOnly: boolean
  /** The live selection, or null. Already resolved — no `$getSelection()` needed. */
  selection: BaseSelection | null
  /** The selection is a `RangeSelection` (caret or text range). */
  isRange: boolean
  /** The selection is a collapsed `RangeSelection` — i.e. a bare caret. */
  isCollapsed: boolean
  /** The range anchor's node, or null when the selection is not a range. */
  anchorNode: LexicalNode | null
  /**
   * The anchor text node's content up to the caret — the substring every
   * typeahead trigger (`/`, `@`, `[[`) scans. Null unless the selection is a
   * collapsed range whose anchor is a `TextNode`, which is exactly the condition
   * all three typeaheads already guard on.
   *
   * Derived on first read and memoized for the commit (it is an O(text-node)
   * string copy), so an editor with no typeahead plugin never pays for it.
   */
  readonly textBeforeCaret: string | null
  /**
   * `node` and its ancestors up to (excluding) the root — i.e. exactly the chain
   * `$findMatchingParent` walks, memoized per commit per node key.
   *
   * This is the one shared fact that is a WALK rather than a field, and it is
   * where the real per-commit work was: three plugins each climbed the tree from
   * the same anchor on every keystroke (code-language looking for a `CodeNode`,
   * the floating toolbar for a `LinkNode`, table for a `TableCellNode` — and
   * `$getTableCellNodeFromLexicalNode` is literally `$findMatchingParent`). They
   * now scan one shared array instead. Pass `facts.anchorNode` for the usual
   * case; a plugin working from some other node (a table selection's anchor,
   * which the hub cannot resolve without depending on `@lexical/table`) passes
   * that instead and simply misses the memo.
   */
  ancestorsOf: (node: LexicalNode | null) => readonly LexicalNode[]
  /**
   * Viewport rect of the DOM selection range, measured at most once per commit
   * however many subscribers ask. Null off-DOM or with no live range.
   */
  caretRect: () => DOMRect | null
  /**
   * Viewport rect of a node's element, measured at most once per commit per key.
   * Null when the key has no element (not yet reconciled, or detached).
   */
  elementRect: (key: string) => DOMRect | null
}

/** A per-commit subscriber. Runs inside the shared read context. */
export type CommitListener = (facts: CommitFacts) => void

/**
 * The host-owned hub. It IS the {@link PluginContext} a plugin's `register`
 * receives — `lexicalForeign` builds one per editor and hands it straight over,
 * and a test driving a plugin standalone can do the same rather than hand-rolling
 * a context object.
 */
export interface CommitHub<Emit> extends PluginContext<Emit> {
  /** Tear down the update listener (if one was ever registered). */
  dispose: () => void
}

/** Shared empty chain, so `ancestorsOf(null)` allocates nothing. */
const EMPTY_CHAIN: readonly LexicalNode[] = []

/**
 * Report an isolated throw instead of swallowing it.
 *
 * Unconditional (not dev-gated), for the reason `@llui/dom` gives for the same
 * decision in its subscriber sweep (7a284002): a gated log would make the throw
 * vanish entirely in a production build, which is strictly worse than the escape
 * the isolation replaces.
 */
function reportHubError(what: string, err: unknown): void {
  console.error(`[llui/lexical commit hub] ${what} threw`, err)
}

/** Derive the shared facts. MUST be called inside an editor-state read. */
function deriveFacts(editor: LexicalEditor, selectionOnly: boolean): CommitFacts {
  const selection = $getSelection()
  const isRange = $isRangeSelection(selection)
  const isCollapsed = isRange && selection.isCollapsed()
  const anchorNode = isRange ? selection.anchor.getNode() : null
  // Captured eagerly (it is one property read) because the lazy `textBeforeCaret`
  // getter below cannot reach `selection` once TypeScript's narrowing is gone.
  const offset = isRange ? selection.anchor.offset : 0

  // `undefined` = not derived yet, `null` = derived and absent. Every memo is
  // per-facts-object, so they expire with the commit that created them — and
  // every one of them is allocated on FIRST USE, not up front: an editor loading
  // only `table` never asks for a caret rect, and one loading only the typeaheads
  // never asks for an element rect or an ancestor chain.
  let text: string | null | undefined
  let caret: DOMRect | null | undefined
  let rects: Map<string, DOMRect | null> | undefined
  let chains: Map<string, readonly LexicalNode[]> | undefined

  return {
    editor,
    selectionOnly,
    selection,
    isRange,
    isCollapsed,
    anchorNode,
    // Lazy like the geometry, for the same reason: `getTextContent().slice()` is
    // an O(text-node) string copy, and only the three typeaheads read it. An
    // editor running `table` + `code-language` used to pay it on every keystroke
    // and never look at the result. A getter rather than a thunk so the three
    // call sites stay a plain field read.
    get textBeforeCaret(): string | null {
      if (text === undefined) {
        text =
          isCollapsed && anchorNode !== null && $isTextNode(anchorNode)
            ? anchorNode.getTextContent().slice(0, offset)
            : null
      }
      return text
    },
    ancestorsOf: (node) => {
      if (node === null) return EMPTY_CHAIN
      const key = node.getKey()
      chains ??= new Map()
      const cached = chains.get(key)
      if (cached !== undefined) return cached
      const chain: LexicalNode[] = []
      for (let curr: LexicalNode | null = node; curr !== null; curr = curr.getParent()) {
        if ($isRootNode(curr)) break
        chain.push(curr)
      }
      chains.set(key, chain)
      return chain
    },
    caretRect: () => {
      if (caret === undefined) {
        const dom = typeof window === 'undefined' ? null : window.getSelection()
        caret = dom && dom.rangeCount > 0 ? dom.getRangeAt(0).getBoundingClientRect() : null
      }
      return caret
    },
    elementRect: (key) => {
      rects ??= new Map()
      const cached = rects.get(key)
      if (cached !== undefined) return cached
      const element = editor.getElementByKey(key)
      const rect = element ? element.getBoundingClientRect() : null
      rects.set(key, rect)
      return rect
    },
  }
}

/**
 * Create the per-editor commit hub. `emit` is the host's raw emit; the returned
 * `emit` is the buffered one every plugin should use.
 */
export function createCommitHub<Emit>(
  editor: LexicalEditor,
  emit: (msg: Emit) => void,
): CommitHub<Emit> {
  const listeners = new Set<CommitListener>()
  let unregister: (() => void) | null = null
  // >0 while a dispatch is in flight; emissions queue instead of firing.
  let dispatching = 0
  const queued: Emit[] = []

  /** Run `body` with emissions buffered, then drain them once the read closes. */
  const buffered = (body: () => void): void => {
    dispatching++
    try {
      body()
    } finally {
      dispatching--
      // The `queued.length > 0` guard is load-bearing for the hot path, not
      // cosmetic (cf. the same call in `@llui/dom`'s `component.ts`): most commits
      // emit nothing — every plugin short-circuits on an unchanged surface — and
      // without it each one still allocates a fresh array from `splice`.
      if (dispatching === 0 && queued.length > 0) {
        // TAKE OWNERSHIP OF THE BATCH BEFORE DELIVERING ANY OF IT. `send` is
        // synchronous in LLui, so a drained emission runs its host reducer — and
        // whatever that reducer's commit triggers — while this loop is still on
        // the stack. `dispatching` is already back at 0 by then, so anything that
        // re-enters the hub (a `withFacts` from a reducer or effect; a nested
        // commit, though Lexical defers those past its listener loop) starts a
        // drain of its own. Iterating `queued` in place let that nested drain
        // restart at index 0 and re-send every message the outer loop had already
        // delivered. Splicing first makes each message the property of exactly one
        // drain — and, because the queue is empty before the first `emit` runs,
        // also means a throw cannot leave delivered messages behind to be replayed
        // on the next commit.
        const batch = queued.splice(0)
        // Isolate each emission INDIVIDUALLY. The host's reducer is not this
        // hub's code, and its throw would otherwise unwind out of Lexical's
        // update-listener loop — which has no isolation of its own — aborting the
        // remaining listeners AND stranding the emissions queued behind it.
        // (A direct `ctx.emit` outside a dispatch is deliberately NOT wrapped:
        // there is only one party on that path, so propagating to the caller is
        // the correct behaviour. Isolation belongs at the multiplexing points.)
        for (const msg of batch) {
          try {
            emit(msg)
          } catch (err) {
            reportHubError('an emission', err)
          }
        }
      }
    }
  }

  const dispatch = (state: EditorState, selectionOnly: boolean): void => {
    if (listeners.size === 0) return
    buffered(() =>
      state.read(() => {
        const facts = deriveFacts(editor, selectionOnly)
        // Iterated IN PLACE — no defensive copy on the keystroke path. Removing
        // an entry during `Set` iteration is well defined in JS (the current one
        // and any later one), which covers the case that actually happens here: a
        // plugin disposing mid-dispatch. Only ADDING can cause a re-visit, and a
        // listener added during a dispatch would simply also see this commit,
        // with facts that are current for it — plugins subscribe at `register`,
        // not from inside a refresh, so that path is theoretical either way.
        for (const listener of listeners) {
          // Isolate each subscriber INDIVIDUALLY, never the sweep as a whole (a
          // single try around the loop would let one bad plugin suppress every
          // plugin after it). Collapsing six private update listeners into one is
          // what makes this fixable in one place: Lexical dispatches update
          // listeners in a bare loop, so one throwing plugin already took the
          // other five — and the host's own outbound-serialize listener — down
          // with it.
          try {
            listener(facts)
          } catch (err) {
            reportHubError('a commit subscriber', err)
          }
        }
      }),
    )
  }

  return {
    emit: (msg) => {
      if (dispatching > 0) queued.push(msg)
      else emit(msg)
    },
    onCommit: (listener) => {
      listeners.add(listener)
      unregister ??= editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) =>
        dispatch(editorState, dirtyElements.size === 0 && dirtyLeaves.size === 0),
      )
      return () => {
        listeners.delete(listener)
        // Hand the listener BACK when the last subscriber leaves, symmetrically
        // with registering it on the first. `dispatch` already early-returns on
        // an empty set, so this is not about correctness — it is about the
        // property the hub advertises ("no subscriber, no listener") continuing
        // to hold after a plugin is disposed, not only before it registered.
        // Re-subscribing registers a fresh one.
        if (listeners.size === 0) {
          unregister?.()
          unregister = null
        }
      }
    },
    withFacts: (fn) => {
      // PER-CALLER, deliberately: `withFacts` answers "what is true right now?",
      // and its callers ask at unrelated moments (a debounced search resolving, a
      // scroll frame). Sharing one derivation across them would need a notion of
      // "the same moment" that only a commit provides.
      //
      // The cost is that a scroll frame in which three element-anchored plugins
      // each call `withFacts` derives the facts three times — no worse than the
      // three private listeners this replaced, but not shared either. Coalescing
      // the viewport path is a follow-up, and belongs with the rAF geometry
      // deferral the design spike left as its own decision (it is the same frame).
      buffered(() => editor.getEditorState().read(() => fn(deriveFacts(editor, false))))
    },
    dispose: () => {
      listeners.clear()
      unregister?.()
      unregister = null
    },
  }
}
