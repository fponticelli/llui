import { handleMint, type MintDeps } from './mint.js'
import { handleResumeList, handleResumeClaim, type ResumeDeps } from './resume.js'
import { handleRevoke, type RevokeDeps } from './revoke.js'
import { handleSessions, type SessionsDeps } from './sessions.js'

export type RouterDeps = MintDeps & ResumeDeps & RevokeDeps & SessionsDeps

/**
 * Matches any /agent/* request and returns the appropriate Response.
 * Returns `null` when the request doesn't match any known path — caller
 * can fall through to their framework's 404 handling. LAP and WS paths
 * are NOT handled here (they land in Plan 5 + factory composition).
 */
export function createHttpRouter(deps: RouterDeps): (req: Request) => Promise<Response | null> {
  return async (req) => {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/agent/mint') return handleMint(req, deps)
    if (path === '/agent/resume/list') return handleResumeList(req, deps)
    if (path === '/agent/resume/claim') return handleResumeClaim(req, deps)
    if (path === '/agent/revoke') return handleRevoke(req, deps)
    if (path === '/agent/sessions') return handleSessions(req, deps)

    return null
  }
}
