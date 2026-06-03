// Serialization + validation for the `__llui_deps.json` library-boundary
// manifest (see `manifest.ts` for the schema). The producer (`build-manifest.ts`)
// writes via `serializeManifest`; the consumer (`manifest-resolve.ts`) reads via
// `parseManifest`. Both sides hand-roll validation — the project takes no JSON-
// schema dependency, and the soundness floor is "anything we can't trust →
// caller coarsens to opaque", so `parseManifest` reports a reason rather than
// throwing.

import { COMPILER_VERSION } from './version.js'
import { MANIFEST_SCHEMA_VERSION } from './manifest.js'
import type { Manifest, HelperEntry, ParamSpec } from './manifest.js'

/** Canonical module-id separator in helper keys: `<moduleId>#<exportName>`. */
export const HELPER_KEY_SEP = '#'

/** The well-known on-disk location, relative to a published package root. */
export const MANIFEST_RELATIVE_PATH = 'dist/__llui_deps.json'

// ── Serialize ───────────────────────────────────────────────────────

/**
 * Serialize a manifest to stable, diff-friendly JSON: object keys sorted
 * (so re-emits are byte-identical regardless of insertion order), arrays left
 * in their meaningful order (e.g. `viaParams` is index-ordered). 2-space indent
 * + trailing newline to match the repo's prettier output.
 */
export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(sortKeysDeep(manifest), null, 2) + '\n'
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

// ── Parse + validate ────────────────────────────────────────────────

export type ParseManifestResult =
  | { ok: true; manifest: Manifest }
  /** `incompatible` = readable but the schema/compiler version doesn't match;
   *  `malformed` = unparseable or structurally wrong. Both → caller coarsens. */
  | { ok: false; reason: 'incompatible' | 'malformed'; detail: string }

/**
 * Parse + validate a manifest JSON string. Validation is intentionally shallow
 * but covers everything the substitution engine iterates (`helpers[*].kind`,
 * `.viaParams[*].shape`, `.index`) so a malformed third-party manifest can't
 * crash the consumer's compile. Schema `version` must equal the current
 * `MANIFEST_SCHEMA_VERSION` and the emitting `compilerVersion`'s major must
 * match this compiler.
 */
export function parseManifest(json: string): ParseManifestResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    return { ok: false, reason: 'malformed', detail: `invalid JSON: ${(e as Error).message}` }
  }
  if (!isRecord(raw))
    return { ok: false, reason: 'malformed', detail: 'top-level is not an object' }

  if (raw['version'] !== MANIFEST_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'incompatible',
      detail: `unsupported schema version ${String(raw['version'])} (expected ${MANIFEST_SCHEMA_VERSION})`,
    }
  }
  const compilerVersion = raw['compilerVersion']
  if (typeof compilerVersion !== 'string') {
    return { ok: false, reason: 'malformed', detail: 'compilerVersion missing or not a string' }
  }
  if (!majorMatches(compilerVersion, COMPILER_VERSION)) {
    return {
      ok: false,
      reason: 'incompatible',
      detail: `manifest compilerVersion ${compilerVersion} is incompatible with ${COMPILER_VERSION}`,
    }
  }

  const helpersRaw = raw['helpers']
  const componentsRaw = raw['components'] ?? {}
  if (!isRecord(helpersRaw))
    return { ok: false, reason: 'malformed', detail: 'helpers is not an object' }
  if (!isRecord(componentsRaw))
    return { ok: false, reason: 'malformed', detail: 'components is not an object' }

  const helpers: Record<string, HelperEntry> = {}
  for (const [key, entry] of Object.entries(helpersRaw)) {
    const validated = validateHelperEntry(entry)
    if (!validated.ok) {
      return { ok: false, reason: 'malformed', detail: `helper "${key}": ${validated.detail}` }
    }
    helpers[key] = validated.entry
  }

  return {
    ok: true,
    manifest: {
      version: MANIFEST_SCHEMA_VERSION,
      compilerVersion,
      helpers,
      components: componentsRaw as Manifest['components'],
    },
  }
}

function validateHelperEntry(
  entry: unknown,
): { ok: true; entry: HelperEntry } | { ok: false; detail: string } {
  if (!isRecord(entry)) return { ok: false, detail: 'not an object' }
  if (entry['kind'] !== 'view-helper' && entry['kind'] !== 'parts-helper') {
    return { ok: false, detail: `invalid kind ${String(entry['kind'])}` }
  }
  if (
    !Array.isArray(entry['helperLocalPaths']) ||
    !entry['helperLocalPaths'].every((p) => typeof p === 'string')
  ) {
    return { ok: false, detail: 'helperLocalPaths is not a string[]' }
  }
  if (!Array.isArray(entry['viaParams'])) return { ok: false, detail: 'viaParams is not an array' }
  for (const p of entry['viaParams'] as unknown[]) {
    if (!isRecord(p) || typeof p['index'] !== 'number' || typeof p['shape'] !== 'string') {
      return { ok: false, detail: 'viaParams entry missing index/shape' }
    }
    if (
      p['shape'] === 'state-value' &&
      (!Array.isArray(p['reads']) || !p['reads'].every((r) => typeof r === 'string'))
    ) {
      return { ok: false, detail: 'state-value param missing reads:string[]' }
    }
  }
  // contextReads is optional; if present it must be an array.
  if (entry['contextReads'] !== undefined && !Array.isArray(entry['contextReads'])) {
    return { ok: false, detail: 'contextReads is not an array' }
  }
  return {
    ok: true,
    entry: {
      kind: entry['kind'],
      helperLocalPaths: entry['helperLocalPaths'] as string[],
      viaParams: entry['viaParams'] as ParamSpec[],
      ...(entry['contextReads'] !== undefined
        ? { contextReads: entry['contextReads'] as HelperEntry['contextReads'] }
        : {}),
    },
  }
}

// ── helpers ─────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Major-version compatibility (semver-ish): same leading numeric segment. */
function majorMatches(a: string, b: string): boolean {
  return major(a) === major(b)
}

function major(v: string): string {
  return v.split('.')[0] ?? v
}
