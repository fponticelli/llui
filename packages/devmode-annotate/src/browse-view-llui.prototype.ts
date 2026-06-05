// PROTOTYPE — dogfooding experiment, not wired into the build.
//
// A re-implementation of the CORE of ./browse-view.ts authored with
// @llui/dom (TEA component on an independent mount root) instead of raw
// `document.createElement` + `el.innerHTML = ''` rebuilds.
//
// Scope: the structurally interesting parts — session select, the four
// filters, client-side filtering, the keyed notes list, per-row select +
// expand, the bulk bar, and async fetch effects. Deliberately ELIDED (each
// is "more of the same" declaratively, and porting them wouldn't change the
// verdict): the proposed-diff viewer, the inline edit textarea, re-solve,
// replay, and the screenshot lightbox (which in LLui would simply be a
// `portal(() => …)` gated by `show`). Markers below note where they'd slot in.
//
// Requires `@llui/dom` as a dependency of this package (it has none today);
// left out of package.json on purpose — this file is exploratory.

import {
  component,
  mountSignalComponent,
  div,
  span,
  button,
  select,
  option,
  input,
  each,
  show,
  text,
  type Renderable,
  type SignalViewBag,
} from '@llui/dom'

// ── Domain types (same as browse-view.ts) ───────────────────────────────

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

interface BrowseFilters {
  kind: 'all' | 'text' | 'rect' | 'capture' | 'reply'
  author: 'all' | 'human' | 'llm'
  status: 'all' | 'open' | 'working' | 'proposed' | 'applied' | 'closed'
  text: string
}

export interface BrowseViewOptions {
  origin: string
  onError?: (message: string) => void
}

// Hydrated expansion payload (fetched lazily when a row is expanded).
interface ExpansionData {
  prose: string
  intent?: string
  history: StatusTransition[]
}

// ── Pure helpers (lifted verbatim from browse-view.ts) ───────────────────

function statusBucket(s: string | undefined): BrowseFilters['status'] {
  if (!s || s === 'open') return 'open'
  if (s === 'claimed' || s === 'in-progress' || s === 'accepted') return 'working'
  if (s === 'proposed') return 'proposed'
  if (s === 'applied') return 'applied'
  return 'closed'
}

