import { describe, it, expect } from 'vitest'
import {
  defaultIdentityResolver,
  signCookieValue,
  type IdentityResolver,
} from '../../src/server/identity.js'

const key = 'x'.repeat(32)

function mkReq(cookieHeader: string | null): Request {
  const h = new Headers()
  if (cookieHeader) h.set('cookie', cookieHeader)
  return new Request('https://app.example/agent/mint', { method: 'POST', headers: h })
}

describe('defaultIdentityResolver', () => {
  it('returns null when the cookie is absent', async () => {
    const resolver: IdentityResolver = defaultIdentityResolver({
      name: 'llui-agent-uid',
      signingKey: key,
    })
    expect(await resolver(mkReq(null))).toBeNull()
  })

  it('returns null when the cookie is present but signature invalid', async () => {
    const resolver = defaultIdentityResolver({ name: 'llui-agent-uid', signingKey: key })
    expect(await resolver(mkReq('llui-agent-uid=bogus.signature'))).toBeNull()
  })

  it('returns the uid when the signed cookie validates', async () => {
    const signed = await signCookieValue('user-42', key)
    const resolver = defaultIdentityResolver({ name: 'llui-agent-uid', signingKey: key })
    expect(await resolver(mkReq(`llui-agent-uid=${signed}`))).toBe('user-42')
  })

  it('ignores cookies other than the configured name', async () => {
    const signed = await signCookieValue('user-42', key)
    const resolver = defaultIdentityResolver({ name: 'llui-agent-uid', signingKey: key })
    expect(await resolver(mkReq(`session=abc; llui-agent-uid=${signed}; csrf=xyz`))).toBe('user-42')
  })

  it('factory throws when constructed without a signing key', () => {
    expect(() => defaultIdentityResolver({ name: 'llui-agent-uid', signingKey: '' })).toThrow()
  })
})
