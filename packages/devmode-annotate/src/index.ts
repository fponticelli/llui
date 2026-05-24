// @llui/devmode-annotate — the in-app HUD for the devmode-annotate
// proposal (docs/proposals/devmode-annotate/). v1 ships text-only notes;
// v2 (this revision) adds a rect-drawing mode that bakes the
// annotation into a screenshot before POST. Pin / lasso / arrow /
// element-pick land in subsequent revisions.
//
// Tree-shaken in prod via `import.meta.env.DEV`.

import type {
  Annotation,
  CaptureLevel,
  CaptureRequestPayload,
  CreateNoteRequest,
  CreateNoteResponse,
  NoteFrontmatter,
  NoteIntent,
  NoteKind,
  NoteRect,
} from '@llui/vite-plugin'

import { bakeAnnotations } from './bake.js'
import { collectComponentInfo, collectDebugSnapshot, collectSourceMap } from './debug-collector.js'
import { drawRect } from './overlay.js'
import { captureScreenshot, type CaptureFn } from './screenshot.js'
import { btnStyle, modeButtonStyle, STYLES } from './styles.js'

export type BakeFn = (screenshotBase64: string, annotations: Annotation[]) => Promise<string>

export interface MountAnnotateOptions {
  /** Base origin for the dev-server API. Defaults to current location. */
  origin?: string
  /** Override the LLui versions reported in frontmatter. Auto-detected
   *  from `window.__llui` when present; otherwise the strings 'unknown'
   *  are used. */
  llui?: { runtime: string; compiler: string }
  /** Suppress the on-page HUD; useful in tests. */
  hidden?: boolean
  /** Inject a custom capture function — used by tests to substitute
   *  the html-to-image pipeline. */
  capture?: CaptureFn
  /** Inject a custom bake function — used by tests to skip the
   *  Image/canvas pipeline. Receives the captured screenshot (base64
   *  with `data:` prefix or raw) + annotations, returns the baked
   *  screenshot as `data:image/png;base64,…` (or any string the
   *  middleware can store as base64). */
  bake?: BakeFn
  /** Disable the SSE subscription to /_llui/events. Tests that don't
   *  want a real EventSource pass `false`; production callers should
   *  leave it `true` (default) so LLM-initiated captures land. */
  subscribeEvents?: boolean
}

export type HudMode = 'text' | 'rect'

export interface AnnotateHudHandle {
  open(): void
  close(): void
  destroy(): void
  /** Programmatic submission. Resolves with the created note's metadata
   *  or rejects on HTTP failure. */
  submit(
    prose: string,
    opts?: {
      captureLevel?: CaptureLevel
      annotations?: Annotation[]
      screenshot?: string
      /** Defaults to 'task' for human submissions; pass 'note' for FYI. */
      intent?: NoteIntent
    },
  ): Promise<CreateNoteResponse>
  /** Programmatically trigger the rect-drawing overlay. Resolves when
   *  the user completes or cancels. */
  drawRect(): Promise<NoteRect | null>
  /** Handle a single LLM-initiated capture-request — same code path
   *  as the SSE handler. Exposed for tests and for callers driving the
   *  bridge manually. */
  handleCaptureRequest(
    requestId: string,
    payload: CaptureRequestPayload,
  ): Promise<CreateNoteResponse>
  /** Set the default intent for floating-button submits. Default 'task'.
   *  Per-call submit() options override this. */
  setIntent(intent: NoteIntent): void
}

interface LluiDevSurfaceLike {
  runtime?: string
  compiler?: string
}

declare global {
  interface Window {
    __llui?: LluiDevSurfaceLike
  }
  interface ImportMeta {
    env?: { DEV?: boolean; MODE?: string }
  }
}

const HUD_ELEMENT_ID = 'llui-devmode-annotate-root'

// Persisted floating-button position. We store as { x, y } in viewport
// pixels; on read, we clamp to the current viewport so a previously-
// saved off-screen position never strands the button.
const POSITION_STORAGE_KEY = 'llui-devmode-annotate.position'
const DRAG_THRESHOLD_PX = 4
const BUTTON_SIZE_PX = 44
const BUTTON_MARGIN_PX = 16

