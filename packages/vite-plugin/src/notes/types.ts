// The notebook wire-protocol types live in `@llui/devmode-annotate`
// (the HUD package is the producer of every request shape). We re-export
// them here so consumers that already import from `@llui/vite-plugin`
// continue to work. Editing the types themselves means editing
// packages/devmode-annotate/src/note-types.ts.

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
  ListNotesError,
  ListNotesQuery,
  ListNotesResponse,
  LogLevel,
  MessageLogEntry,
  NoteBody,
  NoteFrontmatter,
  NoteIntent,
  NoteKind,
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
} from '@llui/notes-format/note-types'
