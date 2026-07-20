// Block drag-and-drop reordering — a hover gutter grip that reorders TOP-LEVEL
// blocks, by pointer drag or by keyboard.
//
// ## Why not HTML5 drag-and-drop
// `draggable=true` + `dragover`/`drop` cannot work here: the drag source lives in
// a portaled overlay while the drop zone is a `contenteditable`, and Lexical owns
// the native drag/drop pipeline for content insertion. Hijacking it fights the
// editor. Raw `mousedown` → document `mousemove`/`mouseup` (the same mechanics the
// reference ProseMirror implementation uses) keeps the editor's own drag handling
// untouched and gives exact control over the drop-slot geometry.
//
// ## Why the reorder goes through Lexical, never the DOM
// Moving DOM nodes under a `contenteditable` desynchronizes Lexical's node map
// from the DOM and is reverted on the next reconcile. The commit is a single
// `target.insertAfter(source)` / `insertBefore` inside one `editor.update`, so it
// is ONE undo step, replays correctly through the collab CRDT (`@lexical/yjs`
// observes node moves, not DOM mutations), and preserves the moved node's key —
// selection anchored inside it (or inside any other block) survives.
//
// ## Shape
// All geometry is PURE (see {@link blockAtPoint} / {@link findDropTarget} /
// {@link indicatorRect}): the DOM layer only measures rects and feeds numbers in.
// Everything rendered lives in this plugin's JSON state slice and is drawn with
// the package's shared {@link overlayRoot} primitive — no competing overlay
// system, no imperative DOM writes in the view.
//
// ## Stacking
// Both surfaces sit BELOW the `OVERLAY_Z` scale in `overlay.ts` (60+): the gutter
// grip and the drop indicator are chrome for the document body and must never
// cover a typeahead, the context menu, or the floating toolbar.

import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { button, div, onMount, text, type Renderable, type Signal } from '@llui/dom'
import { definePluginUI } from './ui.js'
import { onViewportChange, overlayRoot } from './overlay.js'
import type { MarkdownPlugin } from './types.js'

/** Stacking levels for this plugin's two surfaces — deliberately below the
 * shared `OVERLAY_Z` scale (60+) so document chrome never covers a menu. */
export const BLOCK_DRAG_Z = { handle: 58, indicator: 59 } as const

/** Pixels of pointer travel before a grip mousedown becomes a drag (below the
 * threshold it is a click, which toggles keyboard grab mode instead). */
const DRAG_THRESHOLD = 5

/** Vertical slack when deciding which block the pointer is "on" — block margins
 * leave real gaps between rects, and the gutter must not flicker across them. */
const HOVER_TOLERANCE = 6

/** How far LEFT of the editor's content box the hover zone extends, i.e. how
 * much room the gutter grip is given. */
const GUTTER_WIDTH = 40

/** The measured viewport geometry of one top-level block. Pure data — the unit
 * of everything below, so all placement logic is testable without a DOM. */
export interface BlockRect {
  key: NodeKey
  top: number
  bottom: number
  left: number
  width: number
}

/** Which side of the target block the source lands on. */
export type Place = 'before' | 'after'

/** A resolved drop slot: "put the dragged block `place` this `key`". */
export interface DropTarget {
  key: NodeKey
  place: Place
}

/** Viewport position of the drop-indicator line. */
export interface IndicatorRect {
  x: number
  y: number
  width: number
}

// ── Pure geometry ───────────────────────────────────────────────────────────

/**
 * The block whose vertical band contains `clientY`, or `null` when the pointer
 * is in no block's band.
 *
 * TWO passes, and the order matters. A block's OWN rect always wins outright;
 * only a point in no block at all falls through to the widened search, where
 * the NEAREST band within `tolerance` wins (ties biased upward, matching how a
 * reader attributes a gap to the block above it).
 *
 * A single widened pass with first-match-wins — which this was — is wrong
 * wherever two rects touch or nearly touch, and touching rects are the common
 * case, not the exotic one: list items, table rows, consecutive lines, and any
 * margin-collapsed heading. With `tolerance = 6` and adjacent rects [0,20] and
 * [20,40], every y in [20,26] resolved to the FIRST block, so the block below
 * lost the top 6px of its own body — the grip targeted, grabbed and dragged the
 * wrong block. Generally, for an inter-block gap `g < tolerance`, block N stole
 * the first `tolerance - g` px of block N+1.
 */
