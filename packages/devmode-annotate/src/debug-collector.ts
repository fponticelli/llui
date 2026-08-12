// HUD-side telemetry collection.
//
// The registry walk itself — `collectDebugSnapshot` / `collectComponentInfo`,
// the host-entry filter, the dev-tooling name prefix — is NOT here: it lives in
// `@llui/dom`'s `debug-collect` module, because the MCP server needs the exact
// same walk inside a page it evaluates out of process, and a second copy is what
// issue #50 removed. This module keeps the collectors that are HUD-only (source
// map, verbose snapshot, console capture) and re-exports the shared ones so the
// HUD keeps a single import surface.
//
// Every collector falls back to `{}` / `null` when no debug API is present —
// e.g. production builds, or in dev when devtools-mode is off.

import type {
  ConsoleLogEntry,
  LogLevel,
  NoteRect,
  SourceMapEntry,
  VerboseNoteBody,
} from './note-types.js'
import { hostComponentEntries, type DebugCollectOptions } from '@llui/dom/debug-collect'
import { uniqueSelectorFor } from './selector.js'

// Re-exported so the debug collector's public surface (and its tests) keep a
// stable `uniqueSelectorFor` import even though the implementation now lives in
// the shared selector module.
export { uniqueSelectorFor } from './selector.js'

// The shared collectors, re-exported under this module's name so HUD callers
// don't have to know which half of the split they need. `@llui/dom` is the
// canonical home — change them there.
export {
  collectComponentInfo,
  collectDebugSnapshot,
  DEVTOOLS_COMPONENT_PREFIX as HUD_COMPONENT_PREFIX,
  type ComponentInfoSnapshot,
} from '@llui/dom/debug-collect'

// Introspection surfaces only the HUD-side collectors probe, on top of the
// shared `TelemetrySource`. Structural subsets of @llui/dom's `ElementReport` /
// `LifetimeNode` / `BindingDebugInfo` — the collectors read a few fields each
// and feature-detect every method, so narrowing keeps the contract honest.
interface ElementReportLike {
  bindings: Array<{ bindingIndex: number; kind?: string }>
}

interface BindingSourceLike {
  file: string
  line: number
  column: number
}

interface LifetimeNodeLike {
  scopeId: string
  kind: string
  active: boolean
  children: LifetimeNodeLike[]
}

interface BindingDebugInfoLike {
  index: number
  kind: string
  dead: boolean
}

interface HudTelemetrySource {
  getState(): unknown
  inspectElement?(selector: string): ElementReportLike | null
  getBindingSource?(bindingIndex: number): BindingSourceLike | null
  getScopeTree?(opts?: { depth?: number; scopeId?: string }): LifetimeNodeLike
  getBindings?(): BindingDebugInfoLike[]
}

export interface CollectOptions extends DebugCollectOptions {
  /** Override the global lookup. Tests inject a stub map. */
  components?: Record<string, HudTelemetrySource>
}

/** The registry a HUD-side collect call should walk: injected, else the global. */
function resolveHostEntries(opts: CollectOptions): Array<[string, HudTelemetrySource]> {
  const components = opts.components ?? globalThis.__lluiComponents
  if (!components) return []
  return hostComponentEntries(components)
}

export interface CollectSourceMapOptions extends CollectOptions {
  /** Grid sample size — N x N points across the bbox are inspected.
   *  Default 3 (9 samples). Higher = more thorough, slower. */
  samples?: number
}

/**
 * Build a SourceMapEntry[] for elements inside a viewport bbox. Uses
 * the runtime's existing `inspectElement` + `getBindingSource` to map
 * each element back to the view-fn line that created it. Requires
 * `__bindingSources` emission (active in dev mode via the Vite plugin).
 *
 * Returns an empty array when no debug API is present, when the bbox
 * doesn't intersect any LLui-managed element, or when bindings have
 * no source records (production builds without devtools mode).
 */
export function collectSourceMap(
  bbox: NoteRect,
  opts: CollectSourceMapOptions = {},
): SourceMapEntry[] {
  if (typeof document === 'undefined') return []
  const entries = resolveHostEntries(opts)
  if (entries.length === 0) return []

  const samples = Math.max(1, opts.samples ?? 3)
  const seen = new Set<string>()
  const sourceMap: SourceMapEntry[] = []

  // jsdom (and a few embedded contexts) ship without
  // document.elementFromPoint; bail cleanly there rather than crash.
  if (typeof document.elementFromPoint !== 'function') return []

  // Sample a grid of points across the bbox; the union of elements
  // beneath each point is our candidate set.
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = bbox.x + (bbox.w * (i + 0.5)) / samples
      const y = bbox.y + (bbox.h * (j + 0.5)) / samples
      const el = document.elementFromPoint(x, y)
      if (!el) continue
      const selector = uniqueSelectorFor(el)
      if (!selector || seen.has(selector)) continue
      seen.add(selector)

      for (const [name, api] of entries) {
        if (typeof api.inspectElement !== 'function') continue
        let report: ElementReportLike | null
        try {
          report = api.inspectElement(selector)
        } catch {
          continue
        }
        if (!report || !report.bindings) continue
        for (const binding of report.bindings) {
          if (typeof api.getBindingSource !== 'function') continue
          let src: BindingSourceLike | null
          try {
            src = api.getBindingSource(binding.bindingIndex)
          } catch {
            continue
          }
          if (!src) continue
          sourceMap.push({
            selector,
            file: src.file,
            line: src.line,
            componentPath: [name],
          })
        }
      }
    }
  }
  return sourceMap
}

