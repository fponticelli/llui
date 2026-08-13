// Canonical diagnostic schema — v2c §3.
//
// Every diagnostic the compiler emits (cross-file resolver, manifest
// substitution, future per-module diagnostics) flows through this shape.
// Adapters (ESLint, MCP, future LSP, CLI) translate it into their
// host-specific representations. Adapters never construct diagnostics;
// they consume.
//
// Stable contract:
//   - `id` is a stable string like `llui/opaque-view-call`. Renaming
//     follows the §8.2 deprecation cycle (alias for one minor; remove
//     in the next).
//   - `severity` is the *intent* of the diagnostic; adapters may downgrade
//     `error` to `warning` based on host policy (e.g. ESLint `--max-warnings`).
//   - `category` groups diagnostics for filtering. New categories require
//     a doc revision.
//   - `location` is always project-relative on emission (shared.md §6.4).

import type ts from 'typescript'

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export type DiagnosticCategory =
  /** Reactive-path correctness — overflow, opaque accessors, mask gating. */
  | 'reactivity'
  /** View composition — async helpers, missing context providers, helper cycles. */
  | 'composition'
  /** Agent integration — Msg-schema resolvability, dispatch-translator drift. */
  | 'agent'
  /** Style / authoring conventions — naming, redundancy, lint-only signals. */
  | 'style'
  /** Performance — whole-state (FULL_MASK) coarsening, expensive accessors. */
  | 'perf'
  /** Module / build configuration — manifest skew, version mismatch, integrity. */
  | 'config'
  /** Internal — module exceptions, walker termination paths, debug diagnostics. */
  | 'internal'

export interface Position {
  /** 0-based line index. */
  line: number
  /** 0-based UTF-16 code-unit column. */
  column: number
}

export interface Range {
  start: Position
  end: Position
}

export interface DiagnosticLocation {
  /** Project-relative path on emission (never absolute, never hostname-tainted). */
  file: string
  range: Range
}

export interface CodeAction {
  /** Human-readable label for the autofix. */
  title: string
  /** Source edits that apply the fix. Adapters translate to their host edit format. */
  edits: Array<{
    file: string
    range: Range
    /** New text replacing `range`. Empty string deletes the range. */
    newText: string
  }>
}

export interface DiagnosticRelatedInformation {
  location: DiagnosticLocation
  message: string
}

export interface Diagnostic {
  /** Stable id — `<namespace>/<slug>`. Examples: `llui/opaque-view-call`. */
  id: string
  severity: DiagnosticSeverity
  category: DiagnosticCategory
  /** Human-readable, present-tense, actionable. */
  message: string
  location: DiagnosticLocation
  /** Cross-references (e.g. the other end of a cycle, the missing provider's expected site). */
  relatedInformation?: DiagnosticRelatedInformation[]
  /** Structured edits the adapter can offer as autofixes. */
  fixes?: CodeAction[]
  /** Optional URL to user-facing documentation for this diagnostic id. */
  documentation?: string
}

/**
 * Convert a TS Compiler API `(start, end)` offset pair against a parsed source
 * file into the canonical `Range` shape. Used by emitters that have AST
 * node positions but not pre-computed line/column.
 */
export function rangeFromOffsets(sf: ts.SourceFile, start: number, end: number): Range {
  return {
    start: offsetToPosition(sf, start),
    end: offsetToPosition(sf, end),
  }
}

function offsetToPosition(sf: ts.SourceFile, offset: number): Position {
  // The SourceFile's line map (a binary search over precomputed line starts),
  // not the O(offset) character scan this used to do — free once every emitter
  // holds a parsed module anyway (#93).
  //
  // The LOW end of the clamp is the load-bearing half: `getLineAndCharacterOfPosition`
  // throws a `Debug Failure` for a negative position, while a position PAST the
  // end merely returns an out-of-range character. The scan it replaces was total,
  // so an emitter handing over a stale or synthesized offset used to get a
  // nonsense-but-harmless position; it must not start throwing out of a
  // diagnostic path instead. Both ends are pinned in diagnostic-schema.test.ts.
  //
  // One deliberate semantic change: the line map counts U+2028/U+2029 and a lone
  // `\r` as line breaks, where the deleted scan counted `\n` only. CRLF is
  // identical either way, and agreeing with `tsc`'s own diagnostic positions is
  // the point of using its map.
  const pos = offset < 0 ? 0 : offset > sf.text.length ? sf.text.length : offset
  const lc = sf.getLineAndCharacterOfPosition(pos)
  return { line: lc.line, column: lc.character }
}

/**
 * Project-relative path helper. Adapters pass the project root resolved
 * from `llui.config.ts` / Vite's `config.root`; emitters that have an
 * absolute path use this to canonicalize before placing into a
 * Diagnostic. Falls back to the absolute path if `root` is empty or
 * the file isn't a descendant.
 */
export function relativizeFile(absoluteFile: string, root: string): string {
  if (!root) return absoluteFile
  const normRoot = root.endsWith('/') ? root : root + '/'
  if (absoluteFile.startsWith(normRoot)) {
    return absoluteFile.slice(normRoot.length)
  }
  return absoluteFile
}
