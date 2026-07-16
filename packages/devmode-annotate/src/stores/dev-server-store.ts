// The dev-server NotesStore adapter — the Vite-plugin `/_llui/*` endpoints.
// It's the HTTP store rooted at `${origin}/_llui` with no extra headers, so
// dev behaviour is exactly the shared HTTP core's behaviour.

import type { NotesStore } from '../notes-store.js'
import { createHttpNotesStore } from './http-store.js'

/** Build the dev-server-backed store rooted at `origin` (e.g. `location.origin`).
 * When a `taskCapabilityToken` is supplied (injected by `@llui/vite-plugin` when
 * the attention router is enabled), it's sent as the `x-llui-task-capability`
 * header so the middleware can trust an in-HUD task submission. */
export function devServerStore(origin: string, taskCapabilityToken?: string): NotesStore {
  return createHttpNotesStore({
    baseUrl: `${origin}/_llui`,
    ...(taskCapabilityToken !== undefined
      ? { headers: { 'x-llui-task-capability': taskCapabilityToken } }
      : {}),
  })
}
