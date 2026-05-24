# 01 — On-disk Format

**Status:** Proposal.
**Parent:** [`README.md`](./README.md)
**Touches:** project filesystem (`.llui/notes/`), shared types consumed by 02 and 03.

The on-disk notebook is the single source of truth. Both the dev-server middleware and the MCP server read and write through it. No separate event log; the filesystem is the database. The directory listing is the log; the `001…` prefix is the order; mtime is the timestamp.

---

## Directory layout

```
.llui/notes/
  session-2026-05-23-1432/
    001-human-rect-edit-button.md       (+ 001-human-rect-edit-button.png)
    002-llm-capture-user-card.md        (+ 002-llm-capture-user-card.png)
    003-human-textonly-routing-bug.md
    004-human-rect-modal-overflow.md    (+ 004-human-rect-modal-overflow.png)
```

- **Sessions** are subdirectories. A new session starts on each `pnpm dev` invocation, named `session-{ISO date}-{HHMM}`.
- **Notes** are markdown files numbered `001…999` per session (padded to 3 digits), with a `{author}-{kind}-{slug}` suffix for grep-friendliness.
- **Screenshots** are sibling PNGs with the same basename. Absent for text-only notes.
- The directory is git-ignored by default. To preserve a session, the developer copies it into a tracked location.

---

## Frontmatter schema

Each `.md` file begins with YAML frontmatter:

```ts
type Author = 'human' | 'llm'

type NoteKind =
  | 'rect' // human-drawn rectangle(s)
  | 'lasso' // human-drawn freehand polygon(s)
  | 'pin' // numbered pin(s) with text
  | 'element' // element-pick: click DOM node, capture its box
  | 'arrow' // arrow between two points
  | 'text' // text-only, no screenshot
  | 'capture' // LLM-initiated screenshot, no human annotation

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
interface Point {
  x: number
  y: number
}

type Annotation =
  | ({ type: 'rect' } & Rect & { label?: string })
  | { type: 'lasso'; points: Point[]; label?: string }
  | { type: 'pin'; at: Point; index: number; label: string }
  | { type: 'element'; selector: string; bbox: Rect; label?: string }
  | { type: 'arrow'; from: Point; to: Point; label?: string }
  | { type: 'highlight'; selector: string; style?: 'rect' | 'arrow'; label?: string }
// Semantic form, resolved at capture time. Used by LLM-initiated captures.

interface AgentSchemaSummary {
  msg: string // e.g. "EditUser"
  fields: Record<string, string> // field name → TS type as string
}

interface NoteFrontmatter {
  // Identity (server-assigned)
  id: string // "001", "002"…
  ts: string // ISO 8601
  author: Author
  kind: NoteKind
  captureLevel: 'standard' | 'verbose'

  // Location
  url: string
  route: string | null // matched pattern, e.g. "/users/:id"
  routeParams: Record<string, string>
  viewport: { w: number; h: number; dpr: number }

  // Component context (null when no element was targeted)
  componentPath: string[] | null // ["App", "UserCard", "EditButton"]
  componentMeta: {
    file: string // source path, repo-relative
    line: number
    name: string
  } | null

  // Annotations baked into the screenshot
  annotations: Annotation[]

  // Files
  screenshot: string | null // sibling filename, null for text-only

  // Agent surface available at target element
  agentSchemas: AgentSchemaSummary[]

  // Versioning
  llui: { runtime: string; compiler: string }

  // Optional cross-references
  fulfillsRequestId?: string // present iff this note answered an LLM capture-request
}
```

---

## Body structure

The `.md` body has two parts: prose written by the author (human or LLM), followed by a single fenced ```json block. The block is **always present**, even when empty, so parsers can rely on its presence.

````markdown
---
id: 001
ts: 2026-05-23T14:32:11Z
author: human
kind: rect
captureLevel: standard
url: http://localhost:5173/users/42
route: /users/:id
routeParams: { id: '42' }
viewport: { w: 1440, h: 900, dpr: 2 }
componentPath: [App, UserCard, EditButton]
componentMeta:
  file: src/components/EditButton.ts
  line: 14
  name: EditButton
annotations:
  - { type: rect, x: 142, y: 88, w: 96, h: 32, label: 'wrong copy' }
screenshot: 001-human-rect-edit-button.png
agentSchemas:
  - msg: EditUser
    fields: { id: string, name: string }
llui: { runtime: 0.4.3, compiler: 0.5.6 }
---

The "Edit" button copy says "Update" but the design spec calls for "Save changes".
The focus ring is also missing on hover.

```json
{
  "stateSnapshot": { ... },
  "messageLog": [ ... ],
  "pendingMessages": [],
  "effects": { "pending": [], "recent": [ ... ] },
  "dirtyTrace": [ ... ],
  "structuralAt": { ... },
  "sourceMap": [ ... ],
  "errors": []
}
```
````

### Body JSON shape

```ts
type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

