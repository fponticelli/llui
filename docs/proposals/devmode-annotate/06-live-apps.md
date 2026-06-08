# 06 — HUD in live apps (capture-only)

**Status:** Proposal. Open for revision until adopted.
**Last revised:** 2026-06-07

Expose the devmode-annotate HUD to live (production) apps as a **capture-only** triage client, runtime-opt-in and lazy-loaded, persisting through a pluggable store that defaults to in-browser + export — with solving left where the code is (the developer's dev environment).

This proposal **revises the "Production telemetry" non-goal** in [README.md](./README.md): the HUD may now ship to production, but only as a capture surface. No LLM, no credentials, no source patching ever runs in the browser.

---

## Motivation

Today the HUD is structurally welded to the Vite dev server. Three couplings, all dev-only:

- **Activation** — `mountAnnotateHud()` early-returns `noopHandle()` when `!import.meta.env.DEV` (`packages/devmode-annotate/src/index.ts:375`), and the Vite plugin auto-injects it via `transformIndexHtml` (dev serve only).
- **Storage** — the HUD POSTs to `/_llui/notes`; the actual persistence is `writeFileSync` into `~/.llui/notes/session-*/` (`packages/vite-plugin/src/notes/store.ts`). Sessions/chains live in `.chain-state.json` on disk.
- **Solve** — the router (`packages/vite-plugin/src/notes/router.ts`) spawns a **local CLI** (`claude --print …`, `codex exec`, `gemini --yolo`) using the developer's shell + `ANTHROPIC_API_KEY`, and the proposed diff is applied to local source.

In production there is no dev server, no filesystem, no local CLI, and no source tree to patch. The browser-side capture machinery (annotation tools, screenshot, element picker, repro recorder, debug collector) is reusable; everything it talks _to_ is dev-only.

The value: a bug in a deployed app is captured **with full LLui fidelity** (route, component path, scope state, message/effect log, repro events, screenshot) by the person who hit it, then handed back to the developer who solves it in the place where solving actually works.

---

## Vision

> **In production the HUD is a capture/triage client.** It records a high-fidelity bug artifact and hands it off; it never tries to fix anything. Solve stays where the code is.

The end-to-end loop:

```
prod app → authorized user captures → notes + screenshots in IndexedDB
        → export bundle (zip) → developer imports into ~/.llui/notes
        → existing router / MCP solves locally (unchanged)
```

The store is the bridge between prod-capture and dev-solve. Because capture and solve are decoupled, neither side needs to know how the other is hosted.

---

## Decisions (locked)

| #   | Decision         | Choice                                                                                                                |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Production solve | **Capture-only.** No browser-side solver, no LLM, no credentials. Solve stays a dev-only router feature.              |
| 2   | Default store    | **Pluggable, defaulting to in-browser (IndexedDB) + export.** No host backend required to be useful.                  |
| 3   | Activation       | **App-developer decision.** Host calls `mountAnnotateHud()` explicitly, behind its own authz. No prod auto-injection. |
| 4   | Privacy          | **Host owns the policy.** We ship the redaction _seams_ (per-channel); we do not ship a redaction policy.             |

These collapse most of the complexity: with capture-only there is no `Solver` port in the browser at all, the `router.ts` / CLI-spawn surface never ships to prod, and `solveEnabled` is simply `false` (the split-button collapses to "Save"; `browse-view` already conditionalizes on it).

---

## Dev mode is preserved, not forked

The current dev experience must be **behaviourally unchanged** — same auto-injection, same `/_llui/*` endpoints, same on-disk notebook, same solve flow. But it is **not left as a parallel legacy path**. Dev mode is migrated onto the new infra as the first consumer of the `NotesStore` port:

- The HUD's direct `/_llui/notes` calls are replaced by a `devServerStore()` adapter that wraps those same endpoints. There is **one** store abstraction; dev is just the adapter that talks to the dev server.
- No second implementation, no `if (dev) … else …` branching in the HUD core. The HUD depends only on the port; dev vs prod is which adapter is injected (DRY).
- The dev auto-inject path (`transformIndexHtml`) keeps working — it simply mounts with `store: devServerStore()` instead of hardcoding the fetch URLs.

The contract for "did we break dev mode?" is [current-state.md](./current-state.md): if any observable behaviour there changes, the refactor is wrong. P1 below is exactly this migration, shipped before any prod-only adapter exists, so dev mode exercises the new seam first.

---

## Architecture

Two changes invert the dev-server coupling; everything else follows.

### A. Extract a `NotesStore` port

The HUD depends on a store interface, not on `/_llui/notes`.

```ts
interface NotesStore {
  createNote(req: CreateNoteRequest): Promise<CreateNoteResponse>
  listNotes(filter?: NoteFilter): Promise<Note[]>
  readNote(id: string): Promise<Note | null>
  deleteNote(id: string): Promise<void>
  putScreenshot(blob: Blob): Promise<ScreenshotRef> // blob-capable, not base64-in-markdown
  getScreenshot(ref: ScreenshotRef): Promise<Blob | null>
  currentSession(): Promise<SessionId>
  rotateSession(): Promise<SessionId>
}
```

Adapters:

| Adapter                            | Use              | Notes                                                                                         |
| ---------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `indexedDbStore()`                 | **prod default** | Screenshots as blobs (localStorage can't hold PNGs). Offline-safe; survives reloads.          |
| `devServerStore()`                 | dev (existing)   | Wraps the current `/_llui/*` endpoints. Powers the dev auto-inject path. Unchanged behaviour. |
| `httpStore({ endpoint, headers })` | opt-in prod      | POSTs to a host-provided backend with host-injected auth. No baked credentials.               |
| `exportBundle()` / download        | prod hand-off    | Zip of the on-disk `.md` + `.png` layout (decision below).                                    |

**Screenshot blob refactor:** screenshots become store-managed blob refs. The FS adapter may still inline base64 (back-compat with the existing `.png` sidecar); IndexedDB/HTTP carry blobs.

### B. Export / import bundle (closes the capture-only loop)

The missing piece that makes capture-only useful end-to-end.

- **Export** (prod, decision 1): a **zip of the on-disk `.md` + `.png` layout** — the exact `session-*/{id}-{author}-{kind}-{slug}.{md,png}` structure the FS store and MCP already read — plus a top-level **`bundle.json` manifest** (exporter identity, host-stamped timestamp, app build, `schemaVersion`, note count, content hash). The note files stay in the native layout so MCP reads them untouched.
- **Import** (dev, new): a Vite-plugin endpoint / CLI command that ingests an exported zip into `~/.llui/notes` — **content-addressed and idempotent** (dedup by per-note hash, namespace incoming sessions by the manifest key, preserve original ids + provenance, never overwrite; see resolutions below) — after which the **existing** router/MCP solve flow picks it up with no changes.

This makes the **schema-version stamp non-optional**: the prod client and the dev importer must agree on the note format. Reuse the existing schema-hash machinery; reject/upgrade on mismatch at import.

### C. Activation: explicit mount + lazy load

```ts
mountAnnotateHud({
  store,             // NotesStore (defaults to indexedDbStore() in prod)
  capture?,          // levels; debug-collector + repro default OFF in prod (decision below)
  redact?,           // per-channel sanitize hooks (decision below)
  maskScreenshots?,  // element-masking opt-in
})
```

- **No prod auto-injection.** `transformIndexHtml` injection stays strictly dev-only. In prod the host calls `mountAnnotateHud()` itself, behind its own authz, and chooses its own reveal gesture. We provide the API + lazy loader; the host owns who/when.
- **Lazy load.** Ship a tiny stub that registers the activation trigger and does `() => import('@llui/devmode-annotate')` only on activation, so Lexical (`@llui/markdown-editor`), `@llui/components`, and `html-to-image` never enter the main bundle.
- **Zero-cost when unused.** A separate prod build flag (e.g. `__LLUI_HUD_PROD__`) keeps apps that never opt in tree-shaking the HUD to nothing — the `import.meta.env.DEV` early-return is replaced by this flag plus the runtime gate.

### D. Privacy seams (host owns policy)

We don't decide what's sensitive; we make it _interceptable_, otherwise the host can't comply.

- **Per-channel `redact` hooks** (decision 2): separate callbacks over `state`, `repro`, and `screenshot`, so a host can drop just the risky channel rather than all-or-nothing. Run pre-persist.
- **Element masking** opt-in for screenshots.
- **Safe defaults** (decision 3): in prod, `debug-collector` (full state / message / effect dump) and repro-recording default **OFF** unless the host explicitly enables them.

---

## Resolved design questions

1. **Export/import format** → **zip of the on-disk `.md`+`.png` layout.** Import is a literal file copy; MCP and the router read it untouched.
2. **Redact granularity** → **per-channel** (`state` / `repro` / `screenshot`), not one whole-payload callback.
3. **Prod capture defaults** → **`debug-collector` and repro-recording OFF by default**; host opts in.

---

## Packages affected

| Package                  | Change                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@llui/devmode-annotate` | Extract `NotesStore` port; add `indexedDbStore` / `httpStore` / `devServerStore` / `exportBundle` adapters; screenshot→blob; runtime gate + lazy stub; per-channel `redact` + screenshot masking; prod-safe capture defaults. |
| `@llui/vite-plugin`      | New **import** endpoint/CLI to ingest an exported zip into `~/.llui/notes`. Existing middleware/router unchanged. Auto-inject stays dev-only.                                                                                 |
| `@llui/mcp`              | None required (reads imported notes through the unchanged FS layout).                                                                                                                                                         |

No prod-build cost for apps that don't opt in (tree-shaken via the build flag).

---

## Phased adoption

1. **P1 — `NotesStore` port + `devServerStore`; migrate dev mode onto it. ✅ DONE.** Pure refactor: the existing dev HUD stops calling `/_llui/*` directly and goes through `devServerStore()`. Behaviour identical (validated against [current-state.md](./current-state.md)); no parallel code path remains. Dev mode is the first consumer of the new seam. _Shipped: `src/notes-store.ts` (port), `src/stores/dev-server-store.ts` (adapter), `index.ts` + `browse-view.ts` migrated, `mountAnnotateHud({ store })` injectable, parity + injection tests in `test/notes-store.test.ts` and `test/hud.test.ts`. Full suites green (devmode-annotate 173, vite-plugin 185, mcp 159)._
2. **P2 — `indexedDbStore` + screenshot blobs. ✅ DONE.** HUD runs against browser storage with no dev server. _Shipped: `src/note-format.ts` (canonical fs-free slug/filename/id/session-name/status-replay helpers; the server's `slug.ts`/`session.ts`/`status.ts`/`store.ts` now delegate to it — DRY, single source); `src/stores/indexed-db-store.ts` (`indexedDbStore({ dbName?, now? })` — Blobs for screenshots, object-URL cache for the sync `screenshotUrl`, in-process event bus so a tab's own writes refresh its browse view); exported from index. Tests `test/note-format.test.ts` + `test/indexed-db-store.test.ts` (fake-indexeddb, full contract). Green: devmode-annotate 196, vite-plugin 185, mcp 159._
3. **P3 — `exportBundle` (zip) + `bundle.json` manifest + schema-version stamp. ✅ DONE.** Prod capture produces a self-describing, content-hashed hand-off artifact (exporter, build, schemaVersion, count, hash). _Shipped: `src/note-serialize.ts` (canonical `.md` serialize/parse, shared — server `frontmatter.ts` now delegates); `NOTE_SCHEMA_VERSION` in `note-format`; `ExportableStore`/`RawSession`/`RawNote` on the port with `indexedDbStore.exportSessions`; `src/export-bundle.ts` (`exportBundle` → standard zip via `fflate` of `session-*/{md,png}` + `status.jsonl` + `bundle.json`; SHA-256 content hash that excludes the manifest so it's clock-independent → idempotent-import basis; `bundleFilename`). Tests `test/export-bundle.test.ts` (zip round-trip, manifest, determinism). Green: devmode-annotate 200, vite-plugin 185, mcp 159._
4. **P4 — Dev-side import (content-addressed, idempotent). ✅ DONE** (loop closed); source-position resolver still open. Ingest zip → namespace by manifest content-hash key, write-if-absent (idempotent re-import), two-pass validate-then-write (atomic; path-traversal-safe), `import.json` provenance sidecar → the existing `listNotes`/`listSessions`/router/MCP flow reads it unchanged. _Shipped: `packages/vite-plugin/src/notes/import.ts` (`importBundle(notesRoot, zip)`), exported from `notes/index.js`, wired as `POST /_llui/import` in the middleware (broadcasts `session-rotated` so listeners refresh). Tests `test/notes-import.test.ts` (namespacing, idempotency, schema-mismatch + missing-manifest + traversal rejection). Green: vite-plugin 191, mcp 159._ Remaining: resolve `schemaHash` → precise source positions on the dev side at solve time (a capture-metadata refinement, Q3).
5. **P5a — Runtime gate + lazy install stub. ✅ DONE.** Opt-in activation, lazy chunk, zero cost when unused. _Shipped: `shouldMountHud()` gate in `hud-core` (dev always; prod only on explicit opt-in) + `allowProduction` option on `mountAnnotateHud`; `src/install.ts` (`installAnnotateHud` at the `./install` subpath) — a tiny stub that registers a Cmd/Ctrl+Shift+A trigger and only `import('./index.js')`s the heavy HUD on first activation, so an app that wires but never triggers it ships no HUD chunk. Tests `test/install.test.ts` (gate truth table, lazy-mount, idempotent activate, trigger, dispose). Green: devmode-annotate 207._
6. **P5b — Open-shadow-root isolation. ✅ DONE.** _Shipped: opt-in `isolate` option on `mountAnnotateHud` (default false = light DOM, so every existing test is untouched; `installAnnotateHud` defaults it ON for prod). When isolated, the chrome mounts inside an open shadow root on a host element; styles applied via constructable `adoptedStyleSheets` (CSP-clean — bypasses `style-src 'unsafe-inline'`) with a shadow-`<style>` fallback where constructable sheets are unavailable (older engines, jsdom). The stylesheet is keyed on `#llui-devmode-annotate-root`, which `root` keeps inside the shadow, so the adopted sheet matches with no `:root`→`:host` rewrite; custom properties inherit cleanly. Capture overlays/picker stay in the light DOM (inline-styled, top-layer over the app) — verified self-contained. `idEl`/`shadowHost` carry the discoverable id + handle; `destroy()` tears down the host + shadow subtree. Tests `test/isolation.test.ts` (shadow mount, no global `<style>`, isolated styling present, idempotency, teardown, light-DOM default preserved). Green: devmode-annotate 229._ Note: Lexical-in-shadow selection behaviour is a browser-runtime concern jsdom can't fully exercise; the editor is confirmed to mount inside the shadow, full validation is manual-in-browser.\_
7. **P6 — Privacy seams. ✅ DONE.** _Shipped: `src/redact.ts` — per-channel `redact` hooks (`state` / `repro` / `screenshot`), each run at the single persist boundary (`collectBody` + repro flush + screenshot finalize, in both `submit` and `handleCaptureRequest`, so the seam can't be bypassed); `screenshot` hook returns `null` to drop or a transformed base64 to mask (subsumes the separate masking knob — the host masks via the hook); `resolveCaptureDefaults(isDev, …)` makes the debug-telemetry body (`captureDebug`) and repro recording default **ON in dev / OFF in prod**, host opts in per channel; `buildNoteBody(annotations, debug)` skips the sensitive debug snapshot when off (keeps the non-sensitive source map). `RedactHooks`/`CaptureDefaults` exported. Tests `test/redact.test.ts` (defaults truth table + each channel pass-through/transform/drop) + a `hud.test.ts` integration case (redaction fires through a real mount+submit). Green: devmode-annotate 219._ Per-note `capturedBy`/`env` identity remains a small follow-up (manifest-level identity already shipped in P3).
8. **P7 (opt-in) — `httpStore`. ✅ DONE.** Direct-to-host-backend for teams that want centralized capture instead of manual export. _Shipped: `src/stores/http-store.ts` — extracted a shared `createHttpNotesStore({ baseUrl, headers?, fetchImpl? })` core; `devServerStore(origin)` is now just `createHttpNotesStore({ baseUrl: ${origin}/_llui })` (DRY — parity tests unchanged, still green); public `httpStore({ baseUrl, headers?, fetch? })` adds a configurable backend URL + injected auth headers (static or per-request async function, never baked) on every request, speaking the same wire protocol. Exported from index. Tests `test/http-store.test.ts` (base-URL routing, auth on every request, token-refresh function, wire-protocol mapping, no-auth). Green: devmode-annotate 224._

P1–P4 deliver the full capture-only loop (manual export/import). P5 makes it shippable to prod. P6 makes it responsible. P7 is convenience.

**UI wiring (✅ DONE):** export and import are surfaced, not just programmatic. Browser: `AnnotateHudHandle.exportBundle()` builds the zip and triggers a download; the browse toolbar shows a `⬇` button (`data-llui-export`) **only when the store can export** (`ExportableStore` — IndexedDB yes, dev-server no). Dev: the `POST /_llui/import` route is verified end-to-end (ingest → listable/readable via the existing notes API → `session-rotated` broadcast). Tests: `test/export-wiring.test.ts` (devmode-annotate) + `test/notes-import-route.test.ts` (vite-plugin). Green: devmode-annotate 233, vite-plugin 194.

---

## Non-goals

- **In-prod solving.** No browser LLM, no credentials, no CLI, no diff-apply. Solve is dev-only, always.
- **A redaction policy.** We ship seams; the host decides what's sensitive.
- **Multi-tenant notes server.** `httpStore` targets a host-provided endpoint; we don't build the backend, auth, or tenancy.
- **Auto-injection in prod.** Activation is always the app developer's explicit call.

---

## Resolved: isolation, identity, source attribution, import

These four were open in an earlier draft; all are now settled. Each pushes work to where it can be done correctly and reuses existing introspection/schema-hash machinery rather than inventing a parallel mechanism.

### Isolation & CSP — open shadow root + constructable stylesheets

The HUD mounts into an **open shadow root**, styled via constructable `adoptedStyleSheets` (not an injected `<style>` text node).

- **Style isolation is bidirectional** — the host app's CSS reset/cascade/z-index can't reach the HUD, and the HUD can't leak into the app. This retroactively fixes dev-mode style collisions too.
- **CSP-clean** — constructable stylesheets are programmatic, so they sidestep the `style-src 'unsafe-inline'` restriction that blocks an injected `<style>`. Dynamic `import()` of the lazy chunk is allowed under `script-src 'self'` because the chunk is bundled into the host's own same-origin build; documented as the one CSP requirement.
- **Open, not closed** — MCP, agent-bridge, and tests must still introspect the HUD; security isn't the goal (it's same-origin regardless).
- **Cost (do-the-harder-thing):** the element-picker/overlay draw against the app's **light** DOM and compute selectors there, so capture overlays render in a top-layer (Popover API / dedicated fixed layer) while the HUD chrome stays in the shadow root; and Lexical-in-shadow-DOM (selection/`contenteditable`) must be validated as part of P5.

### Identity & provenance — structured, omitted-when-absent, manifest-backed

The `author: 'human' | 'llm'` axis (which client wrote the note) is unchanged. Identity (which person) is orthogonal and added as optional, structured metadata:

- Per-note `capturedBy?: { id?: string; label?: string; kind: 'human' | 'llm' | 'agent' }` and `env?: { appVersion?; buildId?; releaseChannel?; url?; viewport?; locale?; userAgent? }`.
- **Omitted when the host doesn't supply it** — no fabricated `"anonymous"` sentinel; absence is truer than invented data.
- Identity/env are **PII and flow through the per-channel `redact` seam** (D).
- The zip carries a top-level **`bundle.json` manifest**: exporter identity, timestamp (stamped by the host, not the runtime), app build, `schemaVersion`, note count, and a content hash. The bundle is self-describing and verifiable, and the manifest hash feeds idempotent import below.

### Source attribution — stable identity in prod, resolve in dev

Same philosophy as the whole proposal: capture _what_ in prod, resolve _where_ in dev.

- The capture records **build-stable identity that does not depend on source maps**: component name + component-id/`schemaHash` (from the existing introspection machinery), the runtime scope-tree path, and the DOM selector.
- Precise source positions are resolved **on the dev side at import/solve time**, against the developer's own source, keyed by `schemaHash`. No source maps ship to prod (bloat + source leakage).
- When introspection wasn't built into the prod app, degrade to route + name + selector **and record the degradation in the note** — no silent gaps.

### Import — content-addressed and idempotent

- **Dedup by per-note content hash** (frontmatter + body + screenshot bytes) so **re-importing the same bundle is a no-op**.
- **Namespace incoming sessions** by a stable key derived from the `bundle.json` manifest / `capturedBy` so two sources' `session-001` never merge.
- Preserve the original session id + exporter provenance in frontmatter; **never overwrite**.
- Hashing is deterministic from note bytes (no `Date.now()`/`Math.random()`, which the repo forbids).

---

## Open questions surviving this proposal

_None at the architectural level._ Remaining unknowns are implementation-validation items, tracked in the phases: Lexical-in-shadow-DOM behaviour (P5), and the exact `schemaHash` → source-position resolver on the dev side (P4).
