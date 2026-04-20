import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AgentToken } from '../protocol.js'

export type TokenPayload = {
  tid: string
  iat: number
  exp: number
  scope: 'agent'
}

export type VerifyResult =
  | { kind: 'ok'; payload: TokenPayload }
  | { kind: 'invalid'; reason: 'malformed' | 'bad-signature' | 'expired' }

const PREFIX = 'llui-agent_'

function toKeyBuffer(key: string | Uint8Array): Buffer {
  const buf = typeof key === 'string' ? Buffer.from(key, 'utf8') : Buffer.from(key)
  if (buf.length < 32) throw new Error('signingKey must be at least 32 bytes')
  return buf
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function b64urlDecode(s: string): Buffer | null {
  try {
    return Buffer.from(s, 'base64url')
  } catch {
    return null
  }
}

/**
 * Serialize a payload to `llui-agent_<base64url(json)>.<base64url(hmac)>`.
 * See spec §6.1.
 */
export function signToken(payload: TokenPayload, key: string | Uint8Array): AgentToken {
  const keyBuf = toKeyBuffer(key)
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8')
  const payloadPart = b64url(jsonBuf)
  const mac = createHmac('sha256', keyBuf).update(payloadPart).digest()
  const sigPart = b64url(mac)
  return (PREFIX + payloadPart + '.' + sigPart) as AgentToken
}

/**
 * Verify the signature, parse the payload, and check expiry.
 */
export function verifyToken(
  token: string,
  key: string | Uint8Array,
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!token.startsWith(PREFIX)) return { kind: 'invalid', reason: 'malformed' }
  const body = token.slice(PREFIX.length)
  const dot = body.indexOf('.')
  if (dot < 0) return { kind: 'invalid', reason: 'malformed' }

  const payloadPart = body.slice(0, dot)
  const sigPart = body.slice(dot + 1)
  const sigBuf = b64urlDecode(sigPart)
  if (!sigBuf) return { kind: 'invalid', reason: 'malformed' }

  const keyBuf = toKeyBuffer(key)
  const expected = createHmac('sha256', keyBuf).update(payloadPart).digest()
  if (expected.length !== sigBuf.length || !timingSafeEqual(expected, sigBuf)) {
    return { kind: 'invalid', reason: 'bad-signature' }
  }

  const jsonBuf = b64urlDecode(payloadPart)
  if (!jsonBuf) return { kind: 'invalid', reason: 'malformed' }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonBuf.toString('utf8'))
  } catch {
    return { kind: 'invalid', reason: 'malformed' }
  }

  if (!isTokenPayload(parsed)) return { kind: 'invalid', reason: 'malformed' }
  if (parsed.exp <= nowSec) return { kind: 'invalid', reason: 'expired' }
  return { kind: 'ok', payload: parsed }
}

function isTokenPayload(x: unknown): x is TokenPayload {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tid === 'string' &&
    typeof o.iat === 'number' &&
    typeof o.exp === 'number' &&
    o.scope === 'agent'
  )
}
