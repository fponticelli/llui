# @llui/lexical-collab

Opt-in **collaborative editing** for the LLui ↔ Lexical binding. It composes
[`@lexical/yjs`](https://www.npmjs.com/package/@lexical/yjs)'s CRDT primitives —
the same wiring the official React `CollaborationPlugin` performs — into a single
options fragment you spread into `lexicalForeign` (or, more commonly, into the
markdown editor's `collab` option).

The network **provider is injected**: bring your own
[`y-websocket`](https://github.com/yjs/y-websocket),
[`y-webrtc`](https://github.com/yjs/y-webrtc), or
[`@hocuspocus/provider`](https://tiptap.dev/hocuspocus). This package never opens
a socket itself, so it stays transport-agnostic and ships **zero CRDT bytes to
non-collaborative bundles** (it is a separate, opt-in package).

## Why it can't be "just a plugin"

A collaborative session inverts the editor's source of truth: the shared Yjs
document — not a markdown string — is canonical. That means the base seam's
built-in pieces must be **disabled and replaced**, which a plain `LexicalPlugin`
cannot do:

- **History** → `@lexical/history`'s local undo stack would cross peers. Replaced
  by a Yjs `UndoManager` scoped to the local origin (your undo only reverts _your_
  edits).
- **Seed** → seeding on every client duplicates content. Replaced by a
  **sync-gated bootstrap**: exactly one peer seeds, and only while the shared
  document is still empty.
- **Controlled `value`** → a markdown signal pushing into a CRDT fights
  convergence. Mutually exclusive with collab.

So `@llui/lexical` exposes the seam options this package plugs into — most
importantly **`externalUndo`**, which takes ownership of the undo stack AND forces
the built-in `@lexical/history` stack off in one place, so the two can never both
run and double-apply an undo — plus `seedMode: 'deferred'` for the sync-gated
bootstrap.

**You never set either yourself.** `yjsCollab(...)` returns them pre-filled as
`collab.foreign`, a fragment you spread into `lexicalForeign`; the handle exposes
its registration only as `externalUndo` and has no `register` member at all. So
wiring the binding and disabling local history are the same act, and the pairing
that silently double-applies undo has no spelling.

Renaming your way around that doesn't work either: `collab.externalUndo` is an
`ExternalUndoOwner`, a branded function type that `lexicalForeign`'s `register`
slot **rejects at compile time**. Plain registration functions are unaffected —
`@llui/lexical-loro`'s split `register` + `externalUndo` binding still type-checks
unchanged.

## Usage with the markdown editor (recommended)

```ts
import { mountApp } from '@llui/dom'
import { markdownEditor } from '@llui/markdown-editor'
import { yjsCollab } from '@llui/lexical-collab'
import { Doc } from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc = new Doc()

mountApp(
  el,
  markdownEditor({
    defaultValue: '# Shared doc\n\nStart typing…', // becomes the bootstrap seed
    collab: (hooks) =>
      yjsCollab({
        id: 'room-42',
        doc,
        provider: new WebsocketProvider('wss://example.com', 'room-42', doc),
        user: { name: 'Ada', color: '#0a7' },
        shouldBootstrap: true, // exactly one peer should seed
        ...hooks, // seed + onStatus/onSync/onPeers → editor's state.collab
      }),
  }),
)
```

`...hooks` forwards the markdown `seed` (so the bootstrapping peer fills the empty
shared doc from `defaultValue` via the editor's own transformers) and the status
sinks (so connection / sync / peer-count flow into `state.collab` for your chrome).

## Usage with the low-level seam

```ts
import { lexicalForeign } from '@llui/lexical'
import { yjsCollab } from '@llui/lexical-collab'

const collab = yjsCollab({ id, doc, provider, user, seed })

lexicalForeign({
  namespace: 'doc',
  serialize,
  deserialize,
  readonly,
  // Everything a CRDT session needs from the seam, in one spread: the binding
  // registration in the `externalUndo` slot (which force-disables the built-in
  // @lexical/history stack) plus `seedMode: 'deferred'` (the sync-gated
  // bootstrap replaces the boot-time seed). Nothing left to remember.
  ...collab.foreign,
})
```

When you `yjsCollab(...)` created the document (you passed neither `doc` nor a
factory that made its own), call `collab.destroy()` after the `lexicalForeign`
unmount tears the binding down — it `destroy()`s the internally-created `YDoc` and
removes it from the `docMap`. A `doc` you supplied is yours to destroy.

## Presence cursors

Remote carets render automatically when a `user` is set. `@lexical/yjs`
inline-styles each caret in the peer's colour; this package ships
`styles/collab.css` to position the overlay container:

```ts
import '@llui/lexical-collab/styles/collab.css'
```

## Testing your integration

The in-memory networked provider used by this package's own tests connects N
peers without a server — useful for asserting convergence in your app's tests.
(See `test/network.ts`.)

<!-- @doc-setup
// Values the low-level-seam snippet elides: the mount target, and the session
// pieces the surrounding prose describes. One declaration per group, so a name
// an earlier block already defines only drops that group. Not rendered; read by
// `pnpm check:docs`.

import type { Signal } from '@llui/dom'
import type { LexicalEditor } from 'lexical'
import type { CollabProvider, CollabUser } from '@llui/lexical-collab'

declare const el: HTMLElement

declare const id: string

declare const provider: CollabProvider

declare const user: CollabUser

declare const seed: (editor: LexicalEditor) => void

declare const serialize: (editor: LexicalEditor) => string

declare const deserialize: (editor: LexicalEditor, value: string) => void

declare const readonly: Signal<boolean>
-->
