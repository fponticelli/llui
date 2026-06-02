# Dev-Mode Annotate

> **Status (2026-06-02): SHIPPED.** `@llui/devmode-annotate` implements the phases described here. The authoritative living contract is [current-state.md](./current-state.md); this file is kept as motivation/rationale.

**Status:** Proposal. Open for revision until adopted.
**Last revised:** 2026-05-23

A shared notebook between the human developer and the LLM, persisted to disk in the project, with two writers (a browser HUD embedded in LLui dev mode, and the `@llui/mcp` server driven by the LLM) and two readers (the same two).

---

## Motivation

The common front-end-with-LLM dev loop is: navigate to a page, observe a problem, screenshot it, annotate with circles or arrows, write a note, paste the bundle into the LLM. The fidelity loss across each step is significant. The LLM sees a flattened image and prose; it never sees the URL, the route match, the component path, the state, the message log, or which line of source rendered the element the human circled.

LLui can do better than every other framework here, because the runtime already knows all of this. The compiler emits `__componentMeta`; the runtime keeps a scope tree, a binding array, and (in dev) a message ring buffer; the MCP server already exposes a tool surface to LLMs; the agent bridge already drives the running app.

This proposal connects those pieces into a first-class workflow: a notebook on disk, two clients that read and write it, a transport that supports both human-initiated capture (HUD) and LLM-initiated capture (MCP), and a Playwright fallback for headless contexts.

---

## Vision

> **Dev mode is a conversation with the LLM, not a pipeline to it.** The human can capture-and-annotate at any time; the LLM can request-and-receive at any time; both write to the same on-disk notebook; the notebook outlives either client.

A capture is never just a screenshot. It carries URL, route, component path, scope state at the focused element, recent messages, in-flight effects, dirty-trace, source-position map for visible elements, and (opt-in) verbose runtime telemetry. The screenshot is one slice of a much richer artifact.

---

## Sub-proposals

The four documents in this folder are independent enough to be adopted, deferred, or revised separately.

### 01 — On-disk format · [`01-on-disk-format.md`](./01-on-disk-format.md)

**Scope:** The `.llui/notes/` directory layout, the per-note `.md` frontmatter schema, the body JSON block schema, and what data is captured from the LLui runtime (state, messages, effects, dirty-trace, source-position map, structural primitives, errors).

This is the canonical contract. Both the middleware and the MCP server agree on this shape; everything else is plumbing.

### 02 — Middleware · [`02-middleware.md`](./02-middleware.md)

**Scope:** The HTTP endpoints exposed by `@llui/vite-plugin` for note creation, capture-request long-poll, and session lifecycle. The SSE event stream the HUD subscribes to. No new package — this lives inside the existing Vite adapter.

### 03 — MCP surface · [`03-mcp-surface.md`](./03-mcp-surface.md)

**Scope:** The MCP resources (`llui://session/...`) and tools (`llui_capture`, `llui_list_notes`, `llui_read_note`, `llui_rotate_session`) added to `@llui/mcp`. The Playwright fallback path for headless capture.

### 04 — Runtime hooks · [`04-runtime-hooks.md`](./04-runtime-hooks.md)

**Scope:** What `@llui/dom` and `@llui/compiler-devtools` need to expose so that captures carry the full LLui telemetry promised by 01. Dev-mode ring buffers, source-position map emission, dirty-trace snapshot helpers, structural-primitive introspection.

### 05 — Task mode · [`05-task-mode.md`](./05-task-mode.md)

**Scope:** Turn notes into tasks. New frontmatter (`intent`, `replyTo`, `proposedDiff`), a status sidecar for the otherwise-immutable notes, `llui_reply_to_note` / `llui_claim_note` / `llui_queue` MCP tools, status badges and diff-review UI in the HUD, and the attention router that wakes the LLM (attached Claude Code in v1; optional `@llui/task-worker` for true ambient behavior). Autopilot is reachable but out of v1 scope.

---

## Packages affected

