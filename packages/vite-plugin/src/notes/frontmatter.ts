// Note serialization / parsing. The canonical, fs-free implementation lives
// in `@llui/devmode-annotate/note-serialize` so the server filesystem store
// and browser stores (export bundles, dev import) emit and read an identical
// on-disk `.md` format. This module re-exports it for the server's existing
// call sites.

export {
  serializeNote,
  parseNote,
  type SerializedNote,
} from '@llui/devmode-annotate/note-serialize'
