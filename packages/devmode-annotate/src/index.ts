// @llui/devmode-annotate — the in-app HUD, authored with @llui/dom.
//
// The shell is a single TEA component over one serializable state tree.
// Reactive parts (modal open/close, view toggle, badges, status line,
// toasts, attachment chips, more-options, solve menu, lineage) are driven by
// state; the floating-button drag + modal reanchor stay an imperative layout
// boundary on the root host (DOM measurement); the textarea is a `foreign`
// boundary so the markdown toolbar can manipulate the caret. All the fiddly
// logic lives — and is unit-tested — in ./hud-core.ts.
//
// Tree-shaken in prod via `import.meta.env.DEV`.

import type {
  Annotation,
  CaptureLevel,
  CaptureRequestPayload,
  ConsoleLogEntry,
  CreateNoteResponse,
  NoteBody,
  NoteIntent,
  NoteRect,
  ReproEvent,
  SourceMapEntry,
} from './note-types.js'

import {
  button,
  component,
  div,
  each,
  foreign,
  input,
  label,
  mountSignalComponent,
  onMount,
  portal,
  show,
  span,
  text,
  type Mountable,
  type Renderable,
  type Signal,
  type SignalViewBag,
} from '@llui/dom'
import {
  corePlugin,
  floatingToolbarPlugin,
  linkPlugin,
  markdownEditor,
  slashPlugin,
  type EditorState,
} from '@llui/markdown-editor'
import '@llui/markdown-editor/styles/editor.css'
// The same stylesheet as raw text, so isolate (shadow-DOM) mode can adopt it
// into the shadow root where the light-DOM side-effect import can't reach.
import EDITOR_CSS from '@llui/markdown-editor/styles/editor.css?raw'
import type { LexicalEditor } from 'lexical'

import {
  collapsible,
  type CollapsibleMsg,
  type CollapsibleState,
} from '@llui/components/collapsible'
import { tabs, type TabsMsg, type TabsState } from '@llui/components/tabs'
import { menu, type MenuMsg, type MenuState, type MenuItem } from '@llui/components/menu'
import { createBrowseView } from './browse-view.js'
import type { ExportableStore, NotesStore } from './notes-store.js'
import { devServerStore } from './stores/dev-server-store.js'
import {
  exportBundle as buildExportBundle,
  bundleFilename,
  type BundleManifest,
} from './export-bundle.js'
import { redactState, resolveCaptureDefaults, type RedactHooks } from './redact.js'
import {
  collectComponentInfo,
  collectDebugSnapshot,
  collectSourceMap,
  collectVerboseSnapshot,
  createConsoleCapture,
} from './debug-collector.js'
import { pickElement } from './element-picker.js'
import { drawRect } from './overlay.js'
import { createReproRecorder, replayReproEvents } from './repro-recorder.js'
import { type CaptureFn } from './screenshot.js'
import {
  btnStyle,
  RESUME_GLYPH_STYLE,
  SPLIT_BTN_STYLES,
  STYLES,
  THEME_STYLESHEET,
} from './styles.js'
import {
  computeModalAnchor,
  queueCounts,
  reduceTask,
  shouldMountHud,
  type TaskEffect,
  type TaskMsg,
  type TaskState,
  taskInitialState,
  type Toast,
  type ToastAction,
} from './hud-core.js'
import { createDisposerRegistry } from './hud-lifecycle.js'
import { createPersistence } from './persistence.js'
import { applySavedPosition, createDragController, readSavedPosition } from './drag-controller.js'
import { installAutoCapture } from './auto-capture.js'
import { createCapturePipeline, type BakeFn } from './capture-pipeline.js'

// The notes transport seam. Re-exported so consumers can supply their own
// adapter (IndexedDB, HTTP, export bundle) via `mountAnnotateHud({ store })`.
export type {
  NotesStore,
  SessionSummary,
  NoteStatusResponse,
  QueueEntry,
  QueueResponse,
  FullNote,
  StatusUpdate,
  NoteUpdate,
  EventSubscription,
} from './notes-store.js'
export { devServerStore } from './stores/dev-server-store.js'
export { httpStore, type HttpStoreOptions, type HeadersInput } from './stores/http-store.js'
export { indexedDbStore, type IndexedDbStoreOptions } from './stores/indexed-db-store.js'
export type { RawNote, RawSession, ExportableStore } from './notes-store.js'
export {
  exportBundle,
  bundleFilename,
  type BundleManifest,
  type BundleIdentity,
  type BundleAppProvenance,
  type ExportBundleOptions,
  type ExportBundleResult,
} from './export-bundle.js'
export { NOTE_SCHEMA_VERSION } from './note-format.js'
export { defaultSecretRedactor } from './redact.js'
export type { RedactHooks, CaptureDefaults, SecretRedactorOptions } from './redact.js'

// The capture geometry + annotation baker types live with the capture
// pipeline; re-exported here so the public surface is unchanged.
export type { ScreenshotGeometry, BakeFn } from './capture-pipeline.js'

function isAutomatedBrowser(): boolean {
  return typeof navigator !== 'undefined' && navigator.webdriver === true
}

/**
 * Apply the HUD stylesheet to a shadow root. Prefers a constructable
 * `adoptedStyleSheets` entry (programmatic — bypasses the `style-src
 * 'unsafe-inline'` CSP rule); falls back to a `<style>` inside the shadow
 * root (still fully style-isolated) where constructable sheets are
 * unavailable (e.g. older engines, jsdom).
 */
function applyShadowStyles(shadow: ShadowRoot, css: string): void {
  const ctor = typeof globalThis.CSSStyleSheet === 'function' ? globalThis.CSSStyleSheet : null
  if (ctor && 'adoptedStyleSheets' in shadow) {
    try {
      const sheet = new ctor()
      sheet.replaceSync(css)
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet]
      return
    } catch {
      // fall through to a <style> element
    }
  }
  const styleEl = document.createElement('style')
  styleEl.textContent = css
  shadow.appendChild(styleEl)
}

/** Trigger a browser download of a Blob via a transient anchor. No-op when
 *  the DOM / object-URL APIs are unavailable (SSR, older test envs). */
function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Anchors download from the light DOM regardless of HUD isolation.
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface MountAnnotateOptions {
  origin?: string
  /** The notes transport. Defaults to `devServerStore(origin)` — the Vite
   *  dev-server endpoints. Inject a different adapter (IndexedDB, HTTP,
   *  export bundle) to run the HUD without a dev server. */
  store?: NotesStore
  /** Mount in a production build. By default the HUD only mounts under the
   *  dev server (`import.meta.env.DEV`); set this when a live app deliberately
   *  ships it (typically via `installAnnotateHud`, behind the host's own
   *  authorization). */
  allowProduction?: boolean
  llui?: { runtime: string; compiler: string }
  hidden?: boolean
  capture?: CaptureFn
  bake?: BakeFn
  subscribeEvents?: boolean
  rehydrate?: boolean
  solveEnabled?: boolean
  autoCaptureOnError?: boolean
  repro?: boolean
  elementPick?: boolean
  /** Per-channel redaction hooks (state / repro / screenshot), run before a
   *  capture is persisted. The host owns the privacy policy; these are the
   *  seams to enforce it. */
  redact?: RedactHooks
  /** Collect the verbose debug-telemetry body (state/message/effect dump).
   *  Defaults: on under the dev server, OFF in production. */
  captureDebug?: boolean
  /** Mount the HUD chrome inside an open shadow root with isolated styles
   *  (constructable `adoptedStyleSheets`, falling back to a shadow `<style>`).
   *  Gives bidirectional style isolation from the host app and avoids the
   *  `style-src 'unsafe-inline'` CSP rule. Default false (light DOM, the dev
   *  default); `installAnnotateHud` turns it on for production. */
  isolate?: boolean
  /** Markdown-editor stylesheet text adopted into the shadow root in isolate
   *  mode (the light-DOM `import '…/editor.css'` can't cross the shadow
   *  boundary). Defaults to the bundled stylesheet (`editor.css?raw`). Override
   *  to supply the CSS in environments where the `?raw` import can't resolve. */
  editorCss?: string
}