export function blockAtPoint(
  blocks: readonly BlockRect[],
  clientY: number,
  tolerance: number = HOVER_TOLERANCE,
): BlockRect | null {
  for (const block of blocks) {
    if (clientY >= block.top && clientY <= block.bottom) return block
  }
  let best: BlockRect | null = null
  let bestDistance = Infinity
  for (const block of blocks) {
    const distance =
      clientY < block.top
        ? block.top - clientY
        : clientY > block.bottom
          ? clientY - block.bottom
          : 0
    if (distance <= tolerance && distance < bestDistance) {
      best = block
      bestDistance = distance
    }
  }
  return best
}

/**
 * The slot `clientY` points at, expressed relative to a neighbouring block.
 *
 * The document has `n + 1` slots for `n` blocks; the slot index is the count of
 * blocks whose vertical midpoint is above the pointer. Two of those slots are
 * where `sourceKey` already sits — dropping there is a no-op, so both return
 * `null` and the caller shows no indicator and commits nothing. That check is
 * what stops a 1px twitch from producing a spurious undo entry.
 */
export function findDropTarget(
  blocks: readonly BlockRect[],
  clientY: number,
  sourceKey: NodeKey,
): DropTarget | null {
  const sourceIndex = blocks.findIndex((b) => b.key === sourceKey)
  if (sourceIndex === -1) return null
  let slot = 0
  for (const block of blocks) {
    if (clientY > (block.top + block.bottom) / 2) slot++
    else break
  }
  // The two boundaries of the source's own slot are both no-ops.
  if (slot === sourceIndex || slot === sourceIndex + 1) return null
  if (slot === 0) return { key: blocks[0]!.key, place: 'before' }
  return { key: blocks[slot - 1]!.key, place: 'after' }
}

/** Where to draw the indicator line for a resolved {@link DropTarget}: on the
 * target's top edge for `before`, its bottom edge for `after`. */
export function indicatorRect(
  blocks: readonly BlockRect[],
  target: DropTarget,
): IndicatorRect | null {
  const block = blocks.find((b) => b.key === target.key)
  if (!block) return null
  return {
    x: block.left,
    y: target.place === 'before' ? block.top : block.bottom,
    width: block.width,
  }
}

// ── Lexical reads / writes ──────────────────────────────────────────────────

/** Measure every top-level block. Blocks with no rendered element (never the
 * case in practice, but possible mid-reconcile) are skipped rather than
 * measured as zeros, which would corrupt every midpoint comparison. */
function readBlockRects(editor: LexicalEditor): BlockRect[] {
  const keys = editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((n) => n.getKey()),
  )
  const rects: BlockRect[] = []
  for (const key of keys) {
    const el = editor.getElementByKey(key)
    if (!el) continue
    const r = el.getBoundingClientRect()
    rects.push({ key, top: r.top, bottom: r.bottom, left: r.left, width: r.width })
  }
  return rects
}

/** A short, speakable name for a block: its leading text, else its node type. */
function blockLabel(node: LexicalNode): string {
  const content = node.getTextContent().trim().replace(/\s+/g, ' ')
  if (content === '') return node.getType()
  return content.length > 32 ? `${content.slice(0, 32)}…` : content
}

/** Result of a reorder attempt: what to announce, or `null` when nothing moved. */
interface MoveOutcome {
  announcement: string
  key: NodeKey
}

/** Move `sourceKey` to `place` `targetKey` among the root's children, inside the
 * caller's `editor.update`. Returns `null` (no mutation, so no undo entry) when
 * either key is stale, they are the same node, or the move is a no-op. */
