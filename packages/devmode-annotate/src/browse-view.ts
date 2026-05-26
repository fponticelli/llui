// Notes browser view. Mounted inside the HUD modal alongside the
// compose view; the user toggles between them via a "Browse" link.
//
// Responsibilities:
//   - Pick a session from the dropdown.
//   - List notes in that session, newest first.
//   - Click a note → expand: full prose + status timeline + edit + delete.
//   - Edit calls PATCH /_llui/notes/:id, Delete calls DELETE /_llui/notes/:id.
//   - Re-fetch whenever the HUD receives a `note-{created,updated,deleted}` SSE event.
//
// The view is fully self-contained — it returns a DOM root + an
// `update()` method the parent calls when new SSE events arrive.

import { btnStyle, STYLES } from './styles.js'

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

/** Filters applied client-side over the fetched notes list. */
interface BrowseFilters {
  kind: 'all' | 'text' | 'rect' | 'capture' | 'reply'
  author: 'all' | 'human' | 'llm'
  status: 'all' | 'open' | 'working' | 'proposed' | 'applied' | 'closed'
  text: string
}

/** Buckets `status` into the high-level categories the filter UI uses. */
function statusBucket(s: string | undefined): BrowseFilters['status'] {
  if (!s || s === 'open') return 'open'
  if (s === 'claimed' || s === 'in-progress' || s === 'accepted') return 'working'
  if (s === 'proposed') return 'proposed'
  if (s === 'applied') return 'applied'
  return 'closed' // rejected | wontfix | failed
}

export interface BrowseViewHandle {
  /** The root DOM element to append to the modal. */
  el: HTMLElement
  /** Re-fetch sessions + current note list. Cheap to call on every
   *  SSE event; debounced internally. */
  refresh: () => void
  /** Called when the view becomes visible. Triggers an immediate
   *  fetch if it hasn't loaded yet. */
  onShow: () => void
}

export interface BrowseViewOptions {
  origin: string
  /** Reports user actions back to the host modal — used to surface
   *  errors via the existing status line / toast system. */
  onError?: (message: string) => void
}

/**
 * Build the browse-view DOM tree + return a handle. The parent owns
 * mount/unmount and visibility toggling.
 */
