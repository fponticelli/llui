// Pure logic for the HUD shell — extracted from index.ts so it can be
// unit-tested directly and reused by the @llui/dom view layer without
// dragging the DOM along. Everything here is a pure function of its inputs
// (no DOM, no globals, no time) so the reducer/view can stay declarative.

import type { NoteRect } from './note-types.js'

// ── Floating-button position math ────────────────────────────────────────

export const DRAG_THRESHOLD_PX = 4
export const BUTTON_SIZE_PX = 44
export const BUTTON_MARGIN_PX = 16

export interface SavedPosition {
  anchorX: 'left' | 'right'
  offsetX: number
  anchorY: 'top' | 'bottom'
  offsetY: number
}

/** Clamp an edge offset so the button stays fully inside the viewport. */
export function clampOffset(offset: number, viewportSize: number): number {
  const max = Math.max(BUTTON_MARGIN_PX, viewportSize - BUTTON_SIZE_PX - BUTTON_MARGIN_PX)
  return Math.min(Math.max(BUTTON_MARGIN_PX, offset), max)
}

/**
 * Derive the anchor + offset from the button's current viewport rect. Anchor
 * follows the center: right half → right-anchored, bottom half → bottom-
 * anchored. Offset is the distance from the chosen edge to the matching
 * button edge, so a right/bottom-anchored button tracks viewport resize.
 */
export function deriveSavedPosition(
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  viewportW: number,
  viewportH: number,
): SavedPosition {
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const anchorX: 'left' | 'right' = centerX < viewportW / 2 ? 'left' : 'right'
  const anchorY: 'top' | 'bottom' = centerY < viewportH / 2 ? 'top' : 'bottom'
  const offsetX = anchorX === 'left' ? rect.left : viewportW - rect.right
  const offsetY = anchorY === 'top' ? rect.top : viewportH - rect.bottom
  return { anchorX, offsetX, anchorY, offsetY }
}

/** Validate + parse a persisted SavedPosition (returns null on any mismatch). */
export function parseSavedPosition(raw: string | null): SavedPosition | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<SavedPosition>
    if (
      (p.anchorX !== 'left' && p.anchorX !== 'right') ||
      (p.anchorY !== 'top' && p.anchorY !== 'bottom') ||
      typeof p.offsetX !== 'number' ||
      typeof p.offsetY !== 'number'
    ) {
      return null
    }
    return { anchorX: p.anchorX, offsetX: p.offsetX, anchorY: p.anchorY, offsetY: p.offsetY }
  } catch {
    return null
  }
}

// ── Modal reanchor (pure geometry) ───────────────────────────────────────

export interface ModalAnchor {
  horizontal: 'left' | 'right'
  vertical: 'top' | 'bottom'
}

/**
 * Decide which corner the modal anchors to so it stays on-screen relative to
 * the floating button. Mirrors index.ts#reanchorModal: prefer right-aligned +
 * above the button; flip to left / below when that would clip the viewport.
 */
export function computeModalAnchor(
  rootRect: { top: number; right: number },
  modalW: number,
  modalH: number,
  gap = 8,
): ModalAnchor {
  const horizontal: 'left' | 'right' = rootRect.right - modalW < gap ? 'left' : 'right'
  const vertical: 'top' | 'bottom' = rootRect.top - modalH - gap < gap ? 'top' : 'bottom'
  return { horizontal, vertical }
}

// ── Status + token formatting ────────────────────────────────────────────

export function statusLabel(to: string, reason?: string): string {
  switch (to) {
    case 'open':
      return '⏳ queued for the router…'
    case 'claimed':
      return '🤖 claude is working on it…'
    case 'in-progress':
      return '🤖 claude is editing files…'
    case 'proposed':
      return reason ? `✓ proposed: ${reason}` : '✓ proposed fix ready'
    case 'accepted':
      return '✓ accepted; applying…'
    case 'applied':
      return '✅ applied — change is in your working tree'
    case 'rejected':
      return '✗ rejected'
    case 'wontfix':
      return '✗ closed without changes'
    case 'failed':
      return `❌ failed${reason ? `: ${reason.slice(0, 80)}` : ''}`
    default:
      return `→ ${to}`
  }
}