function $moveBlock(sourceKey: NodeKey, targetKey: NodeKey, place: Place): MoveOutcome | null {
  if (sourceKey === targetKey) return null
  const root = $getRoot()
  const children = root.getChildren()
  const source = children.find((n) => n.getKey() === sourceKey)
  const target = children.find((n) => n.getKey() === targetKey)
  if (!source || !target) return null
  const sourceIndex = source.getIndexWithinParent()
  const targetIndex = target.getIndexWithinParent()
  // Already in that slot — mutating would push an empty undo step.
  if (place === 'after' && targetIndex === sourceIndex - 1) return null
  if (place === 'before' && targetIndex === sourceIndex + 1) return null

  const label = blockLabel(source)
  // `insertAfter`/`insertBefore` detach the node from its current parent first
  // and re-anchor an element-anchored selection, so this is a true move.
  if (place === 'after') target.insertAfter(source)
  else target.insertBefore(source)
  return {
    key: sourceKey,
    announcement: `${label} moved to position ${source.getIndexWithinParent() + 1} of ${root.getChildrenSize()}.`,
  }
}

/** Move the block one slot up (`-1`) or down (`1`). Clamped at both ends, where
 * it reports the boundary rather than silently doing nothing. */
function $shiftBlock(key: NodeKey, direction: -1 | 1): MoveOutcome | null {
  const root = $getRoot()
  const children = root.getChildren()
  const index = children.findIndex((n) => n.getKey() === key)
  if (index === -1) return null
  const next = index + direction
  if (next < 0) return { key, announcement: 'Already at the first position.' }
  if (next >= children.length) return { key, announcement: 'Already at the last position.' }
  const neighbour = children[next]!
  return $moveBlock(key, neighbour.getKey(), direction === 1 ? 'after' : 'before')
}

// ── TEA slice ───────────────────────────────────────────────────────────────

interface BlockDragState {
  handleVisible: boolean
  handleX: number
  handleY: number
  /** Top-level node key the gutter is currently pointing at (`''` = none). */
  hoverKey: string
  dragging: boolean
  indicatorVisible: boolean
  indicatorX: number
  indicatorY: number
  indicatorWidth: number
  /** Key held in keyboard grab mode (`''` = not grabbed). */
  grabbedKey: string
  /** Live-region text. */
  announce: string
  /**
   * Monotonic counter bumped on every announcement. `aria-live` re-announces on
   * a text CHANGE, so an identical consecutive message would otherwise be
   * silent; the view mixes this into the rendered string as an invisible
   * alternating character purely to force that change.
   */
  announceNonce: number
  /**
   * The handle was revealed by KEYBOARD (`revealAtSelection`), not by hover, so
   * the grip should take focus as it mounts. Mouse hover must never steal focus
   * out of the contenteditable, which is why this is a flag and not unconditional.
   */
  keyboardReveal: boolean
}

type BlockDragMsg =
  | { type: 'hover'; key: string; x: number; y: number }
  | { type: 'revealAtSelection'; key: string; x: number; y: number }
  | { type: 'hoverOut' }
  | { type: 'dragStart' }
  | { type: 'dragOver'; x: number; y: number; width: number }
  | { type: 'dragOverNone' }
  | { type: 'dragEnd' }
  | { type: 'drop'; sourceKey: string; targetKey: string; place: Place }
  | { type: 'toggleGrab' }
  | { type: 'moveGrabbed'; direction: -1 | 1 }
  | { type: 'releaseGrab' }
  | { type: 'announce'; text: string }
  | { type: 'reposition'; x: number; y: number }

type BlockDragEffect =
  | { type: 'move'; sourceKey: string; targetKey: string; place: Place }
  | { type: 'shift'; key: string; direction: -1 | 1 }
  | { type: 'describe'; key: string; grabbed: boolean }

const INITIAL: BlockDragState = {
  handleVisible: false,
  handleX: 0,
  handleY: 0,
  hoverKey: '',
  dragging: false,
  indicatorVisible: false,
  indicatorX: 0,
  indicatorY: 0,
  indicatorWidth: 0,
  grabbedKey: '',
  announce: '',
  announceNonce: 0,
  keyboardReveal: false,
}

function hideIndicator(state: BlockDragState): BlockDragState {
  return state.indicatorVisible ? { ...state, indicatorVisible: false } : state
}

