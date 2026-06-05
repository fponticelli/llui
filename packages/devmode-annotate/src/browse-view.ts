// Notes browser view — authored with @llui/dom.
//
// Mounted inside the HUD modal alongside the compose view. A single TEA
// component over one serializable state tree: pick a session, list its notes
// (newest first), filter client-side, expand a row to see prose + status
// timeline + screenshot + proposed-diff + actions (re-solve / replay / edit /
// delete), and select rows for bulk delete / wontfix. Keyed `each`/`show`
// reconciliation replaces the old `innerHTML = ''` rebuilds, so an SSE-driven
// refresh updates only changed rows (scroll + expanded content survive).
//
// Public API is unchanged: createBrowseView(opts) → { el, refresh, onShow }.

import {
  component,
  mountSignalComponent,
  div,
  span,
  button,
  input,
  textarea,
  img,
  pre,
  each,
  show,
  portal,
  text,
  type Signal,
  type Renderable,
  type SignalViewBag,
} from '@llui/dom'
import { select, type SelectMsg, type SelectState } from '@llui/components/select'
import { btnStyle, STYLES } from './styles.js'

// ── Domain shapes (server payloads) ──────────────────────────────────────

interface SessionSummary {
  id: string
  noteCount: number
  startedAt?: string
}

interface NoteSummary {
  id: string
  filename: string
  sessionId: string
  kind: string
  author: 'human' | 'llm'
  intent?: 'task' | 'note'
  status?: string
  ts: string
  preview: string
  hasScreenshot?: boolean
  replyTo?: string
}

interface StatusTransition {
  ts: string
  noteId: string
  from: string | null
  to: string
  by?: string
  reason?: string
}

interface ProposedDiff {
  summary: string
  confidence: string
  files: Array<{ path: string; patch: string }>
}

interface NoteFrontmatterLite {
  kind: string
  author: string
  intent?: string
  screenshot?: string | null
  proposedDiff?: ProposedDiff
  replyTo?: string
}

/** Full note JSON fetched lazily on expand. */
interface FullNote {
  frontmatter: NoteFrontmatterLite
  prose: string
  body?: { repro?: unknown[] }
}

/** Filters applied client-side over the fetched notes list. */
interface BrowseFilters {
  kind: 'all' | 'text' | 'rect' | 'capture' | 'reply'
  author: 'all' | 'human' | 'llm'
  status: 'all' | 'open' | 'working' | 'proposed' | 'applied' | 'closed'
  text: string
}

export interface BrowseViewHandle {
  /** The root DOM element to append to the modal. */
  el: HTMLElement
  /** Re-fetch sessions + current note list. Cheap on every SSE event;
   *  debounced internally. */
  refresh: () => void
  /** Called when the view becomes visible. Triggers an immediate fetch if
   *  it hasn't loaded yet. */
  onShow: () => void
}

export interface BrowseViewOptions {
  origin: string
  /** Reports user actions back to the host modal (errors → status line). */
  onError?: (message: string) => void
  /** Replay a captured repro trace against the live DOM. */
  onReplayRepro?: (events: unknown[]) => Promise<{ applied: number; skipped: unknown[] }>
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/** Buckets `status` into the high-level categories the filter UI uses. */
export function statusBucket(s: string | undefined): BrowseFilters['status'] {
  if (!s || s === 'open') return 'open'
  if (s === 'claimed' || s === 'in-progress' || s === 'accepted') return 'working'
  if (s === 'proposed') return 'proposed'
  if (s === 'applied') return 'applied'
  return 'closed' // rejected | wontfix | failed
}

export function statusGlyph(status: string | undefined): string {
  switch (status) {
    case 'claimed':
    case 'in-progress':
      return '🤖'
    case 'proposed':
      return '✓'
    case 'applied':
      return '✅'
    case 'rejected':
    case 'wontfix':
      return '✗'
    case 'failed':
      return '❌'
    default:
      return ''
  }
}

export function kindGlyph(kind: string): string {
  switch (kind) {
    case 'rect':
      return '⌖'
    case 'capture':
      return '📸'
    case 'reply':
      return '↩'
    default:
      return '📝'
  }
}

export function matchesFilters(n: NoteSummary, f: BrowseFilters): boolean {
  if (f.kind !== 'all' && n.kind !== f.kind) return false
  if (f.author !== 'all' && n.author !== f.author) return false
  if (f.status !== 'all' && statusBucket(n.status) !== f.status) return false
  if (f.text && !n.preview.toLowerCase().includes(f.text.toLowerCase())) return false
  return true
}

// ── TEA shapes ───────────────────────────────────────────────────────────

type Phase = 'idle' | 'loading' | 'ready'

interface ExpansionData {
  prose: string
  frontmatter: NoteFrontmatterLite
  history: StatusTransition[]
  repro: unknown[]
}

export interface BrowseState {
  phase: Phase
  sessions: SessionSummary[]
  /** Session picker — its value[0] is the canonical current session id. */
  sessionSelect: SelectState
  notes: NoteSummary[]
  /** Filter pickers — each value[0] is the canonical filter value. */
  kindSelect: SelectState
  authorSelect: SelectState
  statusSelect: SelectState
  /** Free-text search (a plain input, not a select). */
  searchText: string
  expandedNoteId: string | null
  selectedIds: string[]
  /** hydrated expansions keyed by note id; 'loading' while in flight */
  expansions: Record<string, ExpansionData | 'loading'>
  /** note id currently in inline-edit mode, + the draft prose */
  editingNoteId: string | null
  editDraft: string
  /** full-size screenshot lightbox src, or null when closed */
  lightboxSrc: string | null
}

export type BrowseMsg =
  | { type: 'show' }
  | { type: 'refresh' }
  | { type: 'sessions/loaded'; sessions: SessionSummary[] }
  | { type: 'notes/loaded'; notes: NoteSummary[] }
  | { type: 'sessionSelect'; msg: SelectMsg }
  | { type: 'kindSelect'; msg: SelectMsg }
  | { type: 'authorSelect'; msg: SelectMsg }
  | { type: 'statusSelect'; msg: SelectMsg }
  | { type: 'filter/text'; value: string }
  | { type: 'row/toggleExpand'; id: string }
  | { type: 'row/toggleSelect'; id: string }
  | { type: 'expansion/loaded'; id: string; data: ExpansionData }
  | { type: 'selection/clear' }
  | { type: 'note/delete'; id: string }
  | { type: 'bulk/delete' }
  | { type: 'bulk/wontfix' }
  | { type: 'edit/start'; id: string; prose: string }
  | { type: 'edit/change'; value: string }
  | { type: 'edit/cancel' }
  | { type: 'edit/save' }
  | { type: 'reSolve'; prose: string }
  | { type: 'replay'; events: unknown[] }
  | { type: 'diff/accept'; taskId: string }
  | { type: 'diff/reject'; taskId: string }
  | { type: 'lightbox/open'; src: string }
  | { type: 'lightbox/close' }

export type BrowseEffect =
  | { type: 'fetchSessions' }
  | { type: 'fetchNotes'; sessionId: string | null }
  | { type: 'fetchExpansion'; id: string; sessionId: string }
  | { type: 'deleteNote'; id: string; sessionId: string }
  | { type: 'bulkDelete'; ids: string[]; sessionId: string }
  | { type: 'bulkStatus'; ids: string[]; to: string; sessionId: string }
  | { type: 'patchProse'; id: string; prose: string; sessionId: string }
  | { type: 'postStatus'; taskId: string; to: 'accepted' | 'rejected'; sessionId: string }
  | { type: 'reSolve'; prose: string }
  | { type: 'replay'; events: unknown[] }
  | { type: 'report'; message: string }

// Static filter option lists: [value, label]. The select's `items` are the
// values; labels are looked up for rendering.
const KIND_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['all', 'All kinds'],
  ['text', '📝 text'],
  ['rect', '⌖ rect'],
  ['capture', '📸 capture'],
  ['reply', '↩ reply'],
]
const AUTHOR_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['all', 'All authors'],
  ['human', '👤 human'],
  ['llm', '🤖 llm'],
]
const STATUS_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['all', 'All statuses'],
  ['open', 'open'],
  ['working', 'working'],
  ['proposed', 'proposed'],
  ['applied', 'applied'],
  ['closed', 'closed'],
]