function statusGlyph(status: string | undefined): string {
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

function kindGlyph(kind: string): string {
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

function matchesFilters(n: NoteSummary, f: BrowseFilters): boolean {
  if (f.kind !== 'all' && n.kind !== f.kind) return false
  if (f.author !== 'all' && n.author !== f.author) return false
  if (f.status !== 'all' && statusBucket(n.status) !== f.status) return false
  if (f.text && !n.preview.toLowerCase().includes(f.text.toLowerCase())) return false
  return true
}

// ── TEA shapes ───────────────────────────────────────────────────────────

type Phase = 'idle' | 'loading' | 'ready'

// State is a single JSON-serializable record. NOTE: the raw version keeps a
// `Set<string>` (selectedIds), a `Map` (noteCache) and live closures — none
// of which the agent/MCP debug surface can see. Here it is all plain data,
// which is exactly what makes the HUD introspectable by LLui's own tools.
interface State {
  phase: Phase
  sessions: SessionSummary[]
  currentSessionId: string | null
  notes: NoteSummary[]
  filters: BrowseFilters
  expandedNoteId: string | null
  selectedIds: string[]
  // hydrated expansions keyed by note id; 'loading' while the fetch is in flight
  expansions: Record<string, ExpansionData | 'loading'>
}

type Msg =
  | { type: 'show' }
  | { type: 'refresh' }
  | { type: 'sessions/loaded'; sessions: SessionSummary[] }
  | { type: 'notes/loaded'; notes: NoteSummary[] }
  | { type: 'session/select'; id: string }
  | { type: 'filter/kind'; value: BrowseFilters['kind'] }
  | { type: 'filter/author'; value: BrowseFilters['author'] }
  | { type: 'filter/status'; value: BrowseFilters['status'] }
  | { type: 'filter/text'; value: string }
  | { type: 'row/toggleExpand'; id: string }
  | { type: 'row/toggleSelect'; id: string }
  | { type: 'expansion/loaded'; id: string; data: ExpansionData }
  | { type: 'selection/clear' }
  | { type: 'note/delete'; id: string }
  | { type: 'bulk/delete' }

type Effect =
  | { type: 'fetchSessions' }
  | { type: 'fetchNotes'; sessionId: string | null }
  | { type: 'fetchExpansion'; id: string; sessionId: string }
  | { type: 'deleteNote'; id: string; sessionId: string }
  | { type: 'bulkDelete'; ids: string[]; sessionId: string }
  | { type: 'report'; message: string }

const initialFilters = (): BrowseFilters => ({
  kind: 'all',
  author: 'all',
  status: 'all',
  text: '',
})

const init = (): State => ({
  phase: 'idle',
  sessions: [],
  currentSessionId: null,
  notes: [],
  filters: initialFilters(),
  expandedNoteId: null,
  selectedIds: [],
  expansions: {},
})

// Pick the session to show after a sessions fetch: keep the current one if it
// still exists, else default to the most-recently-started (last in the list).
function pickSession(sessions: SessionSummary[], current: string | null): string | null {
  if (sessions.length === 0) return null
  if (current && sessions.some((s) => s.id === current)) return current
  return sessions[sessions.length - 1]!.id
}

const update = (state: State, msg: Msg): [State, Effect[]] => {
  switch (msg.type) {
    case 'show':
      if (state.phase !== 'idle') return [state, []]
      return [{ ...state, phase: 'loading' }, [{ type: 'fetchSessions' }]]

    case 'refresh':
      return [state, [{ type: 'fetchSessions' }]]

    case 'sessions/loaded': {
      const currentSessionId = pickSession(msg.sessions, state.currentSessionId)
      return [
        { ...state, phase: 'ready', sessions: msg.sessions, currentSessionId },
        [{ type: 'fetchNotes', sessionId: currentSessionId }],
      ]
    }

    case 'notes/loaded': {
      const notes = msg.notes.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1))
      return [{ ...state, notes }, []]
    }

    case 'session/select':
      return [
        {
          ...state,
          currentSessionId: msg.id,
          expandedNoteId: null,
          selectedIds: [],
          expansions: {},
        },
        [{ type: 'fetchNotes', sessionId: msg.id }],
      ]

    // All four filters are pure client-side state — no server round-trip,
    // and reconciliation makes the per-keystroke re-render cheap enough that
    // the raw version's 120ms search debounce is no longer needed.
    case 'filter/kind':
      return [{ ...state, filters: { ...state.filters, kind: msg.value } }, []]
    case 'filter/author':
      return [{ ...state, filters: { ...state.filters, author: msg.value } }, []]
    case 'filter/status':
      return [{ ...state, filters: { ...state.filters, status: msg.value } }, []]
    case 'filter/text':
      return [{ ...state, filters: { ...state.filters, text: msg.value } }, []]

    case 'row/toggleExpand': {
      if (state.expandedNoteId === msg.id) {
        return [{ ...state, expandedNoteId: null }, []]
      }
      const already = state.expansions[msg.id]
      const effects: Effect[] =
        already || !state.currentSessionId
          ? []
          : [{ type: 'fetchExpansion', id: msg.id, sessionId: state.currentSessionId }]
      return [
        {
          ...state,
          expandedNoteId: msg.id,
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
      if (!state.currentSessionId) return [state, []]
      return [
        { ...state, expandedNoteId: null },
        [{ type: 'deleteNote', id: msg.id, sessionId: state.currentSessionId }],
      ]

    case 'bulk/delete': {
      if (state.selectedIds.length === 0 || !state.currentSessionId) return [state, []]
      const ids = state.selectedIds
      return [
        { ...state, selectedIds: [] },
        [{ type: 'bulkDelete', ids, sessionId: state.currentSessionId }],
      ]
    }
  }
}

// ── Row view-model ───────────────────────────────────────────────────────
//
// KEY FINDING: `each`'s row `render` receives ONLY the item signal, not the
// component state. The raw version's `renderNoteRow` freely closes over
// `selectedIds` and `expandedNoteId`; here those per-row UI flags must be
// PROJECTED into the row model inside the derive. This is the "explicit data
// flow" tax of TEA — but the projection is itself plain, testable, and
// introspectable, and the chunked-mask reconciler still commits only the
// fields that actually change per row.

interface RowVM {
  id: string
  glyph: string
  preview: string
  statusGlyph: string
  statusTitle: string
  selected: boolean
  expanded: boolean
  expansion: ExpansionData | 'loading' | null
}

function projectRows(s: State): RowVM[] {
  return s.notes
    .filter((n) => matchesFilters(n, s.filters))
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
        expansion: expanded ? (s.expansions[n.id] ?? 'loading') : null,
      }
    })
}

