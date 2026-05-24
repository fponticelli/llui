# 02 — Middleware

**Status:** Proposal.
**Parent:** [`README.md`](./README.md)
**Touches:** `packages/vite-plugin/`. No new package.

The Vite dev-server middleware is the **single writer to disk**. The HUD posts note bundles; the MCP server posts capture requests; both subscribe to the SSE stream for change notifications. Capture requests are in-memory RPC; only notes hit disk.

---

## Endpoint table

| Method | Path                          | Purpose                                              | Body / params                             |
| ------ | ----------------------------- | ---------------------------------------------------- | ----------------------------------------- |
| `POST` | `/_llui/notes`                | Create a note. Server assigns id, ts, filename.      | `CreateNoteRequest`                       |
| `GET`  | `/_llui/notes`                | List notes in current session.                       | `?sessionId=&author=&kind=&since=&limit=` |
| `GET`  | `/_llui/notes/:id`            | Raw markdown of one note.                            | —                                         |
| `GET`  | `/_llui/notes/:id/screenshot` | Raw PNG.                                             | —                                         |
| `GET`  | `/_llui/sessions`             | List sessions on disk.                               | —                                         |
| `GET`  | `/_llui/session/current`      | Current session metadata.                            | —                                         |
| `POST` | `/_llui/session/rotate`       | Start a new session.                                 | —                                         |
| `POST` | `/_llui/capture-request`      | LLM asks HUD to capture. Long-polls until fulfilled. | `CaptureRequest`                          |
| `GET`  | `/_llui/events`               | SSE stream of server events.                         | —                                         |

All paths are namespaced under `/_llui/` to avoid colliding with app routes.

---

## Request / response shapes

````ts
// POST /_llui/notes
interface CreateNoteRequest {
  body: string // markdown prose
  frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'> // server fills id + ts
  noteBody: NoteBody // contents of the ```json block
  screenshot?: string // base64 PNG, optional
}

interface CreateNoteResponse {
  id: string // "003"
  filename: string // "003-human-rect-edit-button.md"
  path: string // absolute path on disk
  sessionId: string
}

// POST /_llui/capture-request
interface CaptureRequest {
  route?: string // navigate to route first
  url?: string // or absolute URL
  selector?: string // CSS or component-path
  annotate?: Annotation[] // pre-baked, drawn before screenshot
  prose?: string // initial prose text
  waitForMessage?: string // wait until this msg fires
  captureLevel?: 'standard' | 'verbose'
  timeoutMs?: number // default 30000
}

interface CaptureRequestResponse {
  requestId: string
  status: 'fulfilled' | 'timeout' | 'no-client'
  note?: CreateNoteResponse // present iff fulfilled
}
````

---

## SSE event union

```ts
type ServerEvent =
  | { type: 'note-created'; id: string; filename: string; author: Author }
  | { type: 'capture-request'; requestId: string; payload: CaptureRequest }
  | { type: 'capture-request-cancelled'; requestId: string }
  | { type: 'session-rotated'; sessionId: string }
```

The HUD subscribes on mount. The MCP server subscribes when serving `llui://session/current` to subscribers.

---

## Lifecycles

### Note creation (HUD → middleware)

1. HUD assembles `CreateNoteRequest` (frontmatter + prose + body JSON + base64 PNG).
2. `POST /_llui/notes`.
3. Middleware:
   - Reads `.llui/notes/current-session` (creates session dir if absent).
   - Computes next `id` by scanning the session dir for the highest existing prefix + 1.
   - Computes filename via the slug rule in 01.
   - Writes `.md` and (if present) sibling `.png`.
   - Emits `note-created` on SSE.
   - Returns `CreateNoteResponse`.
4. If the request carried `fulfillsRequestId`, the middleware additionally resolves the pending long-poll for that request id with the just-created note as the response.

### Capture request (MCP → middleware → HUD)

1. MCP calls `POST /_llui/capture-request` with `CaptureRequest` payload.
2. Middleware:
   - Generates a `requestId`.
   - If at least one SSE subscriber identifies as a HUD: emits `capture-request` on SSE and holds the HTTP response open (long-poll).
   - If no HUD is connected: closes the HTTP response with `{status: 'no-client'}` after a 2-second grace period. MCP then falls back to Playwright (see 03).
