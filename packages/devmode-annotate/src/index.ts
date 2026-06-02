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
  NoteBody,
  NoteFrontmatter,
  NoteIntent,
  NoteKind,
  NoteRect,
  SourceMapEntry,
} from './note-types.js'

import { bakeAnnotations } from './bake.js'
import { createBrowseView } from './browse-view.js'
import { collectComponentInfo, collectDebugSnapshot, collectSourceMap } from './debug-collector.js'
import { pickElement } from './element-picker.js'
import { drawRect } from './overlay.js'
import { createReproRecorder, replayReproEvents } from './repro-recorder.js'
import type { ReproEvent } from './note-types.js'
import { captureScreenshot, describeCaptureError, type CaptureFn } from './screenshot.js'
import {
  btnStyle,
  RESUME_GLYPH_STYLE,
  SPLIT_BTN_STYLES,
  STYLES,
  THEME_STYLESHEET,
} from './styles.js'

export type BakeFn = (screenshotBase64: string, annotations: Annotation[]) => Promise<string>

/** True when running inside an automation-controlled browser (Playwright,
 *  WebDriver, Selenium, …). `navigator.webdriver` is the standardised
 *  signal every such driver sets. Used to suppress the persistent SSE
 *  subscription by default so e2e suites that gate on `networkidle` don't
 *  hang forever. */
function isAutomatedBrowser(): boolean {
  return typeof navigator !== 'undefined' && navigator.webdriver === true
}

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
  /** Enable the server-side rehydrate fetch on mount. The HUD calls
   *  /_llui/session/current + /_llui/notes + /_llui/queue right after
   *  mount to restore tracked tasks, chain histories, and pending
   *  Accept toasts after a page reload. Off by default — the vite
   *  plugin sets it to `true` in the injected bootstrap so production
   *  gets reload-survives-solve, while tests that stub `fetch` aren't
   *  surprised by extra calls. */
  rehydrate?: boolean
  /** Whether the attention router is wired up + available. When
   *  `false` (or missing CLI / `router: false` upstream), the HUD
   *  hides its "Solve" button so the user doesn't try to dispatch a
   *  task with no worker behind it. Notes can still be saved.
   *  Default `true`. */
  solveEnabled?: boolean
  /** Install `window.onerror` + `unhandledrejection` listeners. On
   *  an unhandled exception, the HUD opens pre-populated with the
   *  stack + auto-captured screenshot so the user can submit a one-
   *  click solve request. Default `true`. */
  autoCaptureOnError?: boolean
  /** Show the "● Record" toggle in the compose view (repro recorder).
   *  Default `true`. */
  repro?: boolean
  /** Show the "⌖ Pick element" annotation pill alongside Add region.
   *  Default `true`. */
  elementPick?: boolean
}

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
  /** Replay a captured repro trace against the live DOM. Resolves
   *  with `{ applied, skipped }` once the trace finishes. See
   *  `replayReproEvents` in repro-recorder.ts for option semantics. */
  replayRepro(
    events: ReproEvent[],
    options?: { speed?: number; maxStepMs?: number; abortOnMissing?: boolean },
  ): Promise<{ applied: number; skipped: Array<{ event: ReproEvent; reason: string }> }>
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

// Persisted floating-button position. Stored edge-anchored — anchor
// derived from which half of the viewport the button sits in at
// drag-end. A right/bottom-anchored button keeps a fixed offset from
// the right/bottom edge so window resize moves it with the edge instead
// of stranding it off-screen. Left/top-anchored positions are clamped
// on apply so a shrunk viewport still keeps the button visible.
const POSITION_STORAGE_KEY = 'llui-devmode-annotate.position'
const DRAG_THRESHOLD_PX = 4
const BUTTON_SIZE_PX = 44
const BUTTON_MARGIN_PX = 16

interface SavedPosition {
  anchorX: 'left' | 'right'
  offsetX: number
  anchorY: 'top' | 'bottom'
  offsetY: number
}

function readSavedPosition(): SavedPosition | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedPosition>
    if (
      (parsed.anchorX !== 'left' && parsed.anchorX !== 'right') ||
      (parsed.anchorY !== 'top' && parsed.anchorY !== 'bottom') ||
      typeof parsed.offsetX !== 'number' ||
      typeof parsed.offsetY !== 'number'
    ) {
      return null
    }
    return {
      anchorX: parsed.anchorX,
      offsetX: parsed.offsetX,
      anchorY: parsed.anchorY,
      offsetY: parsed.offsetY,
    }
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

function clampOffset(offset: number, viewportSize: number): number {
  const max = Math.max(BUTTON_MARGIN_PX, viewportSize - BUTTON_SIZE_PX - BUTTON_MARGIN_PX)
  return Math.min(Math.max(BUTTON_MARGIN_PX, offset), max)
}

function applySavedPosition(root: HTMLElement, pos: SavedPosition): void {
  const offsetX = clampOffset(pos.offsetX, window.innerWidth)
  const offsetY = clampOffset(pos.offsetY, window.innerHeight)
  if (pos.anchorX === 'left') {
    root.style.left = `${offsetX}px`
    root.style.right = 'auto'
  } else {
    root.style.right = `${offsetX}px`
    root.style.left = 'auto'
  }
  if (pos.anchorY === 'top') {
    root.style.top = `${offsetY}px`
    root.style.bottom = 'auto'
  } else {
    root.style.bottom = `${offsetY}px`
    root.style.top = 'auto'
  }
}

// Derive the anchor + offset from the button's current viewport rect.
// Anchor follows the center: right half → right-anchored, etc. Offset
// is the distance from the chosen edge to the corresponding button edge.
function deriveSavedPosition(rect: DOMRect): SavedPosition {
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const anchorX: 'left' | 'right' = centerX < window.innerWidth / 2 ? 'left' : 'right'
  const anchorY: 'top' | 'bottom' = centerY < window.innerHeight / 2 ? 'top' : 'bottom'
  const offsetX = anchorX === 'left' ? rect.left : window.innerWidth - rect.right
  const offsetY = anchorY === 'top' ? rect.top : window.innerHeight - rect.bottom
  return { anchorX, offsetX, anchorY, offsetY }
}

function clampViewportXY(x: number, y: number): { x: number; y: number } {
  return {
    x: clampOffset(x, window.innerWidth),
    y: clampOffset(y, window.innerHeight),
  }
}

