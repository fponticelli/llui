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
  PendingEffectEntry,
  RecentEffectEntry,
} from '@llui/vite-plugin'

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

interface DebugApiLike {
  getState(): unknown
  getMessageHistory?(opts?: { since?: number; limit?: number }): MessageRecordLike[]
  getPendingEffects?(): PendingEffectLike[]
  getEffectTimeline?(limit?: number): EffectTimelineEntryLike[]
  getComponentInfo?(): ComponentInfoLike
}

interface ComponentsGlobal {
  __lluiComponents?: Record<string, DebugApiLike>
}

const MESSAGE_LIMIT = 50
const EFFECT_LIMIT = 50

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
  const componentEntries = Object.entries(components)
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

/**
 * Collect identity information for every mounted component. Returns
 * `null` when no debug API is present so callers can keep their
 * existing fallback values.
 */
export function collectComponentInfo(opts: CollectOptions = {}): ComponentInfoSnapshot | null {
  const components = opts.components ?? (globalThis as unknown as ComponentsGlobal).__lluiComponents
  if (!components) return null
  const entries = Object.entries(components)
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