interface SavedPosition {
  x: number
  y: number
}

function readSavedPosition(): SavedPosition | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown }
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null
    return { x: parsed.x, y: parsed.y }
  } catch {
    return null
  }
}

function writeSavedPosition(pos: SavedPosition): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos))
  } catch {
    // localStorage can be unavailable (private mode, quota); fail
    // silently — the button still works for this session.
  }
}

function clampToViewport(pos: SavedPosition): SavedPosition {
  const maxX = Math.max(0, window.innerWidth - BUTTON_SIZE_PX - BUTTON_MARGIN_PX)
  const maxY = Math.max(0, window.innerHeight - BUTTON_SIZE_PX - BUTTON_MARGIN_PX)
  return {
    x: Math.min(Math.max(BUTTON_MARGIN_PX, pos.x), maxX),
    y: Math.min(Math.max(BUTTON_MARGIN_PX, pos.y), maxY),
  }
}

// Floating-button icon: a lasso/rope loop enclosing the "Lui"
// letterform. Combines the annotation-tool semantic (lasso = select +
// annotate) with the LLui brand mark. Drawn as inline SVG so the
// gradient button background shows through the stroke gaps.
//
// Sized to fill ~85% of the 44px button (38px content, ~3px margin
// each side). The loop hugs the viewBox edges; the "Lui" text scales
// up correspondingly.
const BUTTON_ICON_SVG = `
<svg width="38" height="38" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Lasso loop: irregular open ellipse hugging the viewBox edges -->
  <path d="M 3 11 C 1 14.5, 1.5 21, 6 25 C 11 29, 22 29, 27 25 C 31 21.5, 30.5 13, 26 9 C 21 5, 9 5, 5 8.5"
        stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <!-- Lasso tail curling down-left -->
  <path d="M 5 8.5 Q 2 5, 0.5 8 Q -0.5 11, 2 12.5"
        stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <!-- "Lui" letterform inside the loop -->
  <text x="16" y="21" text-anchor="middle"
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
        font-size="13" font-weight="800" letter-spacing="-0.4"
        fill="white">Lui</text>
</svg>`

/**
 * Extract a viewport bbox from any annotation that carries one (rect,
 * element). Returns null for annotations without spatial extent
 * (pin → point, lasso → polygon, arrow → segment, highlight → semantic).
 */
function bboxOf(ann: Annotation): { x: number; y: number; w: number; h: number } | null {
  if (ann.type === 'rect') return { x: ann.x, y: ann.y, w: ann.w, h: ann.h }
  if (ann.type === 'element') return ann.bbox
  return null
}

/**
 * Assemble a NoteBody: rich telemetry from collectDebugSnapshot() plus,
 * when annotations have bboxes, a sourceMap from collectSourceMap().
 */
function buildNoteBody(annotations: Annotation[]): import('@llui/vite-plugin').NoteBody {
  const body = collectDebugSnapshot()
  const sourceMap: Array<import('@llui/vite-plugin').SourceMapEntry> = []
  for (const ann of annotations) {
    const bb = bboxOf(ann)
    if (!bb) continue
    sourceMap.push(...collectSourceMap(bb))
  }
  if (sourceMap.length > 0) {
    body.sourceMap = sourceMap
  }
  return body
}

