import { createHash } from 'node:crypto'
import type { MessageAnnotations } from './msg-annotations.js'

export type SchemaHashInput = {
  msgSchema: unknown
  stateSchema: unknown
  msgAnnotations: Record<string, MessageAnnotations> | null | undefined
}

/**
 * Stable hex SHA-256 (first 32 chars) over a normalized JSON serialization
 * of msgSchema + stateSchema + msgAnnotations. Object key order is
 * normalized so equivalent inputs always produce equal hashes.
 *
 * Used by the runtime to detect when the browser-to-server `hello` frame
 * needs to re-send its schema payload (dev hot-reload).
 */
export function computeSchemaHash(input: SchemaHashInput): string {
  const normalized = {
    msgSchema: sortDeep(input.msgSchema),
    stateSchema: sortDeep(input.stateSchema),
    msgAnnotations: sortDeep(input.msgAnnotations ?? null),
  }
  const json = JSON.stringify(normalized)
  return createHash('sha256').update(json).digest('hex').slice(0, 32)
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortDeep)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortDeep(obj[k])
  }
  return out
}