// Floating-button label: two-line wordmark "LLui" / "HUD". Plain text
// (not SVG) so it inherits the button's font + color. Lines stack via
// flex-direction column on the button itself.
const BUTTON_LABEL_LINES = ['LLui', 'HUD'] as const

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
function buildNoteBody(annotations: Annotation[]): NoteBody {
  const body = collectDebugSnapshot()
  const sourceMap: Array<SourceMapEntry> = []
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
  let pendingRect: NoteRect | null = null
  let pendingElement: { selector: string; bbox: NoteRect } | null = null
  let activeElementPickDismiss: (() => void) | null = null

  // Per-task tracking. The router serializes solves, but the user can
  // submit multiple from the HUD — older tasks finish in the background
  // and surface via toast notifications. The status line in the modal
  // shows the LATEST in-flight task's progress.
  interface TrackedTask {
    noteId: string
    sessionId: string
    chainName: string
    status: 'claimed' | 'in-progress' | 'proposed' | string
  }
  const trackedTasks = new Map<string, TrackedTask>()
  let latestTaskId: string | null = null

  const refreshLineageRow = (): void => {
    // Shows the prior solve we're chaining from, IF the user picked
    // a chain to resume. "Start fresh" + first-ever solve both leave
    // this empty.
    const entry = selectedResumeChain ? chainHistories.get(selectedResumeChain) : null
    if (entry) {
      const trimmed = entry.summary.length > 60 ? entry.summary.slice(0, 60) + '…' : entry.summary
      lineageRow.textContent = `↻ chained from #${entry.lastTaskId} — ${trimmed}`
      lineageRow.style.display = 'block'
    } else {
      lineageRow.style.display = 'none'
      lineageRow.textContent = ''
    }
  }

  // State buckets:
  //  - working: router-owned, claude is still busy ('claimed', 'in-progress')
  //  - ready:  claude proposed a fix; user needs to Accept / Reject ('proposed')
  //  - terminal: workflow done, nothing more to do ('applied', 'rejected', 'wontfix', 'failed')
  const TERMINAL_STATES = new Set(['applied', 'rejected', 'wontfix', 'failed'])
  const isTerminal = (s: string): boolean => TERMINAL_STATES.has(s)
  const isWorking = (s: string): boolean => s === 'claimed' || s === 'in-progress' || s === 'open'
  const isReady = (s: string): boolean => s === 'proposed'

  // ── DOM ────────────────────────────────────────────────────────────
  const root = document.createElement('div')
  root.id = HUD_ELEMENT_ID
  root.style.cssText = STYLES.root

  const floatingBtn = document.createElement('button')
  floatingBtn.type = 'button'
  for (const line of BUTTON_LABEL_LINES) {
    const div = document.createElement('div')
    div.textContent = line
    floatingBtn.appendChild(div)
  }
  floatingBtn.title = 'LLui annotate (Cmd+Shift+A) — drag to move'
  floatingBtn.setAttribute('aria-label', 'Open LLui annotation HUD')
  floatingBtn.style.cssText = STYLES.button

  // Restore saved position if present. Default position from CSS
  // (bottom-right) is used otherwise.
  const saved = typeof localStorage !== 'undefined' ? readSavedPosition() : null
  if (saved && typeof window !== 'undefined') {
    applySavedPosition(root, saved)
  }

  const modal = document.createElement('div')
  modal.setAttribute('data-llui-modal', '')
  modal.style.cssText = STYLES.modal

  // Status-badge row (no title — the context subhead + placeholder
  // carry the framing). Only badges render here; the row stays empty
  // until at least one task is in flight or ready.
  const heading = document.createElement('div')
  heading.style.cssText =
    'display: flex; justify-content: flex-end; align-items: center; min-height: 18px; margin-bottom: 4px;'

  const badges = document.createElement('span')
  badges.style.cssText = 'display: flex; gap: 4px; align-items: center;'
  const workingBadge = document.createElement('span')
  workingBadge.setAttribute('data-llui-badge', 'working')
  workingBadge.style.cssText = STYLES.queueBadge
  workingBadge.style.display = 'none'
  const readyBadge = document.createElement('span')
  readyBadge.setAttribute('data-llui-badge', 'ready')
  readyBadge.style.cssText = STYLES.queueBadgeReady
  readyBadge.style.display = 'none'
  badges.append(workingBadge, readyBadge)
  heading.append(badges)

  const updateQueueBadge = (): void => {
    const tasks = [...trackedTasks.values()]
    const working = tasks.filter((t) => isWorking(t.status)).length
    const ready = tasks.filter((t) => isReady(t.status)).length
    if (working === 0) {
      workingBadge.style.display = 'none'
      workingBadge.textContent = ''
    } else {
      workingBadge.style.display = 'inline-block'
      workingBadge.textContent = `🤖 ${working} working`
    }
    if (ready === 0) {
      readyBadge.style.display = 'none'
      readyBadge.textContent = ''
    } else {
      readyBadge.style.display = 'inline-block'
      readyBadge.textContent = `✓ ${ready} ready`
    }
  }

  // Attachment row — inline "Add region" button + region chip preview
  // when a rect is attached. Replaces the old segmented Text/Draw-rect
  // tab control: drawing a region is now an action ON the note, not a
  // separate mode.
  const attachmentRow = document.createElement('div')
  attachmentRow.style.cssText = STYLES.attachmentRow

  const addRegionBtn = document.createElement('button')
  addRegionBtn.type = 'button'
  addRegionBtn.textContent = '⌖ Add region'
  addRegionBtn.title = 'Draw a rectangle on the page to attach to this note'
  addRegionBtn.style.cssText = STYLES.inlineActionBtn

  const regionChip = document.createElement('span')
  regionChip.style.cssText = STYLES.regionChip
  regionChip.style.display = 'none'
  const regionChipLabel = document.createElement('span')
  const regionChipClear = document.createElement('button')
  regionChipClear.type = 'button'
  regionChipClear.textContent = '×'
  regionChipClear.title = 'Remove region'
  regionChipClear.style.cssText = STYLES.regionChipClose
  regionChip.append(regionChipLabel, regionChipClear)

  // Element-pick pill — hidden when the plugin disabled the feature.
  const elementPickEnabled = opts.elementPick !== false
  const pickElementBtn = document.createElement('button')
  pickElementBtn.type = 'button'
  pickElementBtn.textContent = '⌖ Pick element'
  pickElementBtn.title = 'Click an element on the page to attach it to this note'
  pickElementBtn.style.cssText = STYLES.inlineActionBtn

  const elementChip = document.createElement('span')
  elementChip.style.cssText = STYLES.regionChip
  elementChip.style.display = 'none'
  const elementChipLabel = document.createElement('span')
  const elementChipClear = document.createElement('button')
  elementChipClear.type = 'button'
  elementChipClear.textContent = '×'
  elementChipClear.title = 'Remove element pick'
  elementChipClear.style.cssText = STYLES.regionChipClose
  elementChip.append(elementChipLabel, elementChipClear)

  if (elementPickEnabled) {
    attachmentRow.append(addRegionBtn, regionChip, pickElementBtn, elementChip)
  } else {
    attachmentRow.append(addRegionBtn, regionChip)
  }

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
  textarea.placeholder = 'Describe the issue…'
  textarea.rows = 5
  textarea.style.cssText = STYLES.textarea

  const markdownHint = document.createElement('div')
  markdownHint.style.cssText = STYLES.markdownHint
  markdownHint.innerHTML =
    'Markdown supported · <span style="font-family:ui-monospace,SFMono-Regular,monospace">⌘B</span> bold · <span style="font-family:ui-monospace,SFMono-Regular,monospace">⌘I</span> italic · <span style="font-family:ui-monospace,SFMono-Regular,monospace">⌘E</span> code'

  const statusLine = document.createElement('div')
  statusLine.setAttribute('data-llui-status', '')
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

  // "Solve" is a split button: the main half submits with the
  // current resume mode, the caret half opens a small menu to switch
  // between "Resume previous" and "Start fresh". Hidden entirely
  // when the upstream router is disabled or the CLI isn't on PATH.
  const solveEnabled = opts.solveEnabled !== false
  // Named-chain state, take 2. Each completed solve goes into
  // `chainHistories` keyed by the chainName the router used; the
  // LATEST `summary` from that chain is what the user sees in the
  // resume menu. `selectedResumeChain` is what the next Solve will
  // attach to: `null` means "start fresh" (mint a new chain name on
  // submit), a string means "resume this prior chain". Until at
  // least one chain has completed, the caret is hidden — there's
  // nothing to resume from.
  interface ChainEntry {
    name: string
    lastTaskId: string
    summary: string
    ts: number
  }
  const chainHistories = new Map<string, ChainEntry>()
  let selectedResumeChain: string | null = null
  let chainNameSeq = 0
  const mintChainName = (): string => {
    chainNameSeq += 1
    // Avoid colliding with any chain we've already seen.
    while (chainHistories.has(`chain-${chainNameSeq}`)) chainNameSeq += 1
    return `chain-${chainNameSeq}`
  }

  const solveSplit = document.createElement('div')
  solveSplit.setAttribute('data-llui-solve-split', '')
  solveSplit.style.cssText = SPLIT_BTN_STYLES.container

  const solveBtn = document.createElement('button')
  solveBtn.type = 'button'
  solveBtn.setAttribute('data-llui-solve', '')
  solveBtn.style.cssText = SPLIT_BTN_STYLES.main
  const solveGlyph = document.createElement('span')
  solveGlyph.style.cssText = RESUME_GLYPH_STYLE
  solveGlyph.textContent = '↻'
  const solveLabel = document.createElement('span')
  solveLabel.textContent = 'Solve'
  solveBtn.append(solveGlyph, solveLabel)

  const solveCaret = document.createElement('button')
  solveCaret.type = 'button'
  solveCaret.setAttribute('aria-haspopup', 'menu')
  solveCaret.setAttribute('aria-expanded', 'false')
  solveCaret.style.cssText = SPLIT_BTN_STYLES.caret
  solveCaret.textContent = '▾'
  solveCaret.title = 'Resume options'

  const solveMenu = document.createElement('div')
  solveMenu.setAttribute('role', 'menu')
  solveMenu.style.cssText = SPLIT_BTN_STYLES.menu

  // Render the Solve split button + dropdown menu. The caret is
  // hidden entirely until at least one chain has completed (nothing
  // to resume from on a first solve). When chains exist, each menu
  // item shows the LLM's own summary of that chain's most recent
  // solve — the user picks "the chain that did X" rather than
  // remembering chain names.
  const renderSolveState = (): void => {
    const hasResumable = chainHistories.size > 0
    // No resumable chains → no caret, no menu. The button is a plain
    // primary "Solve" that submits a fresh chain. The container
    // border-radius still wraps it cleanly since the caret was the
    // only thing on the right side.
    solveCaret.style.display = hasResumable ? 'inline-flex' : 'none'
    if (!hasResumable) {
      // Force selection back to null so the next submit mints fresh.
      selectedResumeChain = null
    }
    const activeChain = selectedResumeChain ? chainHistories.get(selectedResumeChain) : null
    solveGlyph.style.display = activeChain ? 'inline-flex' : 'none'
    solveBtn.title = activeChain
      ? `Solve, resuming "${activeChain.summary}" (⌘↩)`
      : 'Solve, starting a fresh conversation (⌘↩)'
    if (!hasResumable) {
      solveMenu.style.display = 'none'
      return
    }

    solveMenu.innerHTML = ''
    const headerEl = document.createElement('div')
    headerEl.textContent = 'Resume chain'
    headerEl.style.cssText =
      'padding: 4px 8px 2px; font-size: 10px; color: var(--hud-fg-subtle); text-transform: uppercase; letter-spacing: 0.5px;'
    solveMenu.appendChild(headerEl)
    // List chains by most-recently-completed first.
    const ordered = [...chainHistories.values()].sort((a, b) => b.ts - a.ts)
    for (const entry of ordered) {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'menuitemradio')
      item.style.cssText = SPLIT_BTN_STYLES.menuItem
      const isActive = selectedResumeChain === entry.name
      const dot = isActive ? '● ' : '○ '
      const summary = entry.summary || `(no summary — task ${entry.lastTaskId})`
      item.textContent = `${dot}${summary}`
      item.title = `Chain ${entry.name} · task #${entry.lastTaskId}`
      item.setAttribute('aria-checked', isActive ? 'true' : 'false')
      item.addEventListener('click', (e) => {
        e.stopPropagation()
        selectedResumeChain = entry.name
        renderSolveState()
        refreshLineageRow()
        closeSolveMenu()
        persistHudState()
      })
      solveMenu.appendChild(item)
    }
    // Divider + "Start fresh".
    const divider = document.createElement('div')
    divider.style.cssText = 'height: 1px; background: var(--hud-border); margin: 4px 6px;'
    solveMenu.appendChild(divider)
    const freshItem = document.createElement('button')
    freshItem.type = 'button'
    freshItem.setAttribute('role', 'menuitemradio')
    freshItem.style.cssText = SPLIT_BTN_STYLES.menuItem
    freshItem.textContent = (selectedResumeChain === null ? '● ' : '○ ') + 'Start fresh'
    freshItem.setAttribute('aria-checked', selectedResumeChain === null ? 'true' : 'false')
    freshItem.addEventListener('click', (e) => {
      e.stopPropagation()
      selectedResumeChain = null
      renderSolveState()
      refreshLineageRow()
      closeSolveMenu()
      persistHudState()
    })
    solveMenu.appendChild(freshItem)
  }
  renderSolveState()

  const closeSolveMenu = (): void => {
    solveMenu.style.display = 'none'
    solveCaret.setAttribute('aria-expanded', 'false')
  }
  const openSolveMenu = (): void => {
    solveMenu.style.display = 'flex'
    solveCaret.setAttribute('aria-expanded', 'true')
  }
  solveCaret.addEventListener('click', (e) => {
    e.stopPropagation()
    if (solveMenu.style.display === 'flex') closeSolveMenu()
    else openSolveMenu()
  })
  // Click anywhere outside the split closes the menu.
  document.addEventListener('click', (e) => {
    if (!solveSplit.contains(e.target as Node)) closeSolveMenu()
  })

  solveSplit.append(solveBtn, solveCaret, solveMenu)

  if (solveEnabled) {
    actions.append(cancelBtn, saveBtn, solveSplit)
  } else {
    // No worker available — promote "Save" to the primary slot so the
    // single available action gets the visual weight.
    saveBtn.style.cssText = btnStyle('primary')
    actions.append(cancelBtn, saveBtn)
  }

  // Context subhead — route · primary component · viewport. Refreshed
  // on each modal open so a navigation while the HUD was closed picks
  // up the new context.
  const contextSubhead = document.createElement('div')
  contextSubhead.style.cssText = STYLES.contextSubhead

  // Lineage subhead — visible only when resume mode is on AND we've
  // already completed at least one task this session. Tells the user
  // "this solve will continue the conversation from #042" so the
  // chained behaviour isn't invisible.
  const lineageRow = document.createElement('div')
  lineageRow.setAttribute('data-llui-lineage', '')
  lineageRow.style.cssText =
    STYLES.contextSubhead + '; color: var(--hud-accent-fg); margin-top: -6px;'
  lineageRow.style.display = 'none'

  // "More options" expander. Collapsed by default — verbose capture
  // is a power-user knob; the default flow should stay simple.
  const moreOptionsToggle = document.createElement('button')
  moreOptionsToggle.type = 'button'
  moreOptionsToggle.style.cssText = STYLES.moreOptionsToggle
  moreOptionsToggle.textContent = '▸ More options'
  const moreOptionsBody = document.createElement('div')
  moreOptionsBody.style.cssText = STYLES.moreOptionsBody
  const verboseLabel = document.createElement('label')
  verboseLabel.style.cssText = STYLES.moreOptionsRow + '; cursor: pointer'
  const verboseCheckbox = document.createElement('input')
  verboseCheckbox.type = 'checkbox'
  verboseCheckbox.style.cssText = 'margin: 0'
  const verboseText = document.createElement('span')
  verboseText.textContent = 'Include verbose telemetry (state, message log, DOM snapshot)'
  verboseLabel.append(verboseCheckbox, verboseText)
  moreOptionsBody.append(verboseLabel)

  // Repro recorder toggle. Captures clicks / inputs / keydowns /
  // route changes between toggle-on and submit and attaches them to
  // noteBody.repro. Hidden when the plugin opted out.
  const reproEnabled = opts.repro !== false
  const reproRecorder = createReproRecorder()
  const reproRow = document.createElement('div')
  reproRow.style.cssText = STYLES.moreOptionsRow + '; margin-top: 6px'
  const reproBtn = document.createElement('button')
  reproBtn.type = 'button'
  reproBtn.style.cssText = [
    'display: inline-flex',
    'align-items: center',
    'gap: 4px',
    'padding: 3px 8px',
    'border-radius: 4px',
    'border: 1px solid var(--hud-border-strong)',
    'background: transparent',
    'color: var(--hud-fg-muted)',
    'cursor: pointer',
    'font: inherit',
    'font-size: 11px',
  ].join('; ')
  const reproStatusLabel = document.createElement('span')
  reproStatusLabel.style.cssText = 'color: var(--hud-fg-subtle); font-size: 11px;'

  const renderReproRow = (): void => {
    const recording = reproRecorder.isRecording()
    reproBtn.textContent = recording ? '■ Stop recording' : '● Start recording'
    if (recording) {
      reproBtn.style.borderColor = 'var(--hud-toast-border-fail)'
      reproBtn.style.color = 'var(--hud-toast-border-fail)'
      reproStatusLabel.textContent = 'capturing clicks, inputs, route changes…'
    } else {
      reproBtn.style.borderColor = 'var(--hud-border-strong)'
      reproBtn.style.color = 'var(--hud-fg-muted)'
      reproStatusLabel.textContent = 'attaches a click+input trail for the LLM to replay'
    }
  }
  reproBtn.addEventListener('click', (e) => {
    e.preventDefault()
    if (reproRecorder.isRecording()) reproRecorder.stop()
    else reproRecorder.start()
    renderReproRow()
  })
  reproRow.append(reproBtn, reproStatusLabel)
  if (reproEnabled) {
    moreOptionsBody.append(reproRow)
    renderReproRow()
  }

  // Footer keyboard hint. Solve shortcut hidden when solve is
  // unavailable so we don't advertise a key that won't dispatch.
  const kbdHint = document.createElement('div')
  kbdHint.style.cssText = STYLES.kbdHint
  const kbd = (s: string): string => `<span style="${STYLES.kbd}">${s}</span>`
  kbdHint.innerHTML =
    (solveEnabled ? `${kbd('⌘↩')} solve · ` : '') + `${kbd('⇧⌘↩')} save · ${kbd('esc')} cancel`

  // Compose view contains all the new-note inputs. Wrapped so we can
  // swap visibility with the browse view in one DOM toggle.
  const composeView = document.createElement('div')
  composeView.setAttribute('data-llui-view', 'compose')
  composeView.style.cssText = 'display: flex; flex-direction: column; gap: 0;'
  composeView.append(
    contextSubhead,
    lineageRow,
    attachmentRow,
    toolbar,
    textarea,
    markdownHint,
    moreOptionsToggle,
    moreOptionsBody,
    statusLine,
    actions,
  )

  // Browse view — sessions + notes list + edit/delete.
  const browse = createBrowseView({
    origin,
    onError: (msg) => {
      statusLine.textContent = msg
    },
    onReplayRepro: (events) => replayReproEvents(events as ReproEvent[]),
  })

  // View toggle, placed in the heading row alongside the badges.
  const viewToggle = document.createElement('button')
  viewToggle.type = 'button'
  viewToggle.style.cssText = [
    'background: transparent',
    'border: 0',
    'padding: 0',
    'cursor: pointer',
    'color: var(--hud-fg-muted)',
    'font: inherit',
    'font-size: 12px',
    'text-decoration: underline',
    'margin-right: auto', // pushes badges to the right
  ].join('; ')
  let currentView: 'compose' | 'browse' = 'compose'
  const applyView = (): void => {
    composeView.style.display = currentView === 'compose' ? 'flex' : 'none'
    browse.el.style.display = currentView === 'browse' ? 'flex' : 'none'
    viewToggle.textContent = currentView === 'compose' ? 'Browse notes' : '← New note'
    kbdHint.style.display = currentView === 'compose' ? 'flex' : 'none'
    if (currentView === 'browse') browse.onShow()
  }
  viewToggle.addEventListener('click', () => {
    currentView = currentView === 'compose' ? 'browse' : 'compose'
    applyView()
    persistHudState()
  })
  // Insert the toggle as the first child of the heading row so it
  // sits left of the badges (margin-right: auto pushes badges right).
  heading.insertBefore(viewToggle, heading.firstChild)

  modal.append(heading, composeView, browse.el, kbdHint)
  applyView()

  // Toast container — fixed top-right, holds transient terminal-state
  // notifications for tasks that finish while the modal is closed or
  // while the user has moved on to a different task. Sits outside the
  // floating root container so it isn't affected by drag/position.
  const toastContainer = document.createElement('div')
  toastContainer.id = 'llui-devmode-annotate-toasts'
  toastContainer.style.cssText = STYLES.toastContainer

  root.append(floatingBtn, modal)
  document.body.appendChild(root)
  document.body.appendChild(toastContainer)

  // Inject the theme stylesheet once. Idempotent — guarded by element
  // id so a second mountAnnotateHud() call (which the public handle
  // dedupes anyway) wouldn't double-insert.
  if (!document.getElementById('llui-devmode-annotate-styles')) {
    const styleEl = document.createElement('style')
    styleEl.id = 'llui-devmode-annotate-styles'
    styleEl.textContent = THEME_STYLESHEET
    document.head.appendChild(styleEl)
  }

  if (opts.hidden) root.style.display = 'none'

  interface ToastAction {
    label: string
    variant?: 'primary' | 'secondary' | 'ghost'
    onClick: () => void
  }
  const spawnToast = (
    kind: 'ok' | 'fail' | 'info',
    body: string,
    opts: { actions?: ToastAction[]; autoDismissMs?: number } = {},
  ): void => {
    const toast = document.createElement('div')
    toast.setAttribute('data-llui-toast', kind)
    const border =
      kind === 'ok'
        ? STYLES.toastBorderOk
        : kind === 'fail'
          ? STYLES.toastBorderFail
          : STYLES.toastBorderInfo
    toast.style.cssText = STYLES.toast + ';' + border
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(-8px)'

    const text = document.createElement('div')
    text.style.cssText = 'flex: 1; min-width: 0; word-break: break-word;'
    text.textContent = body
    toast.appendChild(text)

    const actions = opts.actions ?? []
    for (const action of actions) {
      const actionBtn = document.createElement('button')
      actionBtn.type = 'button'
      actionBtn.textContent = action.label
      actionBtn.style.cssText =
        btnStyle(action.variant ?? 'primary') + '; padding: 4px 10px; font-size: 12px;'
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        action.onClick()
        dismiss()
      })
      toast.appendChild(actionBtn)
    }

    const close = document.createElement('span')
    close.textContent = '×'
    close.style.cssText =
      'color: #888; font-size: 16px; line-height: 1; padding: 0 2px; cursor: pointer; user-select: none;'
    toast.appendChild(close)
    toastContainer.appendChild(toast)

    // Slide-in + (optional) auto-dismiss; click anywhere to dismiss.
    requestAnimationFrame(() => {
      toast.style.opacity = '1'
      toast.style.transform = 'translateY(0)'
    })
    const dismiss = (): void => {
      toast.style.opacity = '0'
      toast.style.transform = 'translateY(-8px)'
      setTimeout(() => toast.remove(), 250)
    }
    // 'fail' toasts NEVER auto-dismiss — the user needs to read the
    // error. Action toasts also don't auto-dismiss (the user might
    // miss the buttons). Plain ok/info toasts auto-dismiss after 8s.
    // `autoDismissMs` overrides the default explicitly.
    const defaultDismissMs = kind === 'fail' ? 0 : actions.length > 0 ? 0 : 8000
    const dismissMs = opts.autoDismissMs ?? defaultDismissMs
    if (dismissMs > 0) setTimeout(dismiss, dismissMs)
    toast.addEventListener('click', dismiss)
  }

  // Helpers that POST a status transition for the Accept/Reject
  // buttons in a proposed-state toast. The middleware acts on the
  // working tree (no-op for accept; revert for reject) and emits
  // subsequent status-changed events that drive the next toast
  // (applied / rejected / failed).
  const postStatusTransition = (
    noteId: string,
    sessionId: string,
    to: 'accepted' | 'rejected',
    failLabel: string,
  ): void => {
    const url = `${origin}/_llui/notes/${noteId}/status?sessionId=${encodeURIComponent(sessionId)}`
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, by: 'human' }),
    }).catch((err: Error) => {
      spawnToast('fail', `${failLabel} failed for ${noteId}: ${err.message}`)
    })
  }
  const acceptTask = (noteId: string, sessionId: string): void => {
    postStatusTransition(noteId, sessionId, 'accepted', 'Accept')
  }
  const rejectTask = (noteId: string, sessionId: string): void => {
    postStatusTransition(noteId, sessionId, 'rejected', 'Reject')
  }
  // ── Behavior ───────────────────────────────────────────────────────

  // Reflect the current `pendingRect` state in the attachment row.
  // Replaces the old setMode() — there's no longer a distinct "text"
  // vs "rect" mode; drawing is just an attachment ON the note.
  const refreshRegionChip = (): void => {
    if (pendingRect) {
      regionChipLabel.textContent = `⌖ ${pendingRect.w}×${pendingRect.h}`
      regionChip.style.display = 'inline-flex'
      addRegionBtn.style.display = 'none'
    } else {
      regionChip.style.display = 'none'
      addRegionBtn.style.display = 'inline-flex'
    }
    // Same pattern for the element-pick chip.
    const pe: { selector: string; bbox: NoteRect } | null = pendingElement
    if (pe) {
      // Show only the last selector segment so the chip stays compact.
      const tail = pe.selector.split('>').pop()?.trim() ?? pe.selector
      elementChipLabel.textContent = `⌖ ${tail}`
      elementChip.title = pe.selector
      elementChip.style.display = 'inline-flex'
      pickElementBtn.style.display = 'none'
    } else {
      elementChip.style.display = 'none'
      pickElementBtn.style.display = elementPickEnabled ? 'inline-flex' : 'none'
    }
  }
  refreshRegionChip()

  // Element-pick handler — symmetric to startRectFlow(). Hides the
  // modal while the picker is active so the user can hover the page;
  // restores it on submit/cancel.
  const startElementPickFlow = async (): Promise<void> => {
    if (activeElementPickDismiss) {
      activeElementPickDismiss()
      activeElementPickDismiss = null
    }
    const wasOpen = modal.style.display === 'block'
    close()
    const result = await pickElement()
    if (wasOpen) open()
    if (result.reason === 'submit' && result.element) {
      pendingElement = result.element
      activeElementPickDismiss = result.dismiss ?? null
    }
    refreshRegionChip()
  }

  // Compute + render the context subhead from the current page state.
  // Called on every modal open so navigations are reflected.
  const refreshContextSubhead = (): void => {
    const parts: string[] = []
    if (typeof location !== 'undefined') parts.push(location.pathname || '/')
    const compInfo = collectComponentInfo()
    if (compInfo?.componentMeta) parts.push(`<${compInfo.componentMeta.name}>`)
    else if (compInfo?.componentPath?.length) parts.push(`<${compInfo.componentPath[0]}>`)
    if (typeof window !== 'undefined') parts.push(`${window.innerWidth}×${window.innerHeight}`)
    contextSubhead.textContent = parts.length > 0 ? parts.join(' · ') : ''
  }

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
    // Refresh the context subhead + lineage from current state — a
    // navigation while the modal was closed should be reflected on
    // next open, and a previously-completed task means the next
    // solve will chain.
    refreshContextSubhead()
    refreshLineageRow()
    // Measurement requires the modal to be rendered, so re-anchor on
    // a microtask after the display flips.
    queueMicrotask(reanchorModal)
    textarea.focus()
    statusLine.textContent = ''
    persistHudState()
  }
  const close = (): void => {
    modal.style.display = 'none'
    persistHudState()
  }
  const destroy = (): void => {
    document.removeEventListener('keydown', onKey)
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
    if (progressTickInterval) {
      clearInterval(progressTickInterval)
      progressTickInterval = null
    }
    eventSource?.close()
    if (activeOverlayDismiss) {
      activeOverlayDismiss()
      activeOverlayDismiss = null
    }
    root.remove()
  }

  // Re-apply the saved position whenever the viewport size changes.
  // Right/bottom-anchored buttons follow their edge naturally; left/top
  // -anchored buttons get clamp-capped so a shrunk viewport can't strand
  // them off-screen. If nothing is saved, the default CSS bottom/right
  // anchoring already tracks resize — no work needed.
  const onResize = (): void => {
    // Keep the context subhead's viewport reading in sync while the
    // modal is open. Cheap — DOM-text write only.
    if (modal.style.display === 'block') {
      refreshContextSubhead()
      reanchorModal()
    }
    const current = readSavedPosition()
    if (current) applySavedPosition(root, current)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize)
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
      refreshRegionChip()
      return result.rect
    }
    // Cancel — the overlay is already dismissed when reason='cancel'.
    // pendingRect is unchanged in this branch (the user kept whatever
    // was attached before, or nothing).
    refreshRegionChip()
    return null
  }

  const buildAnnotations = (): Annotation[] => {
    const out: Annotation[] = []
    if (pendingRect) out.push({ type: 'rect', ...pendingRect })
    // Widen pendingElement before the null-check — `let` narrows to
    // `null` here lexically since the picker handler that assigns
    // appears later in the file.
    const pe: { selector: string; bbox: NoteRect } | null = pendingElement
    if (pe) {
      out.push({ type: 'element', selector: pe.selector, bbox: pe.bbox })
    }
    return out
  }

  const buildKind = (): NoteKind => {
    if (pendingElement) return 'element'
    if (pendingRect) return 'rect'
    return 'text'
  }

  // Default intent — tracked separately from per-call overrides. The
  // floating button respects this; per-call `submitOpts.intent` wins.
  // When solve is disabled there's no worker to act on tasks, so we
  // fall back to a plain note.
  let defaultIntent: NoteIntent = solveEnabled ? 'task' : 'note'

  const submit = async (
    prose: string,
    submitOpts: {
      captureLevel?: CaptureLevel
      annotations?: Annotation[]
      screenshot?: string
      intent?: NoteIntent
      /** Forwarded into the note's frontmatter. The router reads this
       *  on task-intent notes to decide whether to pass the
       *  resume-previous-conversation flag to the LLM (e.g. `claude
       *  --continue`). Defaults to `true` for HUD-driven submits when
       *  the intent is 'task'. */
      resume?: boolean
      /** Forwarded into frontmatter. Routes the task into a named
       *  resume chain so parallel conversation threads stay
       *  independent. Default 'default'. */
      chainName?: string
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
        throw new Error(`devmode-annotate: screenshot failed — ${describeCaptureError(err)}`, {
          cause: err,
        })
      }
    }

    const compInfo = collectComponentInfo()
    const intent: NoteIntent = submitOpts.intent ?? defaultIntent
    // Resume defaults: task notes inherit the caller's choice (or true
    // when omitted); 'note'-intent submissions never carry a resume
    // flag since they don't dispatch.
    const resume: boolean | undefined = intent === 'task' ? (submitOpts.resume ?? true) : undefined
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
      ...(resume !== undefined ? { resume } : {}),
      ...(submitOpts.chainName ? { chainName: submitOpts.chainName } : {}),
      screenshot: screenshotBase64 ? 'placeholder.png' : null,
      agentSchemas: [],
      llui,
    }
    // Drain the repro recorder. Captured events attach to the note
    // body so the LLM can replay the interaction trail that led to
    // this submission. Recorder stops after flush.
    const noteBody = buildNoteBody(annotations)
    const reproEvents = reproRecorder.flush()
    if (reproEvents.length > 0) {
      noteBody.repro = reproEvents
    }
    if (reproRecorder.isRecording()) {
      reproRecorder.stop()
      if (reproEnabled) renderReproRow()
    }
    const body: CreateNoteRequest = {
      body: prose,
      frontmatter,
      noteBody,
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
    const clamped = clampViewportXY(nx, ny)
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
      const pos = deriveSavedPosition(rect)
      writeSavedPosition(pos)
      applySavedPosition(root, pos)
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

  addRegionBtn.addEventListener('click', () => {
    void startRectFlow()
  })
  regionChipClear.addEventListener('click', (e) => {
    e.stopPropagation()
    dismissActiveOverlay()
    pendingRect = null
    refreshRegionChip()
  })
  regionChip.addEventListener('click', () => {
    // Click on the chip body (not the × close) re-opens the drawing
    // overlay so the user can adjust the region.
    void startRectFlow()
  })

  if (elementPickEnabled) {
    pickElementBtn.addEventListener('click', () => {
      void startElementPickFlow()
    })
    elementChipClear.addEventListener('click', (e) => {
      e.stopPropagation()
      if (activeElementPickDismiss) {
        activeElementPickDismiss()
        activeElementPickDismiss = null
      }
      pendingElement = null
      refreshRegionChip()
    })
    elementChip.addEventListener('click', () => {
      void startElementPickFlow()
    })
  }

  // More-options expand/collapse.
  let moreOptionsOpen = false
  moreOptionsToggle.addEventListener('click', () => {
    moreOptionsOpen = !moreOptionsOpen
    moreOptionsBody.style.display = moreOptionsOpen ? 'block' : 'none'
    moreOptionsToggle.textContent = moreOptionsOpen ? '▾ More options' : '▸ More options'
  })

  cancelBtn.addEventListener('click', () => {
    dismissActiveOverlay()
    pendingRect = null
    if (activeElementPickDismiss) {
      activeElementPickDismiss()
      activeElementPickDismiss = null
    }
    pendingElement = null
    refreshRegionChip()
    close()
  })

  // Live progress for an in-flight task. The router emits one
  // `task-progress` event per stream-json line (debounced 250ms);
  // we cache the latest values and ALSO tick the elapsed display
  // locally every 1s so the line never looks stale during long
  // tool calls that produce no intermediate output.
  interface ProgressSnapshot {
    noteId: string
    /** ms-since-task-start reported by the router. */
    reportedElapsedMs: number
    /** local wall-clock when that report arrived. The render fn
     *  derives current elapsed = reportedElapsedMs + (now - reportedAt). */
    reportedAt: number
    tokens?: { in: number; out: number; cacheRead?: number }
    toolSummary?: string
  }
  let activeProgress: ProgressSnapshot | null = null
  let progressTickInterval: ReturnType<typeof setInterval> | null = null

  const renderActiveProgress = (): void => {
    if (!activeProgress || activeProgress.noteId !== latestTaskId) return
    const elapsed = activeProgress.reportedElapsedMs + (Date.now() - activeProgress.reportedAt)
    const parts: string[] = ['🤖 working']
    if (activeProgress.tokens) {
      const t = activeProgress.tokens
      const cacheSuffix =
        t.cacheRead !== undefined && t.cacheRead > 0 ? ` (${fmtTokens(t.cacheRead)} cached)` : ''
      parts.push(`${fmtTokens(t.in)} ctx${cacheSuffix}`)
      parts.push(`${fmtTokens(t.out)} out`)
    }
    parts.push(`${Math.round(elapsed / 1000)}s`)
    if (activeProgress.toolSummary) parts.push(activeProgress.toolSummary)
    statusLine.textContent = parts.join(' · ')
  }

  const stopProgressTicker = (): void => {
    if (progressTickInterval) {
      clearInterval(progressTickInterval)
      progressTickInterval = null
    }
    activeProgress = null
  }

  const handleTaskProgress = (
    noteId: string,
    p: {
      elapsedMs?: number
      tokens?: { in: number; out: number; cacheRead?: number }
      toolSummary?: string
    },
  ): void => {
    const task = trackedTasks.get(noteId)
    if (!task) return
    // Only the LATEST in-flight task's progress shows in the status
    // line — others continue in the background and surface their
    // terminal result via toast.
    if (noteId !== latestTaskId) return
    activeProgress = {
      noteId,
      reportedElapsedMs: p.elapsedMs ?? 0,
      reportedAt: Date.now(),
      ...(p.tokens ? { tokens: p.tokens } : {}),
      ...(p.toolSummary ? { toolSummary: p.toolSummary } : {}),
    }
    // Preserve previously-known tokens/toolSummary across heartbeats
    // that omit them (the router sends a partial payload when nothing
    // new has arrived).
    if (!p.tokens && activeProgress.tokens === undefined) {
      // nothing to do
    }
    renderActiveProgress()
    if (!progressTickInterval) {
      progressTickInterval = setInterval(renderActiveProgress, 1000)
    }
  }

  // Compact thousands-separator for token counts ("1,247", "14k").
  const fmtTokens = (n: number): string => {
    if (n >= 10_000) return `${Math.round(n / 1000)}k`
    return n.toLocaleString()
  }

  // Centralized status-update handler. Used by both the catch-up GET
  // and the SSE listener so they share the same toast/queue logic.
  const handleStatusUpdate = (noteId: string, to: string, reason: string | undefined): void => {
    const task = trackedTasks.get(noteId)
    if (!task) return
    const prev = task.status
    task.status = to
    if (noteId === latestTaskId) {
      statusLine.textContent = statusLabel(to, reason)
    }

    // Defense-in-depth liveness: start the local 1s elapsed ticker
    // the moment a task enters a working state. If the upstream
    // task-progress events (stream-json) take a while to arrive — or
    // never arrive (e.g. heartbeat-only preset) — at least the user
    // sees the clock advancing instead of a frozen
    // "claude is working on it…". When a real task-progress event
    // lands later, it overwrites with token + tool detail.
    if (isWorking(to) && noteId === latestTaskId && activeProgress?.noteId !== noteId) {
      activeProgress = {
        noteId,
        reportedElapsedMs: 0,
        reportedAt: Date.now(),
      }
      renderActiveProgress()
      if (!progressTickInterval) {
        progressTickInterval = setInterval(renderActiveProgress, 1000)
      }
    }

    // Stop the progress ticker once the task leaves the working
    // states. The static statusLabel for 'proposed'/'applied'/etc
    // takes over from here.
    if ((isReady(to) || isTerminal(to)) && activeProgress?.noteId === noteId) {
      stopProgressTicker()
    }

    // 'proposed' means the router successfully produced a result —
    // record the chain entry (overwriting any prior entry for the
    // same chain) so the next Solve's menu shows this summary. The
    // router broadcasts the LLM's own one-line summary as `reason`.
    if (isReady(to) && !isReady(prev)) {
      chainHistories.set(task.chainName, {
        name: task.chainName,
        lastTaskId: noteId,
        summary: reason ?? '',
        ts: Date.now(),
      })
      // Auto-select the chain we just completed — common case is
      // "I want to continue this" so the next Solve resumes by
      // default. User can pick "Start fresh" or another chain.
      selectedResumeChain = task.chainName
      renderSolveState()
      refreshLineageRow()
    }

    // 'proposed' is NOT terminal but IS actionable — fire a toast
    // with an "Accept" button so the user can apply directly. Only
    // toast on the FIRST proposal (don't re-fire if duplicate events
    // arrive).
    if (isReady(to) && !isReady(prev)) {
      spawnToast('info', `Note ${noteId}: ${reason ?? 'proposed fix ready'}`, {
        actions: [
          {
            label: 'Reject',
            variant: 'ghost',
            onClick: () => rejectTask(noteId, task.sessionId),
          },
          {
            label: 'Accept',
            variant: 'primary',
            onClick: () => acceptTask(noteId, task.sessionId),
          },
        ],
      })
      updateQueueBadge()
      return
    }

    if (isTerminal(to)) {
      const kind: 'ok' | 'fail' | 'info' =
        to === 'applied' ? 'ok' : to === 'failed' ? 'fail' : 'info'
      spawnToast(kind, `Note ${noteId}: ${statusLabel(to, reason)}`)
      trackedTasks.delete(noteId)
      if (noteId === latestTaskId) {
        // Promote the newest still-in-flight task as the new "latest".
        const remaining = [...trackedTasks.entries()]
        latestTaskId = remaining.length > 0 ? remaining[remaining.length - 1]![0] : null
        if (latestTaskId) {
          const promoted = trackedTasks.get(latestTaskId)!
          statusLine.textContent = statusLabel(promoted.status)
        }
      }
      updateQueueBadge()
      return
    }

    // Non-terminal, non-ready transitions (e.g. 'claimed' → 'in-progress'):
    // just refresh the badge so 'working' counts stay accurate.
    updateQueueBadge()
  }

  const submitWithIntent = (intent: NoteIntent): void => {
    const prose = textarea.value.trim()
    if (prose === '' && buildAnnotations().length === 0) {
      statusLine.textContent = 'add text or draw a region first'
      return
    }
    const captureLevel: CaptureLevel = verboseCheckbox.checked ? 'verbose' : 'standard'
    statusLine.textContent = pendingRect ? 'capturing screenshot…' : 'sending…'
    // Pick the chain name to attach to this task:
    //   - if the user selected a prior chain to resume → that name
    //   - otherwise → mint a fresh chain id. The router has no
    //     session for the fresh id, so resume: true is vacuously a
    //     no-op (new conversation).
    const chainName = intent === 'task' ? (selectedResumeChain ?? mintChainName()) : undefined
    submit(prose, {
      intent,
      captureLevel,
      resume: true,
      ...(chainName ? { chainName } : {}),
    }).then(
      async (result) => {
        textarea.value = ''
        pendingRect = null
        if (activeElementPickDismiss) {
          activeElementPickDismiss()
          activeElementPickDismiss = null
        }
        pendingElement = null
        dismissActiveOverlay()
        refreshRegionChip()
        verboseCheckbox.checked = false
        persistHudState()
        if (intent === 'task') {
          // Add to per-task tracking. Buttons stay enabled so the
          // user can capture another issue right away; older tasks
          // finish in the background and surface via toast.
          trackedTasks.set(result.id, {
            noteId: result.id,
            sessionId: result.sessionId,
            chainName: chainName ?? 'default',
            status: 'claimed', // optimistic — router has already claimed by now
          })
          latestTaskId = result.id
          updateQueueBadge()
          statusLine.textContent = statusLabel('claimed')
          // Catch up: rare-but-possible case where the task already
          // finished before the 201 reached us. Only override if the
          // reported state is LATER than 'claimed'.
          try {
            const res = await fetch(
              `${origin}/_llui/notes/${result.id}/status?sessionId=${encodeURIComponent(result.sessionId)}`,
            )
            if (res.ok) {
              const payload = (await res.json()) as {
                current: string | null
                history: Array<{ to: string; reason?: string }>
              }
              if (payload.current && payload.current !== 'open' && payload.current !== 'claimed') {
                const last = payload.history[payload.history.length - 1]
                handleStatusUpdate(result.id, payload.current, last?.reason)
              }
            }
          } catch {
            // Best-effort. SSE will pick up future transitions.
          }
        } else {
          statusLine.textContent = `✓ note saved (${result.filename})`
        }
      },
      (err: Error) => {
        statusLine.textContent = err.message
      },
    )
  }
  saveBtn.addEventListener('click', () => submitWithIntent('note'))
  solveBtn.addEventListener('click', () => submitWithIntent('task'))

  // ── Markdown toolbar wiring ────────────────────────────────────────
  //
  // Smart wrap+toggle. Hitting Bold once wraps the selection in `**`;
  // hitting it again removes the wrap. Three cases detected:
  //   (1) selection itself is `**text**`           → strip wrap
  //   (2) selection is `text` with `**` on either side in surrounding
  //                                                   → strip flanking
  //   (3) neither                                  → wrap
  const toggleWrap = (marker: string): void => {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value
    const selected = value.slice(start, end)
    const ml = marker.length

    // Case 1: selection itself is wrapped — strip.
    if (selected.length >= ml * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      const inner = selected.slice(ml, selected.length - ml)
      textarea.value = value.slice(0, start) + inner + value.slice(end)
      textarea.focus()
      textarea.setSelectionRange(start, start + inner.length)
      return
    }

    // Case 2: surrounding text wraps the selection — strip flanking.
    if (
      start >= ml &&
      end + ml <= value.length &&
      value.slice(start - ml, start) === marker &&
      value.slice(end, end + ml) === marker
    ) {
      textarea.value = value.slice(0, start - ml) + selected + value.slice(end + ml)
      textarea.focus()
      const newStart = start - ml
      textarea.setSelectionRange(newStart, newStart + selected.length)
      return
    }

    // Case 3: wrap. Placeholder only when no selection.
    const placeholder = selected || 'text'
    const replacement = `${marker}${placeholder}${marker}`
    textarea.value = value.slice(0, start) + replacement + value.slice(end)
    textarea.focus()
    const cursorStart = start + ml
    const cursorEnd = cursorStart + placeholder.length
    textarea.setSelectionRange(cursorStart, cursorEnd)
  }

  // Line-prefix toggle. If every selected line already starts with
  // the prefix, strip it; otherwise add it.
  const toggleLinePrefix = (addPrefix: (i: number) => string, matchPrefix: RegExp): void => {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    // Find end of last line in selection (the \n AT or AFTER `end`).
    let lineEnd = value.indexOf('\n', end)
    if (lineEnd === -1) lineEnd = value.length
    const block = value.slice(lineStart, lineEnd) || 'item'
    const lines = block.split('\n')
    const allMatch = lines.every((l) => matchPrefix.test(l))
    const next = lines
      .map((line, i) => (allMatch ? line.replace(matchPrefix, '') : `${addPrefix(i)}${line}`))
      .join('\n')
    textarea.value = value.slice(0, lineStart) + next + value.slice(lineEnd)
    textarea.focus()
    textarea.setSelectionRange(lineStart, lineStart + next.length)
  }

  boldBtn.addEventListener('click', () => toggleWrap('**'))
  italicBtn.addEventListener('click', () => toggleWrap('*'))
  codeBtn.addEventListener('click', () => toggleWrap('`'))
  bulletBtn.addEventListener('click', () => toggleLinePrefix(() => '- ', /^- /))
  numBtn.addEventListener('click', () => toggleLinePrefix((i) => `${i + 1}. `, /^\d+\. /))

  textarea.addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey
    if (!cmd) return
    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault()
      toggleWrap('**')
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault()
      toggleWrap('*')
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault()
      toggleWrap('`')
    } else if (e.key === 'Enter') {
      // ⌘↩ → solve (when available, default action); ⇧⌘↩ → save.
      e.preventDefault()
      if (e.shiftKey || !solveEnabled) submitWithIntent('note')
      else submitWithIntent('task')
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
  // requests AND live status updates on tracked tasks. The browser's
  // native EventSource has built-in reconnect; we don't need a custom
  // retry loop.
  //
  // Status updates route through `handleStatusUpdate` so the catch-up
  // GET and the SSE stream share toast/queue-counter logic. The
  // status line reflects the most recent in-flight task; older tasks
  // surface their terminal outcome via toast.

  const statusLabel = (to: string, reason?: string): string => {
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

  // ── Rehydrate from server on mount ─────────────────────────────
  // Page reloads previously erased in-flight task tracking, chain
  // histories, and any Accept toast for an already-proposed solve.
  // We now read the same on-disk notebook the router writes and
  // reconstruct the HUD's tracking state so a refresh is harmless.
  const rehydrateFromServer = async (): Promise<void> => {
    try {
      const sessionRes = await fetch(`${origin}/_llui/session/current`)
      if (!sessionRes.ok) return
      const { sessionId } = (await sessionRes.json()) as { sessionId: string }
      if (!sessionId) return

      const [notesRes, queueRes] = await Promise.all([
        fetch(`${origin}/_llui/notes?sessionId=${encodeURIComponent(sessionId)}`),
        fetch(`${origin}/_llui/queue?sessionId=${encodeURIComponent(sessionId)}`),
      ])
      if (!notesRes.ok || !queueRes.ok) return
      const notesData = (await notesRes.json()) as {
        notes: Array<{
          id: string
          ts: string
          kind: string
          intent?: 'task' | 'note'
          chainName?: string
          replyTo?: string
          proposedSummary?: string
        }>
      }
      const queueData = (await queueRes.json()) as {
        queue: Array<{ noteId: string; status: string }>
      }

      const byId = new Map<string, (typeof notesData.notes)[number]>()
      for (const n of notesData.notes) byId.set(n.id, n)

      // Pair each task with its newest reply (so we can show the
      // LLM's summary in toasts + chain menu).
      const newestReplyByTaskId = new Map<string, (typeof notesData.notes)[number]>()
      for (const n of notesData.notes) {
        if (n.kind !== 'reply' || !n.replyTo) continue
        const prev = newestReplyByTaskId.get(n.replyTo)
        if (!prev || n.ts > prev.ts) newestReplyByTaskId.set(n.replyTo, n)
      }

      for (const entry of queueData.queue) {
        const task = byId.get(entry.noteId)
        if (!task || task.intent !== 'task') continue
        const chainName = task.chainName ?? 'default'
        const reply = newestReplyByTaskId.get(task.id)

        // In-flight: just track. Don't latch latestTaskId — the user
        // shouldn't be jumped to an older task's progress when they
        // reload while many were running.
        if (
          entry.status === 'open' ||
          entry.status === 'claimed' ||
          entry.status === 'in-progress'
        ) {
          trackedTasks.set(task.id, {
            noteId: task.id,
            sessionId,
            chainName,
            status: entry.status,
          })
        } else if (entry.status === 'proposed') {
          // Proposed but not accepted: surface the Accept toast (the
          // user may have reloaded right between propose + accept).
          trackedTasks.set(task.id, {
            noteId: task.id,
            sessionId,
            chainName,
            status: 'proposed',
          })
          const summary = reply?.proposedSummary ?? 'proposed fix ready'
          chainHistories.set(chainName, {
            name: chainName,
            lastTaskId: task.id,
            summary,
            ts: new Date(reply?.ts ?? task.ts).getTime(),
          })
          spawnToast('info', `Note ${task.id}: ${summary}`, {
            actions: [
              {
                label: 'Reject',
                variant: 'ghost',
                onClick: () => rejectTask(task.id, sessionId),
              },
              {
                label: 'Accept',
                variant: 'primary',
                onClick: () => acceptTask(task.id, sessionId),
              },
            ],
          })
        } else if (reply?.proposedSummary) {
          // Terminal but had a proposed reply at some point — keep
          // the chain history visible in the resume menu.
          chainHistories.set(chainName, {
            name: chainName,
            lastTaskId: task.id,
            summary: reply.proposedSummary,
            ts: new Date(reply.ts).getTime(),
          })
        }
      }
      updateQueueBadge()
      renderSolveState()
    } catch (err) {
      console.warn('[llui:devmode-annotate] rehydrate failed:', err)
    }
  }

  // ── Persisted HUD state ────────────────────────────────────────
  // Modal open/closed, current view, textarea draft, and the
  // selected resume chain all survive a reload via localStorage.
  const HUD_STATE_KEY = 'llui-devmode-annotate.hud-state'
  interface PersistedHudState {
    modalOpen?: boolean
    view?: 'compose' | 'browse'
    draftProse?: string
    selectedResumeChain?: string | null
  }
  const readPersistedHudState = (): PersistedHudState => {
    try {
      const raw = localStorage.getItem(HUD_STATE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as PersistedHudState
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  const persistHudState = (): void => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      try {
        const state: PersistedHudState = {
          modalOpen: modal.style.display === 'block',
          view: currentView,
          draftProse: textarea.value,
          selectedResumeChain,
        }
        localStorage.setItem(HUD_STATE_KEY, JSON.stringify(state))
      } catch {
        // localStorage unavailable (private mode, quota); silently
        // skip — next session will start fresh.
      }
    }, 200)
  }

  // Wire persistence on the events that actually change the state.
  textarea.addEventListener('input', persistHudState)

  // Apply persisted state.
  const persisted = readPersistedHudState()
  if (persisted.draftProse) textarea.value = persisted.draftProse
  if (persisted.selectedResumeChain !== undefined) {
    selectedResumeChain = persisted.selectedResumeChain
  }
  if (persisted.view === 'browse') {
    currentView = 'browse'
    applyView()
  }
  if (persisted.modalOpen) {
    // Defer the open() call until after this microtask so layout has
    // settled and we don't re-anchor against a 0×0 modal.
    queueMicrotask(() => {
      open()
    })
  }

  // Kick off server rehydrate (fire-and-forget; renders happen
  // inside). Opt-in via the bootstrap — the plugin sets
  // `rehydrate: true` so production gets the reload-survives-solve
  // behaviour, while tests (which stub fetch with single-shape
  // responses) default to off and don't see surprise extra calls.
  if (opts.rehydrate === true) {
    void rehydrateFromServer()
  }

  // The SSE subscription defaults ON, but never under an automated
  // browser: the stream never closes, so it permanently blocks
  // `waitForLoadState('networkidle')` in any consumer's Playwright /
  // WebDriver e2e suite that mounts the HUD in dev. There's no human to
  // drive the HUD and no LLM capture session under automation, so the
  // default flips OFF when `navigator.webdriver` is true. An explicit
  // `subscribeEvents` (true or false) always wins — a suite that
  // specifically exercises the SSE path can force it on.
  const subscribeEvents = opts.subscribeEvents ?? !isAutomatedBrowser()
  let eventSource: EventSource | null = null
  if (subscribeEvents && typeof EventSource !== 'undefined') {
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
          elapsedMs?: number
          tokens?: { in: number; out: number }
          toolSummary?: string
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
        if (parsed.type === 'status-changed' && parsed.noteId && parsed.to) {
          handleStatusUpdate(parsed.noteId, parsed.to, parsed.reason)
          browse.refresh()
          return
        }
        if (parsed.type === 'task-progress' && parsed.noteId) {
          handleTaskProgress(parsed.noteId, {
            ...(parsed.elapsedMs !== undefined ? { elapsedMs: parsed.elapsedMs } : {}),
            ...(parsed.tokens ? { tokens: parsed.tokens } : {}),
            ...(parsed.toolSummary ? { toolSummary: parsed.toolSummary } : {}),
          })
          return
        }
        if (
          parsed.type === 'note-created' ||
          parsed.type === 'note-updated' ||
          parsed.type === 'note-deleted'
        ) {
          browse.refresh()
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

  // ── Auto-capture on uncaught error ─────────────────────────────
  // window.onerror + unhandledrejection fire for synchronous and
  // promise-rejection errors respectively. We open the HUD with a
  // prefilled prose + skip re-opening on duplicate same-error events
  // within a short window so a chatty React effect doesn't spam.
  const autoCaptureEnabled = opts.autoCaptureOnError !== false
  let lastAutoCaptureAt = 0
  const fillFromError = (label: string, message: string, stack: string | undefined): void => {
    // 5s debounce per HUD instance — multiple synchronous error
    // events with the same source map to one auto-capture.
    const now = Date.now()
    if (now - lastAutoCaptureAt < 5000) return
    lastAutoCaptureAt = now
    const lines = [
      `**Auto-captured ${label}**`,
      '',
      '```',
      message,
      ...(stack ? [stack.split('\n').slice(0, 8).join('\n')] : []),
      '```',
      '',
      'What was happening when this fired?',
    ]
    textarea.value = lines.join('\n')
    open()
    // Place caret at the end so the user can continue typing.
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }
  const onWindowError = (e: ErrorEvent): void => {
    if (!autoCaptureEnabled) return
    fillFromError('error', e.message || String(e.error), e.error?.stack)
  }
  const onUnhandledRejection = (e: PromiseRejectionEvent): void => {
    if (!autoCaptureEnabled) return
    const reason = e.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    fillFromError('unhandled rejection', message, stack)
  }
  if (autoCaptureEnabled && typeof window !== 'undefined') {
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
  }

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
    replayRepro: replayReproEvents,
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
    replayRepro: () => Promise.resolve({ applied: 0, skipped: [] }),
  }
}
