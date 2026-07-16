/**
 * JSON-Pointer (RFC 6901) resolution and immutable upsert over an A2UI data model.
 *
 * A2UI uses absolute pointers (`/user/name`) against the surface data-model root
 * and relative pointers (`name`) scoped to the current template item. Both forms
 * tokenize the same way here; the caller decides which root to resolve against.
 */

import type { JsonValue, JsonObject } from './protocol.js'
import { warnOnce } from './catalog.js'

/**
 * Absolute cap on any array index written via a pointer. A server-supplied
 * `/items/999999999` must not be allowed to balloon a sparse array to a
 * billion slots (OOM/DoS from a ~60-byte envelope). Writes may append
 * (`i === arr.length`) but never open a gap, and never exceed this cap.
 */
const MAX_ARRAY_INDEX = 100_000

/** Pointer tokens that must never be written at an object level (prototype
 * pollution defense-in-depth): writing `obj['__proto__'] = …` on a plain object
 * mutates its prototype. */
const RESERVED_TOKENS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor'])

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

  const nodeIsArray = Array.isArray(node)
  // RFC 6901: `-` addresses the (nonexistent) element after the last — an
  // explicit append-at-end.
  const isAppend = token === '-'

  // An array level: the current token indexes into an existing array, or we
  // create a fresh array because the token is an index / append marker and the
  // slot is empty. (An index token targeting an existing OBJECT stays on the
  // object branch below — numeric string keys on objects are legal.)
  if (nodeIsArray || ((isIndexToken(token) || isAppend) && (node === undefined || node === null))) {
    // Container/token mismatch: a non-index, non-append token targeting an
    // existing array must NOT fall through to the object branch (which would
    // rebuild a fresh object and silently discard the whole array). Refuse the
    // write and keep the array intact, exactly like an out-of-range index.
    if (nodeIsArray && !isIndexToken(token) && !isAppend) {
      warnOnce(`Refusing to write non-index pointer token "${token}" to an array`)
      return node as JsonValue
    }
    const arr: JsonValue[] = nodeIsArray ? (node as JsonValue[]).slice() : []
    const i = isAppend ? arr.length : Number(token)
    // Reject out-of-range writes: append at the end is fine, but never open a
    // gap or exceed the absolute cap (would grow a sparse array without bound).
    if (i > arr.length || i >= MAX_ARRAY_INDEX) {
      warnOnce(`Refusing out-of-range array write at index ${i} (length ${arr.length})`)
      return arr
    }
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

  // An object level. Reserved tokens are refused (prototype pollution).
  if (RESERVED_TOKENS.has(token)) {
    warnOnce(`Refusing to write reserved pointer token "${token}"`)
    return node === null || node === undefined ? {} : node
  }
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
