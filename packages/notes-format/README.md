# @llui/notes-format

Zero-dependency (bar `yaml`) home of the [LLui](https://github.com/fponticelli/llui) devmode
notebook **on-disk format**.

Three fs-free, DOM-free modules describe the note contract shared by every side of the notebook:

- `note-types` — the `NoteFrontmatter` / `NoteBody` / wire-protocol / SSE-event type surface.
- `note-format` — filename, slug, session-name, and status-replay helpers (`deriveSlug`,
  `deriveFilename`, `parseFilename`, `nextId`, `defaultSessionName`, `buildQueue`, …) plus
  `NOTE_SCHEMA_VERSION`.
- `note-serialize` — `serializeNote` / `parseNote`, the YAML-frontmatter `.md` (de)serializer.

Splitting these out of `@llui/devmode-annotate` lets the server filesystem store
(`@llui/vite-plugin`) and the MCP server (`@llui/mcp`) consume the format **without** dragging in
the HUD's editor stack (lexical + friends, ~18 MB). `@llui/devmode-annotate` re-exports these from
its own `./note-types` / `./note-format` / `./note-serialize` subpaths, so its public API is
unchanged.

```bash
pnpm add @llui/notes-format
```

```ts
import { serializeNote, parseNote } from '@llui/notes-format/note-serialize'
import { deriveSlug, nextId } from '@llui/notes-format/note-format'
import type { NoteFrontmatter } from '@llui/notes-format/note-types'
```