const filterSelectInit = (options: ReadonlyArray<readonly [string, string]>): SelectState =>
  select.init({ items: options.map(([v]) => v), value: ['all'] })

export const browseInit = (): BrowseState => ({
  phase: 'idle',
  sessions: [],
  sessionSelect: select.init({ items: [], value: [] }),
  notes: [],
  kindSelect: filterSelectInit(KIND_OPTIONS),
  authorSelect: filterSelectInit(AUTHOR_OPTIONS),
  statusSelect: filterSelectInit(STATUS_OPTIONS),
  searchText: '',
  expandedNoteId: null,
  selectedIds: [],
  expansions: {},
  editingNoteId: null,
  editDraft: '',
  lightboxSrc: null,
})

// ── Selectors — the select slices are the source of truth ────────────────

/** The canonical current session id (select value[0]). */
export const currentSessionId = (s: BrowseState): string | null => s.sessionSelect.value[0] ?? null

/** The active filters, derived from the select slices + search text. */
export const activeFilters = (s: BrowseState): BrowseFilters => ({
  kind: (s.kindSelect.value[0] ?? 'all') as BrowseFilters['kind'],
  author: (s.authorSelect.value[0] ?? 'all') as BrowseFilters['author'],
  status: (s.statusSelect.value[0] ?? 'all') as BrowseFilters['status'],
  text: s.searchText,
})

/** Keep the current session if it still exists, else default to most recent. */
function pickSession(sessions: SessionSummary[], current: string | null): string | null {
  if (sessions.length === 0) return null
  if (current && sessions.some((s) => s.id === current)) return current
  return sessions[sessions.length - 1]!.id
}

