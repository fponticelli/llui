// The note (de)serializer now lives in the zero-dependency
// `@llui/notes-format` package. Re-exported here so this package's public
// `./note-serialize` subpath and every internal `./note-serialize.js` import
// keep working unchanged.
export * from '@llui/notes-format/note-serialize'
