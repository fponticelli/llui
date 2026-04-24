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

/**
 * Normalize key + payload to `Uint8Array<ArrayBuffer>`, the shape
 * WebCrypto wants. Newer TS lib types parameterize `Uint8Array` over the
 * underlying buffer, and `TextEncoder.encode()` returns
 * `Uint8Array<ArrayBufferLike>` — which `crypto.subtle.*` won't accept
 * directly. A one-shot copy is cheap (HMAC inputs are bytes-small) and
 * keeps the types honest without `as BufferSource` scattered at call sites.
 */
function toBytes(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const raw = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const buf = new ArrayBuffer(raw.byteLength)
  const out = new Uint8Array(buf)
  out.set(raw)
  return out
}

function toKeyBytes(key: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof key === 'string') {
    if (key.length < 32) throw new Error('signingKey must be at least 32 bytes')
  } else if (key.byteLength < 32) {
    throw new Error('signingKey must be at least 32 bytes')
  }
  return toBytes(key)
}

/**
 * Import a signing key as a WebCrypto `CryptoKey`. Done per call so the
 * caller doesn't have to pre-import and pass it around; the cost is a
 * microtask per sign/verify, which is negligible for our call volume
 * (tokens verified once per LAP HTTP request).
 */
async function importHmacKey(key: string | Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toKeyBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  )
}

function toBase64Url(bytes: Uint8Array): string {
  // btoa needs a binary string; build it manually to avoid ArrayBuffer/Uint8Array quirks.
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
    const bin = atob(b64)
    const buf = new ArrayBuffer(bin.length)
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * Serialize a payload to `llui-agent_<base64url(json)>.<base64url(hmac)>`.
 * See spec §6.1. Async because WebCrypto's HMAC sign/verify is the
 * cross-runtime standard; Node, Cloudflare, Deno, and Bun all expose
 * `crypto.subtle` identically.
 */
export async function signToken(
  payload: TokenPayload,
  key: string | Uint8Array,
): Promise<AgentToken> {
  const cryptoKey = await importHmacKey(key, ['sign'])
  const jsonBytes = toBytes(JSON.stringify(payload))
  const payloadPart = toBase64Url(jsonBytes)
  const macBuf = await crypto.subtle.sign('HMAC', cryptoKey, toBytes(payloadPart))
  const sigPart = toBase64Url(new Uint8Array(macBuf))
  return (PREFIX + payloadPart + '.' + sigPart) as AgentToken
}

/**
 * Verify the signature, parse the payload, and check expiry.
 * `crypto.subtle.verify` does the constant-time compare internally,
 * so we don't need a separate `timingSafeEqual`.
 */
export async function verifyToken(
  token: string,
  key: string | Uint8Array,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!token.startsWith(PREFIX)) return { kind: 'invalid', reason: 'malformed' }
  const body = token.slice(PREFIX.length)
  const dot = body.indexOf('.')
  if (dot < 0) return { kind: 'invalid', reason: 'malformed' }

  const payloadPart = body.slice(0, dot)
  const sigPart = body.slice(dot + 1)
  const sigBytes = fromBase64Url(sigPart)
  if (!sigBytes) return { kind: 'invalid', reason: 'malformed' }

  const cryptoKey = await importHmacKey(key, ['verify'])
  const ok = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, toBytes(payloadPart))
  if (!ok) return { kind: 'invalid', reason: 'bad-signature' }

  const jsonBytes = fromBase64Url(payloadPart)
  if (!jsonBytes) return { kind: 'invalid', reason: 'malformed' }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(jsonBytes))
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
