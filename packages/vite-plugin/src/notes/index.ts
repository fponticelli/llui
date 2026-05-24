// Barrel for the on-disk notebook helpers. Exposed via the package's
// `./notes` subpath export — `@llui/mcp` imports the filesystem
// readers from here so the MCP server and the Vite plugin share one
// implementation of the on-disk format (no duplication, no drift).
//
// The middleware (in src/index.ts via configureServer) also calls into
// these helpers; everything routes through one source of truth.

export {
  createNote,
  ensureNotesRoot,
  listNotes,
  listSessions,
  readNote,
  readScreenshot,
} from './store.js'

export {
  defaultSessionName,
  ensureSession,
  readCurrentSessionFile,
  resolveCurrentSession,
  rotateSession,
  type ResolveSessionOptions,
  type RotatedSession,
  type SessionInfo,
} from './session.js'

export { parseNote, serializeNote, type SerializedNote } from './frontmatter.js'

export { deriveFilename, deriveSlug, padId } from './slug.js'

export {
  appendStatus,
  currentStatus,
  listQueue,
  readAllTransitions,
  readStatusHistory,
  type QueueEntry,
} from './status.js'

// Server-side middleware components. Exposed so test harnesses and
// alternative hosts (e.g. a standalone notebook server) can instantiate
// the middleware without going through the Vite plugin. Production
// consumers normally let the Vite plugin own these.
export { createEventBus, type EventBus, type SseEventListener } from './event-bus.js'
export {
  createCaptureRegistry,
  type CaptureRegistry,
  type SubmitOptions as CaptureSubmitOptions,
  type SubmitResult as CaptureSubmitResult,
} from './capture-registry.js'
export {
  createNotesMiddleware,
  type MiddlewareHandler,
  type NotesMiddlewareConfig,
} from './middleware.js'

export type {
  AgentSchemaSummary,
  Annotation,
  Author,
  CaptureLevel,
  CaptureRequestPayload,
  CaptureRequestResponse,
  ComponentMetaRef,
  ConsoleLogEntry,
  CreateNoteRequest,
  CreateNoteResponse,
  CurrentSessionResponse,
  DirtyTraceEntry,
  ListNotesQuery,
  ListNotesResponse,
  LogLevel,
  MessageLogEntry,
  NoteBody,
  NoteFrontmatter,
  NoteIntent,
  NoteKind,
  NotePoint,
  NoteRect,
  NoteStatus,
  NoteSummary,
  PendingEffectEntry,
  PendingMessage,
  ProposedDiff,
  RecentEffectEntry,
  RuntimeErrorEntry,
  ServerEvent,
  SourceMapEntry,
  SseRole,
  StatusTransition,
  StructuralSnapshot,
  VerboseNoteBody,
} from './types.js'
