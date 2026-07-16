---
title: '@llui/notes-format'
description: 'Devmode notebook on-disk format: note types, filename/slug/session helpers, YAML (de)serialization'
---

# @llui/notes-format

The on-disk format for the [LLui](https://github.com/fponticelli/llui) devmode notebook. A zero-dependency (bar `yaml`) package that defines the note types and the filename/slug/session helpers and YAML (de)serialization shared by the vite-plugin server store, the dev-mode HUD, and the MCP server — so all three read and write the exact same notes on disk.

```bash
pnpm add @llui/notes-format
```

## Usage

```ts
import { serializeNote, parseNote } from '@llui/notes-format/note-serialize'
import type { Note } from '@llui/notes-format/note-types'

// Round-trip a note through its YAML-front-matter on-disk form.
const text = serializeNote(note)
const parsed: Note = parseNote(text)
```

## Entry points

| Import                              | Purpose                               |
| ----------------------------------- | ------------------------------------- |
| `@llui/notes-format`                | Barrel — re-exports the modules below |
| `@llui/notes-format/note-types`     | Note type definitions                 |
| `@llui/notes-format/note-format`    | Filename / slug / session helpers     |
| `@llui/notes-format/note-serialize` | YAML (de)serialization                |

<!-- auto-api:start -->

## Functions

### `buildQueue()`

Materialize per-note current status from a flat transition log, newest
touched first. One entry per note id that has ever transitioned;
optionally filtered by status.

```typescript
function buildQueue(
  transitions: readonly StatusTransition[],
  filter?: { status?: NoteStatus | NoteStatus[] },
): QueueEntry[]
```

### `currentStatusFromHistory()`

Current status for a note: last `to`, or null when it has no transitions.

```typescript
function currentStatusFromHistory(history: readonly StatusTransition[]): NoteStatus | null
```

### `defaultSessionName()`

Default UTC session folder name: `session-YYYY-MM-DD-HHMM`.

```typescript
function defaultSessionName(d: Date): string
```

### `deriveFilename()`

```typescript
function deriveFilename(id: string, author: Author, kind: NoteKind, slug: string): string
```

### `deriveSlug()`

```typescript
function deriveSlug(prose: string): string
```

### `nextId()`

The next id given the ids already present (handles gaps): padId(max+1).

```typescript
function nextId(existingIds: readonly number[]): string
```

### `padId()`

3-digit zero-padded session-local sequence id (001, 002, … then 1000+).

```typescript
function padId(n: number): string
```

### `parseFilename()`

```typescript
function parseFilename(filename: string): ParsedFilename | null
```

### `parseNote()`

```typescript
function parseNote(markdown: string): SerializedNote
```

### `preview()`

One-line preview of prose for note summaries.

```typescript
function preview(prose: string, max = 80): string
```

### `serializeNote()`

```typescript
function serializeNote(note: SerializedNote): string
```

## Types

### `Annotation`

```typescript
export type Annotation =
  | ({ type: 'rect' } & NoteRect & { label?: string })
  | { type: 'element'; selector: string; bbox: NoteRect; label?: string }
```

### `Author`

```typescript
export type Author = 'human' | 'llm'
```

### `CaptureLevel`

```typescript
export type CaptureLevel = 'standard' | 'verbose'
```

### `LogLevel`

```typescript
export type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'
```

### `NoteIntent`

```typescript
export type NoteIntent = 'task' | 'note'
```

### `NoteKind`

```typescript
export type NoteKind = 'rect' | 'element' | 'text' | 'capture' | 'reply'
```

### `NoteStatus`

```typescript
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
```

### `ReproEvent`

```typescript
export type ReproEvent =
  | { type: 'click'; t: number; selector: string }
  | { type: 'input'; t: number; selector: string; value?: string; redacted?: boolean }
  | { type: 'keydown'; t: number; key: string; mods?: string }
  | { type: 'route'; t: number; pathname: string }
```

### `ServerEvent`

```typescript
export type ServerEvent =
  | { type: 'note-created'; id: string; filename: string; author: Author }
  | { type: 'note-updated'; id: string; sessionId: string }
  | { type: 'note-deleted'; id: string; sessionId: string }
  | {
      type: 'task-progress'
      noteId: string
      elapsedMs: number
      /** Token counters from the LLM stream.
       *   - `in`: latest cumulative input_tokens (context size). Grows
       *           monotonically across the conversation.
       *   - `out`: sum of all output_tokens generated so far.
       *   - `cacheRead`: prompt-cache hits, if the model reports them
       *           (claude's `cache_read_input_tokens`). Shows how much
       *           of the context was served from cache vs. reprocessed. */
      tokens?: { in: number; out: number; cacheRead?: number }
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
```

### `SseRole`

```typescript
export type SseRole = 'hud' | 'mcp' | 'viewer'
```

## Interfaces

### `AgentSchemaSummary`

```typescript
export interface AgentSchemaSummary {
  msg: string
  fields: Record<string, string>
}
```

### `CaptureRequestPayload`

```typescript
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
```

### `CaptureRequestResponse`

```typescript
export interface CaptureRequestResponse {
  requestId: string
  status: 'fulfilled' | 'timeout' | 'no-client'
  note?: CreateNoteResponse
}
```

### `ComponentMetaRef`

```typescript
export interface ComponentMetaRef {
  file: string
  line: number
  name: string
}
```

### `ConsoleLogEntry`

```typescript
export interface ConsoleLogEntry {
  ts: string
  level: LogLevel
  text: string
}
```

### `CreateNoteRequest`

```typescript
export interface CreateNoteRequest {
  body: string
  frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'>
  noteBody: NoteBody
  screenshot?: string
}
```

### `CreateNoteResponse`

```typescript
export interface CreateNoteResponse {
  id: string
  filename: string
  path: string
  sessionId: string
}
```

### `CurrentSessionResponse`

```typescript
export interface CurrentSessionResponse {
  sessionId: string
  startedAt: string
  notesDir: string
}
```

### `DirtyTraceEntry`

```typescript
export interface DirtyTraceEntry {
  component: string
  pathsTracked: string[]
  mask: number
  maskHi?: number
  lastFlippedBits: string[]
}
```

### `ListNotesError`

A note file that matched the canonical filename but could not be parsed
(corrupt frontmatter, torn write, hand-edited). Surfaced rather than
silently dropped so a broken note is visible instead of vanishing.

```typescript
export interface ListNotesError {
  filename: string
  message: string
}
```

### `ListNotesQuery`

```typescript
export interface ListNotesQuery {
  sessionId?: string
  author?: Author
  kind?: NoteKind | NoteKind[]
  since?: string
  limit?: number
}
```

### `ListNotesResponse`

```typescript
export interface ListNotesResponse {
  sessionId: string
  notes: NoteSummary[]
  total: number
  /** Present (and non-empty) only when one or more note files failed to
   *  parse. Absent on the clean path so existing consumers are unaffected. */
  errors?: ListNotesError[]
}
```

### `MessageLogEntry`

```typescript
export interface MessageLogEntry {
  ts: string
  component: string
  msg: unknown
}
```

### `NoteBody`

```typescript
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
```

### `NoteFrontmatter`

```typescript
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
```

### `NoteRect`

```typescript
export interface NoteRect {
  x: number
  y: number
  w: number
  h: number
}
```

### `NoteSummary`

```typescript
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
  /** Frontmatter shortcuts surfaced in the list so the HUD can
   *  rehydrate trackedTasks + chainHistories on reload without
   *  fetching each note individually. Optional for back-compat with
   *  servers that don't populate them. */
  intent?: NoteIntent
  chainName?: string
  /** For reply notes only — the original task this reply addresses. */
  replyTo?: string
  /** For reply notes only — the LLM's one-line summary of the
   *  proposed change (extracted from proposedDiff). */
  proposedSummary?: string
}
```

### `ParsedFilename`

```typescript
export interface ParsedFilename {
  id: string
  idNum: number
  author: Author
  kind: NoteKind
  slug: string
}
```

### `PendingEffectEntry`

```typescript
export interface PendingEffectEntry {
  id: string
  component: string
  effect: unknown
  sinceMs: number
}
```

### `PendingMessage`

```typescript
export interface PendingMessage {
  component: string
  msg: unknown
}
```

### `ProposedDiff`

```typescript
export interface ProposedDiff {
  files: Array<{ path: string; patch: string }>
  summary: string
  confidence: 'high' | 'medium' | 'low'
}
```

### `QueueEntry`

```typescript
export interface QueueEntry {
  noteId: string
  status: NoteStatus
  transitions: StatusTransition[]
}
```

### `RecentEffectEntry`

```typescript
export interface RecentEffectEntry {
  ts: string
  component: string
  effect: unknown
  outcome: 'ok' | 'error' | 'cancelled'
  error?: string
}
```

### `RuntimeErrorEntry`

```typescript
export interface RuntimeErrorEntry {
  ts: string
  kind: 'runtime' | 'compiler'
  file?: string
  line?: number
  message: string
  stack?: string
}
```

### `SerializedNote`

```typescript
export interface SerializedNote {
  frontmatter: NoteFrontmatter
  prose: string
  body: NoteBody
}
```

### `SourceMapEntry`

```typescript
export interface SourceMapEntry {
  selector: string
  file: string
  line: number
  componentPath: string[]
}
```

### `StatusTransition`

```typescript
export interface StatusTransition {
  ts: string
  noteId: string
  from: NoteStatus | null
  to: NoteStatus
  by: Author | 'system'
  reason?: string
}
```

### `StructuralSnapshot`

```typescript
export interface StructuralSnapshot {
  branches: Array<{ at: string; activeArm: string }>
  shows: Array<{ at: string; visible: boolean }>
  eachKeys: Array<{ at: string; keys: string[] }>
}
```

### `VerboseNoteBody`

```typescript
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
```

## Constants

### `NOTE_FILENAME_RE`

```typescript
const NOTE_FILENAME_RE
```

### `NOTE_SCHEMA_VERSION`

On-disk note-format schema version. Stamped into export bundles and
checked on dev import so a producer and consumer never silently disagree.
v2 = the current "body under a `body:` frontmatter key" format (v1 was the
legacy trailing-```json fence, still readable by `parseNote`).

```typescript
const NOTE_SCHEMA_VERSION
```

<!-- auto-api:end -->
