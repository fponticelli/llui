import type { E2EContext, MintResult } from './harness.js'

/**
 * Mint a token, open the WS in the browser, then bind the in-process MCP
 * bridge to the app — retrying until the server's /describe is ready (i.e.
 * until the WS hello frame has been received by the pairing registry).
 *
 * The WS open is async: effectHandler resolves after the WebSocket object is
 * created, but the hello frame travels over the network and arrives some ms
 * later. bindClaude calls /describe which returns 503 'paused' until the
 * hello frame arrives. We poll rather than adding a fixed sleep.
 *
 * Returns the MintResult so tests can access tid, token, lapUrl, wsUrl.
 */
export async function mintAndBind(ctx: E2EContext): Promise<MintResult> {
  const mint = await ctx.mintToken()

  // Poll until bindClaude succeeds (WS hello received) or we time out.
  const deadline = Date.now() + 5_000
  let lastErr: Error | null = null
  while (Date.now() < deadline) {
    try {
      await ctx.bindClaude(mint.lapUrl, mint.token)
      return mint
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      // Only retry on 'paused' — other errors should surface immediately.
      if (!lastErr.message.includes('paused')) throw lastErr
      await new Promise<void>((r) => setTimeout(r, 150))
    }
  }
  throw lastErr ?? new Error('mintAndBind timed out waiting for WS hello')
}

/**
 * Parse the first content item of an MCP tool call result as JSON.
 * Throws if the result has no content or the text is not valid JSON.
 */
export function parseToolResult<T = unknown>(r: {
  content: Array<{ type: string; text?: string }>
}): T {
  const text = (r.content[0] as { text?: string } | undefined)?.text
  if (text === undefined) throw new Error('tool result has no content text')
  return JSON.parse(text) as T
}