export const browseReduce = (state: BrowseState, msg: BrowseMsg): [BrowseState, BrowseEffect[]] => {
  const sid = currentSessionId(state)
  switch (msg.type) {
    case 'show':
      if (state.phase !== 'idle') return [state, []]
      return [{ ...state, phase: 'loading' }, [{ type: 'fetchSessions' }]]

    case 'refresh':
      return [state, [{ type: 'fetchSessions' }]]

    case 'sessions/loaded': {
      const picked = pickSession(msg.sessions, sid)
      let sessionSelect = state.sessionSelect
      ;[sessionSelect] = select.update(sessionSelect, {
        type: 'setItems',
        items: msg.sessions.map((s) => s.id),
      })
      ;[sessionSelect] = select.update(sessionSelect, {
        type: 'setValue',
        value: picked ? [picked] : [],
      })
      return [
        { ...state, phase: 'ready', sessions: msg.sessions, sessionSelect },
        [{ type: 'fetchNotes', sessionId: picked }],
      ]
    }

    case 'notes/loaded': {
      const notes = msg.notes.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1))
      return [{ ...state, notes }, []]
    }

    case 'sessionSelect': {
      const prev = sid
      const [sessionSelect] = select.update(state.sessionSelect, msg.msg)
      const next = sessionSelect.value[0] ?? null
      if (next === prev) return [{ ...state, sessionSelect }, []]
      // Session actually changed → reset the view and refetch.
      return [
        {
          ...state,
          sessionSelect,
          expandedNoteId: null,
          editingNoteId: null,
          selectedIds: [],
          expansions: {},
        },
        [{ type: 'fetchNotes', sessionId: next }],
      ]
    }

    // Filters are pure client-side state — reconciliation makes per-keystroke
    // re-render cheap, so the old 120ms search debounce is gone.
    case 'kindSelect': {
      const [kindSelect] = select.update(state.kindSelect, msg.msg)
      return [{ ...state, kindSelect }, []]
    }
    case 'authorSelect': {
      const [authorSelect] = select.update(state.authorSelect, msg.msg)
      return [{ ...state, authorSelect }, []]
    }
    case 'statusSelect': {
      const [statusSelect] = select.update(state.statusSelect, msg.msg)
      return [{ ...state, statusSelect }, []]
    }
    case 'filter/text':
      return [{ ...state, searchText: msg.value }, []]

    case 'row/toggleExpand': {
      if (state.expandedNoteId === msg.id) {
        return [{ ...state, expandedNoteId: null, editingNoteId: null }, []]
      }
      const already = state.expansions[msg.id]
      const effects: BrowseEffect[] =
        already || !sid ? [] : [{ type: 'fetchExpansion', id: msg.id, sessionId: sid }]
      return [
        {
          ...state,
          expandedNoteId: msg.id,
          editingNoteId: null,
          expansions: already ? state.expansions : { ...state.expansions, [msg.id]: 'loading' },
        },
        effects,
      ]
    }

    case 'expansion/loaded':
      return [{ ...state, expansions: { ...state.expansions, [msg.id]: msg.data } }, []]

    case 'row/toggleSelect': {
      const has = state.selectedIds.includes(msg.id)
      const selectedIds = has
        ? state.selectedIds.filter((id) => id !== msg.id)
        : [...state.selectedIds, msg.id]
      return [{ ...state, selectedIds }, []]
    }

    case 'selection/clear':
      return [{ ...state, selectedIds: [] }, []]

    case 'note/delete':
      if (!sid) return [state, []]
      return [
        { ...state, expandedNoteId: null, editingNoteId: null },
        [{ type: 'deleteNote', id: msg.id, sessionId: sid }],
      ]

    case 'bulk/delete': {
      if (state.selectedIds.length === 0 || !sid) return [state, []]
      return [
        { ...state, selectedIds: [] },
        [{ type: 'bulkDelete', ids: state.selectedIds, sessionId: sid }],
      ]
    }

    case 'bulk/wontfix': {
      if (state.selectedIds.length === 0 || !sid) return [state, []]
      return [
        { ...state, selectedIds: [] },
        [
          {
            type: 'bulkStatus',
            ids: state.selectedIds,
            to: 'wontfix',
            sessionId: sid,
          },
        ],
      ]
    }

    case 'edit/start':
      return [{ ...state, editingNoteId: msg.id, editDraft: msg.prose }, []]
    case 'edit/change':
      return [{ ...state, editDraft: msg.value }, []]
    case 'edit/cancel':
      return [{ ...state, editingNoteId: null }, []]
    case 'edit/save': {
      if (!state.editingNoteId || !sid) return [state, []]
      return [
        { ...state, editingNoteId: null },
        [
          {
            type: 'patchProse',
            id: state.editingNoteId,
            prose: state.editDraft,
            sessionId: sid,
          },
        ],
      ]
    }

    case 'reSolve':
      return [state, [{ type: 'reSolve', prose: msg.prose }]]

    case 'replay':
      return [state, [{ type: 'replay', events: msg.events }]]

    case 'diff/accept':
      if (!sid) return [state, []]
      return [
        state,
        [
          {
            type: 'postStatus',
            taskId: msg.taskId,
            to: 'accepted',
            sessionId: sid,
          },
        ],
      ]
    case 'diff/reject':
      if (!sid) return [state, []]
      return [
        state,
        [
          {
            type: 'postStatus',
            taskId: msg.taskId,
            to: 'rejected',
            sessionId: sid,
          },
        ],
      ]

    case 'lightbox/open':
      return [{ ...state, lightboxSrc: msg.src }, []]
    case 'lightbox/close':
      return [{ ...state, lightboxSrc: null }, []]
  }
}

// ── Row view-model (projected per derive; `each` rows get only the item) ──

interface RowVM {
  id: string
  glyph: string
  preview: string
  statusGlyph: string
  statusTitle: string
  selected: boolean
  expanded: boolean
  editing: boolean
  editDraft: string
  expansion: ExpansionData | 'loading' | null
}

function projectRows(s: BrowseState): RowVM[] {
  return s.notes
    .filter((n) => matchesFilters(n, activeFilters(s)))
    .map((n): RowVM => {
      const expanded = s.expandedNoteId === n.id
      return {
        id: n.id,
        glyph: kindGlyph(n.kind),
        preview: n.preview || '(no prose)',
        statusGlyph: statusGlyph(n.status),
        statusTitle: n.status ?? '',
        selected: s.selectedIds.includes(n.id),
        expanded,
        editing: s.editingNoteId === n.id,
        editDraft: s.editingNoteId === n.id ? s.editDraft : '',
        expansion: expanded ? (s.expansions[n.id] ?? 'loading') : null,
      }
    })
}

function emptyMessage(s: BrowseState): string | null {
  const visible = s.notes.filter((n) => matchesFilters(n, activeFilters(s)))
  if (visible.length > 0) return null
  if (s.notes.length === 0) {
    return currentSessionId(s)
      ? 'no notes in this session yet'
      : 'no sessions yet — drop a note from the compose view'
  }
  return `no notes match the current filters (${s.notes.length} hidden)`
}

