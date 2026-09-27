/**
 * A FROZEN, local Iconify source for the specialized-tools gallery (#266).
 *
 * The registry's icons are fetched from the Iconify HTTP API at mount — right
 * for an app, wrong for a gallery whose scenarios must be deterministic and
 * need no live network. `installFrozenIconify()` points `iconConfig.api` at a
 * sentinel origin and answers requests for it from the literal Lucide subset
 * below, through the SAME loader, batcher and allowlist sanitizer an app uses
 * — only the transport is replaced. Every other request passes through
 * untouched, and the returned function restores both settings.
 *
 * The bodies are Lucide's (ISC), in Iconify's normalized form: paint lives on
 * the body, never on the wrapper.
 */
import { iconConfig } from '@llui/components/icon'

export const FROZEN_ICONIFY_API = 'frozen-iconify'

const stroke = (inner: string): string =>
  `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">${inner}</g>`

export const FROZEN_LUCIDE_BODIES: Readonly<Record<string, string>> = {
  check: stroke('<path d="M20 6L9 17l-5-5"/>'),
  'chevron-down': stroke('<path d="m6 9l6 6l6-6"/>'),
  'chevron-up': stroke('<path d="m18 15l-6-6l-6 6"/>'),
  'chevron-left': stroke('<path d="m15 18l-6-6l6-6"/>'),
  'chevron-right': stroke('<path d="m9 18l6-6l-6-6"/>'),
  x: stroke('<path d="M18 6L6 18M6 6l12 12"/>'),
  minus: stroke('<path d="M5 12h14"/>'),
  search: stroke('<circle cx="11" cy="11" r="8"/><path d="m21 21l-4.3-4.3"/>'),
  calendar: stroke(
    '<path d="M8 2v4m8-4v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  ),
  'grip-vertical': stroke(
    '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  ),
  copy: stroke(
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  ),
  upload: stroke('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7l-5-5l-5 5m5-5v12"/>'),
  'maximize-2': stroke('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
}

/** Install the frozen source; returns a restore function. */
export function installFrozenIconify(): () => void {
  const previousApi = iconConfig.api
  const previousFetch = globalThis.fetch
  iconConfig.api = FROZEN_ICONIFY_API
  const frozenFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(`${FROZEN_ICONIFY_API}/`)) return previousFetch(input, init)
    const query = url.slice(url.indexOf('?icons=') + '?icons='.length)
    const names = query === '' ? [] : query.split(',').map(decodeURIComponent)
    const icons: Record<string, { body: string }> = {}
    for (const name of names) {
      const body = FROZEN_LUCIDE_BODIES[name]
      if (body !== undefined) icons[name] = { body }
    }
    return Promise.resolve(
      new Response(JSON.stringify({ prefix: 'lucide', width: 24, height: 24, icons }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  globalThis.fetch = frozenFetch as typeof fetch
  return () => {
    iconConfig.api = previousApi
    globalThis.fetch = previousFetch
  }
}
