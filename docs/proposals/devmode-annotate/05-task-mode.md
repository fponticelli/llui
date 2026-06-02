# 05 — Task Mode

> **Status (2026-06-02): REALIZED.** intent / replyTo / proposedDiff, the status machine, the queue, Accept/Reject, and chain resume all shipped (`note-types.ts`, `index.ts`). One staleness: the `NoteKind` line still lists `lasso`/`pin`/`arrow`; the shipped set is rect + element + text + capture + reply.

**Status:** Proposal.
**Parent:** [`README.md`](./README.md)
**Touches:** `packages/devmode-annotate/` (HUD), `packages/vite-plugin/` (middleware), `packages/mcp/`. Optional new package: `@llui/task-worker`.

Turn notes into tasks. When the developer drops a note in the UI, the LLM picks it up as work to do — within seconds, without the developer writing a prompt or pasting context. The note is the task; the LLM's reply is the proposed action; the human accepts or rejects.

This phase is additive on top of the rest of the proposal — same notebook, same subscription, same MCP server. The only new mechanics are intent, status, replies, and an attention channel that wakes the LLM.

---

## Modes

| Mode                             | Trigger to action                                          | Code edits                 | Risk                                      | When to use                                            |
| -------------------------------- | ---------------------------------------------------------- | -------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| **Ambient triage** (default)     | LLM reads note immediately; proposes a fix                 | Human-approved only        | Low — fix is just text until accepted     | Default for v1                                         |
| **Autopilot** (opt-in, per-note) | LLM reads note, writes a diff to disk, opens it for review | Auto-applied to filesystem | Medium — LLM can make a mess across files | Trivial fixes (copy, classnames, missing imports) only |
| **Queue-only**                   | Notes accumulate; human picks one and asks the LLM to act  | Manual                     | Lowest                                    | What the proposal already supports without this phase  |

Ambient triage is the recommended v1. Autopilot is reachable later if scoped tightly (LLM self-classifies the note as low-risk before applying).

---

## Frontmatter additions

```ts
type NoteKind = 'rect' | 'lasso' | 'pin' | 'element' | 'arrow' | 'text' | 'capture' | 'reply' // NEW — LLM's response to a task note

type NoteIntent =
  | 'task' // Default. LLM should act on this.
  | 'note' // FYI / archival; LLM should not act unless asked.

interface NoteFrontmatter {
  // … existing fields

  intent: NoteIntent // NEW — required, defaults to 'task' when not set in source
  replyTo?: string // NEW — id of the note this replies to; present iff kind === 'reply'

  // NEW — present iff kind === 'reply' and the LLM included a proposed diff
  proposedDiff?: {
    files: Array<{
      path: string // repo-relative
      patch: string // unified diff text
    }>
    summary: string // one-line "what this changes"
    confidence: 'high' | 'medium' | 'low'
  }
}
```