/**
 * INVARIANT: a grab cannot outlive the grip that owns it —
 * `handleVisible === false` implies `grabbedKey === ''`.
 *
 * Enforced in ONE place, on every reducer result, rather than at each case that
 * hides the handle. Violating it wedges the gutter permanently and
 * unrecoverably: `hover` and `hoverOut` are both hard-gated on
 * `grabbedKey === ''`, so once the handle is hidden with a grab still pending,
 * every subsequent hover is swallowed and the grip never renders again — and the
 * only senders of `releaseGrab` are the grip's own `onKeyDown`/`onBlur`, which
 * cannot fire on a grip that is not in the DOM.
 *
 * It was originally three separate clears (`dragStart`, `dragEnd`, `drop`).
 * That worked, but it was untestable: the three were mutually redundant, so
 * deleting any ONE of them left every test green while re-arming the bug for the
 * next path someone added. A single invariant is both DRY and pinnable.
 */
function normalize(state: BlockDragState): BlockDragState {
  if (state.handleVisible || state.grabbedKey === '') return state
  return { ...state, grabbedKey: '' }
}

function reduceRaw(
  state: BlockDragState,
  msg: BlockDragMsg,
): BlockDragState | [BlockDragState, BlockDragEffect[]] {
  switch (msg.type) {
    case 'hover':
      // While a block is grabbed (or being dragged) the gutter is pinned to it —
      // a stray pointer move must not silently re-target the pending reorder.
      if (state.grabbedKey !== '' || state.dragging) return state
      if (
        state.handleVisible &&
        state.hoverKey === msg.key &&
        state.handleX === msg.x &&
        state.handleY === msg.y
      )
        return state
      return {
        ...state,
        handleVisible: true,
        hoverKey: msg.key,
        handleX: msg.x,
        handleY: msg.y,
        keyboardReveal: false,
      }
    case 'revealAtSelection':
      // The KEYBOARD entry point. The grip is rendered only while
      // `handleVisible`, which `hover` alone could set — and `hover` is produced
      // only by `mousemove`. So without this message the grip was never in the
      // DOM and never in the tab order for a keyboard or screen-reader user, and
      // the unconditional help text ("Press Enter or Space to grab this block…")
      // described an affordance they could not reach. Reordering was mouse-only.
      return {
        ...state,
        handleVisible: true,
        hoverKey: msg.key,
        handleX: msg.x,
        handleY: msg.y,
        keyboardReveal: true,
      }
    case 'hoverOut':
      if (state.grabbedKey !== '' || state.dragging) return state
      return state.handleVisible ? { ...state, handleVisible: false } : state
    case 'dragStart':
      // The grip is hidden for the duration: it sits under the cursor and would
      // otherwise read as a second, stationary drop affordance.
      //
      // Any pending grab is dropped by `normalize` below, because the handle is
      // going away.
      return { ...state, dragging: true, handleVisible: false }
    case 'dragOver':
      return {
        ...state,
        indicatorVisible: true,
        indicatorX: msg.x,
        indicatorY: msg.y,
        indicatorWidth: msg.width,
      }
    case 'dragOverNone':
      return hideIndicator(state)
    case 'dragEnd':
      return { ...hideIndicator(state), dragging: false }
    case 'drop':
      return [
        { ...state, dragging: false, indicatorVisible: false, handleVisible: false },
        [{ type: 'move', sourceKey: msg.sourceKey, targetKey: msg.targetKey, place: msg.place }],
      ]
    case 'toggleGrab': {
      if (state.grabbedKey !== '')
        return [
          { ...state, grabbedKey: '' },
          [{ type: 'describe', key: state.grabbedKey, grabbed: false }],
        ]
      if (state.hoverKey === '') return state
      return [
        { ...state, grabbedKey: state.hoverKey },
        [{ type: 'describe', key: state.hoverKey, grabbed: true }],
      ]
    }
    case 'moveGrabbed':
      if (state.grabbedKey === '') return state
      return [state, [{ type: 'shift', key: state.grabbedKey, direction: msg.direction }]]
    case 'releaseGrab':
      // Announce the cancellation rather than BLANKING the live region. This is
      // also the `onBlur` handler, so clearing it meant Escape (and any focus
      // loss) silently ended a grab with nothing spoken.
      return state.grabbedKey === ''
        ? state
        : {
            ...state,
            grabbedKey: '',
            announce: 'Reorder cancelled.',
            announceNonce: state.announceNonce + 1,
          }
    case 'announce':
      // The nonce is what makes a REPEATED announcement audible. `aria-live`
      // regions re-announce on text CHANGE, so two identical strings in a row —
      // pressing ArrowUp twice at the top of the document, which yields
      // 'Already at the first position.' both times — left the second one
      // silent. The nonce is not rendered; it only forces the text binding to
      // re-commit. (Bumped unconditionally, so even a deduped-by-value message
      // still speaks.)
      return { ...state, announce: msg.text, announceNonce: state.announceNonce + 1 }
    case 'reposition':
      return state.handleX === msg.x && state.handleY === msg.y
        ? state
        : { ...state, handleX: msg.x, handleY: msg.y }
  }
}

