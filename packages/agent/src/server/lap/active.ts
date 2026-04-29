import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { TokenRecord } from '../../protocol.js'

/**
 * Transition a tid to `active` and notify the browser when an LLM
 * makes its first LAP call. Run from every LAP handler that auth's
 * the token, so activation isn't gated by which endpoint the bridge
 * happens to hit first (`describe` was the only one wiring this up
 * historically; the bridge connects via `/observe` so the browser
 * stayed at `awaiting-claude` indefinitely).
 *
 * No-op when the record is already `active` or in any other state —
 * the `awaiting-claude` → `active` transition is the only one we
 * care about here. `pending-resume` reattaches happen in
 * `acceptConnection` (re-pair path); we don't second-guess them
 * from the LAP layer.
 */
export async function ensureActive(
  tokenStore: TokenStore,
  registry: PairingRegistry,
  tid: string,
  rec: TokenRecord,
  now: number,
): Promise<void> {
  if (rec.status !== 'awaiting-claude') return
  const label = rec.uid ?? rec.label ?? 'Claude'
  await tokenStore.markActive(tid, label, now)
  // Best-effort — the browser may have closed the WS in the gap;
  // the registry's send is a no-op in that case and the close
  // handler will mark the record `pending-resume` anyway.
  registry.send(tid, { t: 'active' })
}
