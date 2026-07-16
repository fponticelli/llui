// ── LAP WebSocket frame schemas ──────────────────────────────────
//
// The relay's bidirectional framing (browser ↔ @llui/agent server over
// /agent/ws) is defined here as zod schemas, and the TypeScript frame
// types are DERIVED from those schemas (`z.infer`) so the wire contract
// and the compile-time types can never drift apart. Both boundaries —
// the server's WS upgrade reader and the browser's ws-client — validate
// every inbound frame against these schemas instead of an unchecked
// `JSON.parse(...) as Frame`, so a malformed or hostile frame is rejected
// at the edge rather than dispatched with wrong-typed fields.
//
// App PAYLOADS carried by frames (state snapshots, the msg/state schema
// blobs, log entries) are validated loosely with `z.custom<T>()`: they
// are opaque data the relay forwards without interpreting, so the schema
// guards the frame ENVELOPE and the correlation fields (`t` / `id` /
// `code` / `confirmId` / `outcome`) — the parts routing depends on — and
// preserves the exact leaf types those payload fields already have.
import { z } from 'zod'
import type { LogEntry, MessageSchemaEntry, AgentDocs } from './protocol.js'

// ── Browser → server (ClientFrame) ───────────────────────────────

export const helloFrameSchema = z.object({
  t: z.literal('hello'),
  appName: z.string(),
  appVersion: z.string(),
  msgSchema: z.custom<Record<string, MessageSchemaEntry>>(),
  stateSchema: z.custom<object>(),
  affordancesSample: z.custom<object[]>(),
  docs: z.custom<AgentDocs | null>(),
  schemaHash: z.string(),
  lapVersion: z.number().optional(),
})

export const rpcReplyFrameSchema = z.object({
  t: z.literal('rpc-reply'),
  id: z.string(),
  result: z.unknown(),
})

export const rpcErrorFrameSchema = z.object({
  t: z.literal('rpc-error'),
  id: z.string(),
  code: z.string(),
  detail: z.string().optional(),
})

export const confirmResolvedFrameSchema = z.object({
  t: z.literal('confirm-resolved'),
  confirmId: z.string(),
  outcome: z.enum(['confirmed', 'user-cancelled']),
  stateAfter: z.unknown(),
})

export const stateUpdateFrameSchema = z.object({
  t: z.literal('state-update'),
  id: z.string().optional(),
  path: z.string(),
  stateAfter: z.unknown(),
})

export const logAppendFrameSchema = z.object({
  t: z.literal('log-append'),
  entry: z.custom<LogEntry>(),
})

export const clientFrameSchema = z.discriminatedUnion('t', [
  helloFrameSchema,
  rpcReplyFrameSchema,
  rpcErrorFrameSchema,
  confirmResolvedFrameSchema,
  stateUpdateFrameSchema,
  logAppendFrameSchema,
])

// ── Server → browser (ServerFrame) ───────────────────────────────

export const rpcFrameSchema = z.object({
  t: z.literal('rpc'),
  id: z.string(),
  tool: z.string(),
  args: z.unknown(),
})

export const revokedFrameSchema = z.object({ t: z.literal('revoked') })
export const activeFrameSchema = z.object({ t: z.literal('active') })

export const logPushFrameSchema = z.object({
  t: z.literal('log-push'),
  entry: z.custom<LogEntry>(),
})

export const confirmExpireFrameSchema = z.object({
  t: z.literal('confirm-expire'),
  confirmId: z.string(),
})

export const watchFrameSchema = z.object({
  t: z.literal('watch'),
  id: z.string(),
  path: z.string().optional(),
})

export const unwatchFrameSchema = z.object({
  t: z.literal('unwatch'),
  id: z.string(),
})

/**
 * Server → browser handshake reply. Sent in response to the browser's
 * `hello`, carrying the wire version the server speaks and the oldest
 * client version it will accept. Lets the browser detect (and surface)
 * an incompatibility explicitly; the server independently terminates the
 * pairing when the client is below `minClientVersion`.
 */
export const helloAckFrameSchema = z.object({
  t: z.literal('hello-ack'),
  lapVersion: z.number(),
  minClientVersion: z.number(),
})

export const serverFrameSchema = z.discriminatedUnion('t', [
  rpcFrameSchema,
  revokedFrameSchema,
  activeFrameSchema,
  logPushFrameSchema,
  confirmExpireFrameSchema,
  watchFrameSchema,
  unwatchFrameSchema,
  helloAckFrameSchema,
])

// ── Derived TS types (single source of truth = the schemas above) ─

export type HelloFrame = z.infer<typeof helloFrameSchema>
export type RpcReplyFrame = z.infer<typeof rpcReplyFrameSchema>
export type RpcErrorFrame = z.infer<typeof rpcErrorFrameSchema>
export type ConfirmResolvedFrame = z.infer<typeof confirmResolvedFrameSchema>
export type StateUpdateFrame = z.infer<typeof stateUpdateFrameSchema>
export type LogAppendFrame = z.infer<typeof logAppendFrameSchema>
export type ClientFrame = z.infer<typeof clientFrameSchema>

export type RpcFrame = z.infer<typeof rpcFrameSchema>
export type RevokedFrame = z.infer<typeof revokedFrameSchema>
export type ActiveFrame = z.infer<typeof activeFrameSchema>
export type LogPushFrame = z.infer<typeof logPushFrameSchema>
export type ConfirmExpireFrame = z.infer<typeof confirmExpireFrameSchema>
export type WatchFrame = z.infer<typeof watchFrameSchema>
export type UnwatchFrame = z.infer<typeof unwatchFrameSchema>
export type HelloAckFrame = z.infer<typeof helloAckFrameSchema>
export type ServerFrame = z.infer<typeof serverFrameSchema>

/**
 * Parse + validate an inbound ClientFrame. Returns the typed frame on
 * success or `null` when the value isn't a well-formed frame — callers
 * drop `null` rather than dispatching an unchecked object.
 */
export function parseClientFrame(value: unknown): ClientFrame | null {
  const r = clientFrameSchema.safeParse(value)
  return r.success ? r.data : null
}

/**
 * Parse + validate an inbound ServerFrame. Returns the typed frame on
 * success or `null` when the value isn't a well-formed frame.
 */
export function parseServerFrame(value: unknown): ServerFrame | null {
  const r = serverFrameSchema.safeParse(value)
  return r.success ? r.data : null
}
