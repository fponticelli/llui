# Test Strategy

This document specifies how LLui applications are tested. The central thesis: **LLui's architecture makes most UI testing unnecessary.** The `update()` function is pure. Effects are data. The view runs once. These properties enable a testing model where 90% of application logic is verified by sub-millisecond pure function tests, with no browser, no DOM, and no flakiness — and the framework ships the tooling to make this the default path.

> **Runtime context.** LLui runs on the signal runtime: `view` builds DOM once from a `state: Signal<S>` handle, reactive reads (`state.map(...)`, `state.at('field')`) compile to bindings, and a change runs a chunked-mask reconciler that re-runs only the bindings whose dependency paths changed. There is no virtual DOM and no per-binding bitmask synthesized in source — `send` applies updates synchronously. `@llui/dom` is the single import surface (no `/signals` subpath); element and structural helpers (`div`, `text`, `each`, `show`, `branch`, …) are module imports.

---

## 1. Why UI Testing Is Broken

E2E tests are slow, flaky, and brittle. They break when a CSS class changes, when a selector path shifts, when a third-party script loads slowly, or when CI machines are under load. The root cause is not bad tooling — it is that traditional UI frameworks entangle business logic with the DOM. When the only way to verify "does the submit button disable during validation" is to mount a component, type into an input, click a button, and check an attribute, every test is an integration test whether you want it or not.

LLui's architecture eliminates this entanglement:

- **`update()` is a pure function.** Every state transition, every validation rule, every conditional, every edge case lives in `(state, msg) → [newState, effects]`. No DOM. No browser. No async. Testable with `assert.deepEqual`.
- **Effects are data.** "Was an HTTP request made with the right URL?" is not a question about `fetch` — it is a question about what object `update()` returned. No mocks needed.
- **`view()` runs once.** The binding graph is established at mount time and never re-evaluated. The framework's update mechanism (the chunked-mask reconciler's dirty-path gate + output-equality skip) is tested by the framework, not by every application.
- **The compiler verifies bindings statically.** The signal lint rules — `operator-on-signal` (operating on a `Signal` instead of `.map(...)`-ing its value), `peek-in-slot` (calling `.peek()` in a reactive slot), `pure-derive-body` / `no-node-construction-in-body` (impure or DOM-building `.map`/`derived` bodies) — are compile-time errors, caught at build time, not test time.

This means the testing pyramid inverts:

```
Traditional UI framework:          LLui:

     /  E2E  \                        /  Playwright  \        (transitions, a11y only)
    / integr. \                      / signal runtime \       (reconcile guarantees — framework-level)
   /   unit    \                    / testComponent()   \     (view queries — fast, no browser)
  /  (hard to   \                  / propertyTest()      \    (invariants — auto-generated)
 /   isolate)    \                / update() + effects    \   (pure functions — microseconds)
```

---

## 2. The `@llui/test` Package

LLui ships a first-party test package. It is not optional documentation — it is the primary way applications are tested.

### 2.1 `testComponent()` — Zero-DOM Component Harness

`testComponent()` creates a lightweight harness that runs `init()`, exposes `send()`, and tracks state and effects — all without a browser or DOM.

```typescript
import { testComponent } from '@llui/test'
import { Counter } from './counter'

describe('Counter', () => {
  it('increments', () => {
    const t = testComponent(Counter)
    expect(t.state.count).toBe(0)
    t.send({ type: 'increment' })
    expect(t.state.count).toBe(1)
    expect(t.effects).toEqual([])
  })

  it('does not go below zero', () => {
    const t = testComponent(Counter)
    t.send({ type: 'decrement' })
    expect(t.state.count).toBe(0)
  })

  it('batched sends produce correct final state', () => {
    const t = testComponent(Counter)
    t.send({ type: 'increment' })
    t.send({ type: 'increment' })
    t.send({ type: 'increment' })
    expect(t.state.count).toBe(3)
  })
})
```

The harness provides:

- **`t.state`** — current state after all messages processed.
- **`t.effects`** — effects from the most recent `send()` call.
- **`t.allEffects`** — cumulative effects across all sends, seeded with `init()`'s effects.
- **`t.history`** — array of `{ prevState, msg, nextState, effects }` for every transition.
- **`t.send(msg)`** — dispatches a message through `update()`, updates state, records effects.
- **`t.sendAll([msgs])`** — dispatches a sequence, returns final state.

`testComponent(def)` seeds its initial state and effects from the component's own `init()` — it takes no state-override argument. To start a test from a specific mid-flight state, send the messages that reach it, or build a one-off def with a custom `init` via `defineTestComponent`. The examples below use this thin seeding helper:

```typescript
import { defineTestComponent } from '@llui/test'
import type { SignalComponentDef } from '@llui/dom'

// Seed a component with an explicit starting state (init() is overridden).
const seeded = <S, M, E>(def: SignalComponentDef<S, M, E>, state: S) =>
  defineTestComponent<S, M, E>({ name: def.name ?? 'Test', ...def, init: () => [state, []] })

// Usage: testComponent(seeded(Search, { query: 'hello', results: [], loading: true }))
```

Both `init` and `update` may return a bare `S` or a `[S, E[]]` tuple; the harness normalizes either form.