interface NoteBody {
  // Already proposed
  stateSnapshot?: unknown
  messageLog?: Array<{ ts: string; component: string; msg: unknown }>
  consoleLog?: Array<{ ts: string; level: LogLevel; text: string }>

  // LLui-native
  pendingMessages?: Array<{ component: string; msg: unknown }>
  effects?: {
    pending: Array<{
      id: string
      component: string
      effect: unknown
      sinceMs: number
    }>
    recent: Array<{
      ts: string
      component: string
      effect: unknown
      outcome: 'ok' | 'error' | 'cancelled'
      error?: string
    }>
  }
  dirtyTrace?: Array<{
    component: string
    pathsTracked: string[] // e.g. ["user.name", "user.email"]
    mask: number
    maskHi?: number
    lastFlippedBits: string[] // path names corresponding to bits set last cycle
  }>
  structuralAt?: {
    branches: Array<{ at: string; activeArm: string }>
    shows: Array<{ at: string; visible: boolean }>
    eachKeys: Array<{ at: string; keys: string[] }>
  }
  sourceMap?: Array<{
    selector: string
    file: string
    line: number
    componentPath: string[]
  }>
  errors?: Array<{
    ts: string
    kind: 'runtime' | 'compiler'
    file?: string
    line?: number
    message: string
    stack?: string
  }>

  // Heavy, only emitted at captureLevel: 'verbose'
  verbose?: VerboseNoteBody
}

interface VerboseNoteBody {
  scopeTree?: Array<{
    id: string
    parent: string | null
    component: string
    key?: string
  }>
  bindings?: {
    total: number
    hottest: Array<{ component: string; path: string; firesPerSec: number }>
    lastCycleMs: number
  }
  agentBridge?: {
    connectedAgents: string[]
    pendingToolCalls: number
    recentMsgs: Array<{ ts: string; direction: 'in' | 'out'; payload: unknown }>
  }
  transitionsInFlight?: Array<{ component: string; name: string; progress: number }>
  foreignInstances?: Array<{ component: string; library: string }>
}
```

### Capture-level rules

- `standard` (default for human, default for `llui_capture`): all `NoteBody` fields except `verbose`. Scope of `dirtyTrace` / `structuralAt` / `sourceMap` is the focused element's **enclosing component scope** (e.g. everything inside `UserCard` if the focused element is the button inside it).
- `verbose`: same as `standard` plus the `verbose` sub-object. Scope of `dirtyTrace` / `structuralAt` / `sourceMap` widens to the whole route.
- For text-only notes with no focused element: `standard` collects route-level structurals only; `verbose` adds the verbose sub-object as above.

---

## Filename derivation

The middleware assigns the filename on note creation:

```
{id-3-digit}-{author}-{kind}-{slug}.md
```

Where `slug` is:

- For notes with prose: kebab-case of the first 3–4 words of the prose, trimmed of stopwords (a, the, is, …).
- For notes without prose: `"capture"`.
- Sanitized to `[a-z0-9-]` and capped at 32 chars.

Collisions (rare) get a `-2`, `-3` suffix before the `.md`.

---

## Sessions

- A session is a directory: `session-{YYYY-MM-DD}-{HHMM}`.
- Sessions are created lazily on the first note of a dev-server lifetime.
- The "current" session is tracked in `.llui/notes/current-session` (a one-line text file with the session name). Replaced atomically on rotation.
- `POST /_llui/session/rotate` (see 02) writes a new current-session file and creates the new directory. The previous session remains on disk untouched.

---

## Decisions encoded

1. **Filesystem is the database.** No SQLite, no jsonl, no in-process index. The directory listing + `001…` prefix + frontmatter is the complete schema.
2. **Markdown is the artifact.** Frontmatter for scannable metadata; prose for human-authored text; fenced JSON block for the heavy data the LLM consumes. Both `cat` and "paste into Claude" work without conversion.
3. **One note = one screenshot at most.** Multi-shot bug reports become multi-note. Each `.md` is self-contained.
4. **Annotations are viewport pixels, not DOM selectors.** Survives layout reflow because the screenshot is frozen. The `element` and `highlight` variants carry a selector _and_ a resolved box.
5. **`captureLevel` controls scope, not just presence.** Verbose isn't just "more fields" — it also widens the scope of structural/dirty/source-map captures.
6. **Body JSON block is always present.** Empty `{}` is valid; absent is not. Parsers can rely on the fence.

---

## Open questions

1. Should `.llui/notes/` be configurable (e.g. `LLUI_NOTES_DIR`)? Probably yes — monorepos with multiple LLui apps will want to redirect.
2. Should screenshots be `.webp` instead of `.png`? Smaller, but Claude consumes PNG natively. Recommendation: PNG for v1; revisit if disk size becomes an issue.
3. Should the slug derivation use the LLM (when available) to produce a better summary? Recommendation: no — keep filename derivation purely mechanical and offline.