export function createBrowseView(opts: BrowseViewOptions): BrowseViewHandle {
  const { origin } = opts
  const reportError = opts.onError ?? ((m) => console.warn('[llui:browse]', m))

  const el = document.createElement('div')
  el.setAttribute('data-llui-browse-view', '')
  el.style.cssText = 'display: none; flex-direction: column; gap: 8px;'

  // Header row: session selector + refresh button
  const headerRow = document.createElement('div')
  headerRow.style.cssText = 'display: flex; gap: 8px; align-items: center;'

  const sessionSelect = document.createElement('select')
  sessionSelect.style.cssText = [
    'flex: 1',
    'padding: 4px 6px',
    'border-radius: 6px',
    'border: 1px solid var(--hud-border-strong)',
    'background: var(--hud-input-bg)',
    'color: var(--hud-fg)',
    'font: inherit',
    'font-size: 12px',
  ].join('; ')

  const refreshBtn = document.createElement('button')
  refreshBtn.type = 'button'
  refreshBtn.textContent = '↻'
  // Notes auto-refresh whenever the server broadcasts a
  // note-created / note-updated / note-deleted / status-changed
  // event. This button is the escape hatch for out-of-band edits
  // (e.g. someone wrote files directly with an MCP tool, or SSE
  // dropped briefly during a long solve).
  refreshBtn.title = 'Reload from disk (notes auto-refresh on activity)'
  refreshBtn.style.cssText = STYLES.toolbarBtn + '; padding: 4px 8px;'

  headerRow.append(sessionSelect, refreshBtn)

  // Filter row: kind / author / status selects + free-text search.
  const filterRow = document.createElement('div')
  filterRow.style.cssText = [
    'display: grid',
    'grid-template-columns: 1fr 1fr 1fr',
    'gap: 4px',
    'align-items: center',
    'font-size: 11px',
  ].join('; ')

  const selectStyle = [
    'padding: 3px 4px',
    'border-radius: 4px',
    'border: 1px solid var(--hud-border-strong)',
    'background: var(--hud-input-bg)',
    'color: var(--hud-fg)',
    'font: inherit',
    'font-size: 11px',
  ].join('; ')

  const mkFilterSelect = (options: ReadonlyArray<readonly [string, string]>): HTMLSelectElement => {
    const sel = document.createElement('select')
    sel.style.cssText = selectStyle
    for (const [value, label] of options) {
      const opt = document.createElement('option')
      opt.value = value
      opt.textContent = label
      sel.appendChild(opt)
    }
    return sel
  }
  const kindFilter = mkFilterSelect([
    ['all', 'All kinds'],
    ['text', '📝 text'],
    ['rect', '⌖ rect'],
    ['capture', '📸 capture'],
    ['reply', '↩ reply'],
  ])
  const authorFilter = mkFilterSelect([
    ['all', 'All authors'],
    ['human', '👤 human'],
    ['llm', '🤖 llm'],
  ])
  const statusFilter = mkFilterSelect([
    ['all', 'All statuses'],
    ['open', 'open'],
    ['working', 'working'],
    ['proposed', 'proposed'],
    ['applied', 'applied'],
    ['closed', 'closed'],
  ])

  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.placeholder = 'Search prose…'
  searchInput.style.cssText = [
    'grid-column: 1 / span 3',
    'padding: 4px 6px',
    'border-radius: 4px',
    'border: 1px solid var(--hud-border-strong)',
    'background: var(--hud-input-bg)',
    'color: var(--hud-fg)',
    'font: inherit',
    'font-size: 11px',
  ].join('; ')

  filterRow.append(kindFilter, authorFilter, statusFilter, searchInput)

  // Notes list
  const listEl = document.createElement('div')
  listEl.style.cssText = [
    'display: flex',
    'flex-direction: column',
    'gap: 4px',
    'max-height: 320px',
    'overflow-y: auto',
    'padding: 2px',
  ].join('; ')

  // Empty / loading state
  const emptyEl = document.createElement('div')
  emptyEl.style.cssText = [
    'padding: 16px 8px',
    'text-align: center',
    'color: var(--hud-fg-subtle)',
    'font-size: 12px',
  ].join('; ')

  // Bulk action bar — visible only when >=1 row checkbox is active.
  const bulkBar = document.createElement('div')
  bulkBar.style.cssText = [
    'display: none',
    'align-items: center',
    'gap: 8px',
    'padding: 6px 8px',
    'background: var(--hud-accent-bg)',
    'color: var(--hud-accent-fg)',
    'border-radius: 6px',
    'font-size: 12px',
  ].join('; ')
  const bulkCount = document.createElement('span')
  bulkCount.style.cssText = 'flex: 1;'
  const bulkDeleteBtn = document.createElement('button')
  bulkDeleteBtn.type = 'button'
  bulkDeleteBtn.textContent = 'Delete'
  bulkDeleteBtn.style.cssText = btnStyle('ghost') + '; padding: 4px 10px; font-size: 11px;'
  const bulkWontfixBtn = document.createElement('button')
  bulkWontfixBtn.type = 'button'
  bulkWontfixBtn.textContent = 'Mark wontfix'
  bulkWontfixBtn.style.cssText = btnStyle('ghost') + '; padding: 4px 10px; font-size: 11px;'
  const bulkClearBtn = document.createElement('button')
  bulkClearBtn.type = 'button'
  bulkClearBtn.textContent = '✕'
  bulkClearBtn.title = 'Clear selection'
  bulkClearBtn.style.cssText = [
    'background: transparent',
    'border: 0',
    'color: inherit',
    'cursor: pointer',
    'font-size: 14px',
    'line-height: 1',
    'padding: 0 4px',
  ].join('; ')
  bulkBar.append(bulkCount, bulkWontfixBtn, bulkDeleteBtn, bulkClearBtn)

  el.append(headerRow, filterRow, bulkBar, listEl, emptyEl)

  // ── State ──────────────────────────────────────────────────────
  let sessions: SessionSummary[] = []
  let currentSessionId: string | null = null
  let notes: NoteSummary[] = []
  let expandedNoteId: string | null = null
  let loaded = false
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  const filters: BrowseFilters = { kind: 'all', author: 'all', status: 'all', text: '' }
  const selectedIds = new Set<string>()
  // Cache of full note JSON (frontmatter + prose + body) keyed by id.
  // Populated on expand so the diff viewer / re-solve / screenshot
  // preview can render without re-fetching the same note. Cleared on
  // refresh or session change.
  const noteCache = new Map<
    string,
    {
      frontmatter: {
        kind: string
        author: string
        intent?: string
        screenshot?: string | null
        proposedDiff?: {
          summary: string
          confidence: string
          files: Array<{ path: string; patch: string }>
        }
        replyTo?: string
      }
      prose: string
    }
  >()
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  function matchesFilters(n: NoteSummary): boolean {
    if (filters.kind !== 'all' && n.kind !== filters.kind) return false
    if (filters.author !== 'all' && n.author !== filters.author) return false
    if (filters.status !== 'all' && statusBucket(n.status) !== filters.status) return false
    if (filters.text && !n.preview.toLowerCase().includes(filters.text.toLowerCase())) return false
    return true
  }

  // ── Fetch helpers ──────────────────────────────────────────────
  async function fetchSessions(): Promise<void> {
    try {
      const res = await fetch(`${origin}/_llui/sessions`)
      if (!res.ok) throw new Error(`GET /_llui/sessions → ${res.status}`)
      const payload = (await res.json()) as { sessions: SessionSummary[] }
      sessions = payload.sessions ?? []
      if (sessions.length === 0) {
        currentSessionId = null
      } else if (!currentSessionId || !sessions.find((s) => s.id === currentSessionId)) {
        // Pick the most recently-started session by default. The
        // backend returns them in start order; take the last one.
        currentSessionId = sessions[sessions.length - 1]!.id
      }
      renderSessionSelect()
    } catch (err) {
      reportError(`failed to load sessions: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function fetchNotes(): Promise<void> {
    if (!currentSessionId) {
      notes = []
      renderNotes()
      return
    }
    try {
      const res = await fetch(
        `${origin}/_llui/notes?sessionId=${encodeURIComponent(currentSessionId)}`,
      )
      if (!res.ok) throw new Error(`GET /_llui/notes → ${res.status}`)
      const payload = (await res.json()) as { notes: NoteSummary[] }
      notes = (payload.notes ?? []).slice().sort((a, b) => (a.ts < b.ts ? 1 : -1))
      renderNotes()
    } catch (err) {
      reportError(`failed to load notes: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function fetchStatusHistory(noteId: string): Promise<StatusTransition[]> {
    if (!currentSessionId) return []
    try {
      const res = await fetch(
        `${origin}/_llui/notes/${noteId}/status?sessionId=${encodeURIComponent(currentSessionId)}`,
      )
      if (!res.ok) return []
      const payload = (await res.json()) as { history?: StatusTransition[] }
      return payload.history ?? []
    } catch {
      return []
    }
  }

  async function fetchNoteJson(noteId: string): Promise<{
    frontmatter: {
      kind: string
      author: string
      intent?: string
      screenshot?: string | null
      proposedDiff?: {
        summary: string
        confidence: string
        files: Array<{ path: string; patch: string }>
      }
      replyTo?: string
    }
    prose: string
  } | null> {
    if (!currentSessionId) return null
    const cached = noteCache.get(noteId)
    if (cached) return cached
    try {
      const res = await fetch(
        `${origin}/_llui/notes/${noteId}?sessionId=${encodeURIComponent(currentSessionId)}&format=json`,
      )
      if (!res.ok) return null
      const payload = (await res.json()) as {
        frontmatter: { kind: string; author: string }
        prose: string
      }
      noteCache.set(noteId, payload)
      return payload
    } catch {
      return null
    }
  }

  async function patchNoteProse(noteId: string, prose: string): Promise<boolean> {
    if (!currentSessionId) return false
    try {
      const res = await fetch(
        `${origin}/_llui/notes/${noteId}?sessionId=${encodeURIComponent(currentSessionId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prose }),
        },
      )
      if (!res.ok) {
        reportError(`save failed (${res.status})`)
        return false
      }
      return true
    } catch (err) {
      reportError(`save failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  async function deleteNote(noteId: string): Promise<boolean> {
    if (!currentSessionId) return false
    try {
      const res = await fetch(
        `${origin}/_llui/notes/${noteId}?sessionId=${encodeURIComponent(currentSessionId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        reportError(`delete failed (${res.status})`)
        return false
      }
      return true
    } catch (err) {
      reportError(`delete failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  function renderSessionSelect(): void {
    sessionSelect.innerHTML = ''
    if (sessions.length === 0) {
      const opt = document.createElement('option')
      opt.textContent = '(no sessions)'
      opt.disabled = true
      sessionSelect.appendChild(opt)
      sessionSelect.disabled = true
      return
    }
    sessionSelect.disabled = false
    for (const s of sessions) {
      const opt = document.createElement('option')
      opt.value = s.id
      opt.textContent = `${s.id} (${s.noteCount})`
      if (s.id === currentSessionId) opt.selected = true
      sessionSelect.appendChild(opt)
    }
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
      case 'text':
      default:
        return '📝'
    }
  }

  function renderNotes(): void {
    listEl.innerHTML = ''
    const visible = notes.filter(matchesFilters)
    if (visible.length === 0) {
      if (notes.length === 0) {
        emptyEl.textContent = currentSessionId
          ? 'no notes in this session yet'
          : 'no sessions yet — drop a note from the compose view'
      } else {
        emptyEl.textContent = `no notes match the current filters (${notes.length} hidden)`
      }
      emptyEl.style.display = 'block'
    } else {
      emptyEl.style.display = 'none'
      for (const note of visible) {
        listEl.appendChild(renderNoteRow(note))
      }
    }
    renderBulkBar()
  }

  function renderBulkBar(): void {
    const n = selectedIds.size
    if (n === 0) {
      bulkBar.style.display = 'none'
      return
    }
    bulkBar.style.display = 'flex'
    bulkCount.textContent = `${n} selected`
  }

  function renderNoteRow(note: NoteSummary): HTMLElement {
    const row = document.createElement('div')
    row.setAttribute('data-llui-note-id', note.id)
    row.style.cssText = [
      'border: 1px solid var(--hud-border)',
      'border-radius: 6px',
      'background: var(--hud-surface)',
      'padding: 6px 8px',
      'font-size: 12px',
      'cursor: pointer',
    ].join('; ')

    const isExpanded = note.id === expandedNoteId

    // ── Summary line ──
    const summary = document.createElement('div')
    summary.style.cssText = 'display: flex; align-items: center; gap: 6px;'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = selectedIds.has(note.id)
    checkbox.style.cssText = 'flex: 0 0 auto; margin: 0;'
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation()
    })
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedIds.add(note.id)
      else selectedIds.delete(note.id)
      renderBulkBar()
    })

    const glyph = document.createElement('span')
    glyph.textContent = kindGlyph(note.kind)
    glyph.style.cssText = 'flex: 0 0 auto;'

    const idBadge = document.createElement('span')
    idBadge.textContent = note.id
    idBadge.style.cssText = [
      'font-family: ui-monospace, SFMono-Regular, monospace',
      'font-size: 10px',
      'color: var(--hud-fg-subtle)',
      'flex: 0 0 auto',
    ].join('; ')

    const previewEl = document.createElement('span')
    previewEl.textContent = note.preview || '(no prose)'
    previewEl.style.cssText = [
      'flex: 1 1 auto',
      'overflow: hidden',
      'text-overflow: ellipsis',
      'white-space: nowrap',
      'color: var(--hud-fg)',
    ].join('; ')

    const statusEl = document.createElement('span')
    statusEl.textContent = statusGlyph(note.status)
    statusEl.title = note.status ?? ''
    statusEl.style.cssText = 'flex: 0 0 auto;'

    summary.append(checkbox, glyph, idBadge, previewEl, statusEl)
    row.appendChild(summary)

    if (isExpanded) {
      const expansion = document.createElement('div')
      expansion.style.cssText = 'margin-top: 8px; display: flex; flex-direction: column; gap: 6px;'
      expansion.appendChild(renderExpansionPlaceholder())
      row.appendChild(expansion)
      // Async fill — fetch the full prose + status history once expanded.
      void hydrateExpansion(note, expansion)
    }

    // Click anywhere on the row toggles expansion — but ignore clicks
    // bubbling up from the expansion area (the textarea + buttons).
    row.addEventListener('click', (e) => {
      if (e.target !== summary && (e.target as HTMLElement).closest('[data-llui-expansion]')) {
        return
      }
      expandedNoteId = isExpanded ? null : note.id
      renderNotes()
    })

    return row
  }

  function renderExpansionPlaceholder(): HTMLElement {
    const ph = document.createElement('div')
    ph.setAttribute('data-llui-expansion', '')
    ph.textContent = 'loading…'
    ph.style.cssText = 'color: var(--hud-fg-subtle); font-size: 11px;'
    return ph
  }

  async function hydrateExpansion(note: NoteSummary, expansion: HTMLElement): Promise<void> {
    const [full, history] = await Promise.all([fetchNoteJson(note.id), fetchStatusHistory(note.id)])
    const prose = full?.prose ?? ''
    const frontmatter = full?.frontmatter ?? { kind: note.kind, author: note.author }
    expansion.innerHTML = ''
    expansion.setAttribute('data-llui-expansion', '')

    // Screenshot preview (when the note carries one) — fetched lazily
    // by the browser via the existing /_llui/notes/:id/screenshot
    // endpoint. Click toggles a full-size lightbox.
    if (frontmatter.screenshot && currentSessionId) {
      const wrap = document.createElement('div')
      wrap.style.cssText = 'display: flex; justify-content: center;'
      const img = document.createElement('img')
      img.src = `${origin}/_llui/notes/${note.id}/screenshot?sessionId=${encodeURIComponent(currentSessionId)}`
      img.alt = 'screenshot'
      img.style.cssText = [
        'max-width: 100%',
        'max-height: 200px',
        'border: 1px solid var(--hud-border)',
        'border-radius: 4px',
        'cursor: zoom-in',
        'background: var(--hud-surface)',
      ].join('; ')
      img.addEventListener('click', (e) => {
        e.stopPropagation()
        openLightbox(img.src)
      })
      wrap.appendChild(img)
      expansion.appendChild(wrap)
    }

    // Prose viewer (with inline edit toggle).
    const proseBox = document.createElement('div')
    proseBox.style.cssText = [
      'padding: 8px',
      'background: var(--hud-bg)',
      'border: 1px solid var(--hud-border)',
      'border-radius: 4px',
      'white-space: pre-wrap',
      'font-size: 12px',
      'color: var(--hud-fg)',
      'max-height: 160px',
      'overflow-y: auto',
    ].join('; ')
    proseBox.textContent = prose || '(no prose)'
    expansion.appendChild(proseBox)

    // Diff viewer — reply notes carry a `proposedDiff`. Render each
    // file as a colored unified diff (red removed / green added).
    // Inline Accept / Reject buttons drive the status transition for
    // the ORIGINAL task note (replyTo).
    if (frontmatter.proposedDiff && frontmatter.replyTo) {
      expansion.appendChild(renderProposedDiff(frontmatter.replyTo, frontmatter.proposedDiff))
    }

    // Status timeline.
    const timeline = document.createElement('div')
    timeline.style.cssText = 'font-size: 11px; color: var(--hud-fg-muted);'
    if (history.length > 0) {
      const list = document.createElement('div')
      list.style.cssText = 'display: flex; flex-direction: column; gap: 2px;'
      for (const t of history) {
        const row = document.createElement('div')
        const when = t.ts ? new Date(t.ts).toLocaleTimeString() : ''
        row.textContent = `${when}  ${t.from ?? '·'} → ${t.to}${t.reason ? ` (${t.reason.slice(0, 60)})` : ''}`
        row.style.cssText = 'font-family: ui-monospace, SFMono-Regular, monospace; font-size: 10px;'
        list.appendChild(row)
      }
      timeline.appendChild(list)
    } else {
      timeline.textContent = 'no status transitions'
    }
    expansion.appendChild(timeline)

    // Action row: Re-solve (task notes only) · Edit · Delete.
    const actions = document.createElement('div')
    actions.style.cssText = 'display: flex; gap: 6px; justify-content: flex-end;'
    if (frontmatter.intent === 'task') {
      const resolveBtn = document.createElement('button')
      resolveBtn.type = 'button'
      resolveBtn.textContent = '↻ Re-solve'
      resolveBtn.title =
        'Submit a fresh task with this prose, chained off the previous conversation'
      resolveBtn.style.cssText = btnStyle('secondary') + '; padding: 4px 10px; font-size: 11px;'
      resolveBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        void reSolveFrom(note, prose)
      })
      actions.appendChild(resolveBtn)
    }
    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.textContent = 'Edit'
    editBtn.style.cssText = btnStyle('secondary') + '; padding: 4px 10px; font-size: 11px;'
    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.textContent = 'Delete'
    deleteBtn.style.cssText = btnStyle('ghost') + '; padding: 4px 10px; font-size: 11px;'
    actions.append(editBtn, deleteBtn)

    expansion.appendChild(actions)

    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      enterEditMode(note, expansion, prose)
    })
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`Delete note ${note.id}? This cannot be undone.`)) return
      const ok = await deleteNote(note.id)
      if (ok) {
        expandedNoteId = null
        await fetchNotes()
      }
    })
  }

  /**
   * Render a proposed-diff block: per-file colored unified diffs with
   * inline Accept / Reject buttons that POST a status transition for
   * the original task note (`taskId` == the reply's replyTo).
   */
  function renderProposedDiff(
    taskId: string,
    proposed: {
      summary: string
      confidence: string
      files: Array<{ path: string; patch: string }>
    },
  ): HTMLElement {
    const wrap = document.createElement('div')
    wrap.style.cssText = [
      'border: 1px solid var(--hud-border)',
      'border-radius: 4px',
      'overflow: hidden',
    ].join('; ')

    const head = document.createElement('div')
    head.style.cssText = [
      'padding: 6px 8px',
      'font-size: 11px',
      'background: var(--hud-surface)',
      'color: var(--hud-fg-muted)',
      'display: flex',
      'align-items: center',
      'gap: 6px',
    ].join('; ')
    const headTitle = document.createElement('span')
    headTitle.textContent = `Proposed (${proposed.confidence}) — ${proposed.summary}`
    headTitle.style.cssText = 'flex: 1; color: var(--hud-fg);'
    const acceptBtn = document.createElement('button')
    acceptBtn.type = 'button'
    acceptBtn.textContent = 'Accept'
    acceptBtn.style.cssText = btnStyle('primary') + '; padding: 3px 8px; font-size: 10px;'
    const rejectBtn = document.createElement('button')
    rejectBtn.type = 'button'
    rejectBtn.textContent = 'Reject'
    rejectBtn.style.cssText = btnStyle('ghost') + '; padding: 3px 8px; font-size: 10px;'
    head.append(headTitle, acceptBtn, rejectBtn)
    wrap.appendChild(head)

    for (const file of proposed.files) {
      const fileWrap = document.createElement('div')
      fileWrap.style.cssText = 'border-top: 1px solid var(--hud-border);'
      const filePath = document.createElement('div')
      filePath.textContent = file.path
      filePath.style.cssText = [
        'padding: 4px 8px',
        'font-family: ui-monospace, SFMono-Regular, monospace',
        'font-size: 10px',
        'background: var(--hud-surface)',
        'color: var(--hud-fg-muted)',
      ].join('; ')
      fileWrap.appendChild(filePath)
      const pre = document.createElement('pre')
      pre.style.cssText = [
        'margin: 0',
        'padding: 6px 8px',
        'font-family: ui-monospace, SFMono-Regular, monospace',
        'font-size: 10px',
        'line-height: 1.4',
        'overflow-x: auto',
        'max-height: 220px',
        'overflow-y: auto',
        'background: var(--hud-bg)',
      ].join('; ')
      for (const line of file.patch.split('\n')) {
        const lineEl = document.createElement('div')
        lineEl.textContent = line
        if (line.startsWith('+') && !line.startsWith('+++')) {
          lineEl.style.cssText = 'background: rgba(22, 163, 74, 0.10); color: #15803d;'
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineEl.style.cssText = 'background: rgba(239, 68, 68, 0.10); color: #b91c1c;'
        } else if (line.startsWith('@@')) {
          lineEl.style.cssText = 'color: var(--hud-fg-subtle);'
        }
        pre.appendChild(lineEl)
      }
      fileWrap.appendChild(pre)
      wrap.appendChild(fileWrap)
    }

    const post = async (to: 'accepted' | 'rejected'): Promise<void> => {
      if (!currentSessionId) return
      try {
        const res = await fetch(
          `${origin}/_llui/notes/${taskId}/status?sessionId=${encodeURIComponent(currentSessionId)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to, by: 'human' }),
          },
        )
        if (!res.ok) reportError(`${to} failed (${res.status})`)
      } catch (err) {
        reportError(`${to} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    acceptBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      void post('accepted')
    })
    rejectBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      void post('rejected')
    })

    return wrap
  }

  /**
   * Full-size screenshot overlay. Click anywhere or press Esc to dismiss.
   */
  function openLightbox(src: string): void {
    const overlay = document.createElement('div')
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'background: rgba(0, 0, 0, 0.8)',
      'z-index: 2147483647',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'cursor: zoom-out',
      'padding: 32px',
    ].join('; ')
    const big = document.createElement('img')
    big.src = src
    big.style.cssText =
      'max-width: 100%; max-height: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.6);'
    overlay.appendChild(big)
    document.body.appendChild(overlay)
    const dismiss = (): void => {
      overlay.remove()
      document.removeEventListener('keydown', onKey)
    }
    overlay.addEventListener('click', dismiss)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', onKey)
  }

  /**
   * Submit a fresh task that re-uses the prose of an existing task
   * note. Resume defaults to true so the new spawn picks up the
   * conversation where the previous one left off.
   */
  async function reSolveFrom(_note: NoteSummary, prose: string): Promise<void> {
    if (!prose.trim()) {
      reportError('cannot re-solve a task with empty prose')
      return
    }
    try {
      // Minimal frontmatter — the server backfills id + ts and the
      // router only reads intent/resume/url/route etc. We don't have
      // the full original frontmatter here (the JSON endpoint returns
      // it but we don't need ALL fields for a re-solve).
      const body = {
        body: prose,
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
      void doRefresh()
    } catch (err) {
      reportError(`re-solve failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function enterEditMode(note: NoteSummary, expansion: HTMLElement, currentProse: string): void {
    expansion.innerHTML = ''
    expansion.setAttribute('data-llui-expansion', '')

    const textarea = document.createElement('textarea')
    textarea.value = currentProse
    textarea.rows = 5
    textarea.style.cssText = STYLES.textarea + '; font-size: 12px;'

    const actions = document.createElement('div')
    actions.style.cssText = 'display: flex; gap: 6px; justify-content: flex-end;'
    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.textContent = 'Save'
    saveBtn.style.cssText = btnStyle('primary') + '; padding: 4px 10px; font-size: 11px;'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = btnStyle('ghost') + '; padding: 4px 10px; font-size: 11px;'
    actions.append(cancelBtn, saveBtn)

    expansion.append(textarea, actions)
    textarea.focus()

    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const ok = await patchNoteProse(note.id, textarea.value)
      if (ok) {
        await fetchNotes()
        // hydrateExpansion will run again on the re-render since the
        // note stays expanded.
      }
    })
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      // Re-render to drop back into view mode.
      renderNotes()
    })
  }

  // ── Wire ───────────────────────────────────────────────────────
  sessionSelect.addEventListener('change', () => {
    currentSessionId = sessionSelect.value
    expandedNoteId = null
    selectedIds.clear()
    noteCache.clear()
    void fetchNotes()
  })
  refreshBtn.addEventListener('click', () => {
    void doRefresh()
  })

  // Filter wiring — every change re-renders from the in-memory list,
  // no server round-trip.
  kindFilter.addEventListener('change', () => {
    filters.kind = kindFilter.value as BrowseFilters['kind']
    renderNotes()
  })
  authorFilter.addEventListener('change', () => {
    filters.author = authorFilter.value as BrowseFilters['author']
    renderNotes()
  })
  statusFilter.addEventListener('change', () => {
    filters.status = statusFilter.value as BrowseFilters['status']
    renderNotes()
  })
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      filters.text = searchInput.value
      renderNotes()
    }, 120)
  })

  // Bulk actions.
  bulkClearBtn.addEventListener('click', () => {
    selectedIds.clear()
    renderNotes()
  })
  bulkDeleteBtn.addEventListener('click', async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} note(s)? This cannot be undone.`)) return
    const results = await Promise.all(ids.map((id) => deleteNote(id)))
    selectedIds.clear()
    if (results.some((ok) => !ok)) reportError('one or more deletes failed')
    await fetchNotes()
  })
  bulkWontfixBtn.addEventListener('click', async () => {
    const ids = [...selectedIds]
    if (ids.length === 0 || !currentSessionId) return
    if (!confirm(`Mark ${ids.length} task(s) as wontfix?`)) return
    const sid = currentSessionId
    await Promise.all(
      ids.map((id) =>
        fetch(`${origin}/_llui/notes/${id}/status?sessionId=${encodeURIComponent(sid)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: 'wontfix', by: 'human' }),
        }).catch(() => null),
      ),
    )
    selectedIds.clear()
    await fetchNotes()
  })

  function doRefresh(): Promise<void> {
    return fetchSessions().then(fetchNotes)
  }

  function refresh(): void {
    // Debounce — SSE events can arrive in bursts during a solve.
    if (refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void doRefresh()
    }, 100)
  }

  function onShow(): void {
    if (!loaded) {
      loaded = true
      void doRefresh()
    }
  }

  return { el, refresh, onShow }
}
