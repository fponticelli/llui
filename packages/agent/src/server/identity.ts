export type IdentityResolver = (req: Request) => Promise<string | null>

export type IdentityCookieConfig = {
  name: string
  signingKey: string | Uint8Array
}

/**
 * Normalize to `Uint8Array<ArrayBuffer>` — WebCrypto rejects
 * `Uint8Array<ArrayBufferLike>` which is what `TextEncoder.encode()`
 * produces under newer TS lib types. One-shot copy is cheap.
 */
function toBytes(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const raw = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const buf = new ArrayBuffer(raw.byteLength)
  const out = new Uint8Array(buf)
  out.set(raw)
  return out
}

async function importHmacKey(key: string | Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  )
}

function toBase64Url(bytes: Uint8Array): string {
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

export function defaultIdentityResolver(cfg: IdentityCookieConfig): IdentityResolver {
  if (!cfg.signingKey || (typeof cfg.signingKey === 'string' && cfg.signingKey.length < 32)) {
    throw new Error('IdentityCookie signingKey must be at least 32 bytes')
  }

  return async (req) => {
    const cookie = req.headers.get('cookie')
    if (!cookie) return null
    const pairs = cookie.split(';').map((s) => s.trim())
    for (const pair of pairs) {
      const eq = pair.indexOf('=')
      if (eq < 0) continue
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (name !== cfg.name) continue
      const dot = value.indexOf('.')
      if (dot < 0) return null
      const rawValue = value.slice(0, dot)
      const sigPart = value.slice(dot + 1)
      const sigBytes = fromBase64Url(sigPart)
      if (!sigBytes) return null
      const cryptoKey = await importHmacKey(cfg.signingKey, ['verify'])
      const ok = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, toBytes(rawValue))
      if (!ok) return null
      return rawValue
    }
    return null
  }
}

/**
 * Async because `crypto.subtle.sign` is the cross-runtime standard.
 * Callers building a `Set-Cookie` header must `await` this.
 */
export async function signCookieValue(
  value: string,
  signingKey: string | Uint8Array,
): Promise<string> {
  const cryptoKey = await importHmacKey(signingKey, ['sign'])
  const macBuf = await crypto.subtle.sign('HMAC', cryptoKey, toBytes(value))
  return `${value}.${toBase64Url(new Uint8Array(macBuf))}`
}