/** Compact thousands-separator for token counts ("1,247", "14k"). */
export function fmtTokens(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  return n.toLocaleString()
}

// ── Task status buckets ──────────────────────────────────────────────────

export const TERMINAL_STATES = new Set(['applied', 'rejected', 'wontfix', 'failed'])
export const isTerminal = (s: string): boolean => TERMINAL_STATES.has(s)
export const isWorking = (s: string): boolean =>
  s === 'claimed' || s === 'in-progress' || s === 'open'
export const isReady = (s: string): boolean => s === 'proposed'

// ── Markdown toolbar transforms (pure) ───────────────────────────────────

export interface TextSelection {
  value: string
  start: number
  end: number
}

/**
 * Smart wrap+toggle for an inline marker (`**`, `*`, `` ` ``). Returns the
 * new value + selection range. Three cases (mirrors index.ts#toggleWrap):
 *   1. selection itself is `**text**`               → strip the wrap
 *   2. selection flanked by markers in surrounding   → strip the flanking
 *   3. neither                                       → wrap (placeholder when empty)
 */
export function toggleWrap(sel: TextSelection, marker: string): TextSelection {
  const { value, start, end } = sel
  const selected = value.slice(start, end)
  const ml = marker.length

  // Case 1: selection itself is wrapped — strip.
  if (selected.length >= ml * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(ml, selected.length - ml)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    }
  }

  // Case 2: surrounding text wraps the selection — strip flanking.
  if (
    start >= ml &&
    end + ml <= value.length &&
    value.slice(start - ml, start) === marker &&
    value.slice(end, end + ml) === marker
  ) {
    const newStart = start - ml
    return {
      value: value.slice(0, start - ml) + selected + value.slice(end + ml),
      start: newStart,
      end: newStart + selected.length,
    }
  }

  // Case 3: wrap. Placeholder only when no selection.
  const placeholder = selected || 'text'
  const replacement = `${marker}${placeholder}${marker}`
  const cursorStart = start + ml
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    start: cursorStart,
    end: cursorStart + placeholder.length,
  }
}

/**
 * Line-prefix toggle (bullets, numbered lists). If every selected line already
 * starts with the prefix, strip it; otherwise add it. Mirrors
 * index.ts#toggleLinePrefix.
 */
export function toggleLinePrefix(
  sel: TextSelection,
  addPrefix: (i: number) => string,
  matchPrefix: RegExp,
): TextSelection {
  const { value, start, end } = sel
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  let lineEnd = value.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = value.length
  const block = value.slice(lineStart, lineEnd) || 'item'
  const lines = block.split('\n')
  const allMatch = lines.every((l) => matchPrefix.test(l))
  const next = lines
    .map((line, i) => (allMatch ? line.replace(matchPrefix, '') : `${addPrefix(i)}${line}`))
    .join('\n')
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + next.length,
  }
}

export const BULLET_PREFIX = { add: () => '- ', match: /^- / }
export const NUMBER_PREFIX = { add: (i: number) => `${i + 1}. `, match: /^\d+\. / }

// ── Note kind / annotation helpers ───────────────────────────────────────

/** Derive the note kind from the currently-attached annotation, if any. */
export function deriveKind(pendingElement: unknown | null, pendingRect: NoteRect | null): string {
  if (pendingElement) return 'element'
  if (pendingRect) return 'rect'
  return 'text'
}

// ── Task / status / chain / toast subsystem (pure reducer) ───────────────
//
// The live-feedback heart, re-modeled from index.ts#handleStatusUpdate /
// handleTaskProgress. Everything is serializable data — crucially, toasts
// carry a `msg` DESCRIPTOR for each action button instead of an onClick
// closure, so the whole task state is introspectable and replayable. Time
// (`now`) and the optimistic 'claimed' status enter via messages so the
// reducer stays pure.

export interface TrackedTask {
  noteId: string
  sessionId: string
  chainName: string
  status: string
}

export interface ChainEntry {
  name: string
  lastTaskId: string
  summary: string
  ts: number
}

