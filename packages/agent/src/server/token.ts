import type { AgentToken } from '../protocol.js'

const PREFIX = 'llui-agent_'
const TOKEN_BYTES = 32

/**
 * Result of looking up a presented token. The `expired` reason is
 * returned by the verify path when the token's record exists but its
 * hard-expiry has passed; `unknown` covers both "no record" and
 * "wrong hash" so a probe-by-hash leak surface is uniform.
 */
export type VerifyResult =
  | { kind: 'ok'; tid: string }
  | { kind: 'invalid'; reason: 'malformed' | 'unknown' | 'expired' }

/**
 * Mint an opaque random bearer token + the SHA-256 hash the server
 * stores as a lookup key. Tokens are 32 bytes of CSPRNG entropy (256
 * bits) base64url-encoded with the `llui-agent_` prefix — total
 * 54–55 chars, vs the previous JWT format's ~250.
 *
 * The token itself never persists; only the hash does. A leaked store
 * therefore does not compromise live tokens, since the bearer secret
 * isn't recoverable from the hash. This matches the standard "session
 * cookie / API key" pattern.
 *
 * The opaque form is the only token format the server understands as
 * of 0.0.35. The previous HMAC-signed JWT format is gone; clients
 * carrying old tokens will fail with `unknown` on first call and need
 * to remint. See CHANGELOG.
 */
export async function mintToken(): Promise<{ token: AgentToken; tokenHash: string }> {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  const token = (PREFIX + toBase64Url(bytes)) as AgentToken
  const tokenHash = await sha256Hex(token)
  return { token, tokenHash }
}

/**
 * Compute the SHA-256 hash of a presented bearer token. Returns `null`
 * when the prefix is missing — the verify path uses that to fail-fast
 * on garbage-shaped Authorization headers without a crypto round-trip.
 * Hash is hex-encoded for portability across stores (Postgres `text`,
 * KV string, etc.).
 */
export async function tokenHashOf(token: string): Promise<string | null> {
  if (!token.startsWith(PREFIX)) return null
  return sha256Hex(token)
}

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  const arr = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < arr.length; i++) {
    out += arr[i]!.toString(16).padStart(2, '0')
  }
  return out
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