// ── Styles ───────────────────────────────────────────────────────────────

const STYLE_SELECT =
  'padding: 3px 4px; border-radius: 4px; border: 1px solid var(--hud-border-strong);' +
  ' background: var(--hud-input-bg); color: var(--hud-fg); font: inherit; font-size: 11px;'
const STYLE_ROW =
  'border: 1px solid var(--hud-border); border-radius: 6px; background: var(--hud-surface);' +
  ' padding: 6px 8px; font-size: 12px; cursor: pointer;'
const SMALL_BTN = '; padding: 4px 10px; font-size: 11px;'

type Send = SignalViewBag<BrowseState, BrowseMsg>['send']

// ── View: proposed-diff block ────────────────────────────────────────────

function diffView(send: Send, exp: ExpansionData): Renderable {
  const fm = exp.frontmatter
  if (!fm.proposedDiff || !fm.replyTo) return []
  const taskId = fm.replyTo
  const proposed = fm.proposedDiff
  return [
    div(
      {
        'style.border': '1px solid var(--hud-border)',
        'style.borderRadius': '4px',
        'style.overflow': 'hidden',
        'style.marginTop': '6px',
      },
      [
        div(
          {
            'style.padding': '6px 8px',
            'style.fontSize': '11px',
            'style.background': 'var(--hud-surface)',
            'style.display': 'flex',
            'style.alignItems': 'center',
            'style.gap': '6px',
          },
          [
            span({ 'style.flex': '1', 'style.color': 'var(--hud-fg)' }, [
              text(`Proposed (${proposed.confidence}) — ${proposed.summary}`),
            ]),
            button(
              {
                type: 'button',
                style: btnStyle('primary') + '; padding: 3px 8px; font-size: 10px;',
                onClick: (e: Event) => {
                  e.stopPropagation()
                  send({ type: 'diff/accept', taskId })
                },
              },
              [text('Accept')],
            ),
            button(
              {
                type: 'button',
                style: btnStyle('ghost') + '; padding: 3px 8px; font-size: 10px;',
                onClick: (e: Event) => {
                  e.stopPropagation()
                  send({ type: 'diff/reject', taskId })
                },
              },
              [text('Reject')],
            ),
          ],
        ),
        ...proposed.files.map((file) =>
          div({ 'style.borderTop': '1px solid var(--hud-border)' }, [
            div(
              {
                'style.padding': '4px 8px',
                'style.fontFamily': 'ui-monospace, SFMono-Regular, monospace',
                'style.fontSize': '10px',
                'style.background': 'var(--hud-surface)',
                'style.color': 'var(--hud-fg-muted)',
              },
              [text(file.path)],
            ),
            pre(
              {
                'style.margin': '0',
                'style.padding': '6px 8px',
                'style.fontFamily': 'ui-monospace, SFMono-Regular, monospace',
                'style.fontSize': '10px',
                'style.lineHeight': '1.4',
                'style.overflowX': 'auto',
                'style.maxHeight': '220px',
                'style.overflowY': 'auto',
                'style.background': 'var(--hud-bg)',
              },
              file.patch.split('\n').map((line) => {
                const added = line.startsWith('+') && !line.startsWith('+++')
                const removed = line.startsWith('-') && !line.startsWith('---')
                const hunk = line.startsWith('@@')
                const style = added
                  ? 'background: rgba(22, 163, 74, 0.10); color: #15803d;'
                  : removed
                    ? 'background: rgba(239, 68, 68, 0.10); color: #b91c1c;'
                    : hunk
                      ? 'color: var(--hud-fg-subtle);'
                      : ''
                return div({ style }, [text(line)])
              }),
            ),
          ]),
        ),
      ],
    ),
  ]
}

// ── View: expansion (loaded) ─────────────────────────────────────────────

function loadedExpansion(
  origin: string,
  send: Send,
  onReplay: boolean,
  noteId: string,
  item: Signal<RowVM>,
  data: Signal<ExpansionData>,
): Renderable {
  return [
    // Screenshot preview (click → lightbox).
    show(
      data.map((d) => (d.frontmatter.screenshot ? d.frontmatter.screenshot : null)),
      () => [
        div({ 'style.display': 'flex', 'style.justifyContent': 'center' }, [
          img({
            src: data.map(
              (d) =>
                `${origin}/_llui/notes/${noteId}/screenshot?ts=${encodeURIComponent(
                  d.frontmatter.screenshot ?? '',
                )}`,
            ),
            alt: 'screenshot',
            'style.maxWidth': '100%',
            'style.maxHeight': '200px',
            'style.border': '1px solid var(--hud-border)',
            'style.borderRadius': '4px',
            'style.cursor': 'zoom-in',
            'style.background': 'var(--hud-surface)',
            onClick: (e: Event) => {
              e.stopPropagation()
              send({ type: 'lightbox/open', src: (e.currentTarget as HTMLImageElement).src })
            },
          }),
        ]),
      ],
    ),
    // Prose viewer OR inline edit textarea.
    show(
      item.map((r) => (r.editing ? true : null)),
      () => [
        textarea({
          rows: 5,
          style: STYLES.textarea + '; font-size: 12px;',
          value: item.map((r) => r.editDraft),
          onInput: (e: Event) =>
            send({ type: 'edit/change', value: (e.currentTarget as HTMLTextAreaElement).value }),
          onClick: (e: Event) => e.stopPropagation(),
        }),
      ],
      () => [
        div(
          {
            'style.padding': '8px',
            'style.background': 'var(--hud-bg)',
            'style.border': '1px solid var(--hud-border)',
            'style.borderRadius': '4px',
            'style.whiteSpace': 'pre-wrap',
            'style.fontSize': '12px',
            'style.color': 'var(--hud-fg)',
            'style.maxHeight': '160px',
            'style.overflowY': 'auto',
          },
          [text(data.map((d) => d.prose || '(no prose)'))],
        ),
      ],
    ),
    // Proposed-diff block (reply notes only).
    show(
      data.map((d) => (d.frontmatter.proposedDiff && d.frontmatter.replyTo ? d : null)),
      (d) => diffView(send, d.peek()),
    ),
    // Status timeline.
    div({ 'style.fontSize': '11px', 'style.color': 'var(--hud-fg-muted)' }, [
      show(
        data.map((d) => (d.history.length > 0 ? d.history : null)),
        (history) => [
          each(history, {
            key: (t) => `${t.noteId}:${t.ts}:${t.to}`,
            render: (t) => [
              div(
                {
                  'style.fontFamily': 'ui-monospace, SFMono-Regular, monospace',
                  'style.fontSize': '10px',
                },
                [
                  text(
                    t.map(
                      (x) =>
                        `${x.ts ? new Date(x.ts).toLocaleTimeString() : ''}  ${x.from ?? '·'} → ${x.to}${
                          x.reason ? ` (${x.reason.slice(0, 60)})` : ''
                        }`,
                    ),
                  ),
                ],
              ),
            ],
          }),
        ],
        () => [text('no status transitions')],
      ),
    ]),
    // Action row.
    ...actionRow(send, onReplay, noteId, item, data),
  ]
}