export interface ProgressSnapshot {
  noteId: string
  reportedElapsedMs: number
  reportedAt: number
  tokens?: { in: number; out: number; cacheRead?: number }
  toolSummary?: string
}

export interface ToastAction {
  label: string
  variant: 'primary' | 'secondary' | 'ghost'
  /** Dispatched (and the toast dismissed) when the button is clicked. */
  msg: TaskMsg
}

export interface Toast {
  id: number
  kind: 'ok' | 'fail' | 'info'
  body: string
  actions: ToastAction[]
}

export interface TaskState {
  tracked: Record<string, TrackedTask>
  latestTaskId: string | null
  chains: Record<string, ChainEntry>
  selectedChain: string | null
  progress: ProgressSnapshot | null
  toasts: Toast[]
  toastSeq: number
  statusLine: string
}

export type TaskMsg =
  | { type: 'task/track'; task: TrackedTask }
  | { type: 'task/status'; noteId: string; to: string; reason?: string; now: number }
  | {
      type: 'task/progress'
      noteId: string
      elapsedMs?: number
      tokens?: { in: number; out: number; cacheRead?: number }
      toolSummary?: string
      now: number
    }
  | { type: 'task/tick'; now: number }
  | { type: 'task/accept'; noteId: string; sessionId: string }
  | { type: 'task/reject'; noteId: string; sessionId: string }
  | { type: 'toast/dismiss'; id: number }

export type TaskEffect =
  | { type: 'postStatus'; noteId: string; sessionId: string; to: 'accepted' | 'rejected' }
  | { type: 'startTicker' }
  | { type: 'stopTicker' }

export const taskInitialState = (): TaskState => ({
  tracked: {},
  latestTaskId: null,
  chains: {},
  selectedChain: null,
  progress: null,
  toasts: [],
  toastSeq: 0,
  statusLine: '',
})

/** Working / ready counts for the queue badges. */
export function queueCounts(s: TaskState): { working: number; ready: number } {
  const tasks = Object.values(s.tracked)
  return {
    working: tasks.filter((t) => isWorking(t.status)).length,
    ready: tasks.filter((t) => isReady(t.status)).length,
  }
}

/** Render the in-flight progress line (mirrors index.ts#renderActiveProgress). */
export function formatProgress(p: ProgressSnapshot, now: number): string {
  const elapsed = p.reportedElapsedMs + (now - p.reportedAt)
  const parts: string[] = ['🤖 working']
  if (p.tokens) {
    const t = p.tokens
    const cacheSuffix = t.cacheRead && t.cacheRead > 0 ? ` (${fmtTokens(t.cacheRead)} cached)` : ''
    parts.push(`${fmtTokens(t.in)} ctx${cacheSuffix}`)
    parts.push(`${fmtTokens(t.out)} out`)
  }
  parts.push(`${Math.round(elapsed / 1000)}s`)
  if (p.toolSummary) parts.push(p.toolSummary)
  return parts.join(' · ')
}

function acceptRejectActions(noteId: string, sessionId: string): ToastAction[] {
  return [
    { label: 'Reject', variant: 'ghost', msg: { type: 'task/reject', noteId, sessionId } },
    { label: 'Accept', variant: 'primary', msg: { type: 'task/accept', noteId, sessionId } },
  ]
}

function pushToast(
  s: TaskState,
  kind: Toast['kind'],
  body: string,
  actions: ToastAction[] = [],
): TaskState {
  return {
    ...s,
    toasts: [...s.toasts, { id: s.toastSeq, kind, body, actions }],
    toastSeq: s.toastSeq + 1,
  }
}

