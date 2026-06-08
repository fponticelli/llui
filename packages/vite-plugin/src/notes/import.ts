// Dev-side bundle import — ingest an export bundle (produced by the browser
// HUD's `exportBundle`) into the on-disk notebook so the existing router/MCP
// solve flow picks it up unchanged. This closes the capture-only loop:
//   prod app → IndexedDB → export zip → THIS → ~/.llui/notes → solve in dev.
//
// Import is content-addressed and idempotent:
//   - Incoming sessions are namespaced by a stable key derived from the
//     bundle's content hash, so two sources' `session-001` never merge and
//     re-importing the same bundle lands in the same place.
//   - Files are written only when absent — re-import is a no-op, never an
//     overwrite. A `import.json` sidecar preserves exporter provenance and
//     the original session id.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { NOTE_SCHEMA_VERSION } from '@llui/devmode-annotate/note-format'
import { strFromU8, unzipSync } from 'fflate'

interface BundleManifest {
  schemaVersion: number
  exportedAt: string
  sessions: string[]
  noteCount: number
  contentHash: string
  exportedBy?: unknown
  app?: unknown
}

export interface ImportBundleResult {
  /** Short stable key derived from the bundle content hash. */
  bundleKey: string
  /** Target session folder names that received notes. */
  importedSessions: string[]
  /** `.md` notes written this run. */
  notesImported: number
  /** `.md` notes already present (idempotent re-import). */
  notesSkipped: number
}

const SESSION_RE = /^session-[A-Za-z0-9._-]+$/
const SAFE_BASENAME_RE = /^[A-Za-z0-9._-]+$/

function parseManifest(files: Record<string, Uint8Array>): BundleManifest {
  const raw = files['bundle.json']
  if (!raw) throw new Error('import: bundle.json missing — not a valid LLui notes bundle')
  let manifest: BundleManifest
  try {
    manifest = JSON.parse(strFromU8(raw)) as BundleManifest
  } catch (err) {
    throw new Error(`import: bundle.json is not valid JSON`, { cause: err })
  }
  if (manifest.schemaVersion !== NOTE_SCHEMA_VERSION) {
    throw new Error(
      `import: schema version mismatch — bundle is v${manifest.schemaVersion}, this tool expects v${NOTE_SCHEMA_VERSION}`,
    )
  }
  if (!Array.isArray(manifest.sessions)) {
    throw new Error('import: bundle.json missing a sessions array')
  }
  return manifest
}

/**
 * Import an export bundle (zip bytes) into `notesRoot`. Returns a summary;
 * throws on a malformed bundle, schema mismatch, or unsafe entry paths.
 */
export function importBundle(notesRoot: string, zip: Uint8Array): ImportBundleResult {
  const files = unzipSync(zip)
  const manifest = parseManifest(files)
  const bundleKey = manifest.contentHash.slice(0, 8)
  const knownSessions = new Set(manifest.sessions)

  const rootAbs = resolve(notesRoot)
  const targetFor = (originalSession: string): string => `${originalSession}-import-${bundleKey}`

  // Resolve a target path and verify it stays within notesRoot.
  const safeJoin = (targetSession: string, basename: string): string => {
    const dir = resolve(rootAbs, targetSession)
    if (dir !== rootAbs && !dir.startsWith(rootAbs + sep)) {
      throw new Error(`import: unsafe target path ${JSON.stringify(targetSession)}`)
    }
    return join(dir, basename)
  }

  // Pass 1 — validate every entry and plan the writes. Nothing touches the
  // filesystem until the whole bundle is known-good, so a single bad entry
  // aborts with no partial import.
  interface PlannedWrite {
    targetSession: string
    basename: string
    bytes: Uint8Array
    isNote: boolean
  }
  const planned: PlannedWrite[] = []
  for (const [entryPath, bytes] of Object.entries(files)) {
    if (entryPath === 'bundle.json') continue

    const slash = entryPath.indexOf('/')
    if (slash === -1) {
      throw new Error(`import: unexpected top-level entry ${JSON.stringify(entryPath)}`)
    }
    const originalSession = entryPath.slice(0, slash)
    const basename = entryPath.slice(slash + 1)

    if (!SESSION_RE.test(originalSession) || !knownSessions.has(originalSession)) {
      throw new Error(
        `import: entry references an unknown session ${JSON.stringify(originalSession)}`,
      )
    }
    if (!SAFE_BASENAME_RE.test(basename) || basename.includes('..')) {
      throw new Error(`import: unsafe entry name ${JSON.stringify(entryPath)}`)
    }
    planned.push({
      targetSession: targetFor(originalSession),
      basename,
      bytes,
      isNote: basename.endsWith('.md'),
    })
  }

  // Pass 2 — execute. Files are written only when absent (idempotent).
  const importedSessions = new Set<string>()
  let notesImported = 0
  let notesSkipped = 0
  for (const w of planned) {
    mkdirSync(resolve(rootAbs, w.targetSession), { recursive: true })
    const dest = safeJoin(w.targetSession, w.basename)
    importedSessions.add(w.targetSession)
    if (existsSync(dest)) {
      if (w.isNote) notesSkipped++
      continue
    }
    writeFileSync(dest, w.bytes)
    if (w.isNote) notesImported++
  }

  // Provenance sidecar per target folder — preserves the original session id
  // and exporter identity without rewriting every note's frontmatter.
  for (const originalSession of manifest.sessions) {
    const targetSession = targetFor(originalSession)
    if (!importedSessions.has(targetSession)) continue
    const sidecar = {
      originalSessionId: originalSession,
      bundleContentHash: manifest.contentHash,
      exportedAt: manifest.exportedAt,
      ...(manifest.exportedBy !== undefined ? { exportedBy: manifest.exportedBy } : {}),
      ...(manifest.app !== undefined ? { app: manifest.app } : {}),
    }
    writeFileSync(safeJoin(targetSession, 'import.json'), JSON.stringify(sidecar, null, 2), 'utf8')
  }

  return {
    bundleKey,
    importedSessions: [...importedSessions].sort(),
    notesImported,
    notesSkipped,
  }
}
