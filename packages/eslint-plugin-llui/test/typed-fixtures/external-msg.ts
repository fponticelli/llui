// External Msg union with an UNCONVENTIONAL name (`Action` — not
// `Msg`, not `*Msg`). The dropped name heuristics would never fire
// on this; only typed-lint cross-file detection can recognise it as
// a Msg union by chasing the symbol through `component<S, Action, E>`.
export type Action =
  | { type: 'untaggedFromExternalFile' }
  /** @intent("Has tag") */
  | { type: 'taggedFromExternalFile' }