`testComponent()` runs in Node. No jsdom. No browser. Each test takes microseconds. There is zero flakiness because there is no IO, no timers, no async.

### 2.2 `testView()` — View Queries Without a Browser

For tests that need to verify what the view renders — and to drive interaction through the real signal runtime — `testView(def, state)` mounts the component (via `mountApp`) against a fresh container seeded with the supplied `state`, and exposes query + interaction helpers:

```typescript
import { testView } from '@llui/test'
import { SearchResults } from './search-results'

it('shows loading spinner when loading', () => {
  const v = testView(SearchResults, { query: 'test', results: [], loading: true })
  expect(v.query('[data-testid="spinner"]')).not.toBeNull()
  expect(v.query('[data-testid="results-list"]')).toBeNull()
  v.unmount()
})

it('toggling a result updates the DOM reactively', () => {
  const v = testView(SearchResults, {
    query: 'test',
    results: [{ id: '1', title: 'Result 1', saved: false }],
    loading: false,
  })
  expect(v.queryAll('[data-testid="result"]')).toHaveLength(1)
  v.click('[data-testid="save-1"]')
  expect(v.attr('[data-testid="result"]', 'data-saved')).toBe('true')
  v.unmount()
})
```

`testView` mounts the component through the real signal runtime, so the test environment must supply a DOM (`jsdom` or `happy-dom` — set `test.environment` in the Vitest config). It is not a minimal shim: the full reconciler runs, bindings update, and events propagate. The harness provides:

- **`v.container`** — the mounted container element.
- **`v.handle`** — the `SignalComponentHandle` from `mountApp` (`send`, `getState`, `dispose`, …).
- **`v.query(sel)` / `v.queryAll(sel)`** — `querySelector` / `querySelectorAll`.
- **`v.text(sel)`** — `textContent` of the first match (empty string if absent).
- **`v.attr(sel, name)`** — an attribute value (or `null`).
- **`v.send(msg)`** — dispatch a message and flush.
- **`v.click(sel)`** — click an element (throws if no match), then flush.
- **`v.input(sel, value)`** — set an input's value, dispatch an `input` event, flush.
- **`v.fire(sel, type, init?)`** — dispatch a custom event (bubbles by default), flush.
- **`v.unmount()`** — dispose the runtime and clear the container (idempotent).

Because `send` is synchronous in the signal runtime, `v.handle.flush()` is a no-op kept for harness parity; the helpers call it anyway so tests read naturally.

**When NOT to use `testView()`:** For anything that involves real layout, CSS transitions, focus management, or screen-reader behavior. jsdom/happy-dom do not compute layout or run CSS — those are Playwright concerns.

### 2.3 `assertEffects()` — Partial Effect Matching

Effects are data. Testing them should be as easy as testing state:

```typescript
import { assertEffects } from '@llui/test'

it('search dispatches cancel + debounce + http', () => {
  const t = testComponent(Search)
  t.send({ type: 'setQuery', value: 'hello' })
  assertEffects(t.effects, [
    {
      type: 'cancel',
      token: 'search',
      inner: { type: 'debounce', inner: { type: 'http', url: '/api?q=hello' } },
    },
    { type: 'analytics', event: 'search_typed' },
  ])
})

it('clear cancels without replacement', () => {
  const t = testComponent(seeded(Search, { query: 'hello', results: [], loading: true }))
  t.send({ type: 'clearSearch' })
  assertEffects(t.effects, [{ type: 'cancel', token: 'search' }])
})
```

`assertEffects` does **partial deep matching** by default. You specify the fields you care about; extra fields (like `onSuccess`, `onError`, `ms`) are ignored unless you include them. This makes tests resilient to adding new fields to effects without breaking existing assertions.

### 2.4 `propertyTest()` — Invariant Testing via Random Message Sequences

Since `update()` is pure and `Msg` is a finite discriminated union, the framework can generate random message sequences and verify that invariants hold after every transition:

```typescript
import { propertyTest } from '@llui/test'
import { TodoApp } from './todo-app'

propertyTest(TodoApp, {
  invariants: [
    (state) => state.todos.length >= 0,
    (state) => state.todos.length <= 100,
    (state) => state.filter === 'all' || state.filter === 'active' || state.filter === 'completed',
    (state) => state.todos.every((t) => typeof t.id === 'string' && t.id.length > 0),
    (state, effects) => effects.every((e) => e.type !== 'http' || state.loading),
  ],
  messageGenerators: {
    addTodo: () => ({ type: 'addTodo' as const, text: randomString(1, 50) }),
    toggleTodo: (state) => ({
      type: 'toggleTodo' as const,
      id:
        state.todos.length > 0
          ? state.todos[Math.floor(Math.random() * state.todos.length)].id
          : 'nonexistent',
    }),
    setFilter: () => ({
      type: 'setFilter' as const,
      filter: pick(['all', 'active', 'completed']),
    }),
    clearCompleted: () => ({ type: 'clearCompleted' as const }),
  },
  runs: 1000,
  maxSequenceLength: 50,
})
```

`propertyTest()` generates `runs` random message sequences of up to `maxSequenceLength` messages, feeds each through `update()`, and asserts all invariants after every step. When an invariant fails, it reports the exact sequence that caused the failure and attempts to shrink it to a minimal reproduction.