function emptyMessage(s: State): string | null {
  const visible = s.notes.filter((n) => matchesFilters(n, s.filters))
  if (visible.length > 0) return null
  if (s.notes.length === 0) {
    return s.currentSessionId
      ? 'no notes in this session yet'
      : 'no sessions yet — drop a note from the compose view'
  }
  return `no notes match the current filters (${s.notes.length} hidden)`
}

// ── View ─────────────────────────────────────────────────────────────────

const STYLE_SELECT =
  'padding: 3px 4px; border-radius: 4px; border: 1px solid var(--hud-border-strong);' +
  ' background: var(--hud-input-bg); color: var(--hud-fg); font: inherit; font-size: 11px;'

const STYLE_ROW =
  'border: 1px solid var(--hud-border); border-radius: 6px; background: var(--hud-surface);' +
  ' padding: 6px 8px; font-size: 12px; cursor: pointer;'

function expansionView(exp: import('@llui/dom').Signal<ExpansionData | 'loading'>): Renderable {
  // 'loading' sentinel vs hydrated data.
  return [
    div({ 'style.marginTop': '8px', 'style.display': 'flex', 'style.flexDirection': 'column' }, [
      // Prose box (or the loading placeholder).
      div(
        {
          'style.padding': '8px',
          'style.background': 'var(--hud-bg)',
          'style.border': '1px solid var(--hud-border)',
          'style.borderRadius': '4px',
          'style.whiteSpace': 'pre-wrap',
          'style.fontSize': '12px',
          'style.color': 'var(--hud-fg)',
        },
        [text(exp.map((e) => (e === 'loading' ? 'loading…' : e.prose || '(no prose)')))],
      ),
      // Status timeline — one line per transition. (Diff viewer / screenshot
      // / edit textarea would slot in here too; elided.)
      div(
        {
          'style.fontSize': '10px',
          'style.color': 'var(--hud-fg-muted)',
          'style.marginTop': '6px',
        },
        [
          show(
            exp.map((e) => (e === 'loading' ? null : e.history)),
            (history) =>
              history.peek().length === 0
                ? [text('no status transitions')]
                : [
                    each(history, {
                      key: (t) => `${t.noteId}:${t.ts}:${t.to}`,
                      render: (t) => [
                        div({ 'data-row': 'transition' }, [
                          text(
                            t.map(
                              (x) =>
                                `${x.from ?? '·'} → ${x.to}${x.reason ? ` (${x.reason.slice(0, 60)})` : ''}`,
                            ),
                          ),
                        ]),
                      ],
                    }),
                  ],
          ),
        ],
      ),
      // Action row — Delete kept; Edit / Re-solve / Replay elided.
      div(
        {
          'style.display': 'flex',
          'style.gap': '6px',
          'style.justifyContent': 'flex-end',
          'style.marginTop': '6px',
        },
        [],
      ),
    ]),
  ]
}