export interface AnnotateHudHandle {
  open(): void
  close(): void
  destroy(): void
  /** Programmatically set the compose draft (Markdown). Flows into the embedded
   * editor like a restored draft. */
  setProse(text: string): void
  submit(
    prose: string,
    opts?: {
      captureLevel?: CaptureLevel
      annotations?: Annotation[]
      screenshot?: string
      intent?: NoteIntent
      resume?: boolean
      chainName?: string
    },
  ): Promise<CreateNoteResponse>
  drawRect(): Promise<NoteRect | null>
  handleCaptureRequest(
    requestId: string,
    payload: CaptureRequestPayload,
  ): Promise<CreateNoteResponse>
  setIntent(intent: NoteIntent): void
  replayRepro(
    events: ReproEvent[],
    options?: { speed?: number; maxStepMs?: number; abortOnMissing?: boolean },
  ): Promise<{ applied: number; skipped: Array<{ event: ReproEvent; reason: string }> }>
  /** Export the notebook as a downloadable `.zip` bundle and trigger a
   *  browser download. Resolves to the bundle manifest, or `null` when the
   *  active store can't export (e.g. the dev-server store). */
  exportBundle(): Promise<BundleManifest | null>
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
const BUTTON_LABEL_LINES = ['LLui', 'HUD'] as const

// The saved-position DOM helpers (the imperative layout boundary) live in
// ./drag-controller.js; `readSavedPosition` / `applySavedPosition` are imported
// above for the initial mount + resize handling.

// ── Annotation → note-body helpers ───────────────────────────────────────

function bboxOf(ann: Annotation): { x: number; y: number; w: number; h: number } | null {
  if (ann.type === 'rect') return { x: ann.x, y: ann.y, w: ann.w, h: ann.h }
  if (ann.type === 'element') return ann.bbox
  return null
}
interface BuildNoteBodyOptions {
  /** The privacy gate: collect the per-component telemetry at all. Off in prod
   *  by default. When off, only code-structure data (source map) is kept. */
  debug: boolean
  /** Capture depth. `standard` = state/message/effect snapshot + source map;
   *  `verbose` ADDS the deep scope-tree / binding totals + the console log. */
  level: CaptureLevel
  /** Recent console entries (from the HUD's console capture), drained into the
   *  verbose body. */
  consoleLog?: ConsoleLogEntry[]
}

function buildNoteBody(annotations: Annotation[], opts: BuildNoteBodyOptions): NoteBody {
  // The debug snapshot (per-component state, message/effect logs) is the
  // sensitive channel — gated by `debug` (off in prod by default). The
  // source-position map below is code structure, not user data, so it's kept
  // regardless.
  const body: NoteBody = opts.debug ? collectDebugSnapshot() : {}
  const sourceMap: SourceMapEntry[] = []
  for (const ann of annotations) {
    const bb = bboxOf(ann)
    if (!bb) continue
    sourceMap.push(...collectSourceMap(bb))
  }
  if (sourceMap.length > 0) body.sourceMap = sourceMap

  // Verbose telemetry is strictly additive over the standard snapshot, and
  // still honors the `debug` privacy gate (it's state-derived, so prod stays
  // opted out). This is what makes the "verbose telemetry" checkbox real —
  // previously it only flipped a frontmatter flag with no body effect.
  if (opts.debug && opts.level === 'verbose') {
    const verbose = collectVerboseSnapshot()
    if (verbose) body.verbose = verbose
    if (opts.consoleLog && opts.consoleLog.length > 0) {
      body.consoleLog = opts.consoleLog.slice()
    }
  }
  return body
}

// ── HUD state ────────────────────────────────────────────────────────────

interface HudState {
  modalOpen: boolean
  tabs: TabsState
  moreOptions: CollapsibleState
  solveMenu: MenuState
  draftProse: string
  pendingRect: NoteRect | null
  pendingElement: { selector: string; bbox: NoteRect } | null
  verbose: boolean
  reproRecording: boolean
  defaultIntent: NoteIntent
  statusLine: string
  contextLine: string
  tasks: TaskState
}

type HudMsg =
  | { type: 'modal/open' }
  | { type: 'modal/close' }
  | { type: 'modal/toggle' }
  | { type: 'tabs'; msg: TabsMsg }
  | { type: 'moreOptions'; msg: CollapsibleMsg }
  | { type: 'solveMenu'; msg: MenuMsg }
  | { type: 'setProse'; value: string }
  | { type: 'attach/rect'; rect: NoteRect | null }
  | { type: 'attach/element'; element: { selector: string; bbox: NoteRect } | null }
  | { type: 'clearAttachments' }
  | { type: 'verbose/set'; value: boolean }
  | { type: 'repro/toggle' }
  | { type: 'repro/set'; recording: boolean }
  | { type: 'intent/set'; intent: NoteIntent }
  | { type: 'chain/select'; name: string | null }
  | { type: 'status/set'; text: string }
  | { type: 'context/set'; line: string }
  | { type: 'task'; msg: TaskMsg }

type HudEffect = TaskEffect | { type: 'persist' } | { type: 'reproStart' } | { type: 'reproStop' }

const initHud = (solveEnabled: boolean) => (): HudState => ({
  modalOpen: false,
  tabs: tabs.init({ items: ['compose', 'browse'], value: 'compose' }),
  moreOptions: collapsible.init(),
  solveMenu: menu.init(),
  draftProse: '',
  pendingRect: null,
  pendingElement: null,
  verbose: false,
  reproRecording: false,
  defaultIntent: solveEnabled ? 'task' : 'note',
  statusLine: '',
  contextLine: '',
  tasks: taskInitialState(),
})

function reduceHud(state: HudState, msg: HudMsg): [HudState, HudEffect[]] {
  switch (msg.type) {
    case 'modal/open':
      return [{ ...state, modalOpen: true, statusLine: '' }, [{ type: 'persist' }]]
    case 'modal/close': {
      const [solveMenu] = menu.update(state.solveMenu, { type: 'close' })
      return [{ ...state, modalOpen: false, solveMenu }, [{ type: 'persist' }]]
    }
    case 'modal/toggle':
      return [
        {
          ...state,
          modalOpen: !state.modalOpen,
          statusLine: state.modalOpen ? state.statusLine : '',
        },
        [{ type: 'persist' }],
      ]
    case 'tabs': {
      const [tabsState] = tabs.update(state.tabs, msg.msg)
      return [{ ...state, tabs: tabsState }, [{ type: 'persist' }]]
    }
    case 'moreOptions': {
      const [moreOptions] = collapsible.update(state.moreOptions, msg.msg)
      return [{ ...state, moreOptions }, []]
    }
    case 'solveMenu': {
      const [solveMenu] = menu.update(state.solveMenu, msg.msg)
      return [{ ...state, solveMenu }, []]
    }
    case 'setProse':
      return [{ ...state, draftProse: msg.value }, [{ type: 'persist' }]]
    case 'attach/rect':
      return [{ ...state, pendingRect: msg.rect }, []]
    case 'attach/element':
      return [{ ...state, pendingElement: msg.element }, []]
    case 'clearAttachments':
      return [{ ...state, pendingRect: null, pendingElement: null }, []]
    case 'verbose/set':
      return [{ ...state, verbose: msg.value }, []]
    case 'repro/toggle': {
      const recording = !state.reproRecording
      return [
        { ...state, reproRecording: recording },
        [{ type: recording ? 'reproStart' : 'reproStop' }],
      ]
    }
    case 'repro/set':
      return [{ ...state, reproRecording: msg.recording }, []]
    case 'intent/set':
      return [{ ...state, defaultIntent: msg.intent }, []]
    case 'chain/select':
      return [
        { ...state, tasks: { ...state.tasks, selectedChain: msg.name } },
        [{ type: 'persist' }],
      ]
    case 'status/set':
      return [{ ...state, statusLine: msg.text }, []]
    case 'context/set':
      return [{ ...state, contextLine: msg.line }, []]
    case 'task': {
      const [tasks, effs] = reduceTask(state.tasks, msg.msg)
      let solveMenu = state.solveMenu
      const items = solveMenuItems(tasks)
      const changed =
        items.length !== solveMenu.items.length ||
        items.some((it, i) => it.value !== solveMenu.items[i]?.value)
      if (changed) {
        ;[solveMenu] = menu.update(solveMenu, { type: 'setItems', items })
      }
      return [
        { ...state, tasks, solveMenu, statusLine: tasks.statusLine || state.statusLine },
        effs,
      ]
    }
  }
}

// ── Lineage + solve-menu helpers (pure) ──────────────────────────────────

/** The 'Start fresh' menu item value (sentinel — not a real chain name). */
const SOLVE_FRESH = '__fresh__'

/** Menu items for the Solve resume dropdown: chains newest-first + fresh. */
function solveMenuItems(tasks: TaskState): MenuItem[] {
  return Object.values(tasks.chains)
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .map((c) => c.name)
    .concat([SOLVE_FRESH])
    .map((value) => ({ value, kind: 'action' as const }))
}

function lineageText(tasks: TaskState): string {
  const entry = tasks.selectedChain ? tasks.chains[tasks.selectedChain] : null
  if (!entry) return ''
  const trimmed = entry.summary.length > 60 ? entry.summary.slice(0, 60) + '…' : entry.summary
  return `↻ chained from #${entry.lastTaskId} — ${trimmed}`
}

export function mountAnnotateHud(opts: MountAnnotateOptions = {}): AnnotateHudHandle {
  if (
    !shouldMountHud({ dev: import.meta.env?.DEV ?? false, allowProduction: opts.allowProduction })
  )
    return noopHandle()
  if (typeof document === 'undefined') return noopHandle()

  const existing = document.getElementById(HUD_ELEMENT_ID) as
    | (HTMLElement & { _lluiHandle?: AnnotateHudHandle })
    | null
  if (existing?._lluiHandle) return existing._lluiHandle

  const origin = opts.origin ?? (typeof location !== 'undefined' ? location.origin : '')
  const store = opts.store ?? devServerStore(origin)
  const llui = opts.llui ?? {
    runtime: (typeof window !== 'undefined' && window.__llui?.runtime) || 'unknown',
    compiler: (typeof window !== 'undefined' && window.__llui?.compiler) || 'unknown',
  }
  const solveEnabled = opts.solveEnabled !== false
  const elementPickEnabled = opts.elementPick !== false
  // Prod-safe capture defaults: the debug-telemetry body and interaction
  // recording default ON in dev and OFF in production (host opts in).
  const isDev = import.meta.env?.DEV ?? false
  const captureChannels = resolveCaptureDefaults(isDev, {
    ...(opts.captureDebug !== undefined ? { captureDebug: opts.captureDebug } : {}),
    ...(opts.repro !== undefined ? { repro: opts.repro } : {}),
  })
  const reproEnabled = captureChannels.repro
  // Continuously mirror the console into a ring buffer so a verbose capture can
  // attach the recent console log. Gated by the same privacy channel as the
  // rest of the telemetry (prod stays off), and torn down in destroy().
  const consoleCapture = captureChannels.debug ? createConsoleCapture() : null
  // Build the note body honoring the debug-capture default + the host's
  // per-channel state redaction. The single place every capture routes
  // through, so the seam can't be bypassed. `level` (standard/verbose) drives
  // how deep the telemetry goes.
  const collectBody = (annotations: Annotation[], level: CaptureLevel): NoteBody =>
    redactState(
      buildNoteBody(annotations, {
        debug: captureChannels.debug,
        level,
        ...(consoleCapture ? { consoleLog: consoleCapture.snapshot() } : {}),
      }),
      opts.redact?.state,
    )

  // Export: only stores that can produce raw sessions (IndexedDB; not the
  // dev-server store, whose notes already live on disk) support it.
  const storeCanExport = (s: NotesStore): s is NotesStore & ExportableStore =>
    typeof (s as Partial<ExportableStore>).exportSessions === 'function'
  const exportNotesBundle = async (): Promise<BundleManifest | null> => {
    if (!storeCanExport(store)) return null
    const { blob, manifest } = await buildExportBundle(store)
    triggerDownload(blob, bundleFilename(manifest))
    return manifest
  }

  // Imperative refs (the embedded markdown editor + DOM nodes used for measurement).
  // The prose field is a nested `markdownEditor()` app mounted into a `foreign`
  // host; `mdApp` is its handle (read/clear via `setValue`), `editorApi` the live
  // Lexical editor (for focus).
  let mdApp: ReturnType<typeof mountSignalComponent> | null = null
  let editorApi: LexicalEditor | null = null
  let modalEl: HTMLElement | null = null

  // Every timer, listener, subscription, nested app, and DOM node registers its
  // teardown here; `destroy()` folds over the registry (see ./hud-lifecycle).
  const disposers = createDisposerRegistry()

  const reproRecorder = createReproRecorder()

  // In isolate (shadow-DOM) mode the HUD must own its portal targets: every
  // menu/select overlay has to portal INTO the shadow root, not document.body,
  // so the shadow's adopted styles apply and the popup stays contained. Created
  // here (detached) so createBrowseView + solveSplit can close over it; appended
  // to the shadow root below where the shadow is built.
  const isolate = opts.isolate === true
  const overlayHost: HTMLElement | null = isolate ? document.createElement('div') : null
  if (overlayHost) overlayHost.setAttribute('data-llui-overlay-portal', '')

  // Browse view (its own LLui component) — hosted inside the modal.
  const browse = createBrowseView({
    store,
    ...(overlayHost ? { overlayTarget: overlayHost } : {}),
    onError: (m) => handle.send({ type: 'status/set', text: m }),
    onReplayRepro: (events) =>
      replayReproEvents(events as ReproEvent[], {
        // Replaying a trace synthesizes real clicks/navigation in the
        // live app — gate it behind an explicit confirmation. The
        // route-match guard (origin path stamped in the trace) is
        // enforced by replayReproEvents itself.
        confirm: () =>
          typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(
                'Replay this recorded interaction? It will fire real clicks and navigation in the app.',
              )
            : false,
      }),
    // Only surface the export button when the store can actually export.
    ...(storeCanExport(store)
      ? {
          onExport: async () => {
            const manifest = await exportNotesBundle()
            if (manifest)
              handle.send({ type: 'status/set', text: `✓ exported ${manifest.noteCount} note(s)` })
          },
        }
      : {}),
  })

  // Root host — the floating-button container. Position lives here (imperative).
  const root = document.createElement('div')
  root.id = HUD_ELEMENT_ID
  root.style.cssText = STYLES.root
  const saved = typeof localStorage !== 'undefined' ? readSavedPosition() : null
  if (saved && typeof window !== 'undefined') applySavedPosition(root, saved)

  // Toast container — fixed top-right, outside the draggable root.
  const toastContainer = document.createElement('div')
  toastContainer.id = 'llui-devmode-annotate-toasts'
  toastContainer.style.cssText = STYLES.toastContainer

  // `idEl` is the element that lives in the document tree and carries the
  // discoverable id / handle. In isolate mode that's the shadow host (the
  // chrome lives inside its open shadow root); otherwise it's `root` itself.
  // The stylesheet is keyed on `#llui-devmode-annotate-root`, so `root` keeps
  // that id inside the shadow and the adopted sheet still matches.
  let shadowHost: HTMLElement | null = null
  let idEl: HTMLElement
  if (isolate) {
    shadowHost = document.createElement('div')
    shadowHost.id = HUD_ELEMENT_ID
    const shadow = shadowHost.attachShadow({ mode: 'open' })
    shadow.appendChild(root)
    shadow.appendChild(toastContainer)
    // The overlay portal target lives inside the shadow so menu/select popups
    // portal into it (styles apply, content is contained).
    if (overlayHost) shadow.appendChild(overlayHost)
    applyShadowStyles(shadow, THEME_STYLESHEET)
    // Bundle the markdown-editor stylesheet into the shadow — the light-DOM
    // side-effect `import '…/editor.css'` doesn't cross the shadow boundary, so
    // the embedded editor would render unstyled without this.
    const editorCss = opts.editorCss ?? EDITOR_CSS
    if (editorCss) applyShadowStyles(shadow, editorCss)
    document.body.appendChild(shadowHost)
    idEl = shadowHost
  } else {
    document.body.appendChild(root)
    document.body.appendChild(toastContainer)
    if (!document.getElementById('llui-devmode-annotate-styles')) {
      const styleEl = document.createElement('style')
      styleEl.id = 'llui-devmode-annotate-styles'
      styleEl.textContent = THEME_STYLESHEET
      document.head.appendChild(styleEl)
    }
    idEl = root
  }
  if (opts.hidden) root.style.display = 'none'

  // ── Imperative bridge fns (declared before the view so handlers close over them) ──

  const getState = (): HudState => handle.getState()
  // Prefer the live editor's serialized markdown over the (debounced) state mirror
  // so a submit fired right after the last keystroke still captures it.
  const proseValue = (): string =>
    mdApp ? (mdApp.getState() as EditorState).value : getState().draftProse

  const reanchorModal = (): void => {
    if (!modalEl) return
    const rootRect = root.getBoundingClientRect()
    const modalW = modalEl.offsetWidth || 360
    const modalH = modalEl.offsetHeight || 320
    const anchor = computeModalAnchor(rootRect, modalW, modalH)
    modalEl.style.left = anchor.horizontal === 'left' ? '0' : 'auto'
    modalEl.style.right = anchor.horizontal === 'right' ? '0' : 'auto'
    modalEl.style.top = anchor.vertical === 'top' ? '56px' : 'auto'
    modalEl.style.bottom = anchor.vertical === 'bottom' ? '56px' : 'auto'
  }

  // The floating-button drag boundary (pointer wiring + saved-position I/O).
  const dragController = createDragController({
    root,
    isModalOpen: () => getState().modalOpen,
    reanchorModal,
  })

  const refreshContext = (): void => {
    const parts: string[] = []
    if (typeof location !== 'undefined') parts.push(location.pathname || '/')
    const info = collectComponentInfo()
    if (info?.componentMeta) parts.push(`<${info.componentMeta.name}>`)
    else if (info?.componentPath?.length) parts.push(`<${info.componentPath[0]}>`)
    if (typeof window !== 'undefined') parts.push(`${window.innerWidth}×${window.innerHeight}`)
    handle.send({ type: 'context/set', line: parts.length > 0 ? parts.join(' · ') : '' })
  }

  const open = (): void => {
    handle.send({ type: 'modal/open' })
    refreshContext()
    queueMicrotask(reanchorModal)
    queueMicrotask(() => editorApi?.focus())
  }
  const close = (): void => handle.send({ type: 'modal/close' })

  // Drawing overlay lifecycle.
  let activeOverlayDismiss: (() => void) | null = null
  let activeElementPickDismiss: (() => void) | null = null
  const dismissActiveOverlay = (): void => {
    activeOverlayDismiss?.()
    activeOverlayDismiss = null
  }
  const startRectFlow = async (): Promise<NoteRect | null> => {
    dismissActiveOverlay()
    const wasOpen = getState().modalOpen
    close()
    const result = await drawRect()
    if (wasOpen) open()
    if (result.reason === 'submit' && result.rect) {
      activeOverlayDismiss = result.dismiss
      handle.send({ type: 'attach/rect', rect: result.rect })
      return result.rect
    }
    return null
  }
  const startElementPickFlow = async (): Promise<void> => {
    activeElementPickDismiss?.()
    activeElementPickDismiss = null
    const wasOpen = getState().modalOpen
    close()
    const result = await pickElement()
    if (wasOpen) open()
    if (result.reason === 'submit' && result.element) {
      activeElementPickDismiss = result.dismiss ?? null
      handle.send({ type: 'attach/element', element: result.element })
    }
  }

  const buildAnnotations = (): Annotation[] => {
    const s = getState()
    const out: Annotation[] = []
    if (s.pendingRect) out.push({ type: 'rect', ...s.pendingRect })
    if (s.pendingElement)
      out.push({
        type: 'element',
        selector: s.pendingElement.selector,
        bbox: s.pendingElement.bbox,
      })
    return out
  }

  let defaultIntentRef: NoteIntent = solveEnabled ? 'task' : 'note'

  // The capture pipeline owns the capture → redact → bake order and the shared
  // frontmatter template for both the human (`submit`) and LLM-driven
  // (`handleCaptureRequest`) paths, so neither can skip host redaction and the
  // two frontmatters can't drift. See ./capture-pipeline.
  const capturePipeline = createCapturePipeline({
    store,
    llui,
    reproRecorder,
    getState,
    buildAnnotations,
    collectBody,
    getDefaultIntent: () => defaultIntentRef,
    notifyReproStopped: () => handle.send({ type: 'repro/set', recording: false }),
    ...(opts.capture ? { capture: opts.capture } : {}),
    ...(opts.bake ? { bake: opts.bake } : {}),
    ...(opts.redact ? { redact: opts.redact } : {}),
  })
  const { submit, handleCaptureRequest } = capturePipeline

  let chainNameSeq = 0
  const mintChainName = (): string => {
    chainNameSeq += 1
    while (getState().tasks.chains[`chain-${chainNameSeq}`]) chainNameSeq += 1
    return `chain-${chainNameSeq}`
  }

  const submitWithIntent = (intent: NoteIntent): void => {
    const prose = proseValue().trim()
    if (prose === '' && buildAnnotations().length === 0) {
      handle.send({ type: 'status/set', text: 'add text or draw a region first' })
      return
    }
    const s = getState()
    const captureLevel: CaptureLevel = s.verbose ? 'verbose' : 'standard'
    handle.send({ type: 'status/set', text: s.pendingRect ? 'capturing screenshot…' : 'sending…' })
    const chainName = intent === 'task' ? (s.tasks.selectedChain ?? mintChainName()) : undefined
    submit(prose, { intent, captureLevel, resume: true, ...(chainName ? { chainName } : {}) }).then(
      async (result) => {
        // Clearing draftProse pushes '' into the editor via the foreign value bind.
        handle.send({ type: 'setProse', value: '' })
        handle.send({ type: 'clearAttachments' })
        handle.send({ type: 'verbose/set', value: false })
        dismissActiveOverlay()
        activeElementPickDismiss?.()
        activeElementPickDismiss = null
        if (intent === 'task') {
          handle.send({
            type: 'task',
            msg: {
              type: 'task/track',
              task: {
                noteId: result.id,
                sessionId: result.sessionId,
                chainName: chainName ?? 'default',
                status: 'claimed',
              },
            },
          })
          try {
            const payload = await store.getStatus(result.id, result.sessionId)
            if (payload.current && payload.current !== 'open' && payload.current !== 'claimed') {
              const last = payload.history[payload.history.length - 1]
              handle.send({
                type: 'task',
                msg: {
                  type: 'task/status',
                  noteId: result.id,
                  to: payload.current,
                  reason: last?.reason,
                  now: Date.now(),
                },
              })
            }
          } catch {
            // best-effort; SSE picks up future transitions.
          }
        } else {
          handle.send({ type: 'status/set', text: `✓ note saved (${result.filename})` })
        }
      },
      (err: Error) => handle.send({ type: 'status/set', text: err.message }),
    )
  }

  // ── The view ───────────────────────────────────────────────────────────

  const view = ({ state, send }: SignalViewBag<HudState, HudMsg>): Renderable => [
    ...floatingButton(),
    ...modalView(state, send),
    // Toasts → portal into the fixed top-right container.
    portal(
      () => [
        each(
          state.map((s) => s.tasks.toasts),
          {
            key: (t) => t.id,
            render: (t) => toastView(t, send),
          },
        ),
      ],
      toastContainer,
    ),
  ]

  const floatingButton = (): Renderable => [
    onMount(() => {
      // Wire drag imperatively on the button after it mounts.
      const btn = root.querySelector<HTMLButtonElement>('[data-llui-fab]')
      if (btn) dragController.wire(btn)
      modalEl = root.querySelector<HTMLElement>('[data-llui-modal]')
      return undefined
    }),
    button(
      {
        type: 'button',
        'data-llui-fab': '',
        title: 'LLui annotate (Cmd+Shift+A) — drag to move',
        'aria-label': 'Open LLui annotation HUD',
        style: STYLES.button,
        // open()/close() (not a bare modal/toggle) so opening also refreshes
        // the context subhead, re-anchors the modal, and focuses the textarea.
        // `justDragged` swallows the click synthesized at the end of a drag so
        // dragging the button doesn't also toggle the modal.
        onClick: () => {
          if (dragController.justDragged()) return
          if (getState().modalOpen) close()
          else open()
        },
      },
      BUTTON_LABEL_LINES.map((line) => div({}, [text(line)])),
    ),
  ]

  const modalView = (state: Signal<HudState>, send: (m: HudMsg) => void): Renderable => {
    const parts = tabsConnectFor(state, send)
    return [
      div(
        {
          'data-llui-modal': '',
          style: STYLES.modal,
          'style.display': state.map((s) => (s.modalOpen ? 'block' : 'none')),
        },
        [
          ...headingRow(state, send),
          ...composeViewEl(state, send),
          // Browse view — the 'browse' tab panel, hosting the browse component.
          div(
            {
              ...parts.item('browse').panel,
              'style.display': state.map((s) => (s.tabs.value === 'browse' ? 'block' : 'none')),
            },
            [
              foreign({
                tag: 'div',
                mount: ({ el }) => {
                  el.appendChild(browse.el)
                  return browse
                },
                // Tear down the browse component (refresh timer + its own signal
                // component) when the HUD unmounts, so destroy() leaves nothing live.
                unmount: (b) => b.dispose(),
              }),
            ],
          ),
          div(
            {
              style: STYLES.kbdHint,
              'style.display': state.map((s) => (s.tabs.value === 'compose' ? 'flex' : 'none')),
            },
            kbdHintParts(),
          ),
        ],
      ),
    ]
  }

  const kbdHintParts = (): Renderable => {
    const kbd = (s: string): Mountable => span({ style: STYLES.kbd }, [text(s)])
    const out: Mountable[] = []
    if (solveEnabled) out.push(kbd('⌘↩'), text(' solve · '))
    out.push(kbd('⇧⌘↩'), text(' save · '), kbd('esc'), text(' cancel'))
    return out
  }

  const tabsConnectFor = (state: Signal<HudState>, send: (m: HudMsg) => void) =>
    tabs.connect(state.at('tabs'), (m) => send({ type: 'tabs', msg: m }), {
      id: 'llui-hud-tabs',
      onNavigate: (v) => {
        if (v === 'browse') browse.onShow()
      },
    })

  const tabTrigger = (
    parts: ReturnType<typeof tabsConnectFor>,
    state: Signal<HudState>,
    value: 'compose' | 'browse',
    labelText: string,
  ): Mountable =>
    button(
      {
        ...parts.item(value).trigger,
        'style.background': 'transparent',
        'style.border': '0',
        'style.padding': '0 2px',
        'style.cursor': 'pointer',
        'style.font': 'inherit',
        'style.fontSize': '12px',
        'style.color': state.map((s) =>
          s.tabs.value === value ? 'var(--hud-fg)' : 'var(--hud-fg-muted)',
        ),
        'style.textDecoration': state.map((s) => (s.tabs.value === value ? 'none' : 'underline')),
        'style.fontWeight': state.map((s) => (s.tabs.value === value ? '600' : '400')),
      },
      [text(labelText)],
    )

  const headingRow = (state: Signal<HudState>, send: (m: HudMsg) => void): Renderable => {
    const parts = tabsConnectFor(state, send)
    return [
      div(
        {
          'style.display': 'flex',
          'style.justifyContent': 'flex-end',
          'style.alignItems': 'center',
          'style.minHeight': '18px',
          'style.marginBottom': '4px',
        },
        [
          div(
            {
              ...parts.list,
              'style.display': 'flex',
              'style.gap': '8px',
              'style.marginRight': 'auto',
            },
            [
              tabTrigger(parts, state, 'compose', 'New note'),
              tabTrigger(parts, state, 'browse', 'Browse notes'),
            ],
          ),
          span({ 'style.display': 'flex', 'style.gap': '4px', 'style.alignItems': 'center' }, [
            ...badge(state, 'working'),
            ...badge(state, 'ready'),
          ]),
        ],
      ),
    ]
  }

  const badge = (state: Signal<HudState>, which: 'working' | 'ready'): Renderable => {
    const count = state.map((s) => queueCounts(s.tasks)[which])
    const styleBase = which === 'working' ? STYLES.queueBadge : STYLES.queueBadgeReady
    return [
      span(
        {
          'data-llui-badge': which,
          style: styleBase,
          'style.display': count.map((n) => (n > 0 ? 'inline-block' : 'none')),
        },
        [text(count.map((n) => (which === 'working' ? `🤖 ${n} working` : `✓ ${n} ready`)))],
      ),
    ]
  }

  const composeViewEl = (state: Signal<HudState>, send: (m: HudMsg) => void): Renderable => {
    const parts = tabsConnectFor(state, send)
    return [
      div(
        {
          ...parts.item('compose').panel,
          'data-llui-view': 'compose',
          'style.display': state.map((s) => (s.tabs.value === 'compose' ? 'flex' : 'none')),
          'style.flexDirection': 'column',
          'style.gap': '0',
        },
        [
          // context subhead
          div(
            {
              style: STYLES.contextSubhead,
              'style.display': state.map((s) => (s.contextLine ? 'block' : 'none')),
            },
            [text(state.map((s) => s.contextLine))],
          ),
          // lineage
          div(
            {
              'data-llui-lineage': '',
              style: STYLES.contextSubhead + '; color: var(--hud-accent-fg); margin-top: -6px;',
              'style.display': state.map((s) => (lineageText(s.tasks) ? 'block' : 'none')),
            },
            [text(state.map((s) => lineageText(s.tasks)))],
          ),
          ...attachmentRow(state, send),
          ...editorForeign(state, send),
          div({ style: STYLES.markdownHint }, [
            text('Rich editor · select text to format · '),
            span({ 'style.fontFamily': 'ui-monospace,SFMono-Regular,monospace' }, [text('/')]),
            text(' for commands · '),
            span({ 'style.fontFamily': 'ui-monospace,SFMono-Regular,monospace' }, [text('⌘↵')]),
            text(' to submit'),
          ]),
          ...moreOptions(state, send),
          div({ 'data-llui-status': '', style: STYLES.status }, [
            text(state.map((s) => s.statusLine)),
          ]),
          ...actionsRow(state, send),
        ],
      ),
    ]
  }

  const attachmentRow = (state: Signal<HudState>, send: (m: HudMsg) => void): Renderable => [
    div({ style: STYLES.attachmentRow }, [
      // Add region / region chip
      show(
        state.map((s) => s.pendingRect),
        (rect) => [
          span(
            {
              style: STYLES.regionChip,
              'style.display': 'inline-flex',
              onClick: () => void startRectFlow(),
            },
            [
              span({}, [text(rect.map((r) => `⌖ ${r.w}×${r.h}`))]),
              button(
                {
                  type: 'button',
                  title: 'Remove region',
                  style: STYLES.regionChipClose,
                  onClick: (e: Event) => {
                    e.stopPropagation()
                    dismissActiveOverlay()
                    send({ type: 'attach/rect', rect: null })
                  },
                },
                [text('×')],
              ),
            ],
          ),
        ],
        // No region attached → offer "Add region", but only while no
        // element is attached either (the two attachments are mutually
        // exclusive until submitted or cleared).
        () => [
          show(
            state.map((s) => (s.pendingElement ? null : true)),
            () => [
              button(
                {
                  type: 'button',
                  title: 'Draw a rectangle on the page to attach to this note',
                  style: STYLES.inlineActionBtn,
                  onClick: () => void startRectFlow(),
                },
                [text('⌖ Add region')],
              ),
            ],
          ),
        ],
      ),
      // Pick element / element chip (when enabled)
      ...(elementPickEnabled
        ? [
            show(
              state.map((s) => s.pendingElement),
              (pe) => [
                span(
                  {
                    style: STYLES.regionChip,
                    'style.display': 'inline-flex',
                    title: pe.map((p) => p.selector),
                    onClick: () => void startElementPickFlow(),
                  },
                  [
                    span({}, [
                      text(pe.map((p) => `⌖ ${p.selector.split('>').pop()?.trim() ?? p.selector}`)),
                    ]),
                    button(
                      {
                        type: 'button',
                        title: 'Remove element pick',
                        style: STYLES.regionChipClose,
                        onClick: (e: Event) => {
                          e.stopPropagation()
                          activeElementPickDismiss?.()
                          activeElementPickDismiss = null
                          send({ type: 'attach/element', element: null })
                        },
                      },
                      [text('×')],
                    ),
                  ],
                ),
              ],
              // No element attached → offer "Pick element", but only while
              // no region is attached either.
              () => [
                show(
                  state.map((s) => (s.pendingRect ? null : true)),
                  () => [
                    button(
                      {
                        type: 'button',
                        title: 'Click an element on the page to attach it to this note',
                        style: STYLES.inlineActionBtn,
                        onClick: () => void startElementPickFlow(),
                      },
                      [text('⌖ Pick element')],
                    ),
                  ],
                ),
              ],
            ),
          ]
        : []),
    ]),
  ]

  // The prose field is a real `markdownEditor()` (WYSIWYG, hides the Markdown).
  // It's mounted as a nested app inside a `foreign` host so the surrounding HUD
  // stays one TEA component. Formatting (bold/italic/code/lists/links) is the
  // editor's job — its floating selection toolbar + Markdown shortcuts replace the
  // old hand-rolled toolbar. Cmd/Ctrl+Enter submits (plain Enter is a newline).
  interface EditorInst {
    app: ReturnType<typeof mountSignalComponent>
    unbind: () => void
    onKey: (e: KeyboardEvent) => void
    host: HTMLElement
  }
  const editorForeign = (state: Signal<HudState>, send: (m: HudMsg) => void): Renderable => [
    foreign<EditorInst, { value: Signal<string> }>({
      tag: 'div',
      state: { value: state.at('draftProse') },
      mount: ({ el, state: { value } }) => {
        const host = el as HTMLElement
        host.setAttribute('data-llui-editor', '')
        host.style.cssText = STYLES.editorHost
        let last = value.peek()
        const app = mountSignalComponent(
          host,
          markdownEditor({
            defaultValue: last,
            placeholder: 'Describe the issue…',
            // Near-synchronous so a quick Solve click captures the last keystrokes.
            changeDebounceMs: 50,
            plugins: [corePlugin(), linkPlugin(), floatingToolbarPlugin(), slashPlugin()],
            onChange: (md) => {
              last = md
              send({ type: 'setProse', value: md })
            },
            onReady: (ed) => {
              editorApi = ed
            },
          }),
          // Keep the HUD's own editor out of the global __lluiComponents registry
          // so it never pollutes the app component-info / debug snapshots the HUD
          // collects (the HUD itself mounts with devtools:false for the same reason).
          { devtools: false },
        )
        mdApp = app
        // External pushes (persistence restore, clear-on-submit) → into the editor,
        // echo-guarded against our own onChange round-trips.
        const unbind = value.bind((v) => {
          if (v === last) return
          last = v
          app.send({ type: 'setValue', value: v })
        })
        const onKey = (e: KeyboardEvent): void => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submitWithIntent(e.shiftKey || !solveEnabled ? 'note' : 'task')
          }
        }
        host.addEventListener('keydown', onKey, true)
        return { app, unbind, onKey, host }
      },
      unmount: (inst) => {
        inst.host.removeEventListener('keydown', inst.onKey, true)
        inst.unbind()
        inst.app.dispose()
        if (mdApp === inst.app) mdApp = null
        editorApi = null
      },
    }),
  ]

  const moreOptions = (state: Signal<HudState>, send: (m: HudMsg) => void): Renderable => {
    const parts = collapsible.connect(
      state.at('moreOptions'),
      (m) => send({ type: 'moreOptions', msg: m }),
      { id: 'llui-more-options' },
    )
    return [
      button({ ...parts.trigger, style: STYLES.moreOptionsToggle }, [
        text(state.map((s) => (s.moreOptions.open ? '▾ More options' : '▸ More options'))),
      ]),
      div(
        {
          ...parts.content,
          style: STYLES.moreOptionsBody,
          'style.display': state.map((s) => (s.moreOptions.open ? 'block' : 'none')),
        },
        [
          label({ style: STYLES.moreOptionsRow + '; cursor: pointer;' }, [
            input({
              type: 'checkbox',
              'style.margin': '0',
              checked: state.map((s) => s.verbose),
              onChange: (e: Event) =>
                send({ type: 'verbose/set', value: (e.currentTarget as HTMLInputElement).checked }),
            }),
            span({}, [text('Include verbose telemetry (state, message log, DOM snapshot)')]),
          ]),
          ...(reproEnabled
            ? [
                div({ style: STYLES.moreOptionsRow + '; margin-top: 6px;' }, [
                  button(
                    {
                      type: 'button',
                      style: reproBtnStyle(false),
                      'style.borderColor': state.map((s) =>
                        s.reproRecording
                          ? 'var(--hud-toast-border-fail)'
                          : 'var(--hud-border-strong)',
                      ),
                      'style.color': state.map((s) =>
                        s.reproRecording ? 'var(--hud-toast-border-fail)' : 'var(--hud-fg-muted)',
                      ),
                      onClick: (e: Event) => {
                        e.preventDefault()
                        send({ type: 'repro/toggle' })
                      },
                    },
                    [
                      text(
                        state.map((s) =>
                          s.reproRecording ? '■ Stop recording' : '● Start recording',
                        ),
                      ),
                    ],
                  ),
                  span({ 'style.color': 'var(--hud-fg-subtle)', 'style.fontSize': '11px' }, [
                    text(
                      state.map((s) =>
                        s.reproRecording
                          ? 'capturing clicks, inputs, route changes…'
                          : 'attaches a click+input trail for the LLM to replay',
                      ),
                    ),
                  ]),
                ]),
              ]
            : []),
        ],
      ),
    ]
  }

  const reproBtnStyle = (_recording: boolean): string =>
    [
      'display: inline-flex',
      'align-items: center',
      'gap: 4px',
      'padding: 3px 8px',
      'border-radius: 4px',
      'border: 1px solid var(--hud-border-strong)',
      'background: transparent',
      'cursor: pointer',
      'font: inherit',
      'font-size: 11px',
    ].join('; ')

  const actionsRow = (state: Signal<HudState>, send: (m: HudMsg) => void): Renderable => [
    div({ style: STYLES.actions }, [
      button(
        {
          type: 'button',
          style: btnStyle('ghost'),
          onClick: () => {
            dismissActiveOverlay()
            activeElementPickDismiss?.()
            activeElementPickDismiss = null
            send({ type: 'clearAttachments' })
            close()
          },
        },
        [text('Cancel')],
      ),
      button(
        {
          type: 'button',
          title: 'Just save the note for reference (intent: note)',
          style: solveEnabled ? btnStyle('secondary') : btnStyle('primary'),
          onClick: () => submitWithIntent('note'),
        },
        [text('Save note')],
      ),
      ...(solveEnabled ? solveSplit(state, send) : []),
    ]),
  ]

  const solveSplit = (state: Signal<HudState>, send: (m: HudMsg) => void): Renderable => {
    const parts = menu.connect(state.at('solveMenu'), (m) => send({ type: 'solveMenu', msg: m }), {
      id: 'llui-solve-menu',
      onSelect: (v) => send({ type: 'chain/select', name: v === SOLVE_FRESH ? null : v }),
    })
    return [
      div({ 'data-llui-solve-split': '', style: SPLIT_BTN_STYLES.container }, [
        button(
          {
            type: 'button',
            'data-llui-solve': '',
            style: SPLIT_BTN_STYLES.main,
            title: state.map((s) => {
              const c = s.tasks.selectedChain ? s.tasks.chains[s.tasks.selectedChain] : null
              return c
                ? `Solve, resuming "${c.summary}" (⌘↩)`
                : 'Solve, starting a fresh conversation (⌘↩)'
            }),
            onClick: () => submitWithIntent('task'),
          },
          [
            span(
              {
                style: RESUME_GLYPH_STYLE,
                'style.display': state.map((s) =>
                  s.tasks.selectedChain && s.tasks.chains[s.tasks.selectedChain]
                    ? 'inline-flex'
                    : 'none',
                ),
              },
              [text('↻')],
            ),
            span({}, [text('Solve')]),
          ],
        ),
        button(
          {
            ...parts.trigger,
            title: 'Resume options',
            style: SPLIT_BTN_STYLES.caret,
            'style.display': state.map((s) =>
              Object.keys(s.tasks.chains).length > 0 ? 'inline-flex' : 'none',
            ),
          },
          [text('▾')],
        ),
      ]),
      menu.overlay({
        state: state.at('solveMenu'),
        send: (m) => send({ type: 'solveMenu', msg: m }),
        parts,
        placement: 'bottom-end',
        ...(overlayHost ? { target: overlayHost } : {}),
        content: () => [
          div({ ...parts.content, style: SPLIT_BTN_STYLES.menu, 'style.display': 'flex' }, [
            div(
              {
                'style.padding': '4px 8px 2px',
                'style.fontSize': '10px',
                'style.color': 'var(--hud-fg-subtle)',
                'style.textTransform': 'uppercase',
                'style.letterSpacing': '0.5px',
              },
              [text('Resume chain')],
            ),
            each(
              state.map((s) =>
                Object.values(s.tasks.chains)
                  .slice()
                  .sort((a, b) => b.ts - a.ts)
                  .map((c) => c.name),
              ),
              {
                key: (name) => name,
                render: (nameSig) => {
                  const name = nameSig.peek()
                  return [
                    button({ ...parts.item(name).item, style: SPLIT_BTN_STYLES.menuItem }, [
                      text(
                        state.map((s) => {
                          const entry = s.tasks.chains[name]
                          const active = s.tasks.selectedChain === name
                          const summary = entry?.summary || `(no summary — task ${name})`
                          return `${active ? '● ' : '○ '}${summary}`
                        }),
                      ),
                    ]),
                  ]
                },
              },
            ),
            div(
              {
                'style.height': '1px',
                'style.background': 'var(--hud-border)',
                'style.margin': '4px 6px',
              },
              [],
            ),
            button({ ...parts.item(SOLVE_FRESH).item, style: SPLIT_BTN_STYLES.menuItem }, [
              text(
                state.map((s) =>
                  s.tasks.selectedChain === null ? '● Start fresh' : '○ Start fresh',
                ),
              ),
            ]),
          ]),
        ],
      }),
    ]
  }

  const toastView = (t: Signal<Toast>, send: (m: HudMsg) => void): Renderable => {
    const border = (kind: Toast['kind']): string =>
      kind === 'ok'
        ? STYLES.toastBorderOk
        : kind === 'fail'
          ? STYLES.toastBorderFail
          : STYLES.toastBorderInfo
    return [
      div(
        {
          'data-llui-toast': t.map((x) => x.kind),
          style: t.map((x) => STYLES.toast + ';' + border(x.kind)),
          onClick: () => send({ type: 'task', msg: { type: 'toast/dismiss', id: t.peek().id } }),
        },
        [
          div({ 'style.flex': '1', 'style.minWidth': '0', 'style.wordBreak': 'break-word' }, [
            text(t.map((x) => x.body)),
          ]),
          each(
            t.map((x) => x.actions),
            {
              key: (a) => a.label,
              render: (a) => [
                button(
                  {
                    type: 'button',
                    style: a.map(
                      (x) => btnStyle(x.variant) + '; padding: 4px 10px; font-size: 12px;',
                    ),
                    onClick: (e: Event) => {
                      e.stopPropagation()
                      const action: ToastAction = a.peek()
                      send({ type: 'task', msg: action.msg })
                      send({ type: 'task', msg: { type: 'toast/dismiss', id: t.peek().id } })
                    },
                  },
                  [text(a.map((x) => x.label))],
                ),
              ],
            },
          ),
          span(
            {
              'style.color': '#888',
              'style.fontSize': '16px',
              'style.lineHeight': '1',
              'style.padding': '0 2px',
              'style.cursor': 'pointer',
              'style.userSelect': 'none',
            },
            [text('×')],
          ),
        ],
      ),
    ]
  }

  // ── Pre-mount controllers (own timers; referenced by onEffect) ─────────
  // Created BEFORE the mount call so the effect handler references these live
  // objects (persistence, ticker) instead of bindings declared further down —
  // the fix for the old temporal-dead-zone hazard where `onEffect` referenced
  // `schedulePersist` / `progressTickInterval` declared below and only worked
  // by accident of first-send timing. They close over `handle` (declared just
  // below) but only touch it when their methods run, well after mount.

  // Progress ticker — a 1s interval that pulses task/tick while a task works.
  let progressTickInterval: ReturnType<typeof setInterval> | null = null
  const ticker = {
    start(): void {
      if (!progressTickInterval)
        progressTickInterval = setInterval(
          () => handle.send({ type: 'task', msg: { type: 'task/tick', now: Date.now() } }),
          1000,
        )
    },
    stop(): void {
      if (progressTickInterval) {
        clearInterval(progressTickInterval)
        progressTickInterval = null
      }
    },
  }

  // Debounced localStorage mirror of the durable HUD state (see ./persistence).
  const persistence = createPersistence(getState)

  // ── Mount ────────────────────────────────────────────────────────────

  const handle = mountSignalComponent<HudState, HudMsg, HudEffect>(
    root,
    component<HudState, HudMsg, HudEffect>({
      name: 'llui-devmode-annotate:hud',
      init: initHud(solveEnabled),
      update: reduceHud,
      view,
      onEffect: (eff) => {
        switch (eff.type) {
          case 'persist':
            persistence.schedule()
            return
          case 'postStatus':
            void store
              .postStatus(eff.noteId, eff.sessionId, { to: eff.to, by: 'human' })
              .catch(() => {
                handle.send({ type: 'status/set', text: `${eff.to} failed for ${eff.noteId}` })
              })
            return
          case 'startTicker':
            ticker.start()
            return
          case 'stopTicker':
            ticker.stop()
            return
          case 'reproStart':
            reproRecorder.start()
            return
          case 'reproStop':
            reproRecorder.stop()
            return
        }
      },
    }),
    { devtools: false },
  )
  ;(idEl as HTMLElement & { _lluiHandle?: AnnotateHudHandle })._lluiHandle = undefined

  // Now that the editor foreign has mounted, query the modal ref.
  modalEl = root.querySelector<HTMLElement>('[data-llui-modal]')

  // ── Restore persisted state ────────────────────────────────────────
  const persisted = persistence.read()
  if (persisted.draftProse) {
    // setProse → state.draftProse → the editor foreign's value.bind → setValue.
    handle.send({ type: 'setProse', value: persisted.draftProse })
  }
  if (persisted.selectedResumeChain !== undefined && persisted.selectedResumeChain !== null) {
    handle.send({ type: 'chain/select', name: persisted.selectedResumeChain })
  }
  if (persisted.view === 'browse') {
    handle.send({ type: 'tabs', msg: { type: 'setValue', value: 'browse' } })
    browse.onShow()
  }
  if (persisted.modalOpen) queueMicrotask(() => open())

  // ── Auto-dismiss toasts (subscribe-based scheduler — keeps reducer pure) ──
  // Map (not a bare Set) so every pending dismiss timer is tracked by toast id:
  // destroy() can clear them all, and a toast that's dismissed early prunes its
  // own timer instead of leaking it + growing the id set unboundedly.
  const toastTimeouts = new Map<number, ReturnType<typeof setTimeout>>()
  handle.subscribe((s) => {
    const liveIds = new Set(s.tasks.toasts.map((t) => t.id))
    for (const [id, timer] of toastTimeouts) {
      if (!liveIds.has(id)) {
        clearTimeout(timer)
        toastTimeouts.delete(id)
      }
    }
    for (const t of s.tasks.toasts) {
      if (toastTimeouts.has(t.id)) continue
      if (t.kind !== 'fail' && t.actions.length === 0) {
        const timer = setTimeout(() => {
          toastTimeouts.delete(t.id)
          handle.send({ type: 'task', msg: { type: 'toast/dismiss', id: t.id } })
        }, 8000)
        toastTimeouts.set(t.id, timer)
      }
    }
  })

  // ── Rehydrate ────────────────────────────────────────────────────────
  const rehydrateFromServer = async (): Promise<void> => {
    try {
      const { sessionId } = await store.currentSession()
      if (!sessionId) return
      const [notesData, queueData] = await Promise.all([
        store.listNotes({ sessionId }),
        store.getQueue(sessionId),
      ])
      const byId = new Map(notesData.notes.map((n) => [n.id, n]))
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
        if (
          entry.status === 'open' ||
          entry.status === 'claimed' ||
          entry.status === 'in-progress'
        ) {
          handle.send({
            type: 'task',
            msg: {
              type: 'task/track',
              task: { noteId: task.id, sessionId, chainName, status: entry.status },
            },
          })
        } else if (entry.status === 'proposed') {
          handle.send({
            type: 'task',
            msg: {
              type: 'task/track',
              task: { noteId: task.id, sessionId, chainName, status: 'claimed' },
            },
          })
          handle.send({
            type: 'task',
            msg: {
              type: 'task/status',
              noteId: task.id,
              to: 'proposed',
              reason: reply?.proposedSummary ?? 'proposed fix ready',
              now: new Date(reply?.ts ?? task.ts).getTime(),
            },
          })
        }
      }
    } catch (err) {
      console.warn('[llui:devmode-annotate] rehydrate failed:', err)
    }
  }
  if (opts.rehydrate === true) void rehydrateFromServer()

  // ── Live events ───────────────────────────────────────────────────────
  const subscribeEvents = opts.subscribeEvents ?? !isAutomatedBrowser()
  let unsubscribeEvents: (() => void) | null = null
  if (subscribeEvents) {
    unsubscribeEvents = store.subscribeEvents({
      role: 'hud',
      onError: (err) => console.warn('[llui:devmode-annotate] event subscription failed:', err),
      onEvent: (parsed) => {
        if (parsed.type === 'capture-request') {
          void handleCaptureRequest(parsed.requestId, parsed.payload ?? {}).catch((err) =>
            console.warn('[llui:devmode-annotate] capture-request failed:', err),
          )
          return
        }
        if (parsed.type === 'status-changed') {
          handle.send({
            type: 'task',
            msg: {
              type: 'task/status',
              noteId: parsed.noteId,
              to: parsed.to,
              reason: parsed.reason,
              now: Date.now(),
            },
          })
          browse.refresh()
          return
        }
        if (parsed.type === 'task-progress') {
          handle.send({
            type: 'task',
            msg: {
              type: 'task/progress',
              noteId: parsed.noteId,
              ...(parsed.elapsedMs !== undefined ? { elapsedMs: parsed.elapsedMs } : {}),
              ...(parsed.tokens ? { tokens: parsed.tokens } : {}),
              ...(parsed.toolSummary ? { toolSummary: parsed.toolSummary } : {}),
              now: Date.now(),
            },
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
      },
    })
  }

  // ── Global keyboard + window listeners ────────────────────────────────
  const onKey = (e: KeyboardEvent): void => {
    // Only act on Escape when the modal is actually open and the event hasn't
    // already been handled (e.g. by an overlay/menu that closed on Escape).
    // Otherwise every Escape anywhere in the app dispatches a close + persist.
    if (e.key === 'Escape' && !e.defaultPrevented && getState().modalOpen) close()
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      open()
    }
  }
  document.addEventListener('keydown', onKey)

  const onResize = (): void => {
    if (getState().modalOpen) {
      refreshContext()
      reanchorModal()
    }
    const current = readSavedPosition()
    if (current) applySavedPosition(root, current)
  }
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize)

  // ── Auto-capture on uncaught error ────────────────────────────────────
  const autoCapture = installAutoCapture({
    enabled: opts.autoCaptureOnError !== false,
    proseValue,
    setProse: (value) => handle.send({ type: 'setProse', value }),
    open,
  })

  // ── Teardown registry ──────────────────────────────────────────────────
  // Every timer/listener/subscription/nested-app/DOM node registers its
  // teardown here, in the order the original destroy() ran them (the component
  // + DOM removal last). `destroy()` folds over the registry.
  disposers.add(() => document.removeEventListener('keydown', onKey))
  disposers.add(() => {
    if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
  })
  disposers.add(() => autoCapture.dispose())
  disposers.add(() => ticker.stop())
  disposers.add(() => persistence.dispose())
  disposers.add(() => {
    for (const timer of toastTimeouts.values()) clearTimeout(timer)
    toastTimeouts.clear()
  })
  disposers.add(() => unsubscribeEvents?.())
  disposers.add(() => reproRecorder.stop())
  disposers.add(() => consoleCapture?.dispose())
  disposers.add(() => dismissActiveOverlay())
  disposers.add(() => {
    // The element picker installs capture-phase document listeners; leaking
    // them leaves the host click-dead, so tear the lingering pick down too.
    activeElementPickDismiss?.()
    activeElementPickDismiss = null
  })
  disposers.add(() => handle.dispose())
  disposers.add(() => {
    if (shadowHost) {
      // Removing the host tears down its shadow root (root + toasts).
      shadowHost.remove()
    } else {
      root.remove()
      toastContainer.remove()
    }
  })

  // ── Handle ────────────────────────────────────────────────────────────
  const destroy = (): void => disposers.dispose()

  const publicHandle: AnnotateHudHandle = {
    open,
    close,
    destroy,
    setProse: (text) => handle.send({ type: 'setProse', value: text }),
    submit,
    drawRect: startRectFlow,
    handleCaptureRequest,
    setIntent: (i) => {
      defaultIntentRef = i
      handle.send({ type: 'intent/set', intent: i })
    },
    replayRepro: replayReproEvents,
    exportBundle: exportNotesBundle,
  }
  ;(idEl as HTMLElement & { _lluiHandle?: AnnotateHudHandle })._lluiHandle = publicHandle
  return publicHandle
}

function noopHandle(): AnnotateHudHandle {
  const noop = (): void => {}
  const rejectNotMounted = (): Promise<never> =>
    Promise.reject(new Error('devmode-annotate: HUD not mounted (not dev mode)'))
  return {
    open: noop,
    close: noop,
    destroy: noop,
    setProse: noop,
    submit: rejectNotMounted,
    drawRect: () => Promise.resolve(null),
    handleCaptureRequest: rejectNotMounted,
    setIntent: noop,
    replayRepro: () => Promise.resolve({ applied: 0, skipped: [] }),
    exportBundle: () => Promise.resolve(null),
  }
}