This catches edge cases no human writes tests for: message orderings that only happen in production, state combinations that arise from unusual interaction patterns, off-by-one errors in array manipulation under rapid add/remove cycles.

**Message generators** receive the current state so they can produce contextually valid messages (e.g., toggling a todo that actually exists). The framework can also auto-generate basic generators from the `Msg` union type at build time via the compiler plugin — filling primitive fields with random values and union fields with random variants.

### 2.5 `replayTrace()` — Regression Testing from Recorded Sessions

Every state transition in a LLui component is `(state, msg) → (newState, effects)`. The framework can record these transitions from a real session and replay them as deterministic regression tests:

```typescript
import { replayTrace } from '@llui/test'
import { CheckoutFlow } from './checkout'

it('checkout trace from user session 2024-03-15 still produces same transitions', () => {
  const trace = loadTrace('./traces/checkout-happy-path.json')
  replayTrace(CheckoutFlow, trace)
})
```

A trace file is a JSON array of `{ msg, expectedState, expectedEffects }` entries. `replayTrace()` feeds each message through `update()` and asserts the output matches. When a code change causes a divergence, the error reports exactly which message caused it and what the expected vs actual state was.

Traces can be captured from:

- Manual testing sessions (a dev tool records transitions as the developer interacts)
- Production sessions (opt-in, with PII scrubbing)
- `testComponent()` runs (export a test's history as a trace)
- LLM debug sessions (the `window.__lluiDebug.exportTrace()` API or the `llui_export_trace` MCP tool — see 07 LLM Friendliness §10)

This replaces fragile E2E regression suites. A trace that passes today and fails after a refactor tells you exactly what changed and where — with no DOM selectors to break.

`replayTrace(def, trace)` replays each entry through the component's pure `update()` and asserts deep state equality and deep effect equality, reporting the diverging step on failure. The trace format is the versioned JSON object below (`lluiTrace: 1`), shared with the LLM debug / MCP protocol (`llui_replay_trace` tool) so a trace exported from a running app replays in a unit test unchanged.

---

## 3. What the Framework Tests (Not the Application)

The six guarantees below are **framework-level** concerns. Application developers do not need to write these tests — the LLui test suite covers them. They are documented here for completeness and because they define what the framework promises.

### Guarantee 1: Reactivity only mutates the minimal necessary subset of the DOM.

Verified via `MutationObserver` in the framework's own browser test suite. A message that changes one field re-runs only the bindings whose dependency paths intersect the changed paths (the reconciler's dirty-path gate). The framework tests assert exact mutation counts.

### Guarantee 2: State changes that do not produce a new value for a binding produce zero DOM mutations.

The output-equality skip. A binding whose dependency path changed still re-runs its `produce`, but if the produced value is unchanged the reconciler does not touch the DOM. Sending a message that sets `count` to its current value runs the accessor but writes nothing. The framework tests assert `mut.total === 0`.

### Guarantee 3: Structural changes do not trigger binding updates on disposed scopes.

When `branch` switches arms, the departing arm's scope (and its bindings/teardowns) is disposed before sibling bindings run. The framework tests assert that no mutation records reference nodes from the disposed scope.

### Guarantee 4: Per-item bindings in `each()` are not re-evaluated when the item reference is unchanged.

`each(state.map(s => s.items), { key, render })` builds each row against a per-row `item` / `index` signal. When a row's item reference is unchanged, its bindings produce unchanged values and the reconciler skips them. The framework tests assert zero mutations on unchanged rows after an append or single-item update.

### Guarantee 5: Events fire exactly once per user interaction.

The framework tests assert dispatch count per click/input event.

### Guarantee 6: Scope disposal is complete.

After disposal: no lingering listeners, no `onMount` callbacks fire, no bindings update. Verified behaviorally — interact with a disposed element and assert no effect occurs.

### Framework DOM Test Infrastructure

The framework's own test suite uses `MutationObserver` for mutation counting, Vitest browser mode with Playwright for real-browser DOM tests, and Playwright standalone for transitions/animations. This infrastructure is **not exposed to application developers** — it is internal to the `@llui/dom` package. Application developers use `@llui/test` instead.

```typescript
// Framework-internal test helper (not exported to apps):
export function observeMutations(root: Node) {
  const log: MutationRecord[] = []
  const obs = new MutationObserver((recs) => log.push(...recs))
  obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
  return {
    get childListCount() {
      return log.filter((r) => r.type === 'childList').length
    },
    get attributeCount() {
      return log.filter((r) => r.type === 'attributes').length
    },
    get characterDataCount() {
      return log.filter((r) => r.type === 'characterData').length
    },
    get total() {
      return log.length
    },
    reset() {
      log.length = 0
    },
    records() {
      return [...log]
    },
    stop() {
      obs.disconnect()
    },
  }
}
```

---

## 4. The Application Test Pyramid

Application developers write tests at four levels. The first two cover 90%+ of application logic without a browser.

### Level 1 — Pure `update()` Tests (Node, microseconds)

The primary testing level. Every state transition, validation rule, conditional branch, and edge case is tested by calling `update()` directly.