| Package                                     | Change                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New: `@llui/devmode-annotate`**           | The HUD. Browser-side overlay, annotation tools, dev-only. ~1–2k LOC. Depends on `@llui/dom`, `@llui/agent-bridge`.                                 |
| **New (P6, optional): `@llui/task-worker`** | Headless attention router for true ambient task mode. Subscribes to MCP, spawns Claude Code per task. Only needed if attached-mode is insufficient. |
| `@llui/vite-plugin`                         | New middleware: `/_llui/notes`, `/_llui/capture-request`, `/_llui/events`, session + status endpoints. ~300 LOC (+ ~100 for P6 status routes).      |
| `@llui/mcp`                                 | New resources + tools; Playwright fallback (peer dep). P6 adds `llui_reply_to_note`, `llui_claim_note`, `llui_queue`.                               |
| `@llui/dom`                                 | Dev-mode ring buffers for messages/effects/errors; introspection getters. Tree-shaken in prod.                                                      |
| `@llui/compiler-devtools`                   | Source-position map emission. Already emits `__componentMeta`; extends it.                                                                          |

No runtime contract changes that affect prod builds. All additions are dev-mode-only and behind `import.meta.env.DEV` gates.

---

## Phased adoption

Each phase is independently shippable.

1. **P1 — On-disk format + middleware (01 + 02)**: minimal HUD that can post text-only notes from a manual UI; no annotations yet; no MCP integration. Validates the on-disk contract and the round-trip.
2. **P2 — HUD annotations (the rest of the new package)**: rect, lasso, pin, element-pick, screenshot baking, the full A flow.
3. **P3 — MCP surface (03)**: resources + read/list tools, ambient subscription. LLM can consume notes; human is the only writer.
4. **P4 — Runtime hooks (04)**: ring buffers, source-position map, dirty-trace. The captures get _interesting_.
5. **P5 — LLM-initiated capture**: `llui_capture` tool, capture-request long-poll, Playwright fallback. Closes the loop.
6. **P6 — Task mode (05)**: intent flag, reply notes, status sidecar, diff-apply, HUD status badges. Attached-mode delivery in v1; headless worker as a follow-up sub-phase if attached proves insufficient.

Phases 1–3 are useful on their own; 4 is where the LLui-native value shows up; 5 is the bidirectional payoff; 6 is the workflow shift — notes stop being passive artifacts and become work.

---

## Non-goals

- **Production telemetry.** This is dev-only. Nothing ships in production builds.
- **Multi-user collaboration.** Sessions are single-developer. No locking, no merge.
- **Cross-app correlation.** One dev server, one app, one notebook. Multi-tab/multi-app is a follow-up.
- **Replayability** (remounting the app at a captured state). The schema reserves space for `stateSnapshot` so this is achievable later, but not in v1.
- **A general-purpose annotation library.** The HUD is LLui-specific and won't be extracted for general web use.

---

## Open questions surviving this proposal

1. **Session naming.** Timestamp form (`session-2026-05-23-1432`) is `ls -lt` friendly; docker-style (`session-eager-fox`) is memorable. Default to timestamp; allow override via env var.
2. **Body JSON block — always present?** Recommendation: yes, even when empty (`{}`), so parsers can rely on its presence.
3. **`captureLevel: 'verbose'` defaults.** Should heavy fields ever be on by default for human-initiated captures? Recommendation: no — humans get `standard`; LLMs opt into `verbose` per-call.
4. **Semantic annotations in `llui_capture`.** Should the `Annotation` union include `{type: 'highlight'; selector: string}` resolved at capture time? Recommendation: yes (covered in 03).
5. **Scope of `dirtyTrace` / `structuralAt` / `sourceMap`.** Focused element only, focused element's enclosing scope, or whole route? Recommendation: enclosing scope by default; whole route at `verbose`.
6. **Attached vs worker for task mode.** Attached Claude Code is sufficient for the common case (user actively coding with Claude open) but pile-ups happen when Claude Code is closed. The `@llui/task-worker` package solves this at the cost of one more process and per-note Claude-Code spawns. Recommendation: ship attached-mode first; promote worker to default if pile-ups become a common complaint.
7. **Autopilot scope.** Should autopilot ever ship, and if so, behind what allowlist? Recommendation: deferred past v1; revisit only after triage mode has real usage data.
