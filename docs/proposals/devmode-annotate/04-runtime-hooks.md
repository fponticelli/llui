# 04 — Runtime Hooks

> **Status (2026-06-02): PARTIAL / BUILT DIFFERENTLY.** The `NoteBody` telemetry (state snapshot, message log, effects) is collected — but via the existing `__lluiDebug` / `__lluiComponents` globals (`debug-collector.ts`), NOT the proposed new `window.__llui` `LluiDevSurface`, which was not built. `dirtyTrace` / `structuralAt` types exist but are not populated.

**Status:** Proposal.
**Parent:** [`README.md`](./README.md)
**Touches:** `packages/dom/`, `packages/compiler-devtools/`. All additions dev-mode-only, tree-shaken in prod.

The capture format described in 01 is only as good as the data the runtime can supply. This document enumerates what `@llui/dom` and `@llui/compiler-devtools` need to expose so the HUD and the Playwright shim can build a full `NoteBody`. Everything here lives behind `import.meta.env.DEV` gates and never ships in production builds.

---

## The introspection surface

A single global, populated only in dev mode:

```ts
declare global {
  interface Window {
    __llui?: LluiDevSurface
  }
}

interface LluiDevSurface {
  // Versions
  runtime: string
  compiler: string

  // Snapshot accessors (all idempotent, all cheap)
  snapshot: {
    state(scopeId?: string): unknown
    scopeAt(point: Point): ScopeRef | null
    enclosingComponent(point: Point): ScopeRef | null
    structuralAt(scope: ScopeRef): StructuralSnapshot
    dirtyTrace(scope: ScopeRef): DirtyTraceEntry[]
    sourceMap(bbox: Rect): SourceMapEntry[]
    agentSchemas(scope: ScopeRef): AgentSchemaSummary[]
    pendingMessages(): PendingMsg[]
    fullScopeTree(): ScopeTreeNode[]
    bindings(): BindingsTelemetry
  }

  // Ring buffers (last N entries, cleared on full reload)
  buffers: {
    messages: RingBuffer<{ ts: string; component: string; msg: unknown }>
    effects: {
      pending: Map<string, PendingEffect>
      recent: RingBuffer<RecentEffect>
    }
    errors: RingBuffer<RuntimeError>
    console: RingBuffer<{ ts: string; level: LogLevel; text: string }>
  }

  // Capture coordination
  capture: {
    waitForMessage(msgType: string, timeoutMs: number): Promise<void>
    requestSnapshot(opts: SnapshotRequest): Promise<NoteBody>
  }
}

interface ScopeRef {
  id: string // internal scope id
  componentPath: string[] // ["App", "UserCard", "EditButton"]
  componentMeta: { file: string; line: number; name: string }
  root: Element // DOM root for the scope
}
```

Every field of `LluiDevSurface` is read-only from the outside. The HUD never mutates runtime state; it only observes.

---

## Ring buffers

All four buffers default to capacity 100, configurable via env at dev-server startup:

| Buffer            | Captures                                                 | Default capacity          |
| ----------------- | -------------------------------------------------------- | ------------------------- |
| `messages`        | Every `send()` call: ts, component, msg                  | 100                       |
| `effects.pending` | Effects emitted but not yet handled. Keyed by effect id. | unbounded (typically <20) |
| `effects.recent`  | Completed effects with outcome                           | 100                       |
| `errors`          | Runtime errors caught by the update loop                 | 50                        |
| `console`         | Monkey-patched `console.*` calls                         | 100                       |

`@llui/dom` already has hooks at every `send()` and every effect emission for the existing dev-mode tracing; this proposal formalizes them into addressable buffers. Implementation cost is low.

The console patch is the only non-trivial bit — it has to chain rather than replace existing handlers, and it has to detect when `console.*` is called from app code vs framework code (only app-code calls go into the buffer; framework calls would create noise).

---

## Dirty-trace snapshot

For each mounted component, the compiler already emits:

```ts
__componentMeta = {
  name: 'UserCard',
  file: 'src/UserCard.ts',
  line: 8,
  paths: ['user.name', 'user.email', 'user.avatar'], // tracked paths in order of bit index
  hasMaskHi: false,
  // … existing fields
}
```

The runtime tracks each component's current `mask` and `maskHi` and the bits set in the last update cycle. `snapshot.dirtyTrace(scope)` walks the focused scope and its descendants (or the whole route at `verbose`), returning one `DirtyTraceEntry` per component:

```ts
interface DirtyTraceEntry {
  component: string // path joined
  pathsTracked: string[] // from __componentMeta.paths
  mask: number // current value
  maskHi?: number
  lastFlippedBits: string[] // path names of bits set last cycle
}
```

No new runtime data is needed; this is purely an exposed accessor over data already maintained by the update loop.

---

## Source-position map

This is the highest-value LLui-native addition. The HUD asks: "for the elements inside this annotation's bounding box, which view-fn call rendered each?"

### Compiler emission

`@llui/compiler-devtools` currently emits `__componentMeta` per component. This proposal adds per-element source positions: when devtools mode is on, each element helper call is decorated with a `data-llui-pos="file:line:col"` attribute (or, less invasively, a `WeakMap<Element, SourcePos>` populated at mount).

The compiler already knows file:line:col for every node it visits (it uses them for diagnostics). Wiring this through to the runtime requires:

1. **Compiler change:** when devtools mode is enabled, decorate `elSplit()` calls with an additional argument carrying the source position.
2. **Runtime change:** `elSplit()` writes that position into a module-level `WeakMap<Element, SourcePos>` instead of (or in addition to) using a DOM attribute. WeakMap avoids polluting the DOM and is GC-friendly.
3. **Accessor:** `snapshot.sourceMap(bbox)` iterates elements within the bounding box, reads their entries from the WeakMap, and returns the result.

Why WeakMap not data-attribute: data-attrs leak into the screenshot if devtools mode is forgotten in prod (unlikely with proper tree-shaking, but ugly); they also pollute the DOM inspector. WeakMap is invisible and free.

---

## Structural primitives

`branch`, `show`, `each` each maintain runtime state — branches know their active arm; show knows its visibility; each knows its key list. `snapshot.structuralAt(scope)` walks the scope tree and returns:

```ts
interface StructuralSnapshot {
  branches: Array<{ at: string; activeArm: string }>
  shows: Array<{ at: string; visible: boolean }>
  eachKeys: Array<{ at: string; keys: string[] }>
}
```

`at` is a stringified component path locating the primitive (e.g. `App.UserList[each]`). No new runtime data needed; the primitives already hold this state.

---

## Capture coordination

The HUD and Playwright shim both call into `__llui.capture` to coordinate timing-sensitive captures:

```ts
interface SnapshotRequest {
  scope?: ScopeRef
  captureLevel: 'standard' | 'verbose'
  bbox?: Rect                              // limits sourceMap scope
}

// Promise resolves with a fully-populated NoteBody
capture.requestSnapshot(opts): Promise<NoteBody>

// Resolves when a message of the given type fires; rejects on timeout
capture.waitForMessage(msgType, timeoutMs): Promise<void>
```

`waitForMessage` lets the LLM say "snap after `UsersLoaded` fires" and get a deterministic screenshot. It hooks the message bus to fire its promise on first match.

`requestSnapshot` runs _inside one microtask_ so the runtime is in a quiescent state (no mid-update inconsistency). If called during a flush, it waits for the flush to complete.

---

## Agent schemas at scope

`snapshot.agentSchemas(scope)` returns the agent-resolvable message types reachable from the focused scope. Two implementations:

- **Coarse (v1):** every msg type declared by every component in the scope's path. The compiler already knows this via `@llui/compiler-introspection`.
- **Precise (later):** filtered to msg types actually wired into event handlers in the scope's view subtree. Requires more compiler help.

v1 ships coarse. Precise is a follow-up.

---

## What changes per package

### `@llui/dom`

- New module: `src/devtools.ts` (only included in dev builds via `import.meta.env.DEV`).
- Adds `window.__llui` assignment at runtime init.
- Defines the ring buffers, populates them from existing send/effect/error hooks.
- Defines all `snapshot.*` accessors.
- Defines the WeakMap that backs source-position lookups.
- Defines `capture.*` helpers.

### `@llui/compiler-devtools`

- Extends `elSplit()` call decoration to include source-position when devtools mode is enabled.
- Already emits `__componentMeta`; extends it with `paths: string[]` ordered by bit index (this may already exist — confirm before implementing).

### `@llui/dom` test changes

- New test file: `test/devtools-surface.test.ts` — asserts `window.__llui` shape, ring buffer behavior, `snapshot.*` correctness against a fixture component tree.
- All in `test/`, not alongside source, per project convention.

---

## Production-build guarantees

- All `devtools.ts` code is gated by `import.meta.env.DEV`. Production bundles see `false` after Vite's define-replace, tree-shaking out the entire module.
- The compiler emits source-position decorations only when `compiler-devtools` is enabled. Default builds do not pay the bytes.
- `window.__llui` is never assigned in production.

Bundle-size check (per design doc 06): after this proposal lands, run the size diff and confirm dev-only weight does not exceed +3KB to the prod bundle. Expected: 0 bytes.

---

## Decisions encoded

1. **One global, `window.__llui`.** Discoverable, simple, easy to feature-detect. Versioned by `runtime` and `compiler` strings.
2. **Source positions in a WeakMap, not data-attrs.** Invisible to screenshots and the DOM inspector, GC-friendly.
3. **Snapshots are quiescent.** `requestSnapshot` waits for the flush queue to drain before reading. No mid-update inconsistency.
4. **Coarse `agentSchemas` for v1.** Precise filtering is a follow-up; ship the 80% solution first.
5. **Console patching opt-in.** Off by default; HUD or shim enables it on connect. Avoids noise for users who never use the feature.

---

## Open questions

1. Should `snapshot.fullScopeTree()` be lazy / chunked? For 500-component apps the tree blob could be sizable. Recommendation: it's only computed at `verbose`, where the user has opted into the cost.
2. Should the WeakMap-based source-position map have a tag attribute fallback for E2E tests or external tooling that can't access the WeakMap? Recommendation: defer — add only if a real consumer asks.
3. Should ring buffer capacities be configurable per-buffer at runtime? Recommendation: yes via `window.__llui.config.set({messagesCapacity: 500})`, with sane defaults.
4. Should we capture a stack trace at every `send()` for the message log? Useful for "where did this msg come from", but expensive. Recommendation: off by default, opt-in via `window.__llui.config.set({traceMessages: true})`.