```typescript
import { testComponent, assertEffects, defineTestComponent } from '@llui/test'
import { Form } from './form'

describe('Form update()', () => {
  it('setField updates the correct field', () => {
    const t = testComponent(Form)
    t.send({ type: 'setField', field: 'email', value: 'a@b.com' })
    expect(t.state.fields.email).toBe('a@b.com')
    expect(t.state.fields.name).toBe('') // untouched
  })

  it('submit with empty name shows validation error, no http effect', () => {
    const t = testComponent(Form)
    t.send({ type: 'submit' })
    expect(t.state.errors.name).toBe('required')
    expect(t.effects).toEqual([])
  })

  it('submit with valid data transitions to loading and dispatches http', () => {
    const t = testComponent(Form)
    t.send({ type: 'setField', field: 'name', value: 'Alice' })
    t.send({ type: 'setField', field: 'email', value: 'a@b.com' })
    t.send({ type: 'submit' })
    expect(t.state.phase).toBe('loading')
    assertEffects(t.effects, [{ type: 'http', url: '/api/submit' }])
  })

  it('submitSuccess clears form and transitions to success', () => {
    // Reach the loading state by sending the messages that produce it, since
    // testComponent seeds from init() and takes no state override.
    const t = testComponent(Form)
    t.send({ type: 'setField', field: 'name', value: 'Alice' })
    t.send({ type: 'setField', field: 'email', value: 'a@b.com' })
    t.send({ type: 'submit' })
    t.send({ type: 'submitSuccess', data: { id: 1 } })
    expect(t.state.phase).toBe('success')
    expect(t.state.fields.name).toBe('')
  })

  it('submitError preserves form data and shows error', () => {
    // For a one-off seed state, build a def with a custom init via
    // defineTestComponent rather than passing a state argument.
    const t = testComponent(
      defineTestComponent({
        ...Form,
        name: 'Form',
        init: () => [
          { phase: 'loading', fields: { name: 'Alice', email: 'a@b.com' }, errors: {} },
          [],
        ],
      }),
    )
    t.send({ type: 'submitError', error: 'Network error' })
    expect(t.state.phase).toBe('error')
    expect(t.state.fields.name).toBe('Alice') // preserved
    expect(t.state.errorMessage).toBe('Network error')
  })
})
```

This tests everything that matters about the form — validation, state transitions, error handling, data preservation — without touching the DOM. The tests are deterministic, instant, and will never flake.

### Level 2 — Property-Based Invariant Tests (Node, seconds)

For components with complex state machines, `propertyTest()` finds edge cases automatically.

```typescript
import { propertyTest } from '@llui/test'
import { Wizard } from './wizard'

propertyTest(Wizard, {
  invariants: [
    // Can never go past step 4 or below step 1
    (state) => state.step >= 1 && state.step <= 4,
    // Loading state always has an in-flight effect
    (state, effects) => state.phase !== 'loading' || effects.some((e) => e.type === 'http'),
    // Data from previous steps is never lost when going back
    (state) => (state.step > 1 ? state.collectedData.step1 !== undefined : true),
    // Errors clear when the user modifies the field
    (state) =>
      Object.keys(state.errors).every(
        (field) => state.fields[field] === state.lastValidated[field],
      ),
  ],
  messageGenerators: {
    next: () => ({ type: 'next' as const }),
    back: () => ({ type: 'back' as const }),
    setField: () => ({
      type: 'setField' as const,
      field: pick(['name', 'email', 'phone', 'address']),
      value: randomString(0, 100),
    }),
    submit: () => ({ type: 'submit' as const }),
    submitSuccess: () => ({ type: 'submitSuccess' as const, data: { id: randomInt(1, 1000) } }),
    submitError: () => ({ type: 'submitError' as const, error: randomString(5, 50) }),
  },
  runs: 2000,
  maxSequenceLength: 30,
})
```

### Level 3 — View Structure Tests (Node, milliseconds)

For tests that need to verify what the view renders for a given state, without interaction:

```typescript
import { testView } from '@llui/test'
import { Dashboard } from './dashboard'

it('loading state shows spinner, not content', () => {
  const v = testView(Dashboard, { phase: 'loading', data: null })
  expect(v.query('[data-testid="spinner"]')).not.toBeNull()
  expect(v.query('[data-testid="content"]')).toBeNull()
})

it('error state shows error message and retry button', () => {
  const v = testView(Dashboard, { phase: 'error', errorMessage: 'Failed to load' })
  expect(v.query('[data-testid="error"]')?.textContent).toBe('Failed to load')
  expect(v.query('[data-testid="retry-btn"]')).not.toBeNull()
})

it('each() renders correct number of rows', () => {
  const v = testView(TodoList, {
    todos: [
      { id: '1', text: 'Buy milk', done: false },
      { id: '2', text: 'Walk dog', done: true },
    ],
    filter: 'all',
  })
  expect(v.queryAll('[data-testid="todo-item"]')).toHaveLength(2)
})
```

### Level 4 — Playwright Tests (Browser, seconds)

The only tests that require a browser. Reserved for things that are impossible to test without one:

- **Accessibility:** Focus management, keyboard navigation, screen reader announcements, ARIA attribute behavior.
- **CSS transitions and animations:** Enter/leave timing, interrupted transitions, animation completion events.
- **Native browser behavior:** Form submission, clipboard interaction, drag-and-drop with real mouse events.
- **Layout-dependent logic:** `getBoundingClientRect` in `onMount`, portal positioning, intersection observers.

