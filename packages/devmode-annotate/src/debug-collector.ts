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
  MessageLogEntry,
  NoteBody,
  NoteRect,
  PendingEffectEntry,
  RecentEffectEntry,
  SourceMapEntry,
} from './note-types.js'

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

interface DebugApiLike {
  getState(): unknown
  getMessageHistory?(opts?: { since?: number; limit?: number }): MessageRecordLike[]
  getPendingEffects?(): PendingEffectLike[]
  getEffectTimeline?(limit?: number): EffectTimelineEntryLike[]
  getComponentInfo?(): ComponentInfoLike
  inspectElement?(selector: string): ElementReportLike | null
  getBindingSource?(bindingIndex: number): BindingSourceLike | null
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
 * Synthesize a unique CSS selector for an element. Prefers id; falls
 * back to a chain of `tag:nth-child()` up to a parent with an id (or
 * the root). The result is querySelector-compatible.
 */
export function uniqueSelectorFor(el: Element): string | null {
  if (el.id) return `#${cssEscape(el.id)}`
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur.tagName !== 'HTML' && cur.tagName !== 'BODY') {
    if (cur.id) {
      parts.unshift(`#${cssEscape(cur.id)}`)
      break
    }
    const parent: ParentNode | null = cur.parentNode
    if (!parent) break
    const children = parent.children
    let index = -1
    for (let k = 0; k < children.length; k++) {
      if (children[k] === cur) {
        index = k + 1
        break
      }
    }
    if (index <= 0) break
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${index})`)
    cur = parent instanceof Element ? parent : null
  }
  return parts.length > 0 ? parts.join(' > ') : null
}

function cssEscape(value: string): string {
  // Browsers expose CSS.escape; node tests (jsdom) generally do too.
  // Fall back to a manual escape for safety.
  const css = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS
  if (css?.escape) return css.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
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