3. HUD receives the `capture-request` SSE event, executes it (navigates if needed, draws annotations, screenshots, gathers metadata), and `POST /_llui/notes` with `fulfillsRequestId` set.
4. Middleware writes the note and resolves the held-open `/capture-request` response with `{status: 'fulfilled', note: ...}`.
5. If the HUD doesn't respond within `timeoutMs`, middleware closes the response with `{status: 'timeout'}` and emits `capture-request-cancelled` on SSE so the HUD knows to discard the in-flight execution.

### Session rotation

`POST /_llui/session/rotate` creates a new directory, atomically updates `.llui/notes/current-session`, and emits `session-rotated` on SSE. All future note creations target the new session. The previous session remains intact.

---

## Identifying HUD subscribers

SSE subscribers identify their role by a query parameter:

```
GET /_llui/events?role=hud
GET /_llui/events?role=mcp
GET /_llui/events?role=viewer    // anonymous; receives note-created only
```

Only `role=hud` subscribers receive `capture-request` events. Multiple HUDs on the same dev server (e.g. two browser tabs) — the middleware emits to the first one and ignores the others, with a header indicating which subscriber holds the request. This keeps capture deterministic in multi-tab scenarios.

---

## Error semantics

| Condition                                                                                | Response                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /_llui/notes` with invalid frontmatter                                             | `400` + `{error, validationIssues}`                                                                                                             |
| `POST /_llui/notes` with `fulfillsRequestId` unknown to middleware                       | Note is still created; cross-ref silently dropped. (Stale capture requests shouldn't lose human notes.)                                         |
| `POST /_llui/capture-request` with no HUD and middleware's `playwrightAvailable` is true | Still returns `no-client`. The Playwright fallback is the **MCP server's** responsibility, not the middleware's. The middleware stays HUD-only. |
| Disk write failure                                                                       | `500` + `{error}`. No retry — caller decides.                                                                                                   |
| Session dir doesn't exist on read                                                        | `404` for `/sessions/:id`; empty list for `/sessions`.                                                                                          |

---

## What the middleware does NOT do

- **Schema validation of the body JSON block.** Treated as opaque text; the middleware only parses the frontmatter to derive the filename slug.
- **Image processing.** PNGs are written as-is. No re-encoding, no compression beyond what the client sends.
- **Search.** `GET /_llui/notes` supports basic filters but not full-text. The MCP layer (03) can add search later.
- **Authentication.** Dev-server only; binds to localhost; no auth.
- **Cleanup.** Old sessions are not auto-deleted. The developer can `rm -rf .llui/notes/session-*` whenever.

---

## Configuration

| Env var                   | Default                     | Purpose                                  |
| ------------------------- | --------------------------- | ---------------------------------------- |
| `LLUI_NOTES_DIR`          | `.llui/notes`               | Override the notes root                  |
| `LLUI_SESSION_NAME`       | `session-{ISO date}-{HHMM}` | Override the auto-generated session name |
| `LLUI_CAPTURE_TIMEOUT_MS` | `30000`                     | Default capture-request timeout          |

All read at Vite plugin init. No hot-reload of these values.

---

## Implementation notes

- The middleware is registered via `configureServer(server)` in the Vite plugin. SSE keep-alive is via heartbeats every 15s.
- Capture-request long-polls are held in a `Map<requestId, ResponsePromise>` in middleware-local memory. On Vite restart, all in-flight requests die — clients see the connection close, which is the correct signal.
- File writes are sequential within a session (no concurrent id allocation needed) — the `.llui/notes/<session>/.lock` file is held with an advisory lock during id allocation + write to guard against the rare HUD-double-submit case.

---

## Open questions

1. Should `POST /_llui/notes` allow a client-suggested `id` (for re-syncing a HUD that did a local write before the dev-server came back up)? Recommendation: no — server assigns ids; HUD buffers offline notes in localStorage and re-posts when the server returns.
2. Should the SSE stream include a heartbeat event the HUD can use for "is the dev server alive"? Yes; standard SSE `:heartbeat\n\n` comment lines every 15s.
3. Multi-HUD: should we round-robin captures or always go to the first subscriber? Recommendation: first subscriber. Multi-HUD is rare and round-robin would surprise users.