```typescript
// tests/e2e/modal.spec.ts
import { test, expect } from '@playwright/test'

test('modal: focus trapped, Escape closes, focus restored', async ({ page }) => {
  await page.goto('/modal-demo')
  const openBtn = page.locator('[data-testid="open-modal"]')
  await openBtn.click()

  const modal = page.locator('[role="dialog"]')
  await expect(modal).toBeVisible()

  // Focus trapped inside modal
  const firstInput = modal.locator('input').first()
  await expect(firstInput).toBeFocused()
  const lastBtn = modal.locator('button[data-testid="confirm"]')
  await lastBtn.focus()
  await page.keyboard.press('Tab')
  await expect(firstInput).toBeFocused() // wrapped

  // Escape closes and restores focus
  await page.keyboard.press('Escape')
  await expect(modal).not.toBeAttached()
  await expect(openBtn).toBeFocused()
})

test('branch leave: CSS transition plays before removal', async ({ page }) => {
  await page.goto('/transition-demo')
  await page.click('[data-testid="switch"]')

  // Old node still in DOM during transition
  await expect(page.locator('[data-testid="case-a"]')).toBeAttached()
  // Wait for transition to complete
  await page.locator('[data-testid="case-a"]').waitFor({ state: 'detached', timeout: 1000 })
  await expect(page.locator('[data-testid="case-b"]')).toBeAttached()
})

test('interrupted transition: A→B→C, only C remains', async ({ page }) => {
  await page.goto('/transition-demo')
  await page.click('[data-testid="go-b"]')
  await page.click('[data-testid="go-c"]') // interrupt before B settles

  await page.locator('[data-testid="case-c"]').waitFor({ state: 'attached', timeout: 1500 })
  await expect(page.locator('[data-testid="case-a"]')).not.toBeAttached()
  await expect(page.locator('[data-testid="case-b"]')).not.toBeAttached()
})
```

**Playwright tests should be rare.** A well-structured LLui application might have 200 Level 1 tests, 10 Level 2 property tests, 30 Level 3 view tests, and 5–10 Playwright tests. If you find yourself writing Playwright tests for business logic, the logic should move to `update()`.

---

## 5. Compile-Time Verification (Zero Runtime Cost)

The LLui compiler replaces an entire class of tests with build-time guarantees:

**Dependency-path correctness.** The signal transform lowers each reactive slot to a `produce` function plus the absolute state dependency paths it reads (`state.at('user.name')` → deps `['user.name']`). The reconciler gates re-runs on those paths. If the analysis is wrong, the framework's compiler tests catch it. Application code does not need to test "did the right binding update" — the compiler guarantees it.

**Reactive-method misuse in slots.** Calling `.peek()` inside a reactive slot (`peek-in-slot`) — which would freeze the value at its mount-time reading — is a compile error. So is using a `Signal` as an operand (or coercing it in a template) instead of `.map`-ing its value (`operator-on-signal`). Feeding a whole-state object into a value slot is caught by the slot types (`Reactive<string | number>`), not a lint rule.

**Impure / DOM-building derive bodies.** A `.map`/`derived` body that performs a side effect or non-deterministic call (`pure-derive-body`) or constructs DOM (`no-node-construction-in-body`) is rejected — derives must be pure transforms of plain values.

**Exhaustiveness checking.** TypeScript's `noImplicitReturns` with discriminated union switches in `update()` catches missing message handlers at compile time.

These are not aspirational — they are implemented as compile-time errors in `@llui/compiler` (surfaced through `@llui/vite-plugin`). The compiler's own correctness is verified by its own test suite:

```typescript
// Compiler test (framework-internal, not application-level):
import { lintSignalSource } from '@llui/compiler'

it('errors on .peek() inside a reactive slot', () => {
  const msgs = lintSignalSource(`text(state.at('count').peek())`)
  expect(msgs).toContainEqual(expect.objectContaining({ rule: 'peek-in-slot' }))
})

it('errors on building DOM inside a .map body', () => {
  const msgs = lintSignalSource(`text(state.map(s => div([])))`)
  expect(msgs).toContainEqual(expect.objectContaining({ rule: 'no-node-construction-in-body' }))
})
```

`lintSignalSource(source)` returns the signal lint messages (`{ rule, message, start, line, column }`) for a source string — the same rules that hard-fail a build through `@llui/vite-plugin`.

---

## 6. Testing Composition

Composition is view functions: a "child" is a module exporting an `update(slice, msg)` reducer and a `view(props, send)` function, with the parent owning all state. There is no separate component boundary to test.

### Testing the parent's reducer

View functions are just functions — they don't need special testing. The parent's `Msg` union namespaces a child's messages (`{ type: 'toolbar'; msg: ToolbarMsg }`) and the parent's reducer routes them. Test the parent's `update()`:

```typescript
it('toolbar message delegated correctly', () => {
  const t = testComponent(Dashboard)
  t.send({ type: 'toolbar', msg: { type: 'toggleMenu' } })
  expect(t.state.toolbar.menuOpen).toBe(true)
})

it('background click closes the toolbar', () => {
  const t = testComponent(Dashboard)
  t.send({ type: 'toolbar', msg: { type: 'toggleMenu' } }) // open it
  t.send({ type: 'backgroundClick' })
  expect(t.state.toolbar.menuOpen).toBe(false)
})
```