function actionRow(
  send: Send,
  onReplay: boolean,
  noteId: string,
  item: Signal<RowVM>,
  data: Signal<ExpansionData>,
): Renderable {
  return [
    div({ 'style.display': 'flex', 'style.gap': '6px', 'style.justifyContent': 'flex-end' }, [
      // Re-solve (task notes only).
      show(
        data.map((d) => (d.frontmatter.intent === 'task' ? true : null)),
        () => [
          button(
            {
              type: 'button',
              title: 'Submit a fresh task with this prose, chained off the previous conversation',
              style: btnStyle('secondary') + SMALL_BTN,
              onClick: (e: Event) => {
                e.stopPropagation()
                send({ type: 'reSolve', prose: data.peek().prose })
              },
            },
            [text('↻ Re-solve')],
          ),
        ],
      ),
      // Replay (notes carrying a repro trace, when host plumbed a replay fn).
      show(
        data.map((d) => (onReplay && d.repro.length > 0 ? d.repro.length : null)),
        (count) => [
          button(
            {
              type: 'button',
              style: btnStyle('secondary') + SMALL_BTN,
              onClick: (e: Event) => {
                e.stopPropagation()
                send({ type: 'replay', events: data.peek().repro })
              },
            },
            [text(count.map((n) => `▶ Replay (${n})`))],
          ),
        ],
      ),
      // Edit / Save+Cancel toggle.
      show(
        item.map((r) => (r.editing ? true : null)),
        () => [
          button(
            {
              type: 'button',
              style: btnStyle('ghost') + SMALL_BTN,
              onClick: (e: Event) => {
                e.stopPropagation()
                send({ type: 'edit/cancel' })
              },
            },
            [text('Cancel')],
          ),
          button(
            {
              type: 'button',
              style: btnStyle('primary') + SMALL_BTN,
              onClick: (e: Event) => {
                e.stopPropagation()
                send({ type: 'edit/save' })
              },
            },
            [text('Save')],
          ),
        ],
        () => [
          button(
            {
              type: 'button',
              style: btnStyle('secondary') + SMALL_BTN,
              onClick: (e: Event) => {
                e.stopPropagation()
                send({ type: 'edit/start', id: noteId, prose: data.peek().prose })
              },
            },
            [text('Edit')],
          ),
          button(
            {
              type: 'button',
              style: btnStyle('ghost') + SMALL_BTN,
              onClick: (e: Event) => {
                e.stopPropagation()
                if (!confirm(`Delete note ${noteId}? This cannot be undone.`)) return
                send({ type: 'note/delete', id: noteId })
              },
            },
            [text('Delete')],
          ),
        ],
      ),
    ]),
  ]
}

function expansionView(
  origin: string,
  send: Send,
  onReplay: boolean,
  item: Signal<RowVM>,
  exp: Signal<ExpansionData | 'loading'>,
): Renderable {
  const noteId = item.peek().id
  return [
    div(
      {
        'data-llui-expansion': '',
        'style.marginTop': '8px',
        'style.display': 'flex',
        'style.flexDirection': 'column',
        'style.gap': '6px',
      },
      [
        show(
          exp.map((e) => (e === 'loading' ? true : null)),
          () => [
            div({ 'style.color': 'var(--hud-fg-subtle)', 'style.fontSize': '11px' }, [
              text('loading…'),
            ]),
          ],
        ),
        show(
          exp.map((e) => (e === 'loading' ? null : e)),
          (data) => loadedExpansion(origin, send, onReplay, noteId, item, data),
        ),
      ],
    ),
  ]
}

// ── View: row ────────────────────────────────────────────────────────────

