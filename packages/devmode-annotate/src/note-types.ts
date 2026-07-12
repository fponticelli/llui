// The note-type contract now lives in the zero-dependency
// `@llui/notes-format` package so consumers of the server store
// (`@llui/vite-plugin`, `@llui/mcp`) can pull it without the HUD's editor
// stack. Re-exported here so this package's public `./note-types` subpath
// and every internal `./note-types.js` import keep working unchanged.
export * from '@llui/notes-format/note-types'