// ── Verbose snapshot (captureLevel: 'verbose') ────────────────────────────

/** Flatten a live scope-tree subtree into the serializable VerboseNoteBody
 *  scopeTree shape, tagging each node with its owning component. */
function flattenScope(
  node: LifetimeNodeLike,
  parent: string | null,
  component: string,
  out: NonNullable<VerboseNoteBody['scopeTree']>,
): void {
  out.push({ id: node.scopeId, parent, component })
  for (const child of node.children ?? []) {
    flattenScope(child, node.scopeId, component, out)
  }
}

/**
 * Collect the deep, verbose-only telemetry (scope tree + binding totals) that
 * `captureLevel: 'verbose'` promises on top of the standard debug snapshot.
 * Reads the signal runtime's optional `getScopeTree` / `getBindings` surfaces;
 * returns `null` when no debug API is present or nothing verbose is derivable
 * (e.g. production without devtools). Never throws at the callsite.
 */
export function collectVerboseSnapshot(opts: CollectOptions = {}): VerboseNoteBody | null {
  const entries = resolveHostEntries(opts)
  if (entries.length === 0) return null

  const scopeTree: NonNullable<VerboseNoteBody['scopeTree']> = []
  let bindingTotal = 0
  for (const [name, api] of entries) {
    if (typeof api.getScopeTree === 'function') {
      let root: LifetimeNodeLike | null
      try {
        root = api.getScopeTree() ?? null
      } catch {
        root = null
      }
      if (root) flattenScope(root, null, name, scopeTree)
    }
    if (typeof api.getBindings === 'function') {
      let bindings: BindingDebugInfoLike[]
      try {
        bindings = api.getBindings() ?? []
      } catch {
        bindings = []
      }
      bindingTotal += bindings.filter((b) => !b.dead).length
    }
  }

  const out: VerboseNoteBody = {}
  if (scopeTree.length > 0) out.scopeTree = scopeTree
  if (bindingTotal > 0) out.bindings = { total: bindingTotal, hottest: [], lastCycleMs: 0 }
  return Object.keys(out).length > 0 ? out : null
}

// ── Console capture (verbose consoleLog channel) ──────────────────────────

const CONSOLE_LEVELS: readonly LogLevel[] = ['log', 'warn', 'error', 'info', 'debug']
const CONSOLE_BUFFER_LIMIT = 200

type ConsoleMethod = (...args: unknown[]) => void
type ConsoleLike = Record<LogLevel, ConsoleMethod>

export interface ConsoleCaptureHandle {
  /** A copy of the captured console entries (oldest first). */
  snapshot(): ConsoleLogEntry[]
  /** Restore the original console methods. Idempotent. */
  dispose(): void
}

function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`
  try {
    return typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : String(arg)
  } catch {
    return String(arg)
  }
}

export interface ConsoleCaptureOptions {
  /** Ring-buffer cap (oldest dropped past this). Default 200. */
  limit?: number
  /** Console to wrap — defaults to the global `console`. Tests inject a stub. */
  target?: Partial<ConsoleLike>
  /** Clock override for entry timestamps. */
  now?: () => Date
}

/**
 * Install a console interceptor that mirrors `console.{log,warn,error,info,
 * debug}` into a bounded ring buffer, then chains to the original method so
 * the developer still sees everything. The verbose capture level drains this
 * buffer into `NoteBody.consoleLog`. Call `dispose()` (from the HUD's
 * `destroy()`) to unpatch.
 */
export function createConsoleCapture(opts: ConsoleCaptureOptions = {}): ConsoleCaptureHandle {
  const limit = opts.limit ?? CONSOLE_BUFFER_LIMIT
  const now = opts.now ?? ((): Date => new Date())
  const target = (opts.target ??
    (typeof console !== 'undefined' ? (console as unknown as ConsoleLike) : undefined)) as
    | Partial<ConsoleLike>
    | undefined

  const buffer: ConsoleLogEntry[] = []
  const originals = new Map<LogLevel, ConsoleMethod>()

  if (target) {
    for (const level of CONSOLE_LEVELS) {
      const orig = target[level]
      if (typeof orig !== 'function') continue
      const bound = orig.bind(target) as ConsoleMethod
      originals.set(level, bound)
      target[level] = (...args: unknown[]): void => {
        if (buffer.length >= limit) buffer.shift()
        buffer.push({
          ts: now().toISOString(),
          level,
          text: args.map(formatConsoleArg).join(' '),
        })
        bound(...args)
      }
    }
  }

  return {
    snapshot: () => buffer.slice(),
    dispose: () => {
      if (!target) return
      for (const [level, orig] of originals) target[level] = orig
      originals.clear()
    },
  }
}