function rowView(origin: string, onReplay: boolean, item: Signal<RowVM>, send: Send): Renderable {
  return [
    div(
      {
        'data-llui-note-id': item.map((r) => r.id),
        style: STYLE_ROW,
        onClick: () => send({ type: 'row/toggleExpand', id: item.peek().id }),
      },
      [
        div({ 'style.display': 'flex', 'style.alignItems': 'center', 'style.gap': '6px' }, [
          input({
            type: 'checkbox',
            checked: item.map((r) => r.selected),
            'style.flex': '0 0 auto',
            'style.margin': '0',
            onClick: (e: Event) => e.stopPropagation(),
            onChange: () => send({ type: 'row/toggleSelect', id: item.peek().id }),
          }),
          span({ 'style.flex': '0 0 auto' }, [text(item.map((r) => r.glyph))]),
          span(
            {
              'style.fontFamily': 'ui-monospace, SFMono-Regular, monospace',
              'style.fontSize': '10px',
              'style.color': 'var(--hud-fg-subtle)',
              'style.flex': '0 0 auto',
            },
            [text(item.map((r) => r.id))],
          ),
          span(
            {
              'style.flex': '1 1 auto',
              'style.overflow': 'hidden',
              'style.textOverflow': 'ellipsis',
              'style.whiteSpace': 'nowrap',
              'style.color': 'var(--hud-fg)',
            },
            [text(item.map((r) => r.preview))],
          ),
          span({ 'style.flex': '0 0 auto', title: item.map((r) => r.statusTitle) }, [
            text(item.map((r) => r.statusGlyph)),
          ]),
        ]),
        show(
          item.map((r) => r.expansion),
          (exp) => expansionView(origin, send, onReplay, item, exp),
        ),
      ],
    ),
  ]
}

// ── View: root ───────────────────────────────────────────────────────────

function makeView(origin: string, onReplay: boolean) {
  return ({ state, send }: SignalViewBag<BrowseState, BrowseMsg>): Renderable => [
    div(
      {
        'data-llui-browse-view': '',
        'style.display': 'flex',
        'style.flexDirection': 'column',
        'style.gap': '8px',
      },
      [
        // Header: session select + refresh.
        div({ 'style.display': 'flex', 'style.gap': '8px', 'style.alignItems': 'center' }, [
          ...sessionSelectCmp(state, send),
          button(
            {
              type: 'button',
              title: 'Reload from disk (notes auto-refresh on activity)',
              style: STYLES.toolbarBtn + '; padding: 4px 8px;',
              onClick: () => send({ type: 'refresh' }),
            },
            [text('↻')],
          ),
        ]),
        // Filter row.
        div(
          {
            'style.display': 'grid',
            'style.gridTemplateColumns': '1fr 1fr 1fr',
            'style.gap': '4px',
          },
          [
            ...filterSelectCmp(state, send, 'kindSelect', 'llui-browse-kind', KIND_OPTIONS),
            ...filterSelectCmp(state, send, 'authorSelect', 'llui-browse-author', AUTHOR_OPTIONS),
            ...filterSelectCmp(state, send, 'statusSelect', 'llui-browse-status', STATUS_OPTIONS),
            input({
              type: 'search',
              placeholder: 'Search prose…',
              'style.gridColumn': '1 / span 3',
              style: STYLE_SELECT,
              value: state.map((s) => activeFilters(s).text),
              onInput: (e: Event) =>
                send({ type: 'filter/text', value: (e.currentTarget as HTMLInputElement).value }),
            }),
          ],
        ),
        // Bulk bar — present only while ≥1 row is selected.
        show(
          state.map((s) => (s.selectedIds.length > 0 ? s.selectedIds.length : null)),
          (count) => [
            div(
              {
                'style.display': 'flex',
                'style.alignItems': 'center',
                'style.gap': '8px',
                'style.padding': '6px 8px',
                'style.background': 'var(--hud-accent-bg)',
                'style.color': 'var(--hud-accent-fg)',
                'style.borderRadius': '6px',
                'style.fontSize': '12px',
              },
              [
                span({ 'style.flex': '1' }, [text(count.map((n) => `${n} selected`))]),
                button(
                  {
                    type: 'button',
                    style: btnStyle('ghost') + SMALL_BTN,
                    onClick: () => {
                      if (confirm(`Mark ${count.peek()} task(s) as wontfix?`))
                        send({ type: 'bulk/wontfix' })
                    },
                  },
                  [text('Mark wontfix')],
                ),
                button(
                  {
                    type: 'button',
                    style: btnStyle('ghost') + SMALL_BTN,
                    onClick: () => {
                      if (confirm(`Delete ${count.peek()} note(s)? This cannot be undone.`))
                        send({ type: 'bulk/delete' })
                    },
                  },
                  [text('Delete')],
                ),
                button(
                  {
                    type: 'button',
                    title: 'Clear selection',
                    style:
                      'background: transparent; border: 0; color: inherit; cursor: pointer;' +
                      ' font-size: 14px; line-height: 1; padding: 0 4px;',
                    onClick: () => send({ type: 'selection/clear' }),
                  },
                  [text('✕')],
                ),
              ],
            ),
          ],
        ),
        // Notes list — keyed reconcile.
        div(
          {
            'style.display': 'flex',
            'style.flexDirection': 'column',
            'style.gap': '4px',
            'style.maxHeight': '320px',
            'style.overflowY': 'auto',
            'style.padding': '2px',
          },
          [
            each(state.map(projectRows), {
              key: (r) => r.id,
              render: (item) => rowView(origin, onReplay, item, send),
            }),
          ],
        ),
        // Empty / no-match message.
        show(state.map(emptyMessage), (msg) => [
          div(
            {
              'style.padding': '16px 8px',
              'style.textAlign': 'center',
              'style.color': 'var(--hud-fg-subtle)',
              'style.fontSize': '12px',
            },
            [text(msg)],
          ),
        ]),
        // Screenshot lightbox (portaled to body, above everything).
        show(
          state.map((s) => s.lightboxSrc),
          (src) => [
            portal(() => [
              div(
                {
                  'style.position': 'fixed',
                  'style.inset': '0',
                  'style.background': 'rgba(0, 0, 0, 0.8)',
                  'style.zIndex': '2147483647',
                  'style.display': 'flex',
                  'style.alignItems': 'center',
                  'style.justifyContent': 'center',
                  'style.cursor': 'zoom-out',
                  'style.padding': '32px',
                  onClick: () => send({ type: 'lightbox/close' }),
                },
                [
                  img({
                    src,
                    'style.maxWidth': '100%',
                    'style.maxHeight': '100%',
                    'style.boxShadow': '0 20px 60px rgba(0,0,0,0.6)',
                  }),
                ],
              ),
            ]),
          ],
        ),
      ],
    ),
  ]
}