No props plumbing, no special test setup. The parent owns the state; the test verifies the parent's state machine.

### Testing a slice reducer in isolation

A child module's `update(slice, msg)` reducer is a plain pure function — test it directly, no harness required:

```typescript
import { toolbarUpdate } from './toolbar'

it('toggleMenu flips menuOpen', () => {
  expect(toolbarUpdate({ menuOpen: false }, { type: 'toggleMenu' })).toEqual({ menuOpen: true })
})

it('selectTool closes the menu', () => {
  expect(toolbarUpdate({ menuOpen: true }, { type: 'selectTool', id: 'a' })).toEqual({
    menuOpen: false,
  })
})
```

### Testing the rendered composition

To verify that the parent wires a child view function correctly — that the child's DOM appears and its callbacks dispatch namespaced messages — mount the parent with `testView` and drive it:

```typescript
it('clicking a tool dispatches the namespaced message', () => {
  const v = testView(Dashboard, { toolbar: { menuOpen: true }, tools: [{ id: 'a', name: 'A' }] })
  v.click('[data-testid="tool-a"]')
  expect(v.handle.getState().toolbar.menuOpen).toBe(false)
  v.unmount()
})
```

---

## 7. Testing the Effect Handler Chain

The `handleEffects().else()` chain is tested at two levels:

**Level 1 — Effect data (pure, no handler).** The most common pattern. Assert what `update()` returns:

```typescript
it('setQuery returns cancel + debounce + http', () => {
  const t = testComponent(Search)
  t.send({ type: 'setQuery', value: 'test' })
  assertEffects(t.effects, [
    {
      type: 'cancel',
      token: 'search',
      inner: {
        type: 'debounce',
        key: 'search',
        ms: 300,
        inner: {
          type: 'http',
          url: '/api?q=test',
        },
      },
    },
  ])
})

it('clearSearch returns cancel-only', () => {
  const t = testComponent(Search)
  t.send({ type: 'setQuery', value: 'test' }) // enter the loading state
  t.send({ type: 'clearSearch' })
  assertEffects(t.effects, [{ type: 'cancel', token: 'search' }])
  expect(t.state.loading).toBe(false)
})
```

**Level 2 — Handler integration (browser, for framework testing).** The `handleEffects` chain runtime — cancellation registry, debounce timer management, `AbortSignal` cleanup — is tested in the framework's own test suite, not in application tests. Applications trust that `handleEffects` works, just as they trust that `fetch` works.

The framework's handler tests verify:

- `cancel(token, inner)` aborts the previous request and starts a new one
- `cancel(token)` aborts without replacement and clears pending debounce timers
- `debounce(key, ms, inner)` delays dispatch until the idle period
- `AbortSignal` fires on component unmount, cancelling all in-flight effects
- Custom effects fall through to `.else()` correctly
- Effects are dispatched after DOM updates (ordering guarantee)

---

## 8. Testing Patterns by Application Type

### Form with Validation

```typescript
describe('RegistrationForm', () => {
  it('empty submit produces errors for all required fields', () => {
    const t = testComponent(RegistrationForm)
    t.send({ type: 'submit' })
    expect(t.state.errors).toEqual({ name: 'required', email: 'required', password: 'required' })
    expect(t.effects).toEqual([]) // no http
  })

  it('invalid email format', () => {
    const t = testComponent(RegistrationForm)
    t.send({ type: 'setField', field: 'email', value: 'not-an-email' })
    t.send({ type: 'submit' })
    expect(t.state.errors.email).toBe('invalid email')
  })

  it('valid submit dispatches http and analytics', () => {
    const t = testComponent(RegistrationForm)
    t.send({ type: 'setField', field: 'name', value: 'Alice' })
    t.send({ type: 'setField', field: 'email', value: 'a@b.com' })
    t.send({ type: 'setField', field: 'password', value: 'secure123' })
    t.send({ type: 'submit' })
    expect(t.state.phase).toBe('loading')
    assertEffects(t.effects, [
      { type: 'http', url: '/api/register' },
      { type: 'analytics', event: 'registration_submitted' },
    ])
  })
})
```

### Async Search with Debounce and Cancellation

```typescript
describe('Search', () => {
  it('typing produces debounced search effect', () => {
    const t = testComponent(Search)
    t.send({ type: 'setQuery', value: 'react' })
    assertEffects(t.effects, [
      { type: 'cancel', token: 'search', inner: { type: 'debounce', ms: 300 } },
    ])
  })

  it('results message populates results and clears loading', () => {
    const t = testComponent(seeded(Search, { query: 'react', results: [], loading: true }))
    t.send({ type: 'results', items: [{ id: '1', title: 'React Docs' }] })
    expect(t.state.loading).toBe(false)
    expect(t.state.results).toHaveLength(1)
  })

  it('error after clear is ignored (stale response)', () => {
    const t = testComponent(seeded(Search, { query: '', results: [], loading: false }))
    t.send({ type: 'error', msg: 'timeout' })
    // Query is empty, so this is a stale error from a cancelled request.
    expect(t.state.phase).toBe('idle') // not 'error'
  })
})
```

