// Shared debug-telemetry collection — the ONE implementation of "walk the
// `__lluiComponents` registry and pull state / message history / effects out of
// every mounted component", plus the `__listComponents` / `__selectComponent`
// registry resolver.
//
// Four readers of that registry used to carry their own copy: the devmode HUD
// (`@llui/devmode-annotate`, in-page), the MCP server's Playwright/CDP path
// (`@llui/mcp`, which evaluates the walk inside a page it shares no module graph
// with), the MCP relay's direct in-process mode, and the browser-side relay in
// `devtools.ts`. One of those copies was a stringified CDP expression the type
// checker could not see, and it had already drifted — it never learned to skip
// the HUD's own components, so an LLM capture taken with the HUD loaded reported
// the HUD's state as if it were the app's. Every consumer now derives from here:
// the out-of-process one through `debugSnapshotExpression()` /
// `componentInfoExpression()`, which SERIALIZE these very functions.
//
// INVARIANT — the collector graph must stay closure-free. `debugCollectSource()`
// emits each function via `Function.prototype.toString()` and re-declares it in
// the page, so anything a collector references that is neither a browser global,
// nor a member of `COLLECTOR_GRAPH`, nor emitted in the preamble is `undefined`
// at page-evaluation time. Add a helper → add it to `COLLECTOR_GRAPH`; add a
// module constant → emit it in the preamble. `test/signals/debug-collect.test.ts`
// evaluates the serialized source and compares it against a direct call, so a
// violation fails the suite instead of silently degrading captured telemetry.

import type { LluiDebugAPI } from './devtools.js'

declare global {
  /**
   * Every mounted component's debug API, keyed by unique component name.
   * Published by `installSignalDebug`; read by the MCP relay, the agent
   * bridge, and the devmode HUD. Declared here so those readers are
   * type-checked instead of each casting `globalThis` to its own shape.
   */
  var __lluiComponents: Record<string, LluiDebugAPI> | undefined
  /** The currently SELECTED component — the one bare relay calls target. */
  var __lluiDebug: LluiDebugAPI | undefined
}

// ── Collector input/output shapes ───────────────────────────────────

/** The message-history subset telemetry reads (`MessageRecord` is wider). */
export interface TelemetryMessageRecord {
  index: number
  timestamp: number
  msg: unknown
}

/** The pending-effect subset telemetry reads (`PendingEffect` is wider). */
export interface TelemetryPendingEffect {
  id: string
  type?: string
  dispatchedAt?: number
  payload?: unknown
}

/** The timeline subset telemetry reads (`EffectTimelineEntry` is wider). */
export interface TelemetryEffectTimelineEntry {
  effectId: string
  type?: string
  phase: string
  timestamp: number
}

/** The component-identity subset telemetry reads (`ComponentInfo` is wider). */
export interface TelemetryComponentInfo {
  name: string
  file: string | null
  line: number | null
}

/**
 * What the collectors need from a registry entry. A structural subset of
 * `LluiDebugAPI` in which everything but `getState` is optional: the collectors
 * probe each method before calling it, so an older runtime — or a test stub —
 * is valid input, and a full `LluiDebugAPI` satisfies it by construction.
 */
export interface TelemetrySource {
  getState(): unknown
  getMessageHistory?(opts?: { since?: number; limit?: number }): TelemetryMessageRecord[]
  getPendingEffects?(): TelemetryPendingEffect[]
  getEffectTimeline?(limit?: number): TelemetryEffectTimelineEntry[]
  getComponentInfo?(): TelemetryComponentInfo
}

export interface DebugMessageLogEntry {
  ts: string
  component: string
  msg: unknown
}

export interface DebugPendingEffectEntry {
  id: string
  component: string
  effect: unknown
  sinceMs: number
}

export interface DebugRecentEffectEntry {
  ts: string
  component: string
  effect: { type: string | null; id: string }
  outcome: 'ok' | 'error' | 'cancelled'
}