type FilterSliceKey = 'kindSelect' | 'authorSelect' | 'statusSelect'
type SliceKey = FilterSliceKey | 'sessionSelect'

const MENU_ITEM_STYLE =
  'display: block; width: 100%; text-align: left; padding: 4px 8px; border: 0;' +
  ' background: transparent; color: var(--hud-fg); cursor: pointer; font: inherit; font-size: 11px;'
const LISTBOX_STYLE =
  'background: var(--hud-bg); border: 1px solid var(--hud-border-strong); border-radius: 4px;' +
  ' box-shadow: 0 4px 16px rgba(0,0,0,0.25); padding: 2px; z-index: 2147483647; max-height: 240px; overflow-y: auto;'

const labelOf = (value: string, options: ReadonlyArray<readonly [string, string]>): string =>
  options.find(([v]) => v === value)?.[1] ?? value

/** A filter dropdown (static options) backed by @llui/components/select. */
function filterSelectCmp(
  state: Signal<BrowseState>,
  send: (m: BrowseMsg) => void,
  sliceKey: FilterSliceKey,
  id: string,
  options: ReadonlyArray<readonly [string, string]>,
): Renderable {
  const slice = state.at(sliceKey)
  const parts = select.connect(slice, (m) => send({ type: sliceKey, msg: m }), { id })
  return [
    button({ ...parts.trigger, style: STYLE_SELECT + '; text-align: left;' }, [
      text(slice.map((ss) => labelOf(ss.value[0] ?? 'all', options))),
    ]),
    select.overlay({
      state: slice,
      send: (m) => send({ type: sliceKey, msg: m }),
      parts,
      sameWidth: true,
      content: () => [
        div(
          { ...parts.content, style: LISTBOX_STYLE },
          options.map(([value, label], index) =>
            button({ ...parts.item(value, index).item, style: MENU_ITEM_STYLE }, [text(label)]),
          ),
        ),
      ],
    }),
  ]
}

/** The session dropdown (dynamic items) backed by @llui/components/select. */
function sessionSelectCmp(state: Signal<BrowseState>, send: (m: BrowseMsg) => void): Renderable {
  const slice = state.at('sessionSelect')
  const parts = select.connect(slice, (m) => send({ type: 'sessionSelect', msg: m }), {
    id: 'llui-browse-session',
  })
  return [
    button({ ...parts.trigger, style: STYLE_SELECT + '; flex: 1; text-align: left;' }, [
      text(
        state.map((s) => {
          const v = s.sessionSelect.value[0]
          if (!v) return '(no sessions)'
          const sess = s.sessions.find((x) => x.id === v)
          return sess ? `${sess.id} (${sess.noteCount})` : v
        }),
      ),
    ]),
    select.overlay({
      state: slice,
      send: (m) => send({ type: 'sessionSelect', msg: m }),
      parts,
      sameWidth: true,
      content: () => [
        div({ ...parts.content, style: LISTBOX_STYLE }, [
          each(
            state.map((s) => s.sessions),
            {
              key: (sess) => sess.id,
              render: (sess, index) => [
                button(
                  { ...parts.item(sess.peek().id, index.peek()).item, style: MENU_ITEM_STYLE },
                  [text(sess.map((x) => `${x.id} (${x.noteCount})`))],
                ),
              ],
            },
          ),
        ]),
      ],
    }),
  ]
}

// keep a reference so `SliceKey` is used (documents the select slice keys).
export type BrowseSelectSlice = SliceKey

// ── Effects + handle ─────────────────────────────────────────────────────

export function createBrowseView(opts: BrowseViewOptions): BrowseViewHandle {
  const reportError = opts.onError ?? ((m) => console.warn('[llui:browse]', m))
  const onReplay = !!opts.onReplayRepro

  const host = document.createElement('div')
  host.setAttribute('data-llui-browse-host', '')

  const handle = mountSignalComponent<BrowseState, BrowseMsg, BrowseEffect>(
    host,
    component<BrowseState, BrowseMsg, BrowseEffect>({
      name: 'llui-devmode-annotate:browse',
      init: browseInit,
      update: browseReduce,
      view: makeView(opts.origin, onReplay),
      onEffect: (eff, { send }) => runEffect(eff, send, opts, reportError),
    }),
    { devtools: false },
  )

  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  const refresh = (): void => {
    if (refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      handle.send({ type: 'refresh' })
    }, 100)
  }
  const onShow = (): void => handle.send({ type: 'show' })

  return { el: host, refresh, onShow }
}

