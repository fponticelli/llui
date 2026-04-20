import type { ServerOptions, AgentServerHandle } from './options.js'
import { InMemoryTokenStore } from './token-store.js'
import { consoleAuditSink } from './audit.js'
import { defaultRateLimiter } from './rate-limit.js'
import { createHttpRouter } from './http/router.js'

const ANONYMOUS_RESOLVER = async () => null

/**
 * Compose the server from its (defaulted) parts. Returns a handle whose
 * `router` matches any /agent/* request. `wsUpgrade` lands in Plan 5.
 *
 * Spec §10.1.
 */
export function createLluiAgentServer(opts: ServerOptions): AgentServerHandle {
  if (!opts.signingKey) {
    throw new Error('createLluiAgentServer: signingKey is required')
  }

  const tokenStore = opts.tokenStore ?? new InMemoryTokenStore()
  const identityResolver = opts.identityResolver ?? ANONYMOUS_RESOLVER
  const auditSink = opts.auditSink ?? consoleAuditSink
  const rateLimiter = opts.rateLimiter ?? defaultRateLimiter({ perBucket: '30/minute' })
  const lapBasePath = opts.lapBasePath ?? '/agent/lap/v1'

  const router = createHttpRouter({
    signingKey: opts.signingKey,
    tokenStore,
    identityResolver,
    auditSink,
    lapBasePath,
  })

  // Silence unused-until-Plan-5 warnings:
  void rateLimiter

  return {
    router,
  }
}
