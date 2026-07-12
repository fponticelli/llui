// Collect LLui runtime telemetry into a NoteBody, using the existing
// `__lluiComponents` global that @llui/dom's devtools.ts populates per
// mounted component.
//
// This is the P4 payoff: notes carry state snapshots, message history,
// pending + recent effects, etc. The proposal lays out a `window.__llui`
// surface — but the existing `__lluiDebug` / `__lluiComponents` already
// expose everything we need, so we read those directly rather than
// duplicating the surface.
//
// Falls back to `{}` (empty NoteBody) when no debug API is present —
// e.g. production builds, or in dev when devtools-mode is off.

import type {
  ComponentMetaRef,
  ConsoleLogEntry,
  LogLevel,
  MessageLogEntry,
  NoteBody,
  NoteRect,
  PendingEffectEntry,
  RecentEffectEntry,
  SourceMapEntry,
  VerboseNoteBody,
} from './note-types.js'
import { uniqueSelectorFor } from './selector.js'

// Re-exported so the debug collector's public surface (and its tests) keep a
// stable `uniqueSelectorFor` import even though the implementation now lives in
// the shared selector module.
export { uniqueSelectorFor } from './selector.js'

// Minimal subset of @llui/dom's LluiDebugAPI we depend on. Typed as a
// structural interface so we don't have to take a runtime dep on
// @llui/dom (which would create a workspace cycle).
interface MessageRecordLike {
  index: number
  timestamp: number
  msg: unknown
  effects?: unknown[]
}

interface PendingEffectLike {
  id: string
  type?: string
  dispatchedAt?: number
  status?: string
  payload?: unknown
}

interface EffectTimelineEntryLike {
  effectId: string
  type?: string
  phase: string
  timestamp: number
  durationMs?: number
}

interface ComponentInfoLike {
  name: string
  file: string | null
  line: number | null
}

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

interface DebugApiLike {
  getState(): unknown
  getMessageHistory?(opts?: { since?: number; limit?: number }): MessageRecordLike[]
  getPendingEffects?(): PendingEffectLike[]
  getEffectTimeline?(limit?: number): EffectTimelineEntryLike[]
  getComponentInfo?(): ComponentInfoLike
  inspectElement?(selector: string): ElementReportLike | null
  getBindingSource?(bindingIndex: number): BindingSourceLike | null
  getScopeTree?(opts?: { depth?: number; scopeId?: string }): LifetimeNodeLike
  getBindings?(): BindingDebugInfoLike[]
}

interface ComponentsGlobal {
  __lluiComponents?: Record<string, DebugApiLike>
}

const MESSAGE_LIMIT = 50
const EFFECT_LIMIT = 50

/**
 * Component-name prefix used by the HUD's OWN @llui/dom components (browse
 * view, rect overlay, element picker, the HUD shell). Now that the HUD is
 * authored with LLui, those components register into the same
 * `__lluiComponents` registry we walk to introspect the HOST app — so every
 * collector skips entries carrying this prefix. The HUD must be invisible to
 * its own telemetry.
 */
export const HUD_COMPONENT_PREFIX = 'llui-devmode-annotate:'

/** Registry entries belonging to the host app (HUD-internal components removed). */
function hostEntries(components: Record<string, DebugApiLike>): Array<[string, DebugApiLike]> {
  return Object.entries(components).filter(([name]) => !name.startsWith(HUD_COMPONENT_PREFIX))
}

export interface CollectOptions {
  /** Override the global lookup. Tests inject a stub map. */
  components?: Record<string, DebugApiLike>
  /** Cap on messageLog entries; default 50. */
  messageLimit?: number
  /** Cap on effects.recent entries; default 50. */
  effectLimit?: number
}

/**
 * Collect runtime telemetry from every mounted component into a
 * NoteBody-shaped partial. Returns an empty object when no debug API
 * is present.
 */