function runEffect(
  eff: BrowseEffect,
  send: (msg: BrowseMsg) => void,
  opts: BrowseViewOptions,
  reportError: (m: string) => void,
): void {
  const { origin } = opts
  const fail = (label: string, err: unknown): void =>
    reportError(`${label}: ${err instanceof Error ? err.message : String(err)}`)

  switch (eff.type) {
    case 'report':
      reportError(eff.message)
      return

    case 'fetchSessions':
      void (async () => {
        try {
          const res = await fetch(`${origin}/_llui/sessions`)
          if (!res.ok) throw new Error(`GET /_llui/sessions → ${res.status}`)
          const payload = (await res.json()) as { sessions: SessionSummary[] }
          send({ type: 'sessions/loaded', sessions: payload.sessions ?? [] })
        } catch (err) {
          fail('failed to load sessions', err)
        }
      })()
      return

    case 'fetchNotes':
      void (async () => {
        if (!eff.sessionId) {
          send({ type: 'notes/loaded', notes: [] })
          return
        }
        try {
          const res = await fetch(
            `${origin}/_llui/notes?sessionId=${encodeURIComponent(eff.sessionId)}`,
          )
          if (!res.ok) throw new Error(`GET /_llui/notes → ${res.status}`)
          const payload = (await res.json()) as { notes: NoteSummary[] }
          send({ type: 'notes/loaded', notes: payload.notes ?? [] })
        } catch (err) {
          fail('failed to load notes', err)
        }
      })()
      return

    case 'fetchExpansion':
      void (async () => {
        try {
          const [full, history] = await Promise.all([
            fetch(
              `${origin}/_llui/notes/${eff.id}?sessionId=${encodeURIComponent(eff.sessionId)}&format=json`,
            )
              .then((r) => (r.ok ? (r.json() as Promise<FullNote>) : null))
              .catch(() => null),
            fetch(
              `${origin}/_llui/notes/${eff.id}/status?sessionId=${encodeURIComponent(eff.sessionId)}`,
            )
              .then((r) => (r.ok ? (r.json() as Promise<{ history?: StatusTransition[] }>) : null))
              .catch(() => null),
          ])
          const fm: NoteFrontmatterLite = full?.frontmatter ?? { kind: 'text', author: 'human' }
          const repro = Array.isArray(full?.body?.repro) ? full!.body!.repro! : []
          send({
            type: 'expansion/loaded',
            id: eff.id,
            data: {
              prose: full?.prose ?? '',
              frontmatter: fm,
              history: history?.history ?? [],
              repro,
            },
          })
        } catch (err) {
          fail('failed to load note', err)
        }
      })()
      return

    case 'deleteNote':
      void (async () => {
        try {
          const res = await fetch(
            `${origin}/_llui/notes/${eff.id}?sessionId=${encodeURIComponent(eff.sessionId)}`,
            { method: 'DELETE' },
          )
          if (!res.ok) reportError(`delete failed (${res.status})`)
          send({ type: 'refresh' })
        } catch (err) {
          fail('delete failed', err)
        }
      })()
      return

    case 'bulkDelete':
      void (async () => {
        const results = await Promise.all(
          eff.ids.map((id) =>
            fetch(`${origin}/_llui/notes/${id}?sessionId=${encodeURIComponent(eff.sessionId)}`, {
              method: 'DELETE',
            })
              .then((r) => r.ok)
              .catch(() => false),
          ),
        )
        if (results.some((ok) => !ok)) reportError('one or more deletes failed')
        send({ type: 'refresh' })
      })()
      return

    case 'bulkStatus':
      void (async () => {
        await Promise.all(
          eff.ids.map((id) =>
            fetch(
              `${origin}/_llui/notes/${id}/status?sessionId=${encodeURIComponent(eff.sessionId)}`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ to: eff.to, by: 'human' }),
              },
            ).catch(() => null),
          ),
        )
        send({ type: 'refresh' })
      })()
      return

    case 'patchProse':
      void (async () => {
        try {
          const res = await fetch(
            `${origin}/_llui/notes/${eff.id}?sessionId=${encodeURIComponent(eff.sessionId)}`,
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ prose: eff.prose }),
            },
          )
          if (!res.ok) {
            reportError(`save failed (${res.status})`)
            return
          }
          send({ type: 'refresh' })
        } catch (err) {
          fail('save failed', err)
        }
      })()
      return

    case 'postStatus':
      void (async () => {
        try {
          const res = await fetch(
            `${origin}/_llui/notes/${eff.taskId}/status?sessionId=${encodeURIComponent(eff.sessionId)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ to: eff.to, by: 'human' }),
            },
          )
          if (!res.ok) reportError(`${eff.to} failed (${res.status})`)
        } catch (err) {
          fail(`${eff.to} failed`, err)
        }
      })()
      return

    case 'reSolve':
      void (async () => {
        if (!eff.prose.trim()) {
          reportError('cannot re-solve a task with empty prose')
          return
        }
        try {
          const body = {
            body: eff.prose,
            frontmatter: {
              author: 'human',
              kind: 'text',
              captureLevel: 'standard',
              url: typeof location !== 'undefined' ? location.href : '',
              route: null,
              routeParams: {},
              viewport: {
                w: typeof window !== 'undefined' ? window.innerWidth : 0,
                h: typeof window !== 'undefined' ? window.innerHeight : 0,
                dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
              },
              componentPath: null,
              componentMeta: null,
              annotations: [],
              screenshot: null,
              agentSchemas: [],
              llui: { runtime: 'unknown', compiler: 'unknown' },
              intent: 'task',
              resume: true,
            },
            noteBody: {},
          }
          const res = await fetch(`${origin}/_llui/notes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            reportError(`re-solve failed (${res.status})`)
            return
          }
          send({ type: 'refresh' })
        } catch (err) {
          fail('re-solve failed', err)
        }
      })()
      return

    case 'replay':
      void (async () => {
        if (!opts.onReplayRepro) return
        try {
          const result = await opts.onReplayRepro(eff.events)
          const skipped = result.skipped.length
          reportError(
            skipped > 0
              ? `Replayed ${result.applied}, skipped ${skipped} (target selector(s) no longer match)`
              : `Replayed ${result.applied} event(s)`,
          )
        } catch (err) {
          fail('Replay failed', err)
        }
      })()
      return
  }
}