function reduce(
  state: BlockDragState,
  msg: BlockDragMsg,
): BlockDragState | [BlockDragState, BlockDragEffect[]] {
  const out = reduceRaw(state, msg)
  return Array.isArray(out) ? [normalize(out[0]), out[1]] : normalize(out)
}

// ── Plugin ──────────────────────────────────────────────────────────────────

/** Per-editor pointer bookkeeping. Transient DOM state, deliberately NOT in the
 * TEA slice (nothing renders from it) — and keyed by editor rather than captured
 * in the plugin closure so a definition mounted twice keeps two sessions. */
interface Session {
  dragging: boolean
}

let seq = 0

export interface BlockDragOptions {
  /** Gutter grip inset, in px left of the block's left edge. Default 28. */
  gutterOffset?: number
}

/**
 * Reorder top-level blocks by dragging a hover gutter grip, or from the keyboard
 * (focus the grip, Enter/Space to grab, ↑/↓ to move, Enter/Space to drop, Escape
 * to cancel). Every reorder is one Lexical node move, hence one undo step.
 */
export function blockDragPlugin(options: BlockDragOptions = {}): MarkdownPlugin {
  const gutterOffset = options.gutterOffset ?? 28
  const sessions = new WeakMap<LexicalEditor, Session>()
  /** Per-editor keyboard entry point, so the command item can reach it. */
  const revealers = new WeakMap<LexicalEditor, () => boolean>()
  const uid = `md-block-drag-${++seq}`
  const helpId = `${uid}-help`
  const gripId = `${uid}-grip`

  return {
    name: 'blockDrag',

    // The command-surface half of the keyboard entry point (Mod+Shift+D is the
    // direct binding). Without one of these two, the entire reorder protocol —
    // and the help text that describes it — is unreachable without a pointer.
    items: [
      {
        id: 'blockDrag',
        label: 'Move block',
        icon: 'blockDrag',
        group: 'block',
        keywords: ['move', 'reorder', 'drag', 'block'],
        run: (editor) => {
          revealers.get(editor)?.()
        },
        surfaces: ['slash', 'context'],
      },
    ],

    // Hover tracking only. The drag session itself is owned by the view (it is
    // started by the grip's own mousedown), which keeps the two concerns apart:
    // `register` answers "which block is the pointer near", the view answers
    // "where would a drop land".
    register: (editor, ctx) => {
      const session: Session = { dragging: false }
      sessions.set(editor, session)
      let lastKey = ''
      let pending = 0

      const measure = (event: MouseEvent): void => {
        // A read-only editor gets no reorder affordance at all.
        if (!editor.isEditable() || session.dragging) return
        const root = editor.getRootElement()
        if (!root) return
        const bounds = root.getBoundingClientRect()
        // The live zone is the content box widened LEFT by the gutter, so the
        // pointer can travel onto the grip without the handle vanishing.
        const inside =
          event.clientX >= bounds.left - GUTTER_WIDTH &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top - HOVER_TOLERANCE &&
          event.clientY <= bounds.bottom + HOVER_TOLERANCE
        if (!inside) {
          if (lastKey !== '') {
            lastKey = ''
            ctx.emit({ type: 'plugin', name: 'blockDrag', msg: { type: 'hoverOut' } })
          }
          return
        }
        const blocks = readBlockRects(editor)
        const block = blockAtPoint(blocks, event.clientY)
        if (!block) {
          if (lastKey !== '') {
            lastKey = ''
            ctx.emit({ type: 'plugin', name: 'blockDrag', msg: { type: 'hoverOut' } })
          }
          return
        }
        lastKey = block.key
        ctx.emit({
          type: 'plugin',
          name: 'blockDrag',
          msg: {
            type: 'hover',
            key: block.key,
            x: block.left - gutterOffset,
            y: block.top,
          },
        })
      }

      // Coalesce to one measurement per frame: `mousemove` fires far faster than
      // the handle can meaningfully move, and each tick costs a layout read.
      // Keep the LATEST event, not the first of the frame. Discarding the rest
      // positioned the grip from stale coordinates: during a fast sweep the
      // pointer can cross two or three blocks inside one frame, and the handle
      // would resolve to the block the pointer was over when the frame STARTED.
      let latest: MouseEvent | null = null
      const onMouseMove = (event: Event): void => {
        latest = event as MouseEvent
        if (pending) return
        pending = requestAnimationFrame(() => {
          pending = 0
          if (latest) measure(latest)
        })
      }
      const hide = (): void => {
        if (session.dragging) return
        lastKey = ''
        ctx.emit({ type: 'plugin', name: 'blockDrag', msg: { type: 'hoverOut' } })
      }

      /**
       * Reveal the grip for the block containing the caret and focus it, so the
       * whole reorder protocol is reachable without a pointer. Bound to
       * Mod+Shift+D below and also exposed as a command item.
       */
      const revealAtSelection = (): boolean => {
        if (!editor.isEditable()) return false
        const key = editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) return null
          return selection.anchor.getNode().getTopLevelElement()?.getKey() ?? null
        })
        if (!key) return false
        const block = readBlockRects(editor).find((b) => b.key === key)
        if (!block) return false
        lastKey = key
        ctx.emit({
          type: 'plugin',
          name: 'blockDrag',
          msg: {
            type: 'revealAtSelection',
            key,
            x: block.left - gutterOffset,
            y: block.top,
          },
        })
        return true
      }
      revealers.set(editor, revealAtSelection)

      document.addEventListener('mousemove', onMouseMove, { passive: true })
      return mergeRegister(
        () => {
          document.removeEventListener('mousemove', onMouseMove)
          if (pending) cancelAnimationFrame(pending)
          sessions.delete(editor)
          revealers.delete(editor)
        },
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (event: KeyboardEvent) => {
            if (event.key !== 'D' && event.key !== 'd') return false
            if (!event.shiftKey || !(event.metaKey || event.ctrlKey)) return false
            if (!revealAtSelection()) return false
            event.preventDefault()
            return true
          },
          COMMAND_PRIORITY_LOW,
        ),
        // Any scroll invalidates the measured gutter position; recomputing from a
        // stale pointer is wrong, so simply retract the handle.
        onViewportChange(hide),
      )
    },

    ui: definePluginUI<BlockDragState, BlockDragMsg, BlockDragEffect>({
      init: () => ({ ...INITIAL }),
      update: reduce,

      onEffect: (effect, ctx) => {
        const editor = ctx.editor()
        if (!editor) return

        if (effect.type === 'describe') {
          const label = editor.getEditorState().read(() => {
            const node = $getRoot()
              .getChildren()
              .find((n) => n.getKey() === effect.key)
            return node ? blockLabel(node) : ''
          })
          ctx.send({
            type: 'announce',
            text: effect.grabbed
              ? `${label} grabbed. Use the up and down arrow keys to move it, Enter to drop, Escape to cancel.`
              : `${label} dropped.`,
          })
          return
        }

        // Held in a box rather than a bare `let`: the assignment happens inside
        // the update callback, which TypeScript's control-flow analysis cannot
        // see, so a plain local would narrow to `null` at every read below.
        const box: { outcome: MoveOutcome | null } = { outcome: null }
        editor.update(
          () => {
            box.outcome =
              effect.type === 'move'
                ? $moveBlock(effect.sourceKey, effect.targetKey, effect.place)
                : $shiftBlock(effect.key, effect.direction)
          },
          {
            // Re-measure AFTER reconciliation so the gutter follows the block it
            // is pinned to; measuring inside the update would read the old layout.
            onUpdate: () => {
              const moved = box.outcome
              if (!moved) return
              const el = editor.getElementByKey(moved.key)
              if (!el) return
              const r = el.getBoundingClientRect()
              ctx.send({ type: 'reposition', x: r.left - gutterOffset, y: r.top })
            },
          },
        )
        const moved = box.outcome
        if (moved) ctx.send({ type: 'announce', text: moved.announcement })
      },

      view: ({ state, send, editor }) => {
        // The pointer drag session. Installed on `document` for the duration of a
        // single drag and torn down on mouseup, so nothing lingers between drags;
        // `abort` covers the unmount-mid-drag case.
        let abort: (() => void) | null = null

        const beginDrag = (event: MouseEvent): void => {
          const live = editor()
          if (!live || !live.isEditable()) return
          const sourceKey = state.peek().hoverKey
          if (sourceKey === '') return
          // Keep the editor's SELECTION exactly where it was — a reorder must
          // never move the caret.
          event.preventDefault()
          // …but `preventDefault` on mousedown also cancels the default FOCUS
          // action, and the sub-threshold path below deliberately falls through
          // to the keyboard protocol. Without an explicit focus the grip was
          // never `document.activeElement`, so `onKeyDown` (bound to the grip)
          // never saw the arrow keys — they went to the contenteditable and
          // moved the caret instead of the block, while `aria-pressed="true"`
          // and the grabbed highlight claimed otherwise. `:focus-visible` never
          // applied and `onBlur`/`releaseGrab` could never fire, so the user was
          // stuck in a visible mode with no working keys.
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()

          const session = sessions.get(live)
          const startX = event.clientX
          const startY = event.clientY
          let dragging = false
          let target: DropTarget | null = null

          const onMove = (ev: MouseEvent): void => {
            if (!dragging) {
              if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD)
                return
              dragging = true
              if (session) session.dragging = true
              send({ type: 'dragStart' })
            }
            const blocks = readBlockRects(live)
            target = findDropTarget(blocks, ev.clientY, sourceKey)
            const rect = target ? indicatorRect(blocks, target) : null
            if (rect) send({ type: 'dragOver', ...rect })
            else send({ type: 'dragOverNone' })
          }

          const finish = (): void => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            abort = null
            if (session) session.dragging = false
          }

          const onUp = (): void => {
            finish()
            if (!dragging) {
              // Below the threshold this was a click, not a drag: fall through to
              // the keyboard protocol so mouse users get the same slow, precise
              // "grab then arrow" path.
              send({ type: 'toggleGrab' })
              return
            }
            if (target) {
              send({ type: 'drop', sourceKey, targetKey: target.key, place: target.place })
            } else {
              send({ type: 'dragEnd' })
            }
          }

          abort = (): void => {
            finish()
            send({ type: 'dragEnd' })
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }

        const onKeyDown = (event: KeyboardEvent): void => {
          switch (event.key) {
            case 'Enter':
            case ' ':
              // Handled here rather than via `click` so Space cannot ALSO fire the
              // button's synthetic click and toggle twice.
              event.preventDefault()
              send({ type: 'toggleGrab' })
              return
            case 'ArrowUp':
              event.preventDefault()
              send({ type: 'moveGrabbed', direction: -1 })
              return
            case 'ArrowDown':
              event.preventDefault()
              send({ type: 'moveGrabbed', direction: 1 })
              return
            case 'Escape':
              event.preventDefault()
              send({ type: 'releaseGrab' })
              return
          }
        }

        const grabbed = state.map((s) => s.grabbedKey !== '')

        return [
          // The live region and the instructions are rendered UNCONDITIONALLY.
          // A live region injected at announcement time is frequently missed by
          // screen readers, and `aria-describedby` must resolve even before the
          // grip exists. `sr-only` is inlined rather than left to the stylesheet
          // because a missing rule here would leak debug text into the page.
          div(
            {
              'data-scope': 'md-block-drag',
              'data-part': 'a11y',
              style:
                'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0',
            },
            [
              div({ 'data-scope': 'md-block-drag', 'data-part': 'help', id: helpId }, [
                text(
                  'Press Enter or Space to grab this block, then the up and down arrow keys to move it. Press Enter to drop, or Escape to cancel.',
                ),
              ]),
              div(
                {
                  'data-scope': 'md-block-drag',
                  'data-part': 'announcer',
                  role: 'status',
                  'aria-live': 'polite',
                  'aria-atomic': 'true',
                },
                [
                  text(
                    state.map((s) =>
                      // The zero-width space alternates with the nonce, so a
                      // repeated boundary bump ('Already at the first
                      // position.') is a NEW string and gets spoken again. It
                      // renders as nothing and is not selectable text.
                      s.announce === '' ? '' : s.announce + (s.announceNonce % 2 ? '\u200B' : ''),
                    ),
                  ),
                ],
              ),
            ],
          ),

          ...overlayRoot({
            open: state.at('handleVisible'),
            x: state.at('handleX'),
            y: state.at('handleY'),
            zIndex: BLOCK_DRAG_Z.handle,
            attrs: { 'data-scope': 'md-block-drag', 'data-part': 'handle' },
            children: () => [
              button(
                {
                  type: 'button',
                  'data-scope': 'md-block-drag',
                  'data-part': 'grip',
                  id: gripId,
                  'aria-label': 'Reorder block',
                  'aria-roledescription': 'draggable block handle',
                  'aria-describedby': helpId,
                  'aria-pressed': grabbed.map((g) => (g ? 'true' : 'false')),
                  'data-grabbed': grabbed.map((g) => (g ? '' : undefined)),
                  title: 'Drag to reorder — or press Enter and use the arrow keys',
                  onMouseDown: beginDrag,
                  onKeyDown,
                  // Losing focus abandons a keyboard grab rather than leaving an
                  // invisible mode armed on an element the user can no longer see.
                  onBlur: () => send({ type: 'releaseGrab' }),
                },
                [
                  text('⠿'),
                  // Take focus ONLY when the keyboard revealed us. `overlayRoot`
                  // rebuilds this subtree each time it opens, so this runs once
                  // per reveal. Focusing on a mouse hover would yank the caret
                  // out of the contenteditable on every pointer move.
                  onMount((root) => {
                    if (!state.peek().keyboardReveal) return
                    // Looked up by id on the OWNER DOCUMENT, not under `root`:
                    // `onMount` hands back the component's root element, while
                    // `overlayRoot` portals the grip to a body-level sibling, so
                    // the grip is never a descendant of `root`. The id is derived
                    // from this plugin instance's `uid`, which keeps it correct
                    // when several editors are mounted at once.
                    const grip = root.ownerDocument.getElementById(gripId)
                    grip?.focus()
                  }),
                ],
              ),
            ],
          }),

          ...overlayRoot({
            open: state.at('indicatorVisible'),
            x: state.at('indicatorX'),
            y: state.at('indicatorY'),
            zIndex: BLOCK_DRAG_Z.indicator,
            attrs: { 'data-scope': 'md-block-drag', 'data-part': 'indicator-root' },
            children: () => [
              div({
                'data-scope': 'md-block-drag',
                'data-part': 'indicator',
                'aria-hidden': 'true',
                // Only the WIDTH is inline (it is measured, hence dynamic); the
                // line's appearance belongs to `styles/block-drag.css`.
                style: (state.at('indicatorWidth') as Signal<number>).map((w) => `width:${w}px`),
              }),
            ],
          }),

          // Abandon any in-flight pointer session if the editor unmounts mid-drag,
          // so the document listeners never outlive the component. `onMount`'s
          // returned cleanup is the sanctioned teardown hook; the Mountable MUST
          // be placed in the view array or it registers nothing.
          onMount(() => () => abort?.()),
        ] satisfies Renderable
      },
    }),
  }
}
