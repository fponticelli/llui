// Shared notebook types. The on-disk format described in
// docs/proposals/devmode-annotate/01-on-disk-format.md is the canonical
// contract — these types are the runtime mirror of that schema.
//
// Re-exported from the package entrypoint so the HUD package
// (@llui/devmode-annotate) and the MCP server (@llui/mcp) can pull from
// one source.

export type Author = 'human' | 'llm'

export type NoteKind = 'rect' | 'lasso' | 'pin' | 'element' | 'arrow' | 'text' | 'capture' | 'reply'

export type NoteIntent = 'task' | 'note'

export type NoteStatus =
  | 'open'
  | 'claimed'
  | 'in-progress'
  | 'proposed'
  | 'accepted'
  | 'applied'
  | 'rejected'
  | 'wontfix'
  | 'failed'

export interface StatusTransition {
  ts: string
  noteId: string
  from: NoteStatus | null
  to: NoteStatus
  by: Author | 'system'
  reason?: string
}

export interface ProposedDiff {
  files: Array<{ path: string; patch: string }>
  summary: string
  confidence: 'high' | 'medium' | 'low'
}

export type CaptureLevel = 'standard' | 'verbose'

export interface NotePoint {
  x: number
  y: number
}

export interface NoteRect {
  x: number
  y: number
  w: number
  h: number
}

export type Annotation =
  | ({ type: 'rect' } & NoteRect & { label?: string })
  | { type: 'lasso'; points: NotePoint[]; label?: string }
  | { type: 'pin'; at: NotePoint; index: number; label: string }
  | { type: 'element'; selector: string; bbox: NoteRect; label?: string }
  | { type: 'arrow'; from: NotePoint; to: NotePoint; label?: string }
  | { type: 'highlight'; selector: string; style?: 'rect' | 'arrow'; label?: string }

export interface AgentSchemaSummary {
  msg: string
  fields: Record<string, string>
}

export interface ComponentMetaRef {
  file: string
  line: number
  name: string
}

export interface NoteFrontmatter {
  // Identity (server-assigned on POST /_llui/notes)
  id: string
  ts: string
  author: Author
  kind: NoteKind
  captureLevel: CaptureLevel

  // Location
  url: string
  route: string | null
  routeParams: Record<string, string>
  viewport: { w: number; h: number; dpr: number }

  // Component context (null when no element was targeted)
  componentPath: string[] | null
  componentMeta: ComponentMetaRef | null

  // Annotations baked into the screenshot
  annotations: Annotation[]

  // Files
  screenshot: string | null

  // Agent surface available at target element
  agentSchemas: AgentSchemaSummary[]

  // Versioning
  llui: { runtime: string; compiler: string }

  // Cross-references (optional)
  fulfillsRequestId?: string

  // Task-mode (P6) — optional, present when the note participates in
  // the task workflow. `intent: 'task'` puts the note in the status
  // machine; `kind: 'reply'` with `replyTo` set is the LLM's response.
  intent?: NoteIntent
  replyTo?: string
  proposedDiff?: ProposedDiff
  /** When true (default true for HUD-originated tasks), the router
   *  spawns the LLM with its resume-previous-conversation flag (e.g.
   *  `claude --continue`) so the LLM keeps prior context. Presets
   *  without a resume flag treat this as a no-op. */
  resume?: boolean
  /** Name of the resume chain this task participates in. The router
   *  keeps a map of chain name → last session id and passes the
   *  corresponding id via `--resume` when `resume: true`. Lets the
   *  user maintain independent conversation threads (e.g. "refactor",
   *  "ui-polish") without them stomping on each other. Default
   *  `'default'`. */
  chainName?: string
}

export type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

export interface MessageLogEntry {
  ts: string
  component: string
  msg: unknown
}

export interface PendingMessage {
  component: string
  msg: unknown
}

export interface PendingEffectEntry {
  id: string
  component: string
  effect: unknown
  sinceMs: number
}

export interface RecentEffectEntry {
  ts: string
  component: string
  effect: unknown
  outcome: 'ok' | 'error' | 'cancelled'
  error?: string
}

export interface DirtyTraceEntry {
  component: string
  pathsTracked: string[]
  mask: number
  maskHi?: number
  lastFlippedBits: string[]
}

export interface StructuralSnapshot {
  branches: Array<{ at: string; activeArm: string }>
  shows: Array<{ at: string; visible: boolean }>
  eachKeys: Array<{ at: string; keys: string[] }>
}

