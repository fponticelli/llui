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
  refreshBtn.title = 'Refresh'
  refreshBtn.style.cssText = STYLES.toolbarBtn + '; padding: 4px 8px;'

  headerRow.append(sessionSelect, refreshBtn)

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

  el.append(headerRow, listEl, emptyEl)

  // ── State ──────────────────────────────────────────────────────
  let sessions: SessionSummary[] = []
  let currentSessionId: string | null = null
  let notes: NoteSummary[] = []
  let expandedNoteId: string | null = null
  let loaded = false
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

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

  async function fetchNoteProse(noteId: string): Promise<string> {
    if (!currentSessionId) return ''
    try {
      const res = await fetch(
        `${origin}/_llui/notes/${noteId}?sessionId=${encodeURIComponent(currentSessionId)}`,
      )
      if (!res.ok) return ''
      const md = await res.text()
      // Strip the frontmatter block to extract the prose body. The
      // serialized format is `---\n<yaml>\n---\n<body>` with an
      // optional `<!-- body-json: ... -->` comment we also strip.
      const body = md
        .replace(/^---[\s\S]*?\n---\n?/, '')
        .replace(/<!-- body-json:[\s\S]*?-->\s*/g, '')
      return body.trim()
    } catch {
      return ''
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
    if (notes.length === 0) {
      emptyEl.textContent = currentSessionId
        ? 'no notes in this session yet'
        : 'no sessions yet — drop a note from the compose view'
      emptyEl.style.display = 'block'
      return
    }
    emptyEl.style.display = 'none'
    for (const note of notes) {
      listEl.appendChild(renderNoteRow(note))
    }
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

    summary.append(glyph, idBadge, previewEl, statusEl)
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
    const [prose, history] = await Promise.all([
      fetchNoteProse(note.id),
      fetchStatusHistory(note.id),
    ])
    expansion.innerHTML = ''
    expansion.setAttribute('data-llui-expansion', '')

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

    // Action row: Edit / Delete.
    const actions = document.createElement('div')
    actions.style.cssText = 'display: flex; gap: 6px; justify-content: flex-end;'
    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.textContent = 'Edit'
    editBtn.style.cssText = btnStyle('secondary') + '; padding: 4px 10px; font-size: 11px;'
    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.textContent = 'Delete'
    deleteBtn.style.cssText = btnStyle('ghost') + '; padding: 4px 10px; font-size: 11px;'
    actions.append(editBtn, deleteBtn)

    expansion.append(proseBox, timeline, actions)

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
    void fetchNotes()
  })
  refreshBtn.addEventListener('click', () => {
    void doRefresh()
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