### Multi-Step Wizard

```typescript
describe('Wizard', () => {
  it('step progression preserves collected data', () => {
    const t = testComponent(Wizard)
    t.send({ type: 'setField', field: 'name', value: 'Alice' })
    t.send({ type: 'next' })
    expect(t.state.step).toBe(2)
    t.send({ type: 'setField', field: 'email', value: 'a@b.com' })
    t.send({ type: 'next' })
    expect(t.state.step).toBe(3)
    // Going back preserves everything
    t.send({ type: 'back' })
    expect(t.state.step).toBe(2)
    expect(t.state.fields.name).toBe('Alice')
    expect(t.state.fields.email).toBe('a@b.com')
  })

  it('cannot advance past step 1 with empty name', () => {
    const t = testComponent(Wizard)
    t.send({ type: 'next' })
    expect(t.state.step).toBe(1) // blocked
    expect(t.state.errors.name).toBe('required')
  })

  // Property test catches edge cases
  propertyTest(Wizard, {
    invariants: [
      (state) => state.step >= 1 && state.step <= 4,
      (state) => state.step <= 1 || state.fields.name !== '',
    ],
    messageGenerators: {
      next: () => ({ type: 'next' as const }),
      back: () => ({ type: 'back' as const }),
      setField: () => ({
        type: 'setField' as const,
        field: pick(['name', 'email', 'phone']),
        value: randomString(0, 50),
      }),
    },
    runs: 1000,
  })
})
```

### Optimistic Update with Rollback

```typescript
describe('LikeButton', () => {
  it('like optimistically increments, then confirms on success', () => {
    const t = testComponent(seeded(LikeButton, { count: 10, liked: false, pending: false }))
    t.send({ type: 'like' })
    expect(t.state.count).toBe(11) // optimistic
    expect(t.state.liked).toBe(true)
    assertEffects(t.effects, [{ type: 'http', url: '/api/like' }])

    t.send({ type: 'likeSuccess' })
    expect(t.state.count).toBe(11) // confirmed
    expect(t.state.pending).toBe(false)
  })

  it('like optimistically increments, rolls back on error', () => {
    const t = testComponent(seeded(LikeButton, { count: 10, liked: false, pending: false }))
    t.send({ type: 'like' })
    expect(t.state.count).toBe(11)

    t.send({ type: 'likeError' })
    expect(t.state.count).toBe(10) // rolled back
    expect(t.state.liked).toBe(false)
  })
})
```

### Real-Time WebSocket

```typescript
describe('LiveFeed', () => {
  it('new message prepends to list', () => {
    const t = testComponent(seeded(LiveFeed, { items: [{ id: '1', text: 'old' }], paused: false }))
    t.send({ type: 'wsMessage', item: { id: '2', text: 'new' } })
    expect(t.state.items[0].text).toBe('new')
    expect(t.state.items[1].text).toBe('old')
  })

  it('list capped at 50 items', () => {
    const t = testComponent(
      seeded(LiveFeed, {
        items: Array.from({ length: 50 }, (_, i) => ({ id: String(i), text: `item ${i}` })),
        paused: false,
      }),
    )
    t.send({ type: 'wsMessage', item: { id: '999', text: 'overflow' } })
    expect(t.state.items).toHaveLength(50) // oldest removed
    expect(t.state.items[0].id).toBe('999')
  })

  it('paused: messages buffered, not applied', () => {
    const t = testComponent(seeded(LiveFeed, { items: [], paused: true, buffer: [] }))
    t.send({ type: 'wsMessage', item: { id: '1', text: 'buffered' } })
    expect(t.state.items).toHaveLength(0)
    expect(t.state.buffer).toHaveLength(1)
  })

  it('resume: buffer flushed into items', () => {
    const t = testComponent(
      seeded(LiveFeed, {
        items: [{ id: '0', text: 'existing' }],
        paused: true,
        buffer: [
          { id: '1', text: 'a' },
          { id: '2', text: 'b' },
        ],
      }),
    )
    t.send({ type: 'resume' })
    expect(t.state.paused).toBe(false)
    expect(t.state.items).toHaveLength(3)
    expect(t.state.buffer).toHaveLength(0)
  })
})
```

---

## 9. What to Avoid

**E2E tests for business logic.** If you are writing a Playwright test to verify that submitting a form with invalid data shows an error, the test is at the wrong level. The validation lives in `update()` — test it there. Playwright exists for focus traps, CSS transitions, and native browser behaviors.

**Mocking `fetch` for effect tests.** Effects are data. Assert what `update()` returned, not what happens when the effect is executed. The `handleEffects` chain is tested by the framework. If your test imports `vi.fn()` to mock `fetch`, you are testing the handler, not your component.

**DOM selectors in pure logic tests.** If a test uses `querySelector`, it is a view test or a Playwright test. Pure `update()` tests should never reference the DOM.

**Snapshot testing.** DOM snapshots break on every formatting change, attribute rename, or comment node adjustment. They do not prove mutation minimality. They train developers to auto-accept snapshot updates instead of investigating changes.

**`innerHTML` assertions.** `expect(root.innerHTML).toBe(expected)` proves final-state correctness but allows a framework that clears and rebuilds everything on every update to pass. It is acceptable in `testView()` for initial structure checks, not for update testing.

