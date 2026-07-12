// The capture pipeline — the single place every screenshot-bearing note routes
// through, for both the human (`submit`) and LLM-driven (`handleCaptureRequest`)
// paths. Owns the capture → redact → bake order (so neither path can skip host
// redaction) and the shared frontmatter template.

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
} from './note-types.js'
import { bakeAnnotations } from './bake.js'
import { deriveKind } from './hud-core.js'
import type { NotesStore } from './notes-store.js'
import { redactRepro, redactScreenshot, type RedactHooks } from './redact.js'
import { collectComponentInfo, type ComponentInfoSnapshot } from './debug-collector.js'
import { captureScreenshot, describeCaptureError, type CaptureFn } from './screenshot.js'
import type { ReproRecorderHandle } from './repro-recorder.js'

/** Geometry threaded from the capture into the annotation baker so viewport
 *  (CSS-px, scroll-relative) annotation coordinates land correctly on the
 *  full-document, DPR-scaled screenshot raster. */
export interface ScreenshotGeometry {
  /** Device pixel ratio the screenshot was captured at (frontmatter viewport.dpr). */
  dpr: number
  /** Viewport scroll offset (CSS px) at capture time. */
  scrollX: number
  scrollY: number
}

export type BakeFn = (
  screenshotBase64: string,
  annotations: Annotation[],
  geometry?: ScreenshotGeometry,
) => Promise<string>

/** The frontmatter fields that vary between capture paths; the rest of the
 *  template (url, viewport, component info, agentSchemas, llui) is filled once
 *  here so the two call sites can't drift. */
interface FrontmatterParams {
  author: NoteFrontmatter['author']
  kind: NoteKind
  captureLevel: CaptureLevel
  annotations: Annotation[]
  /** Pre-resolved screenshot filename sentinel ('placeholder.png') or null. */
  screenshot: string | null
  llui: { runtime: string; compiler: string }
  /** Collected once by the caller and threaded in (avoids calling
   *  `collectComponentInfo()` twice per build). */
  compInfo: ComponentInfoSnapshot | null
  intent?: NoteIntent
  resume?: boolean
  chainName?: string
  fulfillsRequestId?: string
}

/** Build the note frontmatter shared by the human + LLM capture paths. Optional
 *  fields are inserted in the exact positions the two paths used, so the
 *  serialized output stays byte-identical to the pre-refactor templates. */
function buildFrontmatter(p: FrontmatterParams): Omit<NoteFrontmatter, 'id' | 'ts'> {
  return {
    author: p.author,
    kind: p.kind,
    captureLevel: p.captureLevel,
    url: typeof location !== 'undefined' ? location.href : '',
    route: null,
    routeParams: {},
    viewport: {
      w: typeof window !== 'undefined' ? window.innerWidth : 0,
      h: typeof window !== 'undefined' ? window.innerHeight : 0,
      dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    },
    componentPath: p.compInfo?.componentPath ?? null,
    componentMeta: p.compInfo?.componentMeta ?? null,
    annotations: p.annotations,
    ...(p.intent !== undefined ? { intent: p.intent } : {}),
    ...(p.resume !== undefined ? { resume: p.resume } : {}),
    ...(p.chainName ? { chainName: p.chainName } : {}),
    screenshot: p.screenshot,
    agentSchemas: [],
    llui: p.llui,
    ...(p.fulfillsRequestId !== undefined ? { fulfillsRequestId: p.fulfillsRequestId } : {}),
  }
}

/** Minimal live-state read the human submit path needs to derive the note kind. */
export interface SubmitStateSource {
  pendingElement: { selector: string; bbox: NoteRect } | null
  pendingRect: NoteRect | null
}

export interface CapturePipelineDeps {
  store: NotesStore
  llui: { runtime: string; compiler: string }
  reproRecorder: ReproRecorderHandle
  /** Read the pending attachments (for the derived note kind). */
  getState: () => SubmitStateSource
  /** Current annotations built from pending attachments. */
  buildAnnotations: () => Annotation[]
  /** Build the (privacy-gated, redacted) note body for a capture. */
  collectBody: (annotations: Annotation[], level: CaptureLevel) => NoteBody
  /** The active default intent (mutable via the handle's `setIntent`). */
  getDefaultIntent: () => NoteIntent
  /** Notify the HUD that the repro recorder was stopped after a successful
   *  submit (so the UI toggle reflects it). */
  notifyReproStopped: () => void
  capture?: CaptureFn
  bake?: BakeFn
  redact?: RedactHooks
}

export interface CapturePipeline {
  /** Capture → redact → bake, in that order. Returns the base64 screenshot (no
   *  data: prefix) or undefined when the redactor drops it. */
  captureRedactBake(annotations: Annotation[]): Promise<string | undefined>
  submit(prose: string, opts?: SubmitOptions): Promise<CreateNoteResponse>
  handleCaptureRequest(
    requestId: string,
    payload: CaptureRequestPayload,
  ): Promise<CreateNoteResponse>
}

export interface SubmitOptions {
  captureLevel?: CaptureLevel
  annotations?: Annotation[]
  screenshot?: string
  intent?: NoteIntent
  resume?: boolean
  chainName?: string
}

