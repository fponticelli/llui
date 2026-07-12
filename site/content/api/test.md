---
title: '@llui/test'
description: 'Test harness: testComponent, testView, propertyTest, replayTrace'
---

# @llui/test

Test harness for [LLui](https://github.com/fponticelli/llui) components. Mount components in jsdom, send messages, and assert on state and DOM.

```bash
pnpm add -D @llui/test
```

## Usage

```ts
import { testView } from '@llui/test'
import { counterDef } from './counter'

const harness = testView(counterDef, { count: 0 })

harness.click('[data-testid="increment"]')
harness.flush()

expect(harness.text('[data-testid="display"]')).toBe('1')
harness.unmount()
```

## API

### testComponent

```ts
testComponent(def) => { state, send, flush, effects }
```

Mount a component definition headlessly. Returns current state snapshot and message dispatch.

### testView

```ts
testView(def, state?) => ViewHarness<M>
```

Mount a component into jsdom with full DOM. Returns a harness with DOM query and interaction methods.

| Method                   | Description                                     |
| ------------------------ | ----------------------------------------------- |
| `.send(msg)`             | Dispatch a message                              |
| `.flush()`               | Force synchronous update (skip microtask queue) |
| `.click(selector)`       | Simulate click on element                       |
| `.input(selector, val)`  | Set input value and fire input event            |
| `.text(selector)`        | Get textContent of element                      |
| `.attr(selector, name)`  | Get attribute value                             |
| `.query(selector)`       | querySelector on mounted DOM                    |
| `.queryAll(selector)`    | querySelectorAll on mounted DOM                 |
| `.fire(selector, event)` | Dispatch a custom event                         |
| `.unmount()`             | Tear down the component and clean up            |

### assertEffects

```ts
assertEffects(effects, expected) => void
```

Deep-equal assertion on effect arrays. Provides clear diff output on mismatch.

### propertyTest

```ts
propertyTest(def, config) => void
```

Property-based testing over a component definition. `config.messageGenerators` produce random messages, and each generated sequence is checked against `config.invariants` (`(state, effects) => boolean`). Tune `runs` and `maxSequenceLength`; pass a `seed` to make the pseudo-random stream deterministic (the seed is always printed on failure, so you can pin it to replay the exact run). On failure the offending message sequence is automatically **shrunk** (delta-debugging) to a minimal reproducer. An optional `mount` block additionally mounts the component into a real DOM container and dispatches the sequence through `send`/`flush`, asserting no dev-mode panic, no `console.error`, and an optional `assertDom(state, container)` after every commit.

### replayTrace

```ts
replayTrace(def, trace) => void
```

Replay a recorded message trace against a component definition. Asserts state at each step.

### emulateBlurOnRemoval / withBlurOnRemoval

```ts
emulateBlurOnRemoval(doc?) => () => void
withBlurOnRemoval(fn, doc?) => ReturnType<fn>
```

Browser-faithful blur emulation for jsdom. When a focused element (or an ancestor) is removed from the document, real browsers run the HTML "removing steps" focus fixup and synchronously fire `blur` then `focusout`; jsdom resets `document.activeElement` but fires no events. That gap makes the inline-edit-commit pattern — an `<input>` whose `onBlur` commits, inside a `branch` arm the commit itself swaps out — impossible to exercise on its real path. `emulateBlurOnRemoval()` patches `removeChild` / `remove` / `replaceChild` to dispatch the missing events synchronously, returning an uninstall function; `withBlurOnRemoval(fn)` scopes the patch around `fn`.

<!-- auto-api:start -->

## Functions

### `assertEffects()`

Assert an effect list matches an expected list of partials. Length must be
equal; each effect at index `i` must partial-match `expected[i]`. See
{@link partialMatch} for the deep/array semantics (nested arrays match by
index with a length check; `undefined` fields are wildcards).

```typescript
function assertEffects<E>(actual: E[], expected: Array<Partial<E>>): void
```

### `defineTestComponent()`

```typescript
function defineTestComponent<S, M extends { type: string }, E extends { type: string } = never>(
  input: DefineTestComponentInput<S, M, E>,
): SignalComponentDef<S, M, E>
```

### `emulateBlurOnRemoval()`

Browser-faithful blur emulation for jsdom.
The HTML standard's node-removing steps run a "focus fixup": when the
currently-focused element (or an ancestor of it) is removed from the
document, the user agent resets focus to the viewport and fires `blur` then
`focusout` on the old focus target — SYNCHRONOUSLY, as part of the mutation.
Real apps depend on this: an inline-edit `<input>` whose `onBlur` commits,
sitting in a structural arm that the commit itself swaps out, fires that blur
mid-reconcile and re-enters the reducer.
jsdom resets `document.activeElement` to `<body>` on removal but fires NO
events, so that reentrancy is invisible in tests — the single most important
inline-edit interaction can't be exercised. `emulateBlurOnRemoval` closes the
gap by patching the removal-causing mutation methods to dispatch the missing
events synchronously, in browser order (`blur`, then the bubbling `focusout`).
Opt-in and reversible: returns an uninstall function (call it in `afterEach`),
or use {@link withBlurOnRemoval} for automatic scoping.
@param doc - document whose `activeElement` is consulted (defaults to the
ambient `document`). The patch is applied to the shared `Node`/`Element`
prototypes, matching the single jsdom document under test.
@returns an idempotent uninstall function restoring the native methods.

```typescript
function emulateBlurOnRemoval(doc: Document = document): () => void
```

### `propertyTest()`

```typescript
function propertyTest<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  config: PropertyTestConfig<S, M, E>,
): void
```

### `recordAgentSession()`

Begin recording an agent session. Returns a recorder whose `send`
forwards to the handle and captures the message; `stop()` finalizes
the trace into a JSON-serializable fixture.
Typical usage:

```ts
const handle = mountApp(root, App)
const r = recordAgentSession(handle)
r.send({ type: 'Cloud/NewMatrix' })
r.send({ type: 'Matrix/AddCriteria', criteria: [...] })
r.send({ type: 'Cloud/Save' })
const fixture = r.stop()
// Persist `fixture` as JSON; replay in CI to assert the same
// sequence still produces the same final state.
```

The recorder relies on the handle's `flush()` after every send so
the snapshot in `stop()` reflects the drained-message-queue state.
For long-running async effects, snapshot only fires after the
synchronous reducer cycles complete; subsequent commits from
effect responses won't be captured. Apps that need full async
coverage can manually call `await handle.flush()` plus a microtask
sleep before `stop()`, or wrap individual sends in
`await new Promise(r => setTimeout(r, 0))` between them.

```typescript
function recordAgentSession(handle: SignalComponentHandle<unknown, AgentMsg>): AgentSessionRecorder
```

### `reducer()`

Builds a view-less `ComponentDef` from an init + update pair so reducer
suites can drop a component definition into `testComponent()` without
padding a no-op `view`. Use when a test only exercises pure state
transitions (no DOM, no accessors).
The default name `'__reducer__'` is intentionally unergonomic — it
shows up in devtools/HMR registries if one ever leaks into a real
mount, flagging the mistake. Override via `name` when you want the
history trail to match your module.

```typescript
function reducer<S, M extends { type: string }, E extends { type: string } = never>(
  opts: ReducerOptions<S, M, E>,
): SignalComponentDef<S, M, E>
```

### `replayAgentSession()`

```typescript
function replayAgentSession(
  handle: SignalComponentHandle<unknown, AgentMsg>,
  fixture: AgentSessionFixture,
  options: ReplayOptions = {},
): ReplayResult
```

### `replayTrace()`

```typescript
function replayTrace<S, M, E>(def: SignalComponentDef<S, M, E>, trace: LluiTrace<S, M, E>): void
```

### `testComponent()`

```typescript
function testComponent<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  options: TestComponentOptions = {},
): TestHarness<S, M, E>
```

### `testView()`

Mount a component against a fresh container and return an interactive harness.
Simulates events + auto-flushes so tests can chain assertions naturally.

```typescript
function testView<S, M, E>(def: SignalComponentDef<S, M, E>, state: S): ViewHarness<S, M>
```

### `withBlurOnRemoval()`

Run `fn` with {@link emulateBlurOnRemoval} installed, uninstalling afterwards
even if `fn` throws. Returns whatever `fn` returns.

```typescript
function withBlurOnRemoval<T>(fn: () => T, doc: Document = document): T
```

## Interfaces

### `AgentSessionFixture`

Captured trace of an agent-driven session: the sequence of
messages dispatched and the final state observed after the last
one. Serializable as JSON so test fixtures can live alongside
code (`__fixtures__/login-flow.json`) and replay deterministically
in CI.

```typescript
export interface AgentSessionFixture {
  /**
   * State snapshot taken when recording started. Replay starts from
   * here — if the new handle's initial state diverges, the harness
   * reports the divergence so callers can decide whether to fail or
   * normalize.
   */
  initialState: unknown
  /**
   * Messages dispatched in order. Each is the raw msg the agent
   * sent (or whatever the recorder's `send(msg)` was called with).
   */
  msgs: Array<{ type: string; [k: string]: unknown }>
  /** State after every `msg` has been dispatched + drained. */
  finalState: unknown
}
```

### `AgentSessionRecorder`

```typescript
export interface AgentSessionRecorder {
  /**
   * Send a message through the wrapped channel. Forwards to the
   * underlying `handle.send` and records the msg into the trace.
   * Use this in place of `handle.send(msg)` for the duration of
   * the session you want to capture.
   */
  send(msg: { type: string; [k: string]: unknown }): void
  /**
   * Stop recording, snapshot the final state, return the fixture.
   * After `stop()`, further `send()` calls throw.
   */
  stop(): AgentSessionFixture
}
```

### `DefineTestComponentInput`

```typescript
export interface DefineTestComponentInput<
  S,
  M extends { type: string },
  E extends { type: string } = never,
> {
  name: string
  init: () => [S, E[]] | S
  update: (state: S, msg: M) => [S, E[]] | S
  view: (bag: SignalViewBag<S, M>) => Renderable
  onEffect?: SignalComponentDef<S, M, E>['onEffect']
}
```

### `ReducerOptions`

```typescript
export interface ReducerOptions<S, M extends { type: string }, E extends { type: string } = never> {
  init: () => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  name?: string
}
```

### `ReplayOptions`

```typescript
export interface ReplayOptions {
  /**
   * When true, also assert that the new handle's initial state
   * matches `fixture.initialState`. Defaults to false — most apps
   * have deterministic init, but ones that read time / random /
   * environment shouldn't enforce this.
   */
  assertInitial?: boolean
}
```

### `ReplayResult`

Replay a previously-recorded session against a fresh `handle`.
Dispatches each msg in order, snapshots state after the last one,
and compares to `fixture.finalState`. Returns:

- `matches: true` — bit-exact replay; nothing changed.
- `matches: false, diff` — final state differs; `diff` lists the
  paths that diverged in the same JSON-Patch shape as
  `send_message`'s `stateDiff`. Use it in test assertions:
  `expect(result.diff).toEqual([])`.
  The harness deliberately ignores the `initialState` half of the
  fixture by default — replay starts from whatever the new handle's
  `init()` produced, so apps with deterministic init don't need to
  carry their initial state around in source control. Pass
  `assertInitial: true` to also enforce that the initial states
  match; useful when a test wants to catch init-effect drift.

```typescript
export interface ReplayResult {
  matches: boolean
  /**
   * Diff from fixture.finalState to the replay's actual final state.
   * Empty when `matches: true`. Empty when `matches: false` only if
   * the divergence was at the `initialState` level and `assertInitial`
   * was true.
   */
  diff: Array<{ op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }>
}
```

### `TestComponentOptions`

```typescript
export interface TestComponentOptions {
  /**
   * Opt in to faithfully replicating the runtime's effect drain. In the default
   * (pure-reducer) mode `testComponent` runs `update()` once per `send` and
   * stops — effects are recorded but never dispatched. The real runtime instead
   * dispatches every returned effect to `onEffect`, which commonly calls `send`
   * synchronously; the terminal state after such a cascade differs from the
   * pure-reducer state ("green tests lie").
   *
   * With `withEffects: true` the harness replicates the runtime loop exactly:
   * a queue-based `send`, reducers run to quiescence, then the collected
   * effects dispatch in order through the def's `onEffect` with a real
   * {@link EffectApi} (including this mount's lifecycle `signal`); effect-driven
   * `send`s re-enter the same queue, so a cascade settles to the same terminal
   * state a real `mountApp` reaches.
   */
  withEffects?: boolean
}
```

### `TestHarness`

```typescript
export interface TestHarness<S, M, E> {
  /** Current state (after the most recent `send`/`sendAll`/`batch`). */
  state: S
  /**
   * Effects produced by the MOST RECENT top-level `send` (or `batch`, or
   * `init`). In `withEffects` mode a single `send` can run several reducers
   * (the effect→send cascade); this holds every effect emitted across that
   * whole drain, in emission order.
   */
  effects: E[]
  /** Every effect emitted since construction (init effects first). */
  allEffects: E[]
  /**
   * One entry per reducer run, in order. In `withEffects` mode a cascade adds
   * several entries under one `send`.
   */
  history: Array<{ prevState: S; msg: M; nextState: S; effects: E[] }>
  send: (msg: M) => void
  sendAll: (msgs: M[]) => S
  /**
   * Coalesce a burst of `send`s (see the runtime handle's `batch`). Reducers
   * and — in `withEffects` mode — effects still run per message in order; the
   * harness has no DOM to commit, so `batch` here is a faithful structural
   * mirror (it establishes one top-level `effects` window across the burst).
   */
  batch: (fn: () => void) => void
  /**
   * Tear down the harness: aborts the per-mount lifecycle `AbortSignal` handed
   * to `onEffect` (so effect handlers keyed off `api.signal` clean up) and runs
   * any cleanups returned by `onEffect`. After dispose, `send`/`batch` are
   * inert (matching the runtime's after-dispose drop). No-op in the default
   * pure-reducer mode beyond aborting the signal.
   */
  dispose: () => void
}
```

<!-- auto-api:end -->
