---
title: '@llui/lexical-collab'
description: 'Opt-in collaborative editing for the LLui ↔ Lexical binding — yjsCollab() wires an injected Yjs provider into the editor for CRDT sync, scoped undo, and presence cursors.'
---

# @llui/lexical-collab

Adds real-time collaborative editing to the [`@llui/lexical`](/api/lexical) binding. `yjsCollab(...)` produces a `register` hook you wire into `lexicalForeign({ history: false, seedMode: 'deferred', register })` — or you pass it through the [markdown editor's](/api/markdown-editor) `collab` option, which does this for you. Sync runs over a [Yjs](https://yjs.dev) provider you inject, so you keep control of the transport (WebSocket, WebRTC, …).

```bash
pnpm add @llui/lexical-collab @llui/lexical @lexical/yjs yjs
```

`@lexical/yjs` and `yjs` are peer dependencies.

## What it gives you

- **CRDT sync** — document state converges across clients through the injected `CollabProvider`.
- **Scoped undo** — undo/redo is bound to each client's own edits rather than the shared global stream.
- **Presence cursors** — remote users (`CollabUser`) surface as live selection/cursor decorations.

## API

<!-- auto-api:start -->

## Functions

### `yjsCollab()`

Build (but do not yet bind) a collaborative editing handle.

```typescript
function yjsCollab(config: YjsCollabConfig): YjsCollab
```

## Types

### `CollabProvider`

A Yjs network/transport provider. Structurally identical to `@lexical/yjs`'s
`Provider`; re-exported so consumers type their factory without reaching into
`@lexical/yjs` directly. `y-websocket` / `y-webrtc` / `@hocuspocus/provider`
all satisfy it.

```typescript
export type CollabProvider = Provider
```

## Interfaces

### `CollabUser`

Local presence identity broadcast to peers (name + caret colour).

```typescript
export interface CollabUser {
  /** Display name shown on the remote caret. */
  name: string
  /** Caret / selection colour (any CSS colour). */
  color: string
  /** Arbitrary extra data merged into this client's awareness state. */
  awarenessData?: Record<string, unknown>
}
```

### `YjsCollabConfig`

```typescript
export interface YjsCollabConfig {
  /** Shared document id (room name). Must match across peers. */
  id: string
  /** The shared Yjs document. Created if omitted (and registered in `docMap`). */
  doc?: YDoc
  /** Doc registry shared with the provider factory. Created if omitted. */
  docMap?: Map<string, YDoc>
  /** A ready provider. Mutually exclusive with `providerFactory`. */
  provider?: CollabProvider
  /** Factory building the provider from the (id, docMap). Preferred — it lets
   * this module own doc creation/registration before the provider binds. */
  providerFactory?: (id: string, docMap: Map<string, YDoc>) => CollabProvider
  /** Local presence identity. Presence is disabled when omitted. */
  user?: CollabUser
  /** Whether THIS peer may seed an empty shared document. Default `true`.
   * In a multi-peer app exactly one peer should bootstrap (e.g. the creator);
   * the seed only runs if the shared doc is still empty after first sync. */
  shouldBootstrap?: boolean
  /** Seed an empty shared document (runs once, inside an editor update, only on
   * the bootstrapping peer). Without it an empty paragraph is inserted. */
  seed?: (editor: LexicalEditor) => void
  /** Overlay element that hosts remote carets. Created over the editor when
   * omitted; its offsetParent is made `position: relative` if it is static. */
  cursorsContainer?: HTMLElement
  /** Per-node properties excluded from CRDT sync (advanced). */
  excludedProperties?: ExcludedProperties
  /** Connect the provider at mount. Default `true`. */
  autoConnect?: boolean
  /** Connection status changed (`'connected'` ⇄ disconnected). */
  onStatus?: (connected: boolean) => void
  /** Provider sync state changed (initial document handshake complete). */
  onSync?: (synced: boolean) => void
  /** Remote peer count changed (distinct awareness states, excluding self). */
  onPeers?: (count: number) => void
}
```

### `YjsCollab`

Live handle returned by {@link yjsCollab}.

```typescript
export interface YjsCollab {
  /** Wire the binding onto an editor; pass as `lexicalForeign({ register })`.
   * Returns a disposer that tears down every listener, the provider connection,
   * and the cursors overlay. */
  register: (editor: LexicalEditor) => () => void
  /** The shared Yjs document. */
  readonly doc: YDoc
  /** The network provider. */
  readonly provider: CollabProvider
  /** Connect the provider (no-op if `autoConnect` already connected). */
  connect: () => void
  /** Disconnect the provider. */
  disconnect: () => void
}
```

<!-- auto-api:end -->
