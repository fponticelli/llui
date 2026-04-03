/**
 * Type utility for form field messages.
 * Generates a discriminated union where each field gets its own typed variant,
 * avoiding the need to define one message type per field.
 *
 * Usage:
 *   type Fields = { name: string; email: string; age: number }
 *   type Msg = FieldMsg<Fields> | { type: 'submit' }
 *   // Produces: { type: 'setField'; field: 'name'; value: string }
 *   //         | { type: 'setField'; field: 'email'; value: string }
 *   //         | { type: 'setField'; field: 'age'; value: number }
 *   //         | { type: 'submit' }
 */
export type FieldMsg<Fields extends Record<string, unknown>> = {
  [K in keyof Fields]: { type: 'setField'; field: K; value: Fields[K] }
}[keyof Fields]

/**
 * Apply a field update to state immutably.
 * Returns a new state object with the specified field updated.
 *
 * Usage in update():
 *   case 'setField':
 *     return [applyField(state, msg.field, msg.value), []]
 */
export function applyField<S extends Record<string, unknown>, K extends keyof S>(
  state: S,
  field: K,
  value: S[K],
): S {
  return { ...state, [field]: value }
}