export function reduceTask(state: TaskState, msg: TaskMsg): [TaskState, TaskEffect[]] {
  switch (msg.type) {
    case 'task/track': {
      const tracked = { ...state.tracked, [msg.task.noteId]: msg.task }
      return [
        { ...state, tracked, latestTaskId: msg.task.noteId, statusLine: statusLabel('claimed') },
        [],
      ]
    }

    case 'toast/dismiss':
      return [{ ...state, toasts: state.toasts.filter((t) => t.id !== msg.id) }, []]

    // Accept/Reject are side effects (POST); the resulting status-changed
    // event drives the actual state transition.
    case 'task/accept':
      return [
        state,
        [{ type: 'postStatus', noteId: msg.noteId, sessionId: msg.sessionId, to: 'accepted' }],
      ]
    case 'task/reject':
      return [
        state,
        [{ type: 'postStatus', noteId: msg.noteId, sessionId: msg.sessionId, to: 'rejected' }],
      ]

    case 'task/tick':
      if (state.progress && state.progress.noteId === state.latestTaskId) {
        return [{ ...state, statusLine: formatProgress(state.progress, msg.now) }, []]
      }
      return [state, []]

    case 'task/progress': {
      const task = state.tracked[msg.noteId]
      if (!task || msg.noteId !== state.latestTaskId) return [state, []]
      const progress: ProgressSnapshot = {
        noteId: msg.noteId,
        reportedElapsedMs: msg.elapsedMs ?? 0,
        reportedAt: msg.now,
        ...(msg.tokens ? { tokens: msg.tokens } : {}),
        ...(msg.toolSummary ? { toolSummary: msg.toolSummary } : {}),
      }
      return [
        { ...state, progress, statusLine: formatProgress(progress, msg.now) },
        [{ type: 'startTicker' }],
      ]
    }

    case 'task/status': {
      const task = state.tracked[msg.noteId]
      if (!task) return [state, []]
      const prev = task.status
      const to = msg.to
      let s: TaskState = {
        ...state,
        tracked: { ...state.tracked, [msg.noteId]: { ...task, status: to } },
      }
      const effects: TaskEffect[] = []
      if (msg.noteId === s.latestTaskId) s = { ...s, statusLine: statusLabel(to, msg.reason) }

      // Liveness: start the local elapsed clock as soon as a task enters a
      // working state, even before token-level progress arrives.
      if (isWorking(to) && msg.noteId === s.latestTaskId && s.progress?.noteId !== msg.noteId) {
        const progress: ProgressSnapshot = {
          noteId: msg.noteId,
          reportedElapsedMs: 0,
          reportedAt: msg.now,
        }
        s = { ...s, progress, statusLine: formatProgress(progress, msg.now) }
        effects.push({ type: 'startTicker' })
      }
      // Stop ticking once the task leaves the working states.
      if ((isReady(to) || isTerminal(to)) && s.progress?.noteId === msg.noteId) {
        s = { ...s, progress: null }
        effects.push({ type: 'stopTicker' })
      }

      // First transition into 'proposed': record chain history, auto-select
      // it, and fire an Accept/Reject toast.
      if (isReady(to) && !isReady(prev)) {
        s = {
          ...s,
          chains: {
            ...s.chains,
            [task.chainName]: {
              name: task.chainName,
              lastTaskId: msg.noteId,
              summary: msg.reason ?? '',
              ts: msg.now,
            },
          },
          selectedChain: task.chainName,
        }
        s = pushToast(
          s,
          'info',
          `Note ${msg.noteId}: ${msg.reason ?? 'proposed fix ready'}`,
          acceptRejectActions(msg.noteId, task.sessionId),
        )
        return [s, effects]
      }

      // Terminal: toast the outcome, drop the task, promote a new latest.
      if (isTerminal(to)) {
        const kind: Toast['kind'] = to === 'applied' ? 'ok' : to === 'failed' ? 'fail' : 'info'
        s = pushToast(s, kind, `Note ${msg.noteId}: ${statusLabel(to, msg.reason)}`)
        const tracked = { ...s.tracked }
        delete tracked[msg.noteId]
        s = { ...s, tracked }
        if (msg.noteId === s.latestTaskId) {
          const remaining = Object.keys(tracked)
          const latestTaskId = remaining.length > 0 ? remaining[remaining.length - 1]! : null
          s = {
            ...s,
            latestTaskId,
            statusLine: latestTaskId ? statusLabel(tracked[latestTaskId]!.status) : s.statusLine,
          }
        }
        return [s, effects]
      }

      return [s, effects]
    }
  }
}
