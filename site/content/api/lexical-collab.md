---
title: '@llui/lexical-collab'
description: 'Opt-in collaborative editing for the LLui ↔ Lexical binding — yjsCollab() wires an injected Yjs provider into the editor for CRDT sync, scoped undo, and presence cursors.'
---

# @llui/lexical-collab

<!-- package-version:start -->

**Current package version:** `0.4.0`

<!-- package-version:end -->

Adds real-time collaborative editing to the [`@llui/lexical`](/api/lexical) binding. `yjsCollab(...)` produces a `foreign` fragment you spread into `lexicalForeign({ …, ...collab.foreign })` — or you pass the handle through the [markdown editor's](/api/markdown-editor) `collab` option, which does this for you. Sync runs over a [Yjs](https://yjs.dev) provider you inject, so you keep control of the transport (WebSocket, WebRTC, …).

There is nothing else to remember: `foreign` carries the binding registration in the seam's `externalUndo` slot — whose presence **forces the built-in `@lexical/history` stack off** — together with `seedMode: 'deferred'`. The handle deliberately exposes no `register` member, so the combination that would run a local undo stack beside the CRDT one (and double-apply every undo) cannot be expressed.

The registration is also **branded**: `collab.externalUndo` has type `ExternalUndoOwner`, which [`lexicalForeign`](/api/lexical)'s `register` slot rejects at compile time. So re-routing it under another key does not compile either. Plain registration functions are unaffected — a binding that splits `register` and `externalUndo` (see [`@llui/lexical-loro`](/api/lexical-loro)) type-checks unchanged.

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

### `CollabForeignOptions`

The complete set of `lexicalForeign` options a Yjs session requires, as ONE
object to spread — `lexicalForeign({ …, ...collab.foreign })`.

Both members are preconditions the host used to have to remember, and both
fail SILENTLY when forgotten: a surviving `@lexical/history` stack
double-applies undo across peers, and a boot-time seed duplicates content on
every peer that mounts. Bundling them with the registration itself is what
makes the unsafe wiring unrepresentable rather than merely documented.

```typescript
export interface CollabForeignOptions {
  /** The binding's registration, in the seam slot whose presence forces the
   * built-in `@lexical/history` stack off. Branded as an `ExternalUndoOwner`, so
   * the type system also refuses it in the seam's `register` slot. */
  readonly externalUndo: ExternalUndoOwner
  /** The sync-gated bootstrap replaces the seam's boot-time seed.
   *
   * `'auto'` is unconditionally wrong for a CRDT session — it seeds the local
   * document at boot on EVERY peer — so it is folded in here rather than left as
   * a second thing to remember. A host that genuinely needs to override it can
   * still spread this fragment first and set `seedMode` after. */
  readonly seedMode: 'deferred'
}
```

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

### `YjsCollab`

Live handle returned by {@link yjsCollab}.

```typescript
export interface YjsCollab {
  /** The seam options this session requires, ready to spread into
   * `lexicalForeign`. The preferred wiring — see {@link CollabForeignOptions}. */
  readonly foreign: CollabForeignOptions
  /** Wire the binding onto an editor. Returns a disposer that tears down every
   * listener, the provider connection, and the cursors overlay.
   *
   * Named for the `lexicalForeign` slot it must occupy: the seam forces the
   * built-in `@lexical/history` stack off whenever `externalUndo` is set, and
   * this binding owns undo (a Yjs `UndoManager` scoped to the local origin).
   * There is deliberately no `register` member — that slot leaves local history
   * registered, and a CRDT session cannot survive it. This value is BRANDED as
   * an `ExternalUndoOwner`, so re-routing it into `register` under another name
   * is a compile error too. Prefer spreading
   * {@link YjsCollab.foreign}, which also carries `seedMode`; reach for this
   * directly only when handing the binding to a host that assembles the seam
   * options itself (e.g. `@llui/markdown-editor`'s `collab` option). */
  readonly externalUndo: ExternalUndoOwner
  /** The shared Yjs document. */
  readonly doc: YDoc
  /** The network provider. */
  readonly provider: CollabProvider
  /** Connect the provider (no-op if `autoConnect` already connected). */
  connect: () => void
  /** Disconnect the provider. */
  disconnect: () => void
  /** Release resources this handle OWNS. Call AFTER the disposer returned by
   * {@link YjsCollab.externalUndo} has run (the seam runs it at unmount).
   * If `yjsCollab` created the `YDoc` itself (no `doc` was supplied and the
   * provider factory didn't substitute one), the document is `destroy()`d and its
   * `docMap` entry removed. A caller-supplied `doc` is caller-owned and left
   * untouched — you destroy it yourself once every binding over it is gone. */
  destroy: () => void
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

<!-- auto-api:end -->
