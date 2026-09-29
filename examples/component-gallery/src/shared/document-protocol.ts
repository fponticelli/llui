/**
 * The status a path document reports about the ONE scenario it renders —
 * posted to the framing shell and mirrored on `<html>` for headless drivers
 * (`GALLERY_DOCUMENT_READY_ATTRIBUTE`). Protocol types only.
 */
import { GALLERY_DOCUMENT_MESSAGE_TYPE } from '@llui/cli/gallery'
import type { PresentationScenarioPath } from '@llui/cli/presentation-scenarios'

export type GalleryDocumentStatus = 'loading' | 'ready' | 'error'

/** Stable failure categories a document can report. */
export type GalleryDocumentErrorCode =
  /** No canonical entry, alias or copied artifact has that name. */
  | 'unknown-entry'
  /** The contract says this path draws nothing for the entry (styleless / not applicable). */
  | 'not-rendered'
  /** The scenario protocol rejected the selection (case, axis, artifact, path). */
  | 'invalid-selection'
  /** The path's adapter map has no renderer for a product it should draw. */
  | 'missing-renderer'
  /** The renderer threw while mounting, or later at runtime. */
  | 'renderer-failed'

export interface GalleryDocumentMessage {
  readonly type: typeof GALLERY_DOCUMENT_MESSAGE_TYPE
  readonly path: PresentationScenarioPath
  /** The document's own URL (`location.href`) — how the shell ignores a stale frame. */
  readonly href: string
  readonly status: GalleryDocumentStatus
  readonly entry?: string
  readonly caseId?: string
  readonly code?: GalleryDocumentErrorCode
  readonly message?: string
}

const STATUSES: ReadonlySet<string> = new Set<GalleryDocumentStatus>(['loading', 'ready', 'error'])

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow an untrusted `MessageEvent.data` to a document status message. */
export function isGalleryDocumentMessage(value: unknown): value is GalleryDocumentMessage {
  if (!isRecord(value)) return false
  const record = value
  return (
    record['type'] === GALLERY_DOCUMENT_MESSAGE_TYPE &&
    (record['path'] === 'baseline' || record['path'] === 'registryTailwind') &&
    typeof record['href'] === 'string' &&
    typeof record['status'] === 'string' &&
    STATUSES.has(record['status'])
  )
}
