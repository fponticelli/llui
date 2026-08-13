// `@llui/lexical-collab` — opt-in collaborative editing for the LLui ↔ Lexical
// binding. Spread `yjsCollab(...).foreign` into `lexicalForeign` — it carries
// the binding registration AND the seam settings a CRDT session requires, so the
// built-in `@lexical/history` stack and the boot-time seed are disabled by the
// act of wiring rather than by the host remembering to. Or use the markdown
// editor's `collab` option, which does the same for you.

export {
  yjsCollab,
  type YjsCollab,
  type YjsCollabConfig,
  type CollabForeignOptions,
  type CollabProvider,
  type CollabUser,
} from './collab.js'