export function collectDebugSnapshot(opts: CollectOptions = {}): NoteBody {
  const components = opts.components ?? (globalThis as unknown as ComponentsGlobal).__lluiComponents
  if (!components) return {}
  const componentEntries = hostEntries(components)
  if (componentEntries.length === 0) return {}

  const messageLimit = opts.messageLimit ?? MESSAGE_LIMIT
  const effectLimit = opts.effectLimit ?? EFFECT_LIMIT

  const stateSnapshot: Record<string, unknown> = {}
  const messageLog: MessageLogEntry[] = []
  const pending: PendingEffectEntry[] = []
  const recent: RecentEffectEntry[] = []

  for (const [name, api] of componentEntries) {
    // State snapshot is the cheapest read; always include it.
    try {
      stateSnapshot[name] = api.getState()
    } catch {
      stateSnapshot[name] = { __error: 'getState() threw' }
    }

    // Message history — most useful when the LLM is debugging "what
    // happened just before this screenshot".
    if (typeof api.getMessageHistory === 'function') {
      let history: MessageRecordLike[]
      try {
        history = api.getMessageHistory({ limit: messageLimit }) ?? []
      } catch {
        history = []
      }
      for (const rec of history) {
        messageLog.push({
          ts: new Date(rec.timestamp).toISOString(),
          component: name,
          msg: rec.msg,
        })
      }
    }

    // Pending effects — what's queued or in-flight right now.
    if (typeof api.getPendingEffects === 'function') {
      let pendings: PendingEffectLike[]
      try {
        pendings = api.getPendingEffects() ?? []
      } catch {
        pendings = []
      }
      const now = Date.now()
      for (const p of pendings) {
        pending.push({
          id: p.id,
          component: name,
          effect: p.payload ?? p.type ?? null,
          sinceMs: p.dispatchedAt ? Math.max(0, now - p.dispatchedAt) : 0,
        })
      }
    }

    // Recent effect timeline — phased log of dispatched/in-flight/
    // resolved entries. Map terminal phases to RecentEffectEntry.
    if (typeof api.getEffectTimeline === 'function') {
      let timeline: EffectTimelineEntryLike[]
      try {
        timeline = api.getEffectTimeline(effectLimit) ?? []
      } catch {
        timeline = []
      }
      for (const entry of timeline) {
        const outcome = phaseToOutcome(entry.phase)
        if (!outcome) continue
        recent.push({
          ts: new Date(entry.timestamp).toISOString(),
          component: name,
          effect: { type: entry.type ?? null, id: entry.effectId },
          outcome,
        })
      }
    }
  }

  // Sort messages chronologically and trim to limit
  messageLog.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  const trimmedLog = messageLog.length > messageLimit ? messageLog.slice(-messageLimit) : messageLog

  const body: NoteBody = { stateSnapshot, messageLog: trimmedLog }
  if (pending.length > 0 || recent.length > 0) {
    body.effects = { pending, recent }
  }
  return body
}

function phaseToOutcome(phase: string): RecentEffectEntry['outcome'] | null {
  if (phase === 'resolved' || phase === 'resolved-mocked') return 'ok'
  if (phase === 'cancelled') return 'cancelled'
  if (phase === 'errored' || phase === 'error') return 'error'
  return null
}

export interface ComponentInfoSnapshot {
  /** Names of all currently mounted components (keys of __lluiComponents). */
  componentPath: string[]
  /** Metadata for the first mounted component — the most likely candidate
   *  for the "owning" component when an annotation doesn't carry a
   *  precise scope. Per-element resolution requires DOM↔scope mapping
   *  which is a future iteration. */
  componentMeta: ComponentMetaRef | null
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
  const components = opts.components ?? (globalThis as unknown as ComponentsGlobal).__lluiComponents
  if (!components) return []
  const entries = hostEntries(components)
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

/**
 * Collect identity information for every mounted component. Returns
 * `null` when no debug API is present so callers can keep their
 * existing fallback values.
 */
export function collectComponentInfo(opts: CollectOptions = {}): ComponentInfoSnapshot | null {
  const components = opts.components ?? (globalThis as unknown as ComponentsGlobal).__lluiComponents
  if (!components) return null
  const entries = hostEntries(components)
  if (entries.length === 0) return null

  const names = entries.map(([name]) => name)
  // First component's metadata is the primary anchor. Components stack
  // in insertion order in __lluiComponents — typically the root mounts
  // first, so this is the outermost / "App-equivalent".
  const [firstName, firstApi] = entries[0]!
  let meta: ComponentMetaRef | null = null
  if (typeof firstApi.getComponentInfo === 'function') {
    try {
      const info = firstApi.getComponentInfo()
      if (info.file != null && info.line != null) {
        meta = { file: info.file, line: info.line, name: info.name || firstName }
      }
    } catch {
      // Best-effort — collector should never throw at the callsite.
    }
  }
  return { componentPath: names, componentMeta: meta }
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
  const components = opts.components ?? (globalThis as unknown as ComponentsGlobal).__lluiComponents
  if (!components) return null
  const entries = hostEntries(components)
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
