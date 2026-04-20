import { createHmac, timingSafeEqual } from 'node:crypto'

export type IdentityResolver = (req: Request) => Promise<string | null>

export type IdentityCookieConfig = {
  name: string
  signingKey: string | Uint8Array
}

export function defaultIdentityResolver(cfg: IdentityCookieConfig): IdentityResolver {
  if (!cfg.signingKey || (typeof cfg.signingKey === 'string' && cfg.signingKey.length < 32)) {
    throw new Error('IdentityCookie signingKey must be at least 32 bytes')
  }
  const keyBuf =
    typeof cfg.signingKey === 'string'
      ? Buffer.from(cfg.signingKey, 'utf8')
      : Buffer.from(cfg.signingKey)

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
      const sigBuf = Buffer.from(sigPart, 'base64url')
      const expected = createHmac('sha256', keyBuf).update(rawValue).digest()
      if (expected.length !== sigBuf.length || !timingSafeEqual(expected, sigBuf)) return null
      return rawValue
    }
    return null
  }
}

export function signCookieValue(value: string, signingKey: string | Uint8Array): string {
  const keyBuf =
    typeof signingKey === 'string' ? Buffer.from(signingKey, 'utf8') : Buffer.from(signingKey)
  const mac = createHmac('sha256', keyBuf).update(value).digest('base64url')
  return `${value}.${mac}`
}
