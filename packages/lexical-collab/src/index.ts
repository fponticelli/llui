// `@llui/lexical-collab` — opt-in collaborative editing for the LLui ↔ Lexical
// binding. Wire `yjsCollab(...).register` into `lexicalForeign({ history: false,
// seedMode: 'deferred', register })`, or use the markdown editor's `collab`
// option which does this for you.

export {
  yjsCollab,
  type YjsCollab,
  type YjsCollabConfig,
  type CollabProvider,
  type CollabUser,
} from './collab.js'
