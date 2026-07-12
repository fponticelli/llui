// @llui/notes-format — the zero-dependency canonical home of the devmode
// notebook on-disk format.
//
// The three modules here (note-types, note-format, note-serialize) are the
// fs-free, DOM-free contract shared by every side of the notebook:
//   - the server filesystem store in `@llui/vite-plugin`
//   - the browser stores + HUD in `@llui/devmode-annotate`
//   - the MCP server in `@llui/mcp`
//
// Splitting them out of `@llui/devmode-annotate` keeps consumers of the
// server store (i.e. every app that installs `@llui/vite-plugin`) from
// pulling in the HUD's editor stack (lexical + friends).

export * from './note-types.js'
export * from './note-format.js'
export * from './note-serialize.js'