/**
 * A point-in-time telemetry snapshot of every mounted component. Structurally a
 * `NoteBody` subset (`@llui/notes-format`) — the notebook is its main consumer —
 * but declared here so the runtime keeps its zero-dependency root position.
 */
export interface DebugSnapshot {
  stateSnapshot?: Record<string, unknown>
  messageLog?: DebugMessageLogEntry[]
  effects?: {
    pending: DebugPendingEffectEntry[]
    recent: DebugRecentEffectEntry[]
  }
}

export interface DebugComponentMeta {
  file: string
  line: number
  name: string
}

export interface ComponentInfoSnapshot {
  /** Names of all currently mounted host components (registry keys). */
  componentPath: string[]
  /** Metadata for the first mounted component — the most likely "owning"
   *  component when a capture doesn't carry a precise scope. */
  componentMeta: DebugComponentMeta | null
}

export interface DebugCollectOptions {
  /** Override the registry lookup. Tests inject a stub map; the page path and
   *  the HUD both leave this unset and read `globalThis.__lluiComponents`. */
  components?: Record<string, TelemetrySource>
  /** Cap on `messageLog` entries; default 50. */
  messageLimit?: number
  /** Cap on `effects.recent` entries; default 50. */
  effectLimit?: number
}

/** The options that survive serialization into a page expression — `components`
 *  is a live object graph and cannot cross the CDP boundary. */
export type SerializableCollectOptions = Omit<DebugCollectOptions, 'components'>

/**
 * Component-name prefix reserved for dev-tooling UI authored with LLui — today
 * the `@llui/devmode-annotate` HUD (browse view, rect overlay, element picker,
 * the shell). Those components register into the same `__lluiComponents`
 * registry as the host app's, so every collector skips them: the tooling must be
 * invisible to the telemetry it captures.
 */
export const DEVTOOLS_COMPONENT_PREFIX = 'llui-devmode-annotate:'

const DEFAULT_MESSAGE_LIMIT = 50
const DEFAULT_EFFECT_LIMIT = 50

// ── Collector graph (must stay closure-free — see the header) ───────

/** Registry entries belonging to the host app, in registration order. */
export function hostComponentEntries<T>(components: Record<string, T>): Array<[string, T]> {
  return Object.entries(components).filter(([name]) => !name.startsWith(DEVTOOLS_COMPONENT_PREFIX))
}

/** The registry a collect call should walk: the injected one, else the global. */
function resolveComponents(opts: DebugCollectOptions): Record<string, TelemetrySource> | undefined {
  return opts.components ?? globalThis.__lluiComponents
}

/** Terminal effect phases map to a recorded outcome; open phases are skipped. */
function phaseToOutcome(phase: string): 'ok' | 'error' | 'cancelled' | null {
  if (phase === 'resolved' || phase === 'resolved-mocked') return 'ok'
  if (phase === 'cancelled') return 'cancelled'
  if (phase === 'errored' || phase === 'error') return 'error'
  return null
}

/**
 * Collect runtime telemetry from every mounted host component. Returns an empty
 * object when no debug API is present (production builds, or dev with
 * devtools-mode off). Never throws: a component method that blows up degrades
 * that one field, because the caller is usually mid-screenshot.
 */