export function createCapturePipeline(deps: CapturePipelineDeps): CapturePipeline {
  const {
    store,
    llui,
    reproRecorder,
    getState,
    buildAnnotations,
    collectBody,
    getDefaultIntent,
    notifyReproStopped,
    capture,
    bake: bakeOpt,
    redact,
  } = deps

  // Capture → redact → bake, in that order. The host screenshot redactor masks
  // sensitive page regions on the RAW capture, BEFORE annotation labels are
  // composited on top — so the redactor sees page content (not a composite),
  // annotations aren't masked away, and `null` from the redactor drops the
  // screenshot entirely. Used by both the human (`submit`) and LLM-driven
  // capture paths so neither can skip redaction.
  const captureRedactBake = async (annotations: Annotation[]): Promise<string | undefined> => {
    const raw = await captureScreenshot({ ...(capture ? { capture } : {}) })
    const rawB64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw
    const redacted = redactScreenshot(rawB64, redact?.screenshot)
    if (redacted === null) return undefined
    if (annotations.length === 0) return redacted
    const bake = bakeOpt ?? bakeAnnotations
    // Thread the true capture geometry so annotations map viewport→document
    // space correctly on scrolled / retina pages.
    const geometry: ScreenshotGeometry = {
      dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      scrollX: typeof window !== 'undefined' ? window.scrollX || 0 : 0,
      scrollY: typeof window !== 'undefined' ? window.scrollY || 0 : 0,
    }
    const baked = await bake(redacted, annotations, geometry)
    return baked.startsWith('data:') ? baked.slice(baked.indexOf(',') + 1) : baked
  }

  const submit = async (
    prose: string,
    submitOpts: SubmitOptions = {},
  ): Promise<CreateNoteResponse> => {
    const s = getState()
    const annotations = submitOpts.annotations ?? buildAnnotations()
    let screenshotBase64 = submitOpts.screenshot
    let kind: NoteKind = deriveKind(s.pendingElement, s.pendingRect) as NoteKind
    if (submitOpts.annotations && submitOpts.annotations.length > 0) {
      const first = submitOpts.annotations[0]!
      kind = first.type === 'rect' ? 'rect' : 'capture'
    }

    if (annotations.length > 0 && !screenshotBase64) {
      try {
        screenshotBase64 = await captureRedactBake(annotations)
      } catch (err) {
        throw new Error(`devmode-annotate: screenshot failed — ${describeCaptureError(err)}`, {
          cause: err,
        })
      }
    } else if (screenshotBase64) {
      // A screenshot supplied directly (not captured here) — still redact
      // before persist.
      screenshotBase64 = redactScreenshot(screenshotBase64, redact?.screenshot) ?? undefined
    }

    const compInfo = collectComponentInfo()
    const intent: NoteIntent = submitOpts.intent ?? getDefaultIntent()
    const resume: boolean | undefined = intent === 'task' ? (submitOpts.resume ?? true) : undefined
    const frontmatter = buildFrontmatter({
      author: 'human',
      kind,
      captureLevel: submitOpts.captureLevel ?? 'standard',
      annotations,
      screenshot: screenshotBase64 ? 'placeholder.png' : null,
      llui,
      compInfo,
      intent,
      ...(resume !== undefined ? { resume } : {}),
      ...(submitOpts.chainName ? { chainName: submitOpts.chainName } : {}),
    })
    const noteBody = collectBody(annotations, submitOpts.captureLevel ?? 'standard')
    // Read the repro trace WITHOUT clearing it — if the POST below fails, the
    // buffer must survive so the user can retry (or the trace isn't silently
    // lost). It's drained + the recorder stopped only in the success path.
    const reproEvents = redactRepro(reproRecorder.peek(), redact?.repro)
    if (reproEvents.length > 0) noteBody.repro = reproEvents
    const body: CreateNoteRequest = {
      body: prose,
      frontmatter,
      noteBody,
      ...(screenshotBase64 ? { screenshot: screenshotBase64 } : {}),
    }
    const response = await store.createNote(body)
    // Persist succeeded — now it's safe to drain the recorder + stop it.
    reproRecorder.flush()
    if (reproRecorder.isRecording()) {
      reproRecorder.stop()
      notifyReproStopped()
    }
    return response
  }

  const handleCaptureRequest = async (
    requestId: string,
    payload: CaptureRequestPayload,
  ): Promise<CreateNoteResponse> => {
    const prose = payload.prose ?? ''
    const annotations: Annotation[] = payload.annotate ?? []
    const level: CaptureLevel = payload.captureLevel ?? 'standard'
    let screenshotBase64: string | undefined
    // Collected once and threaded into both the failure and success frontmatters.
    const compInfo = collectComponentInfo()
    const baseFrontmatter = (screenshot: string | null): Omit<NoteFrontmatter, 'id' | 'ts'> =>
      buildFrontmatter({
        author: 'llm',
        kind: 'capture',
        captureLevel: payload.captureLevel ?? 'standard',
        annotations,
        screenshot,
        llui,
        compInfo,
        fulfillsRequestId: requestId,
      })

    try {
      // Same capture → redact → bake path as the human flow, so an
      // LLM-requested capture can't skip host screenshot redaction.
      screenshotBase64 = await captureRedactBake(annotations)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const failBody: CreateNoteRequest = {
        body: `[capture failed: ${message}]${prose ? `\n\n${prose}` : ''}`,
        frontmatter: baseFrontmatter(null),
        noteBody: collectBody(annotations, level),
      }
      try {
        return await store.createNote(failBody)
      } catch (postErr) {
        throw new Error(`devmode-annotate: failed to record capture failure`, { cause: postErr })
      }
    }

    // No second redaction here: `captureRedactBake` already redacted the
    // RAW capture before baking annotations on top. Re-running the hook on
    // the baked composite would let a coordinate-mask re-cover the fresh
    // annotation labels, or a `null` return silently drop a screenshot that
    // already passed redaction.
    const body: CreateNoteRequest = {
      body: prose,
      frontmatter: baseFrontmatter(screenshotBase64 ? 'placeholder.png' : null),
      noteBody: collectBody(annotations, level),
      ...(screenshotBase64 ? { screenshot: screenshotBase64 } : {}),
    }
    return store.createNote(body)
  }

  return { captureRedactBake, submit, handleCaptureRequest }
}