function rowView(
  item: import('@llui/dom').Signal<RowVM>,
  send: SignalViewBag<State, Msg>['send'],
): Renderable {
  return [
    div(
      {
        'data-llui-note-id': item.map((r) => r.id),
        style: STYLE_ROW,
        onClick: () => send({ type: 'row/toggleExpand', id: item.peek().id }),
      },
      [
        // Summary line.
        div({ 'style.display': 'flex', 'style.alignItems': 'center', 'style.gap': '6px' }, [
          input({
            type: 'checkbox',
            checked: item.map((r) => r.selected),
            'style.flex': '0 0 auto',
            'style.margin': '0',
            // Don't let the checkbox click bubble to the row's expand toggle.
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
        // Expansion — only present for the expanded row. `show` mounts/unmounts
        // it; the row stays in place (no innerHTML wipe of the whole list).
        show(
          item.map((r) => r.expansion),
          (exp) => expansionView(exp),
        ),
      ],
    ),
  ]
}

const view = ({ state, send }: SignalViewBag<State, Msg>): Renderable => [
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
        select(
          {
            'style.flex': '1',
            style: STYLE_SELECT,
            value: state.map((s) => s.currentSessionId ?? ''),
            onChange: (e: Event) =>
              send({ type: 'session/select', id: (e.currentTarget as HTMLSelectElement).value }),
          },
          [
            each(
              state.map((s) => s.sessions),
              {
                key: (s) => s.id,
                render: (s) => [
                  option({ value: s.map((x) => x.id) }, [
                    text(s.map((x) => `${x.id} (${x.noteCount})`)),
                  ]),
                ],
              },
            ),
          ],
        ),
        button(
          {
            type: 'button',
            title: 'Reload from disk (notes auto-refresh on activity)',
            onClick: () => send({ type: 'refresh' }),
          },
          [text('↻')],
        ),
      ]),
      // Filter row.
      div(
        { 'style.display': 'grid', 'style.gridTemplateColumns': '1fr 1fr 1fr', 'style.gap': '4px' },
        [
          select(
            {
              style: STYLE_SELECT,
              value: state.map((s) => s.filters.kind),
              onChange: (e: Event) =>
                send({
                  type: 'filter/kind',
                  value: (e.currentTarget as HTMLSelectElement).value as BrowseFilters['kind'],
                }),
            },
            [
              option({ value: 'all' }, [text('All kinds')]),
              option({ value: 'text' }, [text('📝 text')]),
              option({ value: 'rect' }, [text('⌖ rect')]),
              option({ value: 'capture' }, [text('📸 capture')]),
              option({ value: 'reply' }, [text('↩ reply')]),
            ],
          ),
          select(
            {
              style: STYLE_SELECT,
              value: state.map((s) => s.filters.author),
              onChange: (e: Event) =>
                send({
                  type: 'filter/author',
                  value: (e.currentTarget as HTMLSelectElement).value as BrowseFilters['author'],
                }),
            },
            [
              option({ value: 'all' }, [text('All authors')]),
              option({ value: 'human' }, [text('👤 human')]),
              option({ value: 'llm' }, [text('🤖 llm')]),
            ],
          ),
          select(
            {
              style: STYLE_SELECT,
              value: state.map((s) => s.filters.status),
              onChange: (e: Event) =>
                send({
                  type: 'filter/status',
                  value: (e.currentTarget as HTMLSelectElement).value as BrowseFilters['status'],
                }),
            },
            [
              option({ value: 'all' }, [text('All statuses')]),
              option({ value: 'open' }, [text('open')]),
              option({ value: 'working' }, [text('working')]),
              option({ value: 'proposed' }, [text('proposed')]),
              option({ value: 'applied' }, [text('applied')]),
              option({ value: 'closed' }, [text('closed')]),
            ],
          ),
          input({
            type: 'search',
            placeholder: 'Search prose…',
            'style.gridColumn': '1 / span 3',
            style: STYLE_SELECT,
            value: state.map((s) => s.filters.text),
            onInput: (e: Event) =>
              send({ type: 'filter/text', value: (e.currentTarget as HTMLInputElement).value }),
          }),
        ],
      ),
      // Bulk bar — present only while >=1 row is selected.
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
              button({ type: 'button', onClick: () => send({ type: 'bulk/delete' }) }, [
                text('Delete'),
              ]),
              button(
                {
                  type: 'button',
                  title: 'Clear selection',
                  onClick: () => send({ type: 'selection/clear' }),
                },
                [text('✕')],
              ),
            ],
          ),
        ],
      ),
      // Notes list — keyed reconcile. An SSE update that changes ONE note's
      // status updates only that row; the raw version rebuilt the whole list
      // (losing scroll position + any expanded row's fetched content).
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
            render: (item) => rowView(item, send),
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
    ],
  ),
]