export function collectDebugSnapshot(opts: DebugCollectOptions = {}): DebugSnapshot {
  const components = resolveComponents(opts)
  if (!components) return {}
  const entries = hostComponentEntries(components)
  if (entries.length === 0) return {}

  const messageLimit = opts.messageLimit ?? DEFAULT_MESSAGE_LIMIT
  const effectLimit = opts.effectLimit ?? DEFAULT_EFFECT_LIMIT

  const stateSnapshot: Record<string, unknown> = {}
  const messageLog: DebugMessageLogEntry[] = []
  const pending: DebugPendingEffectEntry[] = []
  const recent: DebugRecentEffectEntry[] = []
  const now = Date.now()

  for (const [name, api] of entries) {
    // State snapshot is the cheapest read; always include it.
    try {
      stateSnapshot[name] = api.getState()
    } catch {
      stateSnapshot[name] = { __error: 'getState() threw' }
    }

    // Message history — most useful when the LLM is debugging "what happened
    // just before this screenshot".
    if (typeof api.getMessageHistory === 'function') {
      let history: TelemetryMessageRecord[]
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

    // Pending effects — what is queued or in flight right now.
    if (typeof api.getPendingEffects === 'function') {
      let pendings: TelemetryPendingEffect[]
      try {
        pendings = api.getPendingEffects() ?? []
      } catch {
        pendings = []
      }
      for (const p of pendings) {
        pending.push({
          id: p.id,
          component: name,
          effect: p.payload ?? p.type ?? null,
          sinceMs: p.dispatchedAt ? Math.max(0, now - p.dispatchedAt) : 0,
        })
      }
    }

    // Recent effect timeline — phased log; only terminal phases are recorded.
    if (typeof api.getEffectTimeline === 'function') {
      let timeline: TelemetryEffectTimelineEntry[]
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

  messageLog.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  const trimmed = messageLog.length > messageLimit ? messageLog.slice(-messageLimit) : messageLog

  const snapshot: DebugSnapshot = { stateSnapshot, messageLog: trimmed }
  if (pending.length > 0 || recent.length > 0) {
    snapshot.effects = { pending, recent }
  }
  return snapshot
}

/**
 * Collect identity information for every mounted host component. Returns `null`
 * when no debug API is present so callers keep their own fallback values.
 */
export function collectComponentInfo(opts: DebugCollectOptions = {}): ComponentInfoSnapshot | null {
  const components = resolveComponents(opts)
  if (!components) return null
  const entries = hostComponentEntries(components)
  if (entries.length === 0) return null

  const componentPath = entries.map(([name]) => name)
  // Components stack in registration order, and the root mounts first, so the
  // first entry is the outermost / "App-equivalent" — the best anchor when the
  // capture carries no precise scope.
  const first = entries[0]
  if (!first) return { componentPath, componentMeta: null }
  const firstName = first[0]
  const firstApi = first[1]
  let componentMeta: DebugComponentMeta | null = null
  if (typeof firstApi.getComponentInfo === 'function') {
    try {
      const info = firstApi.getComponentInfo()
      if (info && info.file != null && info.line != null) {
        componentMeta = { file: info.file, line: info.line, name: info.name || firstName }
      }
    } catch {
      // Best-effort — a collector must never throw at the callsite.
    }
  }
  return { componentPath, componentMeta }
}

// ── Serialization for out-of-process (CDP) evaluation ───────────────

/** Anything callable; the graph is only ever `toString()`ed. */
type CollectorFn = (...args: never[]) => unknown

/**
 * Every function `debugCollectSource()` emits. Callees first so the emitted
 * source reads top-down (hoisting makes the order irrelevant to the engine).
 * A collector that references a function missing from this list compiles fine
 * and fails only in the page — the serialization test is the guard.
 */
const COLLECTOR_GRAPH: readonly CollectorFn[] = [
  hostComponentEntries,
  resolveComponents,
  phaseToOutcome,
  collectDebugSnapshot,
  collectComponentInfo,
]

/**
 * The collector graph as standalone JavaScript source: a preamble declaring the
 * module constants the functions read, then every function declaration. Dropping
 * this into a fresh scope rebinds the free identifiers, so the page copy IS the
 * in-process implementation rather than a mirror of it.
 */
export function debugCollectSource(): string {
  const preamble = [
    `const DEVTOOLS_COMPONENT_PREFIX = ${JSON.stringify(DEVTOOLS_COMPONENT_PREFIX)}`,
    `const DEFAULT_MESSAGE_LIMIT = ${DEFAULT_MESSAGE_LIMIT}`,
    `const DEFAULT_EFFECT_LIMIT = ${DEFAULT_EFFECT_LIMIT}`,
  ]
  return [...preamble, ...COLLECTOR_GRAPH.map((fn) => fn.toString())].join('\n')
}

/**
 * A self-contained expression that evaluates to a `DebugSnapshot` when run in a
 * page (Playwright's `page.evaluate(string)` / CDP `Runtime.evaluate`). This is
 * how an out-of-process caller gets the collector WITHOUT hand-copying it.
 */
export function debugSnapshotExpression(opts: SerializableCollectOptions = {}): string {
  return pageExpression(`collectDebugSnapshot(${JSON.stringify(opts)})`)
}

/** As `debugSnapshotExpression`, for `ComponentInfoSnapshot | null`. */
export function componentInfoExpression(opts: SerializableCollectOptions = {}): string {
  return pageExpression(`collectComponentInfo(${JSON.stringify(opts)})`)
}

function pageExpression(call: string): string {
  return `(() => {\n${debugCollectSource()}\nreturn ${call}\n})()`
}

// ── Component-registry resolver ─────────────────────────────────────

/**
 * How a caller reaches the component registry and the "selected component"
 * pointer. In the page that pointer is `globalThis.__lluiDebug`
 * (`globalRegistryAccess()`); in the MCP server's direct mode it is the relay's
 * own attached API. Abstracting it is what lets both sides run ONE resolver.
 */
export interface ComponentRegistryAccess {
  /** The live registry, or undefined when nothing has mounted. */
  registry(): Record<string, LluiDebugAPI> | undefined
  /** The currently selected API, or undefined when nothing is selected. */
  active(): LluiDebugAPI | undefined
  /** Point the selection at `api`. */
  setActive(api: LluiDebugAPI): void
}

/** Registry access backed by the runtime globals. */
export function globalRegistryAccess(): ComponentRegistryAccess {
  return {
    registry: () => globalThis.__lluiComponents,
    active: () => globalThis.__lluiDebug,
    setActive: (api) => {
      globalThis.__lluiDebug = api
    },
  }
}

/**
 * Registry-level pseudo-methods. They are NOT members of `LluiDebugAPI` — they
 * operate on the registry rather than on one component — but they travel the
 * same relay channel, so every relay has to recognize them.
 */
export type RegistryMethod = '__listComponents' | '__selectComponent'

export function isRegistryMethod(method: string): method is RegistryMethod {
  return method === '__listComponents' || method === '__selectComponent'
}

export interface ListComponentsResult {
  components: string[]
  active: string | null
}

export interface SelectComponentResult {
  active: string
}

/** Every mounted component's key, plus the key of the selected one (matched by
 *  identity — the pointer is the API object, not a name). */
export function listComponents(access: ComponentRegistryAccess): ListComponentsResult {
  const registry = access.registry()
  if (!registry) return { components: [], active: null }
  const selected = access.active()
  const active = selected
    ? (Object.entries(registry).find(([, api]) => api === selected)?.[0] ?? null)
    : null
  return { components: Object.keys(registry), active }
}

/** Move the selection to `key`. Throws when the key is not registered — the
 *  relays turn that into the error frame their callers already expect. */
export function selectComponent(
  access: ComponentRegistryAccess,
  key: string,
): SelectComponentResult {
  const entry = access.registry()?.[key]
  if (!entry) throw new Error(`unknown component: ${key}`)
  access.setActive(entry)
  return { active: key }
}

/** Dispatch a registry pseudo-method, mirroring the relay call shape. */
export function callRegistryMethod(
  access: ComponentRegistryAccess,
  method: RegistryMethod,
  args: readonly unknown[],
): ListComponentsResult | SelectComponentResult {
  if (method === '__listComponents') return listComponents(access)
  const key = typeof args[0] === 'string' ? args[0] : ''
  return selectComponent(access, key)
}
