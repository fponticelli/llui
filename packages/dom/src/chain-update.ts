/**
 * Compose multiple update handlers into one.
 * Each handler returns [newState, effects] if it handled the message, or null to pass through.
 * The first handler that returns non-null wins.
 */
export function chainUpdate<S, M, E>(
  ...handlers: Array<(state: S, msg: M) => [S, E[]] | null>
): (state: S, msg: M) => [S, E[]] {
  return (state, msg) => {
    for (const handler of handlers) {
      const result = handler(state, msg)
      if (result) return result
    }
    return [state, []]
  }
}