export function mountAnnotateHud(opts: MountAnnotateOptions = {}): AnnotateHudHandle {
  if (!import.meta.env?.DEV) return noopHandle()
  if (typeof document === 'undefined') return noopHandle()

  const existing = document.getElementById(HUD_ELEMENT_ID) as
    | (HTMLElement & { _lluiHandle?: AnnotateHudHandle })
    | null
  if (existing?._lluiHandle) return existing._lluiHandle

  const origin = opts.origin ?? (typeof location !== 'undefined' ? location.origin : '')
  const llui = opts.llui ?? {
    runtime: (typeof window !== 'undefined' && window.__llui?.runtime) || 'unknown',
    compiler: (typeof window !== 'undefined' && window.__llui?.compiler) || 'unknown',
  }

  // ── State ──────────────────────────────────────────────────────────
  let mode: HudMode = 'text'
  let pendingRect: NoteRect | null = null

  // ── DOM ────────────────────────────────────────────────────────────
  const root = document.createElement('div')
  root.id = HUD_ELEMENT_ID
  root.style.cssText = STYLES.root

  const floatingBtn = document.createElement('button')
  floatingBtn.type = 'button'
  floatingBtn.innerHTML = BUTTON_ICON_SVG
  floatingBtn.title = 'LLui annotate (Cmd+Shift+A) — drag to move'
  floatingBtn.setAttribute('aria-label', 'Open LLui annotation HUD')
  floatingBtn.style.cssText = STYLES.button

  // Restore saved position if present. Default position from CSS
  // (bottom-right) is used otherwise.
  const saved = typeof localStorage !== 'undefined' ? readSavedPosition() : null
  if (saved && typeof window !== 'undefined') {
    const pos = clampToViewport(saved)
    root.style.left = `${pos.x}px`
    root.style.top = `${pos.y}px`
    root.style.right = 'auto'
    root.style.bottom = 'auto'
  }

  const modal = document.createElement('div')
  modal.style.cssText = STYLES.modal

  const heading = document.createElement('div')
  heading.textContent = 'New note'
  heading.style.cssText = STYLES.heading

  const modeRow = document.createElement('div')
  modeRow.style.cssText = STYLES.modeRow

  const modeText = document.createElement('button')
  modeText.type = 'button'
  modeText.textContent = 'Text'
  modeText.dataset['mode'] = 'text'

  const modeRect = document.createElement('button')
  modeRect.type = 'button'
  modeRect.textContent = 'Draw rect'
  modeRect.dataset['mode'] = 'rect'

  modeRow.append(modeText, modeRect)

  const rectPreview = document.createElement('div')
  rectPreview.style.cssText = STYLES.rectPreviewWrap
  rectPreview.style.display = 'none'

  // Markdown toolbar above the textarea. Minimal — bold, italic,
  // code, bullets, numbered list. Wraps selection or inserts at the
  // caret. Cmd/Ctrl+B / +I / +E mirror the buttons for keyboard users.
  const toolbar = document.createElement('div')
  toolbar.style.cssText = STYLES.toolbar

  const mkToolBtn = (label: string, title: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.title = title
    b.style.cssText = STYLES.toolbarBtn
    return b
  }
  const boldBtn = mkToolBtn('B', 'Bold (Cmd/Ctrl+B)')
  boldBtn.style.fontWeight = '700'
  const italicBtn = mkToolBtn('I', 'Italic (Cmd/Ctrl+I)')
  italicBtn.style.fontStyle = 'italic'
  const codeBtn = mkToolBtn('</>', 'Inline code (Cmd/Ctrl+E)')
  codeBtn.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace'
  codeBtn.style.fontSize = '11px'
  const bulletBtn = mkToolBtn('•', 'Bullet list')
  const numBtn = mkToolBtn('1.', 'Numbered list')
  numBtn.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace'
  numBtn.style.fontSize = '11px'

  toolbar.append(boldBtn, italicBtn, codeBtn, bulletBtn, numBtn)

  const textarea = document.createElement('textarea')
  textarea.placeholder = "What's wrong, or what should change? (markdown OK)"
  textarea.rows = 5
  textarea.style.cssText = STYLES.textarea

  const statusLine = document.createElement('div')
  statusLine.style.cssText = STYLES.status

  const actions = document.createElement('div')
  actions.style.cssText = STYLES.actions

  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.textContent = 'Cancel'
  cancelBtn.style.cssText = btnStyle('ghost')

  // "Save" is for FYI notes that don't ask the LLM to act —
  // intent='note'. The LLM will see them on llui_list_notes but
  // won't try to act unless asked.
  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.textContent = 'Save note'
  saveBtn.title = 'Just save the note for reference (intent: note)'
  saveBtn.style.cssText = btnStyle('secondary')

  // "Solve" is the primary action: intent='task'. Hands the note to
  // the LLM as work to do. Combined with task-mode (P6), this is what
  // a connected worker picks up.
  const solveBtn = document.createElement('button')
  solveBtn.type = 'button'
  solveBtn.textContent = 'Solve'
  solveBtn.title = 'Have the LLM solve this immediately (intent: task)'
  solveBtn.style.cssText = btnStyle('primary')

  actions.append(cancelBtn, saveBtn, solveBtn)
  modal.append(heading, modeRow, rectPreview, toolbar, textarea, statusLine, actions)
  root.append(floatingBtn, modal)
  document.body.appendChild(root)

  if (opts.hidden) root.style.display = 'none'

  // ── Behavior ───────────────────────────────────────────────────────

  const setMode = (next: HudMode): void => {
    mode = next
    modeText.style.cssText = modeButtonStyle(mode === 'text')
    modeRect.style.cssText = modeButtonStyle(mode === 'rect')
    if (mode === 'text') {
      pendingRect = null
      rectPreview.style.display = 'none'
    } else if (pendingRect) {
      rectPreview.textContent = `Rect: ${pendingRect.w}×${pendingRect.h} at (${pendingRect.x}, ${pendingRect.y})`
      rectPreview.style.display = 'block'
    } else {
      rectPreview.textContent = 'Click "Draw" to mark a region.'
      rectPreview.style.display = 'block'
    }
  }
  setMode('text')

  // The modal is positioned relative to the floating button (root).
  // When the button is dragged near a viewport edge, the modal's
  // default anchor can leave it clipped. Re-anchor here so the modal
  // always lies fully inside the viewport when feasible.
  const reanchorModal = (): void => {
    const rootRect = root.getBoundingClientRect()
    const modalW = modal.offsetWidth || 360
    const modalH = modal.offsetHeight || 320
    const gap = 8

    // Horizontal: align modal's right edge to the button's right edge
    // by default (right: 0). If that pushes the left side off-screen,
    // flip to left-anchor instead.
    const rightAnchoredLeftPx = rootRect.right - modalW
    if (rightAnchoredLeftPx < gap) {
      // Button is too close to the left edge; anchor modal to the
      // button's left side.
      modal.style.left = '0'
      modal.style.right = 'auto'
    } else {
      modal.style.right = '0'
      modal.style.left = 'auto'
    }

    // Vertical: prefer above the button (bottom: 56px). If that
    // pushes the modal off the TOP of the viewport, place it below
    // the button instead.
    const aboveTopPx = rootRect.top - modalH - gap
    if (aboveTopPx < gap) {
      modal.style.top = '56px'
      modal.style.bottom = 'auto'
    } else {
      modal.style.bottom = '56px'
      modal.style.top = 'auto'
    }
  }

  const open = (): void => {
    modal.style.display = 'block'
    // Measurement requires the modal to be rendered, so re-anchor on
    // a microtask after the display flips.
    queueMicrotask(reanchorModal)
    textarea.focus()
    statusLine.textContent = ''
  }
  const close = (): void => {
    modal.style.display = 'none'
  }
  const destroy = (): void => {
    document.removeEventListener('keydown', onKey)
    eventSource?.close()
    if (activeOverlayDismiss) {
      activeOverlayDismiss()
      activeOverlayDismiss = null
    }
    root.remove()
  }

  // Tracks the dismiss callback of the currently-visible drawing
  // overlay. The overlay stays alive after mouseup so the user can see
  // the highlighted region while the modal asks for confirmation —
  // we dismiss it when they Send/Cancel/redraw.
  let activeOverlayDismiss: (() => void) | null = null

  const dismissActiveOverlay = (): void => {
    if (activeOverlayDismiss) {
      activeOverlayDismiss()
      activeOverlayDismiss = null
    }
  }

  const startRectFlow = async (): Promise<NoteRect | null> => {
    // If a previous overlay is still on-screen, tear it down before
    // starting a new draw.
    dismissActiveOverlay()
    // Hide modal during drawing so it doesn't block the overlay.
    const wasOpen = modal.style.display === 'block'
    close()
    const result = await drawRect()
    if (wasOpen) open()
    if (result.reason === 'submit' && result.rect) {
      pendingRect = result.rect
      activeOverlayDismiss = result.dismiss
      setMode('rect')
      return result.rect
    }
    // Cancel — keep current mode, clear preview. The overlay is
    // already dismissed when reason='cancel'.
    if (mode === 'rect') {
      pendingRect = null
      setMode('rect')
    }
    return null
  }

  const buildAnnotations = (): Annotation[] => {
    if (mode === 'rect' && pendingRect) {
      return [{ type: 'rect', ...pendingRect }]
    }
    return []
  }

  const buildKind = (): NoteKind => {
    if (mode === 'rect' && pendingRect) return 'rect'
    return 'text'
  }

  // Default intent — tracked separately from per-call overrides. The
  // floating button respects this; per-call `submitOpts.intent` wins.
  let defaultIntent: NoteIntent = 'task'

  const submit = async (
    prose: string,
    submitOpts: {
      captureLevel?: CaptureLevel
      annotations?: Annotation[]
      screenshot?: string
      intent?: NoteIntent
    } = {},
  ): Promise<CreateNoteResponse> => {
    const annotations = submitOpts.annotations ?? buildAnnotations()
    let screenshotBase64 = submitOpts.screenshot
    let kind: NoteKind = buildKind()

    // If the caller passes their own screenshot OR annotations, prefer
    // those over the HUD's current state.
    if (submitOpts.annotations && submitOpts.annotations.length > 0) {
      const first = submitOpts.annotations[0]!
      kind = first.type === 'rect' ? 'rect' : 'capture'
    }

    if (annotations.length > 0 && !screenshotBase64) {
      try {
        const raw = await captureScreenshot({
          ...(opts.capture ? { capture: opts.capture } : {}),
        })
        const bake = opts.bake ?? bakeAnnotations
        const bakedDataUrl = await bake(raw, annotations)
        screenshotBase64 = bakedDataUrl.startsWith('data:')
          ? bakedDataUrl.slice(bakedDataUrl.indexOf(',') + 1)
          : bakedDataUrl
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`devmode-annotate: screenshot failed — ${message}`, { cause: err })
      }
    }

    const compInfo = collectComponentInfo()
    const intent: NoteIntent = submitOpts.intent ?? defaultIntent
    const frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'> = {
      author: 'human',
      kind,
      captureLevel: submitOpts.captureLevel ?? 'standard',
      url: typeof location !== 'undefined' ? location.href : '',
      route: null,
      routeParams: {},
      viewport: {
        w: typeof window !== 'undefined' ? window.innerWidth : 0,
        h: typeof window !== 'undefined' ? window.innerHeight : 0,
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      },
      componentPath: compInfo?.componentPath ?? null,
      componentMeta: compInfo?.componentMeta ?? null,
      annotations,
      intent,
      screenshot: screenshotBase64 ? 'placeholder.png' : null,
      agentSchemas: [],
      llui,
    }
    const body: CreateNoteRequest = {
      body: prose,
      frontmatter,
      noteBody: buildNoteBody(annotations),
      ...(screenshotBase64 ? { screenshot: screenshotBase64 } : {}),
    }
    const url = `${origin}/_llui/notes`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`devmode-annotate: POST ${url} → ${res.status}`)
    }
    return (await res.json()) as CreateNoteResponse
  }

  // ── Wiring ─────────────────────────────────────────────────────────

  // Draggable floating button. Tracks mousedown→move; if the pointer
  // travels more than DRAG_THRESHOLD_PX, we treat it as a drag and
  // persist the final position. Otherwise the mouseup is a normal
  // click that opens/closes the modal.
  let dragState: {
    startX: number
    startY: number
    pointerStartX: number
    pointerStartY: number
    moved: boolean
  } | null = null

  const onBtnPointerDown = (e: PointerEvent): void => {
    const rect = root.getBoundingClientRect()
    dragState = {
      startX: rect.left,
      startY: rect.top,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      moved: false,
    }
    try {
      floatingBtn.setPointerCapture(e.pointerId)
    } catch {
      // jsdom and some test environments don't implement pointer
      // capture; safe to ignore.
    }
  }
  const onBtnPointerMove = (e: PointerEvent): void => {
    if (!dragState) return
    const dx = e.clientX - dragState.pointerStartX
    const dy = e.clientY - dragState.pointerStartY
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    if (!dragState.moved) {
      dragState.moved = true
      floatingBtn.style.cssText = STYLES.button + ';' + STYLES.buttonDragging
      // Switch root to absolute-position mode for the drag.
      root.style.right = 'auto'
      root.style.bottom = 'auto'
    }
    const nx = dragState.startX + dx
    const ny = dragState.startY + dy
    const clamped = clampToViewport({ x: nx, y: ny })
    root.style.left = `${clamped.x}px`
    root.style.top = `${clamped.y}px`
    // If the modal is currently open, re-anchor it live so it tracks
    // the button position and doesn't go off-screen mid-drag.
    if (modal.style.display === 'block') reanchorModal()
  }
  const onBtnPointerUp = (e: PointerEvent): void => {
    if (!dragState) return
    const wasDrag = dragState.moved
    try {
      floatingBtn.releasePointerCapture(e.pointerId)
    } catch {
      /* see above */
    }
    dragState = null
    floatingBtn.style.cssText = STYLES.button
    if (wasDrag) {
      const rect = root.getBoundingClientRect()
      writeSavedPosition({ x: rect.left, y: rect.top })
      // The modal anchor depends on where the button sits. Re-compute
      // whether to flip horizontal/vertical so it stays on-screen.
      reanchorModal()
      // Eat the subsequent click event so it doesn't toggle the modal.
      const eat = (ev: Event): void => {
        ev.stopPropagation()
        ev.preventDefault()
        floatingBtn.removeEventListener('click', eat, true)
      }
      floatingBtn.addEventListener('click', eat, true)
    }
  }
  floatingBtn.addEventListener('pointerdown', onBtnPointerDown)
  floatingBtn.addEventListener('pointermove', onBtnPointerMove)
  floatingBtn.addEventListener('pointerup', onBtnPointerUp)
  floatingBtn.addEventListener('pointercancel', () => {
    dragState = null
    floatingBtn.style.cssText = STYLES.button
  })

  // Click event opens/closes the modal. Fires naturally after a tap
  // when no drag occurred; a real drag swallows it via the capturing
  // listener installed in onBtnPointerUp above.
  floatingBtn.addEventListener('click', () => {
    if (modal.style.display === 'block') close()
    else open()
  })

  modeText.addEventListener('click', () => {
    dismissActiveOverlay()
    setMode('text')
  })
  modeRect.addEventListener('click', () => {
    setMode('rect')
    if (!pendingRect) {
      void startRectFlow()
    }
  })
  rectPreview.addEventListener('click', () => {
    if (mode === 'rect') void startRectFlow()
  })

  cancelBtn.addEventListener('click', () => {
    dismissActiveOverlay()
    pendingRect = null
    close()
  })

  const submitWithIntent = (intent: NoteIntent): void => {
    const prose = textarea.value.trim()
    if (prose === '' && buildAnnotations().length === 0) {
      statusLine.textContent = 'add text or draw a rect first'
      return
    }
    saveBtn.disabled = true
    solveBtn.disabled = true
    statusLine.textContent = mode === 'rect' ? 'capturing screenshot…' : 'sending…'
    submit(prose, { intent }).then(
      (result) => {
        textarea.value = ''
        pendingRect = null
        dismissActiveOverlay()
        setMode('text')
        if (intent === 'task') {
          // Track this submission so status-changed events update the
          // status line live. Keep the action buttons disabled until
          // a terminal state arrives (or the dev closes the modal).
          trackedTaskNoteId = result.id
          statusLine.textContent = '⏳ queued for the router…'
        } else {
          statusLine.textContent = `✓ note saved (${result.filename})`
          saveBtn.disabled = false
          solveBtn.disabled = false
        }
      },
      (err: Error) => {
        statusLine.textContent = err.message
        saveBtn.disabled = false
        solveBtn.disabled = false
      },
    )
  }
  saveBtn.addEventListener('click', () => submitWithIntent('note'))
  solveBtn.addEventListener('click', () => submitWithIntent('task'))

  // ── Markdown toolbar wiring ────────────────────────────────────────
  const wrapSelection = (before: string, after: string = before): void => {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = textarea.value.slice(start, end)
    const placeholder = selected || 'text'
    const replacement = `${before}${placeholder}${after}`
    textarea.value = textarea.value.slice(0, start) + replacement + textarea.value.slice(end)
    textarea.focus()
    // Position the selection over the inserted text (so it can be
    // typed-over) — or after `before` if there was no original
    // selection.
    const cursorStart = start + before.length
    const cursorEnd = cursorStart + placeholder.length
    textarea.setSelectionRange(cursorStart, cursorEnd)
  }
  const prefixSelectedLines = (prefix: string | ((i: number) => string)): void => {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = textarea.value.slice(0, start)
    // Expand selection to whole lines so the prefix applies at the
    // line head, not mid-word.
    const lineStart = before.lastIndexOf('\n') + 1
    const fullSelected = textarea.value.slice(lineStart, end) || 'item'
    const lines = fullSelected.split('\n')
    const prefixed = lines
      .map((line, i) => `${typeof prefix === 'function' ? prefix(i) : prefix}${line}`)
      .join('\n')
    textarea.value = textarea.value.slice(0, lineStart) + prefixed + textarea.value.slice(end)
    textarea.focus()
    textarea.setSelectionRange(lineStart, lineStart + prefixed.length)
  }
  boldBtn.addEventListener('click', () => wrapSelection('**'))
  italicBtn.addEventListener('click', () => wrapSelection('*'))
  codeBtn.addEventListener('click', () => wrapSelection('`'))
  bulletBtn.addEventListener('click', () => prefixSelectedLines('- '))
  numBtn.addEventListener('click', () => prefixSelectedLines((i) => `${i + 1}. `))

  textarea.addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey
    if (!cmd) return
    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault()
      wrapSelection('**')
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault()
      wrapSelection('*')
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault()
      wrapSelection('`')
    }
  })

  const handleCaptureRequest = async (
    requestId: string,
    payload: CaptureRequestPayload,
  ): Promise<CreateNoteResponse> => {
    const prose = payload.prose ?? ''
    // Semantic 'highlight' annotations would need element-resolution
    // (P4 runtime hooks); pass them through unchanged for v1 — the
    // bake step skips them silently. Concrete shapes (rect, lasso, …)
    // bake fine.
    const annotations: Annotation[] = payload.annotate ?? []

    let screenshotBase64: string | undefined
    try {
      const raw = await captureScreenshot({
        ...(opts.capture ? { capture: opts.capture } : {}),
      })
      if (annotations.length > 0) {
        const bake = opts.bake ?? bakeAnnotations
        const baked = await bake(raw, annotations)
        screenshotBase64 = baked.startsWith('data:') ? baked.slice(baked.indexOf(',') + 1) : baked
      } else {
        screenshotBase64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw
      }
    } catch (err) {
      // Capture failure: we still POST a note (carrying the requestId)
      // so the long-poll on the MCP side resolves — better to surface
      // the failure as a note than to time out silently.
      const message = err instanceof Error ? err.message : String(err)
      const failBody: CreateNoteRequest = {
        body: `[capture failed: ${message}]${prose ? `\n\n${prose}` : ''}`,
        frontmatter: {
          author: 'llm',
          kind: 'capture',
          captureLevel: payload.captureLevel ?? 'standard',
          url: typeof location !== 'undefined' ? location.href : '',
          route: null,
          routeParams: {},
          viewport: {
            w: typeof window !== 'undefined' ? window.innerWidth : 0,
            h: typeof window !== 'undefined' ? window.innerHeight : 0,
            dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
          },
          componentPath: collectComponentInfo()?.componentPath ?? null,
          componentMeta: collectComponentInfo()?.componentMeta ?? null,
          annotations,
          screenshot: null,
          agentSchemas: [],
          llui,
          fulfillsRequestId: requestId,
        },
        noteBody: buildNoteBody(annotations),
      }
      const failRes = await fetch(`${origin}/_llui/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(failBody),
      })
      if (!failRes.ok) {
        throw new Error(`devmode-annotate: POST /_llui/notes → ${failRes.status}`, { cause: err })
      }
      return (await failRes.json()) as CreateNoteResponse
    }

    const llmCompInfo = collectComponentInfo()
    const frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'> = {
      author: 'llm',
      kind: 'capture',
      captureLevel: payload.captureLevel ?? 'standard',
      url: typeof location !== 'undefined' ? location.href : '',
      route: null,
      routeParams: {},
      viewport: {
        w: typeof window !== 'undefined' ? window.innerWidth : 0,
        h: typeof window !== 'undefined' ? window.innerHeight : 0,
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      },
      componentPath: llmCompInfo?.componentPath ?? null,
      componentMeta: llmCompInfo?.componentMeta ?? null,
      annotations,
      screenshot: screenshotBase64 ? 'placeholder.png' : null,
      agentSchemas: [],
      llui,
      fulfillsRequestId: requestId,
    }
    const body: CreateNoteRequest = {
      body: prose,
      frontmatter,
      noteBody: buildNoteBody(annotations),
      ...(screenshotBase64 ? { screenshot: screenshotBase64 } : {}),
    }
    const url = `${origin}/_llui/notes`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`devmode-annotate: POST ${url} → ${res.status}`)
    }
    return (await res.json()) as CreateNoteResponse
  }

  // ── SSE subscription ───────────────────────────────────────────────
  // Open an EventSource so the HUD receives LLM-initiated capture
  // requests AND live status updates on the last task we submitted.
  // The browser's native EventSource has built-in reconnect; we don't
  // need a custom retry loop.
  //
  // `trackedTaskNoteId` is the most recent task the user submitted.
  // We update the modal's status line as transitions arrive
  // (claimed → proposed → applied / failed) so the developer sees
  // claude working in real time instead of a silent disappearance.
  let trackedTaskNoteId: string | null = null

  const statusLabel = (to: string, reason?: string): string => {
    switch (to) {
      case 'open':
        return '⏳ queued for the router…'
      case 'claimed':
        return '🤖 claude is working on it…'
      case 'in-progress':
        return '🤖 claude is editing files…'
      case 'proposed':
        return '✓ proposed fix ready — review the reply note'
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

  let eventSource: EventSource | null = null
  if (opts.subscribeEvents !== false && typeof EventSource !== 'undefined') {
    try {
      eventSource = new EventSource(`${origin}/_llui/events?role=hud`)
      eventSource.addEventListener('message', (e: MessageEvent) => {
        let parsed: {
          type?: string
          requestId?: string
          payload?: CaptureRequestPayload
          noteId?: string
          to?: string
          reason?: string
        }
        try {
          parsed = JSON.parse(e.data as string)
        } catch {
          return
        }
        if (parsed.type === 'capture-request' && parsed.requestId) {
          void handleCaptureRequest(parsed.requestId, parsed.payload ?? {}).catch((err) => {
            console.warn('[llui:devmode-annotate] capture-request handler failed:', err)
          })
          return
        }
        if (
          parsed.type === 'status-changed' &&
          parsed.noteId &&
          parsed.noteId === trackedTaskNoteId &&
          parsed.to
        ) {
          statusLine.textContent = statusLabel(parsed.to, parsed.reason)
          // Terminal states — re-enable the action buttons and stop
          // tracking. The dev can submit another task.
          if (
            parsed.to === 'applied' ||
            parsed.to === 'rejected' ||
            parsed.to === 'wontfix' ||
            parsed.to === 'failed'
          ) {
            saveBtn.disabled = false
            solveBtn.disabled = false
            trackedTaskNoteId = null
          }
        }
      })
    } catch (err) {
      console.warn('[llui:devmode-annotate] EventSource subscription failed:', err)
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      open()
    }
  }
  document.addEventListener('keydown', onKey)

  const handle: AnnotateHudHandle = {
    open,
    close,
    destroy,
    submit,
    drawRect: startRectFlow,
    handleCaptureRequest,
    setIntent: (i) => {
      defaultIntent = i
    },
  }
  ;(root as HTMLElement & { _lluiHandle?: AnnotateHudHandle })._lluiHandle = handle
  return handle
}

function noopHandle(): AnnotateHudHandle {
  const noop = (): void => {}
  const rejectNotMounted = (): Promise<never> =>
    Promise.reject(new Error('devmode-annotate: HUD not mounted (not dev mode)'))
  return {
    open: noop,
    close: noop,
    destroy: noop,
    submit: rejectNotMounted,
    drawRect: () => Promise.resolve(null),
    handleCaptureRequest: rejectNotMounted,
    setIntent: noop,
  }
}
