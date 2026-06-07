# @llui/lexical-collab

Opt-in **collaborative editing** for the LLui ↔ Lexical binding. It composes
[`@lexical/yjs`](https://www.npmjs.com/package/@lexical/yjs)'s CRDT primitives —
the same wiring the official React `CollaborationPlugin` performs — into a single
`register(editor)` step you hand to `lexicalForeign` (or, more commonly, to the
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

So `@llui/lexical` exposes two small, general seam options — `history: false` and
`seedMode: 'deferred'` — and this package supplies the scoped undo + bootstrap.

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
  history: false, // CRDT undo manager replaces the local stack
  seedMode: 'deferred', // collab bootstrap replaces the boot-time seed
  register: (editor) => collab.register(editor),
})
```

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