`intent` defaults to `'task'` in the HUD; the developer can toggle it per-capture. The Playwright shim and LLM-initiated captures default to `'note'` (the LLM doesn't task itself).

---

## Status sidecar

Notes remain immutable. Status lives in a separate append-only log:

```
.llui/notes/session-2026-05-23-1432/
  001-human-rect-edit-button.md
  002-llm-reply-edit-button.md       (replyTo: "001", proposedDiff: ...)
  003-human-text-routing-bug.md
  status.jsonl                        ← append-only state transitions
```

Each line in `status.jsonl`:

```ts
interface StatusTransition {
  ts: string // ISO
  noteId: string // "001"
  from: NoteStatus | null // null on first transition
  to: NoteStatus
  by: 'human' | 'llm' | 'system'
  reason?: string // free-text
}

type NoteStatus =
  | 'open' // task note has been created; no LLM activity yet
  | 'claimed' // LLM (or worker) has claimed it for processing
  | 'in-progress' // LLM is generating a reply
  | 'proposed' // reply note posted with proposedDiff
  | 'accepted' // human accepted; diff is being applied
  | 'applied' // diff written to disk
  | 'rejected' // human rejected
  | 'wontfix' // explicitly closed without action
  | 'failed' // LLM errored / timed out
```

`note` intent notes never enter the status machine. Only `task` intent notes do.

The current status of any note is "the last `to` value in `status.jsonl` for that note id". O(file size) to read, but the file is tiny in practice (~50 bytes per transition, ~5 transitions per note = ~250 bytes; a 200-note session is ~50KB).

---

## Lifecycle (ambient triage)

```
HUMAN drops note (intent: task)
  ↓
HUD POST /_llui/notes  →  middleware writes 001-…, status: open
  ↓
SSE note-created  →  attention router wakes LLM client
  ↓
LLM client: read 001, write status: claimed
  ↓
LLM client: process, write status: in-progress
  ↓
LLM client: POST llui_reply_to_note  →  writes 002-…-reply, status: proposed
  ↓
SSE note-created (the reply)  →  HUD shows badge + diff preview
  ↓
HUMAN clicks Accept  →  HUD POST /_llui/notes/001/status { to: accepted }
  ↓
Middleware applies proposedDiff to disk  →  status: applied
```

Reject path: `HUMAN clicks Reject  →  status: rejected`. The proposed diff is never applied.

---

## Endpoint additions (middleware)

| Method | Path                      | Purpose                                             |
| ------ | ------------------------- | --------------------------------------------------- |
| `POST` | `/_llui/notes/:id/status` | Append a status transition                          |
| `GET`  | `/_llui/notes/:id/status` | Read current status + full history for one note     |
| `GET`  | `/_llui/queue`            | List task-intent notes by current status (filtered) |

```ts
// POST /_llui/notes/:id/status
interface StatusUpdateRequest {
  to: NoteStatus
  by: 'human' | 'llm' | 'system'
  reason?: string
}

// On to: 'accepted', middleware also applies the proposedDiff from the reply note
// and transitions to 'applied' (or 'failed' with reason if patch doesn't apply).
```

Apply semantics: `git apply` against the working tree. Conflicts → status `failed` with the conflict text in `reason`. The middleware does not commit; the human commits manually after review.

---

## MCP tool additions

```ts
// llui_reply_to_note
interface LluiReplyToNoteInput {
  replyTo: string // note id being replied to
  prose: string // markdown body
  proposedDiff?: {
    files: Array<{ path: string; patch: string }>
    summary: string
    confidence: 'high' | 'medium' | 'low'
  }
  setStatus?: NoteStatus // usually 'proposed' if diff present, else 'wontfix' or none
}

interface LluiReplyToNoteOutput {
  noteId: string // id of the created reply note
  filename: string
}
```

```ts
// llui_queue — list active task notes
interface LluiQueueInput {
  status?: NoteStatus | NoteStatus[] // default: ['open', 'claimed', 'in-progress']
  sessionId?: string // default: current
}

interface LluiQueueOutput {
  notes: Array<NoteSummary & { status: NoteStatus; transitions: StatusTransition[] }>
}
```

```ts
// llui_claim_note — atomically claim a task note for processing
// Returns the note contents if claim succeeded, error if already claimed.
interface LluiClaimNoteInput {
  noteId: string
  workerId: string // identifies the claimer
}

interface LluiClaimNoteOutput {
  status: 'claimed' | 'already-claimed-by'
  by?: string // workerId of current claimant if already claimed
  note?: LluiReadNoteOutput
}
```

The claim/atomicity matters when more than one LLM client is connected (e.g. Claude Code attached + a worker running). Without it, both would race to reply.

---

## The attention router

The hard part. SSE delivers the note to subscribers, but Claude Code today is conversational — it doesn't act unless prompted. Three implementations, in order of complexity:

### 1. Attached mode (v1)

The user has Claude Code open with `@llui/mcp` connected. New notes arrive as MCP notifications. The LLM proactively brings up the note in its next turn ("I see you just dropped a note on `EditButton`. Want me to fix the copy?"). The user types "yes" and the LLM acts.

- **Pros:** nothing new to build; works with the existing MCP subscription.
- **Cons:** only acts during active conversation; closed Claude Code means notes pile up.

### 2. Headless worker (follow-up)

A new package, `@llui/task-worker`, is a long-running process that:

1. Subscribes to `llui://session/current` via MCP.
2. On each new `task`-intent note: claims it (`llui_claim_note`), spawns `claude --prompt "<note contents + instruction template>"` in headless mode, captures the result, posts a reply via `llui_reply_to_note`.
3. Releases the claim or marks `failed` on timeout.

- **Pros:** true ambient behavior — close Claude Code, drop notes, come back to proposed diffs.
- **Cons:** new package; per-note cost (each note is a fresh Claude session, no shared history); needs API key / auth setup.

### 3. MCP-native event triggers (future)

If the MCP spec gains a "wake on event" primitive, neither attached nor worker is needed — the protocol itself supports event-driven LLM invocation. Watch this space; design for it but don't depend on it.

### Selection logic

- If a worker is connected (identified by `workerId` on its SSE subscription): worker handles all task notes.
- Else if an attached Claude Code is connected: attached handles them via in-conversation prompting.
- Else: notes accumulate as `open` until someone picks them up.

---

## HUD changes

- **Per-capture intent toggle:** `[ Task ] [ Note ]` switch on the annotation toolbar. Defaults to Task. Sticky preference per session.
- **Status badges on the in-app note list:** colored dot per status (`open` → grey, `in-progress` → pulsing blue, `proposed` → yellow, `accepted` → green, `rejected` → red).
- **Reply rendering:** clicking a task note shows its reply thread inline. If the reply has a `proposedDiff`, the HUD renders it as a syntax-highlighted unified diff with **Accept** and **Reject** buttons.
- **Queue depth indicator:** small chip in the HUD showing "3 tasks pending" so the user knows if the LLM is keeping up.
- **Mode toggle (global):** `Notes mode` vs `Tasks mode` switch. In Notes mode, the intent toggle is hidden and every capture is `note`. In Tasks mode, it defaults to `task`.

---

## Concurrency

Multiple task notes arrive faster than the LLM can process them. Two rules:

1. **No preemption.** Whatever the LLM is processing finishes before the next note is claimed.
2. **FIFO by id.** Notes are processed in creation order.

This is enforced by the worker (in worker mode) or by the LLM client following queue order (in attached mode). The status sidecar makes the queue visible to all clients, so out-of-order processing is at most a UX choice, not a correctness issue.

---

## Failure modes

| Failure                                | Recovery                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| LLM proposes a wrong diff              | Human clicks Reject → status `rejected`. Note is still in the log; human can edit it (drop a follow-up note with more context) or close. |
| Diff fails to apply (patch conflict)   | Middleware writes status `failed` with conflict text. Human resolves manually or asks the LLM to try again.                              |
| Worker dies mid-process                | Claim has a TTL (default 5 min); status transitions to `failed` automatically. Next worker tick re-claims.                               |
| Attached Claude Code crashes mid-reply | No reply is written; status stays at `in-progress` until the TTL expires.                                                                |
| Two clients race on the same note      | `llui_claim_note` is atomic via the status sidecar — second claimer gets `already-claimed-by`.                                           |

---

## What's safe to autopilot

If we ever ship autopilot mode, the LLM must self-classify before applying. Whitelist for automatic apply:

- Single-file change.
- Touches only string literals, JSX text content, or class attributes.
- `confidence: 'high'`.
- File matches a configured allowlist of glob patterns.

Everything else falls through to triage (proposed, awaiting accept). The config lives in `.llui/notes-config.json`:

```json
{
  "autopilot": false,
  "autopilotAllowlist": ["src/copy/**", "src/styles/**"]
}
```

Off by default.

---

## Decisions encoded

1. **Notes are immutable; status is sidecar.** Preserves the append-only model and the value of `status.jsonl` as a complete audit log.
2. **Replies are notes.** A reply is just a note with `kind: 'reply'` and `replyTo` set. No special storage; threads reconstruct from directory + frontmatter.
3. **Triage is the default mode.** Autopilot is opt-in, narrow-scoped, and likely deferred past v1.
4. **Claim-before-process.** Atomic claim via the status sidecar prevents double-replies when multiple LLM clients are connected.
5. **Two attention models, hybrid by default.** Attached works in v1 with no new components; worker is a follow-up for true ambient behavior. The selection rule is mechanical, not user-configured.
6. **Diff apply uses `git apply`.** Standard tooling, predictable conflict semantics, easy for the human to inspect.

---

## Open questions

1. **Reply rendering of the diff** — render as `git diff` syntax-highlighted, or as a 3-way side-by-side? Recommendation: unified diff for v1; side-by-side later if requested.
2. **TTL on claims** — 5 minutes feels right but is a guess. Should be configurable.
3. **`note` intent — should the LLM still acknowledge it?** Recommendation: yes, with a one-line "noted" reply, so the human has confirmation the LLM saw it. Cheap, friendly.
4. **Worker authentication** — the worker spawns Claude Code via the CLI; this needs the user to have a logged-in Claude Code installation. Acceptable for a dev tool; flag in docs.
5. **Cross-session task notes** — if the user rotates sessions mid-task, does the pending task come along? Recommendation: no — task notes are session-scoped. Closing a session with pending tasks emits a warning.
6. **Naming** — `llui_claim_note` might be too low-level for the public MCP surface. Could roll into `llui_reply_to_note` with implicit claim. Recommendation: keep them separate for v1; an LLM can claim a note before deciding it's not worth replying (and release with `wontfix`).
