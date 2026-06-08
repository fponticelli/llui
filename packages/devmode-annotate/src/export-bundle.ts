// Export bundle — a standard zip of the canonical on-disk notebook layout
// (`session-*/{id}-{author}-{kind}-{slug}.{md,png}` + `status.jsonl`) plus a
// top-level `bundle.json` manifest. The manifest is self-describing and
// content-hashed so dev import (P4) is idempotent and version-checked.
//
// This is the prod capture-only hand-off: a user captures into the browser
// store, exports a bundle, and the developer imports it into ~/.llui/notes
// where the existing router/MCP solve flow picks it up unchanged.

import { zipSync, type Zippable } from 'fflate'
import { NOTE_SCHEMA_VERSION } from './note-format.js'
import type { ExportableStore } from './notes-store.js'

/** Who captured the notes (host-populated; omitted when unknown). */
export interface BundleIdentity {
  id?: string
  label?: string
  kind: 'human' | 'llm' | 'agent'
}

/** Capture-environment provenance (host-populated; omitted when unknown). */
export interface BundleAppProvenance {
  version?: string
  buildId?: string
  releaseChannel?: string
  url?: string
}

export interface BundleManifest {
  /** On-disk note-format schema version (see NOTE_SCHEMA_VERSION). */
  schemaVersion: number
  /** Host-stamped export time (ISO). */
  exportedAt: string
  /** The sessions included, sorted. */
  sessions: string[]
  /** Total `.md` notes across all sessions. */
  noteCount: number
  /** SHA-256 hex over every file entry (sorted by path), excluding the
   *  manifest itself. Drives idempotent import + integrity checks. */
  contentHash: string
  exportedBy?: BundleIdentity
  app?: BundleAppProvenance
}

export interface ExportBundleOptions {
  /** Limit to these sessions. Default: every session in the store. */
  sessionIds?: string[]
  /** Capture identity recorded in the manifest. */
  exportedBy?: BundleIdentity
  /** App/environment provenance recorded in the manifest. */
  app?: BundleAppProvenance
  /** Clock override (tests / deterministic runs). */
  now?: () => Date
}

export interface ExportBundleResult {
  blob: Blob
  manifest: BundleManifest
  /** The raw zip bytes (same content as `blob`), handy for tests/Node. */
  bytes: Uint8Array
}

const enc = new TextEncoder()

/** SHA-256 hex over the entries (sorted by path) — deterministic, no clock. */
async function hashEntries(entries: Array<[string, Uint8Array]>): Promise<string> {
  const sorted = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const parts: Uint8Array[] = []
  const NUL = new Uint8Array([0])
  for (const [path, bytes] of sorted) {
    parts.push(enc.encode(path), NUL, bytes, NUL)
  }
  let total = 0
  for (const p of parts) total += p.length
  const flat = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    flat.set(p, off)
    off += p.length
  }
  const digest = await crypto.subtle.digest('SHA-256', flat)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Build an export bundle from any store that can produce raw sessions.
 * Returns the zip as a Blob (for download), the parsed manifest, and the
 * raw bytes.
 */
export async function exportBundle(
  store: ExportableStore,
  opts: ExportBundleOptions = {},
): Promise<ExportBundleResult> {
  const now = opts.now ?? ((): Date => new Date())
  const sessions = await store.exportSessions(opts.sessionIds)

  // Collect every file entry (sans manifest) so we can hash them.
  const fileEntries: Array<[string, Uint8Array]> = []
  let noteCount = 0
  for (const session of sessions) {
    for (const note of session.notes) {
      noteCount++
      fileEntries.push([`${session.id}/${note.filename}`, enc.encode(note.markdown)])
      if (note.screenshot) {
        const pngName = note.filename.replace(/\.md$/, '.png')
        fileEntries.push([`${session.id}/${pngName}`, note.screenshot])
      }
    }
    if (session.statusJsonl !== '') {
      fileEntries.push([`${session.id}/status.jsonl`, enc.encode(session.statusJsonl)])
    }
  }

  const contentHash = await hashEntries(fileEntries)
  const manifest: BundleManifest = {
    schemaVersion: NOTE_SCHEMA_VERSION,
    exportedAt: now().toISOString(),
    sessions: sessions.map((s) => s.id),
    noteCount,
    contentHash,
    ...(opts.exportedBy ? { exportedBy: opts.exportedBy } : {}),
    ...(opts.app ? { app: opts.app } : {}),
  }

  const zippable: Zippable = { 'bundle.json': enc.encode(JSON.stringify(manifest, null, 2)) }
  for (const [path, bytes] of fileEntries) zippable[path] = bytes

  const bytes = zipSync(zippable)
  const blob = new Blob([bytes], { type: 'application/zip' })
  return { blob, manifest, bytes }
}

/** Default bundle filename: `llui-notes-<contentHash prefix>.zip`. */
export function bundleFilename(manifest: BundleManifest): string {
  return `llui-notes-${manifest.contentHash.slice(0, 12)}.zip`
}
