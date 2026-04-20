import type { ServerOptions, AgentServerHandle } from './options.js'
import { InMemoryTokenStore } from './token-store.js'
import { consoleAuditSink } from './audit.js'
import { defaultRateLimiter } from './rate-limit.js'
import { createHttpRouter } from './http/router.js'
import { createLapRouter } from './lap/router.js'
import { WsPairingRegistry } from './ws/pairing-registry.js'
import { createWsUpgradeHandler } from './ws/upgrade.js'

const ANONYMOUS_RESOLVER = async () => null

/**
 * Compose the server from its (defaulted) parts. Returns a handle with a
 * `router` that dispatches `/agent/lap/v1/*` (LAP, checked first) then
 * `/agent/*` (HTTP management), and a `wsUpgrade` for `/agent/ws`.
 *
 * Spec §10.1, §10.4.
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

  const registry = new WsPairingRegistry({
    onLogAppend: (tid, entry) => {
      void auditSink.write({
        at: entry.at,
        tid,
        uid: null,
        event: 'lap-call',
        detail: {
          source: 'client-log',
          kind: entry.kind,
          variant: entry.variant,
          intent: entry.intent,
        },
      })
    },
  })

  const httpRouter = createHttpRouter({
    signingKey: opts.signingKey,
    tokenStore,
    identityResolver,
    auditSink,
    lapBasePath,
  })

  const lapRouter = createLapRouter(
    {
      signingKey: opts.signingKey,
      tokenStore,
      registry,
      auditSink,
      rateLimiter,
    },
    lapBasePath,
  )

  const router: AgentServerHandle['router'] = async (req) => {
    const lapRes = await lapRouter(req)
    if (lapRes) return lapRes
    return httpRouter(req)
  }

  const wsUpgrade = createWsUpgradeHandler({
    signingKey: opts.signingKey,
    tokenStore,
    registry,
    auditSink,
  })

  return { router, wsUpgrade }
}