**High test count as a quality proxy.** 200 tests that all call `update()` and check `state.count` prove less than 5 property tests with well-chosen invariants. Focus on invariants, not individual transitions.

**Testing the framework's guarantees from application code.** You do not test that `Array.push` works. You do not test that `Object.is` works. You do not test that LLui's reconciler produces minimal mutations. The framework tests that. Your tests verify your state machine and your effects.

---

## 10. Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui()],
  test: {
    projects: [
      {
        // Pure reducer tests (testComponent, propertyTest, replayTrace) — Node.
        name: 'unit',
        test: { include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        // View tests (testView) need a DOM — jsdom or happy-dom.
        name: 'view',
        test: { include: ['src/**/*.view.test.ts'], environment: 'jsdom' },
      },
    ],
  },
})
```

Most LLui application tests run in Node. No browser configuration, no Playwright setup, no headless Chrome. If you need Playwright tests (Level 4), add them in a separate `tests/e2e/` directory with `@playwright/test`'s own configuration.

```typescript
// playwright.config.ts — only if you have Level 4 tests
import { defineConfig } from '@playwright/test'

export default defineConfig({
  webServer: { command: 'npm run dev', port: 5173 },
  use: { headless: true },
})
```

---

## 11. Resolved Questions

**Auto-generated message generators: resolved — compiler emits `__generators` with manual override.** The compiler knows the `Msg` union type at build time and emits a `__generators` export that produces random valid messages for each variant, filling primitive fields with random values. This makes `propertyTest()` zero-configuration for simple components. For messages that reference existing state (e.g., toggling a todo by ID), the auto-generated random IDs are unlikely to hit valid entries — this is acceptable for invariant testing (the component must not crash on invalid IDs) but insufficient for coverage testing. The `messageGenerators` parameter remains available for custom generators that produce state-aware messages; auto-generation is the convenience default, manual generators are the precision override.

**Trace format standardization: resolved — v1 ships a versioned JSON format.** A trace file is a JSON object with a header and an entries array:

```json
{
  "lluiTrace": 1,
  "component": "CheckoutFlow",
  "generatedBy": "testComponent",
  "timestamp": "2026-03-15T10:30:00Z",
  "entries": [
    { "msg": { "type": "addItem", "id": "abc" }, "expectedState": { ... }, "expectedEffects": [ ... ] },
    ...
  ]
}
```

The `lluiTrace` field is the format version (integer, currently 1). `component` is the component name string from the definition. `generatedBy` indicates the source: `"testComponent"` for traces exported from test runs, `"devtools"` for traces captured from the DevTools bridge (when it ships), `"manual"` for hand-authored traces. `timestamp` is ISO 8601. `entries` is the ordered sequence of message/state/effect snapshots. `replayTrace()` validates the header, asserts `lluiTrace === 1`, and replays the entries. Unknown `generatedBy` values are accepted (forward-compatible). State comparison uses deep equality; effect comparison uses `assertEffects`-style partial matching by default, with an opt-in `exactEffects: true` flag for strict matching.

**`testView()` DOM backing: resolved — real jsdom/happy-dom, not a bespoke shim.** `testView` mounts through the real signal runtime (`mountApp`), so it needs a real DOM environment supplied by the test runner — `jsdom` or `happy-dom` via Vitest's `environment` setting. This means the full reconciler, event dispatch (`click`/`input`/`fire`), and structural primitives all run exactly as in the browser, so `testView` covers interaction, not just initial structure. What jsdom/happy-dom do NOT provide is layout and CSS computation (`getBoundingClientRect`, `offsetHeight`, `getComputedStyle` return zeros/empties) and real focus/paint semantics. Tests that depend on measured layout, CSS transitions, or focus traps belong in Playwright (Level 4). Using a real DOM rather than a hand-rolled shim eliminates the divergence risk where tests pass against a shim but fail in a browser.

**Property test shrinking: resolved — included in v1.** Shrinking is included. The algorithm: on invariant failure, `propertyTest()` records the failing sequence, then iteratively removes one message at a time (from the end, then from the middle) and re-runs the sequence. If the invariant still fails with the shorter sequence, the shorter sequence becomes the new candidate. The process continues until no single removal preserves the failure. This is a greedy single-pass shrink — not optimal (it won't find the global minimum in all cases) but sufficient to reduce a 50-message failure to typically 3–8 messages. Performance bound: shrinking runs at most `O(n²)` `update()` calls where `n` is the original sequence length. For `maxSequenceLength: 50`, this is at most 2500 calls — microseconds per call, so under 10ms total. The shrunk sequence is reported in the failure output alongside the original.

**Integration with CI: resolved — two-stage pipeline.** Levels 1–3 (`testComponent`, `propertyTest`, `testView`) run as part of the standard `npm test` command. They execute in Node, require no browser, and complete in seconds for typical applications. Level 4 Playwright tests run in a separate CI job triggered on PR and merge to main. The `vitest.config.ts` (or equivalent) includes all Level 1–3 tests by default. A separate `playwright.config.ts` handles Level 4. The `package.json` scripts convention is: `"test"` runs Levels 1–3, `"test:e2e"` runs Level 4. CI pipelines should gate merge on `test` passing; `test:e2e` failures should block merge but can be retriggered independently.
