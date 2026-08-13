// The store entry point — `@llui/devmode-annotate/stores`.
//
// Deliberately separate from the package barrel: the barrel is the HUD, and
// the HUD statically imports the Markdown editor (and therefore Lexical,
// html-to-image, fflate). A live app that injects a custom store into
// `installAnnotateHud` must be able to name the store WITHOUT dragging the
// HUD into its entry chunk — importing `indexedDbStore` from the barrel would
// undo the whole point of the lazy `./install` entry (#116).
//
// So nothing here may import `../index.js`, and `test/entry-boundaries.test.ts`
// fails the build if the graph below ever reaches it.

export { devServerStore } from './dev-server-store.js'
export { httpStore, type HeadersInput, type HttpStoreOptions } from './http-store.js'
export {
  indexedDbStore,
  SCREENSHOT_URL_CACHE_LIMIT,
  type IndexedDbStoreOptions,
} from './indexed-db-store.js'
export type {
  EventSubscription,
  ExportableStore,
  FullNote,
  NotesStore,
  NoteStatusResponse,
  NoteUpdate,
  QueueEntry,
  QueueResponse,
  RawNote,
  RawSession,
  SessionSummary,
  StatusUpdate,
} from '../notes-store.js'