// ── Mount + effect plumbing ──────────────────────────────────────────────

export interface BrowseViewHandle {
  el: HTMLElement
  refresh: () => void
  onShow: () => void
  dispose: () => void
}

export function createBrowseView(opts: BrowseViewOptions): BrowseViewHandle {
  const { origin } = opts
  const reportError = opts.onError ?? ((m) => console.warn('[llui:browse]', m))

  const host = document.createElement('div')
  host.setAttribute('data-llui-browse-host', '')

  const handle = mountSignalComponent<State, Msg, Effect>(
    host,
    component<State, Msg, Effect>({
      name: 'llui-browse-view',
      init,
      update,
      view,
      onEffect: (eff, { send }) => {
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
                reportError(
                  `failed to load sessions: ${err instanceof Error ? err.message : String(err)}`,
                )
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
                reportError(
                  `failed to load notes: ${err instanceof Error ? err.message : String(err)}`,
                )
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
                    .then((r) =>
                      r.ok
                        ? (r.json() as Promise<{
                            prose?: string
                            frontmatter?: { intent?: string }
                          }>)
                        : null,
                    )
                    .catch(() => null),
                  fetch(
                    `${origin}/_llui/notes/${eff.id}/status?sessionId=${encodeURIComponent(eff.sessionId)}`,
                  )
                    .then((r) =>
                      r.ok ? (r.json() as Promise<{ history?: StatusTransition[] }>) : null,
                    )
                    .catch(() => null),
                ])
                send({
                  type: 'expansion/loaded',
                  id: eff.id,
                  data: {
                    prose: full?.prose ?? '',
                    intent: full?.frontmatter?.intent,
                    history: history?.history ?? [],
                  },
                })
              } catch (err) {
                reportError(
                  `failed to load note: ${err instanceof Error ? err.message : String(err)}`,
                )
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
                reportError(`delete failed: ${err instanceof Error ? err.message : String(err)}`)
              }
            })()
            return
          case 'bulkDelete':
            void (async () => {
              const results = await Promise.all(
                eff.ids.map((id) =>
                  fetch(
                    `${origin}/_llui/notes/${id}?sessionId=${encodeURIComponent(eff.sessionId)}`,
                    {
                      method: 'DELETE',
                    },
                  )
                    .then((r) => r.ok)
                    .catch(() => false),
                ),
              )
              if (results.some((ok) => !ok)) reportError('one or more deletes failed')
              send({ type: 'refresh' })
            })()
            return
        }
      },
    }),
  )

  // SSE bursts during a solve: just poke the reducer. Debounce is unnecessary
  // here — `send` is synchronous and reconciliation makes a redundant refresh
  // cheap — but we keep a small one to coalesce server round-trips.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  const refresh = (): void => {
    if (refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      handle.send({ type: 'refresh' })
    }, 100)
  }
  const onShow = (): void => handle.send({ type: 'show' })
  const dispose = (): void => {
    if (refreshTimer) clearTimeout(refreshTimer)
    handle.dispose()
    host.remove()
  }

  return { el: host, refresh, onShow, dispose }
}