export interface SourceMapEntry {
  selector: string
  file: string
  line: number
  componentPath: string[]
}

export interface RuntimeErrorEntry {
  ts: string
  kind: 'runtime' | 'compiler'
  file?: string
  line?: number
  message: string
  stack?: string
}

export interface ConsoleLogEntry {
  ts: string
  level: LogLevel
  text: string
}

export interface VerboseNoteBody {
  scopeTree?: Array<{
    id: string
    parent: string | null
    component: string
    key?: string
  }>
  bindings?: {
    total: number
    hottest: Array<{ component: string; path: string; firesPerSec: number }>
    lastCycleMs: number
  }
  agentBridge?: {
    connectedAgents: string[]
    pendingToolCalls: number
    recentMsgs: Array<{ ts: string; direction: 'in' | 'out'; payload: unknown }>
  }
  transitionsInFlight?: Array<{ component: string; name: string; progress: number }>
  foreignInstances?: Array<{ component: string; library: string }>
}

export interface NoteBody {
  stateSnapshot?: unknown
  messageLog?: MessageLogEntry[]
  consoleLog?: ConsoleLogEntry[]

  pendingMessages?: PendingMessage[]
  effects?: {
    pending: PendingEffectEntry[]
    recent: RecentEffectEntry[]
  }
  dirtyTrace?: DirtyTraceEntry[]
  structuralAt?: StructuralSnapshot
  sourceMap?: SourceMapEntry[]
  errors?: RuntimeErrorEntry[]

  /** Captured user interactions from the HUD's repro recorder. The
   *  LLM uses this to understand what the developer did before the
   *  bug appeared. Times are milliseconds from the start of the
   *  recording, not absolute. */
  repro?: ReproEvent[]

  verbose?: VerboseNoteBody
}

export type ReproEvent =
  | { type: 'click'; t: number; selector: string }
  | { type: 'input'; t: number; selector: string; value: string }
  | { type: 'keydown'; t: number; key: string; mods?: string }
  | { type: 'route'; t: number; pathname: string }

// -- HTTP transport shapes -------------------------------------------------

export interface CreateNoteRequest {
  body: string
  frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'>
  noteBody: NoteBody
  screenshot?: string
}

export interface CreateNoteResponse {
  id: string
  filename: string
  path: string
  sessionId: string
}

export interface CaptureRequestPayload {
  route?: string
  url?: string
  selector?: string
  annotate?: Annotation[]
  prose?: string
  waitForMessage?: string
  captureLevel?: CaptureLevel
  timeoutMs?: number
}

export interface CaptureRequestResponse {
  requestId: string
  status: 'fulfilled' | 'timeout' | 'no-client'
  note?: CreateNoteResponse
}

export interface NoteSummary {
  id: string
  sessionId: string
  filename: string
  ts: string
  author: Author
  kind: NoteKind
  url: string
  componentPath: string[] | null
  preview: string
  hasScreenshot: boolean
}

export interface ListNotesQuery {
  sessionId?: string
  author?: Author
  kind?: NoteKind | NoteKind[]
  since?: string
  limit?: number
}

export interface ListNotesResponse {
  sessionId: string
  notes: NoteSummary[]
  total: number
}

export interface CurrentSessionResponse {
  sessionId: string
  startedAt: string
  notesDir: string
}

// -- SSE event union -------------------------------------------------------

export type SseRole = 'hud' | 'mcp' | 'viewer'

export type ServerEvent =
  | { type: 'note-created'; id: string; filename: string; author: Author }
  | { type: 'note-updated'; id: string; sessionId: string }
  | { type: 'note-deleted'; id: string; sessionId: string }
  | {
      type: 'task-progress'
      noteId: string
      elapsedMs: number
      tokens?: { in: number; out: number }
      toolSummary?: string
    }
  | { type: 'capture-request'; requestId: string; payload: CaptureRequestPayload }
  | { type: 'capture-request-cancelled'; requestId: string }
  | { type: 'session-rotated'; sessionId: string }
  | {
      type: 'status-changed'
      noteId: string
      from: NoteStatus | null
      to: NoteStatus
      /** Optional human-readable context — e.g. the LLM's proposed-fix
       *  summary, a failure message, or a git-apply conflict. The HUD
       *  surfaces this verbatim in its status line. */
      reason?: string
    }
