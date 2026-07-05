/**
 * JSON-Pointer (RFC 6901) resolution and immutable upsert over an A2UI data model.
 *
 * A2UI uses absolute pointers (`/user/name`) against the surface data-model root
 * and relative pointers (`name`) scoped to the current template item. Both forms
 * tokenize the same way here; the caller decides which root to resolve against.
 */

import type { JsonValue, JsonObject } from './protocol.js'

function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** Split a pointer into its path tokens. `''` and `'/'` both mean the root. */
export function pointerTokens(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return []
  const raw = pointer.startsWith('/') ? pointer.slice(1) : pointer
  return raw.split('/').map(unescapeToken)
}

function isIndexToken(token: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(token)
}

/** Resolve a pointer against a data model, or `undefined` if any segment is missing. */
export function resolvePointer(root: JsonValue, pointer: string): JsonValue | undefined {
  const tokens = pointerTokens(pointer)
  let current: JsonValue | undefined = root
  for (const token of tokens) {
    if (current === null || typeof current !== 'object') return undefined
    if (Array.isArray(current)) {
      if (!isIndexToken(token)) return undefined
      const index = Number(token)
      if (index >= current.length) return undefined
      current = current[index]
    } else {
      const obj = current as JsonObject
      if (!Object.prototype.hasOwnProperty.call(obj, token)) return undefined
      current = obj[token]
    }
  }
  return current
}

function setIn(
  node: JsonValue | undefined,
  tokens: readonly string[],
  index: number,
  value: JsonValue | undefined,
): JsonValue {
  const token = tokens[index] as string
  const isLast = index === tokens.length - 1

  // An array level: the current token indexes into an array.
  if (isIndexToken(token) && (Array.isArray(node) || node === undefined || node === null)) {
    const arr: JsonValue[] = Array.isArray(node) ? node.slice() : []
    const i = Number(token)
    if (isLast) {
      if (value === undefined) {
        // Preserve indices: null out the slot rather than reindexing.
        if (i < arr.length) arr[i] = null
      } else {
        arr[i] = value
      }
    } else {
      arr[i] = setIn(arr[i], tokens, index + 1, value)
    }
    return arr
  }

  // An object level.
  const obj: Record<string, JsonValue> =
    node !== null && typeof node === 'object' && !Array.isArray(node)
      ? { ...(node as JsonObject) }
      : {}
  if (isLast) {
    if (value === undefined) {
      delete obj[token]
    } else {
      obj[token] = value
    }
  } else {
    obj[token] = setIn(obj[token], tokens, index + 1, value)
  }
  return obj
}

/**
 * Return a new data model with `value` written at `pointer` (upsert semantics).
 * Missing intermediate containers are created; `undefined` removes the key.
 * Untouched siblings keep their identity (structural sharing).
 */
export function applyPointer(
  root: JsonValue,
  pointer: string,
  value: JsonValue | undefined,
): JsonValue {
  const tokens = pointerTokens(pointer)
  if (tokens.length === 0) return value === undefined ? null : value
  return setIn(root, tokens, 0, value)
}
