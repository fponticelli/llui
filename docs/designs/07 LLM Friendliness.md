# LLM-Friendliness of the LLui Framework

This document is about LLMs generating application code that uses LLui — not about LLMs implementing LLui internals. The distinction matters. An LLM implementing a framework needs deep knowledge of browser APIs, scope trees, and bitmask arithmetic. An LLM writing a component needs to know: what is the shape of state, how do I express a message, how do I render a list. These are very different knowledge surfaces, and friendliness for one does not imply friendliness for the other.

> **For agent-driven runtime use** — where an LLM operates a _running_ LLui app via the `@llui/agent` MCP bridge, rather than authoring code — the operational reference is **doc 11 (Agent Annotations and Tools)**. That doc covers the JSDoc annotation grammar (`@intent`, `@should`, `@warning`, `@example`, `@emits`, `@humanOnly`, `@agentOnly`, etc.) and the full agent tool surface (`observe`, `query_state`, `would_dispatch`, `describe_recent_actions`, etc.). The wire protocol below those tools lives in doc 10 (Agent Protocol).

---

## 1. First Principles of LLM-Friendliness

An LLM generates code by predicting the most probable next token given a context window (the prompt and the tokens it has already emitted). This is the only mechanism. There is no reasoning, no simulation, no understanding of intent — only the statistical distribution over what token comes next. A framework is LLM-friendly when that distribution reliably produces correct code.

Four properties determine that reliability:

**The types constrain the solution space.** Given `State`, `Msg`, and `Effect`, an LLM should be able to derive what `update()` must do by reading the types alone. If the union `Msg = { type: 'increment' } | { type: 'setCount'; value: number }` is in context, the LLM has been given the entire menu of valid messages. It cannot fabricate a case that does not compile. Discriminated unions are the strongest constraint mechanism TypeScript offers because the compiler enforces exhaustiveness when `noImplicitReturns` is active.

**One canonical spelling per concept.** Every time there are two valid ways to express the same thing, the probability mass is divided between them. If `show({ when: s => s.open, ... })` and `branch({ on: s => s.open ? 'true' : 'false', cases: { true: ..., false: ... } })` are both valid for boolean conditionals, the LLM may use either — and may use both inconsistently in the same file. One form per concept means 100% of the probability mass goes to the correct form.

**The vocabulary matches the training corpus.** React, Redux, and Elm have produced enormous quantities of training text. An LLM that has processed thousands of Redux reducers recognizes `(state, action) => newState` as a reduction pattern and generates correct code in that shape. Novel vocabulary (terms that do not appear in the training data at high frequency) reduces confidence and increases error rate. `update()` returning `[newState, effects]` is structurally identical to a Redux reducer with a side-effect list — the LLM's existing knowledge transfers.

**Errors are caught at compile time.** An LLM cannot observe runtime errors without tool use. If a mistake (wrong accessor signature, missing case in a union) only manifests at runtime, the LLM has no feedback signal. TypeScript's type checker is the only available error oracle during generation. A framework that fails silently at runtime is one where the LLM cannot know it made a mistake.

**No magic.** The framework should not transform inputs in ways the LLM cannot predict. Implicit transforms (e.g., converting `onClick` to `'click'` is fine if it is documented and consistent — the LLM learns the pattern), magic filenames, implicit global registrations, or behaviors that differ between dev and prod are all invisible to the LLM. If the LLM cannot predict what the framework will do with its output, it cannot generate correct code.

**Small surface area.** An API with 40 exported functions requires the LLM to remember which function applies in each context. An API with 10 functions, each with a well-defined domain of application, produces higher per-call confidence. Fewer functions is not automatically better (an under-expressive API forces the LLM to reinvent primitives), but function count should match concept count, not exceed it.

---

## 2. What LLui Does That Helps LLMs

### 2.1 The TEA State Machine Is Pre-Learned

The pattern `init → state; update(state, msg) → [newState, effects]; view({ state, send }) → DOM` appears in thousands of training examples under many names: The Elm Architecture, Redux + middleware, the Model-View-Update loop, Hyperapp, Imba. When an LLM sees `component<State, Msg, Effect>({ ... })` (typed by `SignalComponentSpec<S, M, E>`), it immediately maps this to a known template. The `init`, `update`, and `view` fields are predictable: the LLM has high confidence about their signatures and their relationships.

Contrast this with a framework that introduces a novel ownership model or an unusual lifecyle ordering. The LLM's priors are wrong, and the errors it makes will not be the simple errors (wrong field name, off-by-one) that a type checker catches — they will be structural errors (wrong conceptual model) that produce syntactically valid but semantically broken code.

### 2.2 Discriminated Union Messages

```typescript
type Msg = { type: 'increment' } | { type: 'decrement' } | { type: 'setCount'; value: number }
```

This is the strongest possible aid to LLM generation. The union is visible in the context window. The LLM can enumerate every valid message by reading the type. The `switch (msg.type)` in `update()` follows directly from the union — every `case` label is a `type` field value, and TypeScript's control flow analysis narrows `msg` to the specific variant in each arm, making the LLM's generated property accesses type-safe by construction.

A stringly-typed system (`dispatch('SET_COUNT', { value: 3 })`) provides none of this. The LLM must invent both the string constant and the payload shape, and TypeScript cannot verify either.

### 2.3 Effects as Data, Consumed via `handleEffects().else()`

```typescript
type Effect =
  | { type: 'http'; url: string; onSuccess: (data: unknown) => Msg; onError: (e: ApiError) => Msg }
  | { type: 'cancel'; token: string; inner?: Effect }
  | { type: 'analytics'; event: string } // custom
```

Effects as discriminated unions give the LLM the same benefit for side effects that Msg unions give for messages. The LLM can see what effects exist. It can enumerate them. `update()` returning `[newState, [cancel('search', http({ ... }))]]` is a pattern the LLM has seen in Elm (Cmd) and in Hyperapp.

The consumption model is equally LLM-friendly: `handleEffects<Effect, Msg>()` produces a handler that consumes all `@llui/effects` types, with custom types handled in `.else(({ effect, send, signal }) => …)`. The pattern is mechanical: if the `Effect` union includes `http`/`cancel`/`debounce`, use `handleEffects`; handle the rest in `.else()`. Because the component's `onEffect` is `(effect, api)` and `handleEffects().else(...)` returns a `(ctx) => void`, the canonical `onEffect` captures a lifecycle `AbortController` once and forwards: `onEffect: (effect, api) => handler({ effect, send: api.send, signal })`.

### 2.4 `view()` Is a Pure Function

The LLM generates DOM construction code in a style virtually identical to React's JSX or lit-html's tagged templates:

```typescript
view: ({ state, send }) => [
  div({ class: 'counter' }, [
    text(state.at('count').map(String)),
    button({ onClick: () => send({ type: 'increment' }) }, [text('+')]),
  ]),
]
```

The `view` argument is a single bag, `{ state, send }`, where `state` is a `Signal<State>`. Element and structural helpers (`div`, `button`, `text`, `each`, `show`, `branch`, …) are plain module imports from `@llui/dom`, not bag fields. A reactive value is derived from `state` with `.map(fn)` (transform) or narrowed with `.at('path')` (slice into a sub-signal). The LLM never repeats the state type — `state` is already typed.

No lifecycle rules apply. There is no `useEffect` with a dependency array that the LLM will get wrong. There are no class components. The view runs once at mount time and the signal bindings handle updates automatically. The LLM's strong intuition about "return a tree of nodes" applies directly.

### 2.5 Reactive Values Are Signal Derivations

The distinction between static and reactive values is the presence or absence of a `state` read:

```typescript
// Static — applied once at mount:
div({ class: 'container' }, [...])

// Reactive — re-evaluated when the read paths change:
div({ class: state.map(s => s.active ? 'on' : 'off') }, [...])

// Narrow first, then map (preferred when reading one field):
div({ class: state.at('active').map(a => a ? 'on' : 'off') }, [...])
```

`state.map(fn)` and `state.at('path')` are the entire reactive vocabulary for views (plus `.peek()` for one-shot reads in handlers/effects). The `.map(fn)` shape is the same map the LLM uses for arrays and selectors everywhere; the only new idea is "read from `state`, don't capture a plain value." The LLM's existing probability mass over "transform a value with `.map`" applies directly.

### 2.6 No Hook Rules

React hooks have ordering constraints that produce confusing errors ("hooks must not be called inside conditions or loops") that LLMs violate with regularity. This is a significant source of generated code failures. LLui has no hooks. `onMount` is a node-producing helper placed in the view tree:

```typescript
import { input, onMount } from '@llui/dom'

view: ({ send }) => [
  input({ type: 'text' }),
  onMount((rootEl) => {
    rootEl.focus()
    return () => {
      /* optional cleanup, runs on dispose */
    }
  }),
]
```

No ordering constraints. No dependency arrays. `onMount(cb)` returns a node; `cb(rootEl)` fires after DOM insertion and may return a cleanup. `onMount` is a plain import — it does not depend on the component's state type. LLMs handle this pattern correctly.

### 2.7 Plain Object Literal Component Definition

```typescript
export const Counter = component<State, Msg, Effect>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => { ... },
  view: ({ state, send }) => [ ... ],
  onEffect: (effect, { send }) => { ... },
});
```

LLMs are excellent at filling in object literal fields. Given `SignalComponentSpec<S, M, E>` in context, the LLM knows exactly which fields to populate and what their types are. TypeScript's excess property checking catches any field the LLM invents. The pattern (export a plain object, pass it to a wrapper function) appears throughout modern TypeScript codebases. The component's `onEffect` signature is `(effect: E, api: { send, state }) => void | (() => void)`. For the `@llui/effects` builders (`http`/`cancel`/`debounce`/…), wire `handleEffects` into that callback: `handleEffects().else(...)` returns a `(ctx: { effect, send, signal }) => void` handler, so bridge it by capturing a lifecycle `AbortController` and calling `handler({ effect, send: api.send, signal })`.

### 2.8 Plain `.ts` Files

LLui components are TypeScript files. There is no `.llui` extension, no `.svelte` format, no Vue SFCs. The LLM needs no knowledge of custom file formats. It writes TypeScript; it imports from `'@llui/dom'`; it exports a component definition. This is the smallest possible conceptual footprint.

---

## 3. What Hurts LLMs

### 3.1 Compiled Emitter Output (`el` / `signalText`)

The runtime emitters the transform lowers to — `el`, `signalText`, `signalEach`, … — are implementation details. They never appear in source files written by developers. If an LLM sees compiled output — in error messages that quote transformed code, in stack traces, or in examples that use the compiled form — it encounters functions with non-obvious signatures:

```typescript
el('div', { class: 'counter' }, [signalText((s) => String(s.count), ['count'])])
```

An LLM that sees this and tries to write it directly will produce code that depends on internal signatures subject to change. The rule is absolute: the lowered emitters must never appear in user-facing documentation, examples, or developer-facing error messages. If a runtime error quotes a compiled stack frame, the error message should reference the original source location via source maps.

### 3.2 `each()` Signal Render Pattern

```typescript
each(
  state.map((s) => s.todos),
  {
    key: (todo) => todo.id,
    render: (item) => [li([text(item.at('text'))])],
  },
)
```

`each(items, { key, render })` takes a `Signal<readonly T[]>` (derived from `state` with `.map`/`.at`) and a `render(item, index)` callback. `item` is a `Signal<T>` and `index` is a `Signal<number>` — narrow with `item.at('field')` for a reactive slot, or read imperatively with `item.at('id').peek()` inside an event handler.

A common LLM error is reading the parent `state` instead of the per-row `item` signal:

```typescript
// WRONG — reads the parent state with a hardcoded index, not the row:
each(
  state.map((s) => s.todos),
  {
    key: (t) => t.id,
    render: () => [li([text(state.map((s) => s.todos[0].text))])],
  },
)

// CORRECT — read the per-row item signal:
each(
  state.map((s) => s.todos),
  {
    key: (t) => t.id,
    render: (item) => [li([text(item.at('text'))])],
  },
)
```

`item` is a `Signal<T>`, so `item.at('text')` and `item.at('done')` are distinct typed sub-signals. The signal lint rules reject misuse such as `.peek()` in a reactive slot.

The residual risk is forgetting that an event handler reads the CURRENT value with `.peek()`: `onClick: () => send({ type: 'toggle', id: item.at('id').peek() })`, not `item.at('id')` (a signal).

### 3.3 Over-deriving in Multiple Slots

There is no `memo()` in the signal runtime. A value used in several slots is simply derived per slot with `state.map(...)`:

```typescript
// Each slot derives independently; the reconciler gates each on its read paths.
text(state.map((s) => `${s.todos.filter((t) => !t.done).length} remaining`))
```

The reconciler only re-runs a derivation when one of its dependency paths changes, and skips the DOM write when the produced value is unchanged. So the old "wrap shared accessors in `memo()`" rule does not apply — there is no shared-accessor footgun to warn about. The remaining guidance is ordinary: keep `.map`/`derived` bodies pure (the `pure-derive-body` lint rule enforces this) and do not build DOM inside them (`no-node-construction-in-body`).

### 3.4 Composition: View Functions are the Only Primitive

LLMs trained on React will default to component instances for every piece of reusable UI. In LLui the decomposition primitive is the view function, and the parent owns all state. A "child component" is just a module exporting a `view(props, send)` function and an `update(slice, msg)` reducer; the parent imports both, holds the child's slice in its own state, and namespaces the child's messages.

```typescript
// LLM default (wrong — there is no component boundary for sub-components):
SomeChildComponent({ tools: state.map((s) => s.tools) })

// Correct LLui pattern — view function with (props, send) convention. props
// are signals derived from the parent's state; send wraps the child message.
toolbarView({ tools: state.map((s) => s.tools), toolbar: state.at('toolbar') }, (msg) =>
  send({ type: 'toolbar', msg }),
)
```

The system prompt must state: "Use view functions for all composition. State lives in one tree, owned by the root component. Pass signals down (`state.map`/`state.at`) and a wrapped `send` callback up. There is no separate component boundary for sub-components, and no `combine`/`subApp`/`child` primitive — the parent's reducer routes namespaced messages to slice reducers with a plain switch."

For independent embedded apps whose state lifetime is genuinely distinct from the host's (a third-party bundled app, a demo embed), the boundary is `foreign()` — embed the imperative library and drive its declared state signals. Reach for it only when the embedded thing truly owns its own lifecycle.

When the parent's reducer is "route by message prefix to a sub-reducer," write the switch by hand:

```typescript
update: (state, msg) => {
  switch (msg.type) {
    case 'toolbar':
      return [{ ...state, toolbar: toolbarUpdate(state.toolbar, msg.msg) }, []]
    // ... other top-level cases
  }
}
```

### 3.5 `.map()` vs `each()` for Lists

LLMs trained on React will use `.map()` for list rendering. In LLui, `.map()` inside `view()` creates static DOM nodes from the initial state — they never update when the array changes. This is the single most common LLM error for LLui.

```typescript
// WRONG — Array.prototype.map over a plain array → static nodes, never update:
div(state.peek().items.map((item) => div([text(item.name)])))

// CORRECT — reactive keyed list over a derived Signal of the array:
each(
  state.map((s) => s.items),
  {
    key: (t) => t.id,
    render: (item) => [div([text(item.at('name'))])],
  },
)
```

Note the distinction: `state.map(fn)` (a Signal method that DERIVES a reactive value) is correct and idiomatic; `Array.prototype.map` over a plain array to build nodes is the bug. The system prompt should include the rule: "Build lists with `each(state.map(s => s.items), { key, render })`. Never build DOM by calling `Array.prototype.map` over a state array."

### 3.6 Inter-component Coordination

All coordination between view-function "components" happens through the shared parent state. The parent's `Msg` union namespaces child messages: `{ type: 'toolbar'; msg: ToolbarMsg }`. Cross-cutting concerns (toasts, modals, global indicators) become slices on the root state — `state.toasts: Toast[]` — and any view function can dispatch `{ type: 'addToast', message: '...' }` to enqueue one. There is no addressed-effect registry, no global dispatcher, no string-keyed sends. Context (`createContext`/`provide`/`useContext`) is available when a value must reach deep into the tree without prop-threading.

For adapter layers that hold a handle externally (e.g., a router that needs to push navigation events into a mounted app), use `handle.send(msg)` imperatively. The `SignalComponentHandle` is returned from `mountApp` (and `mountSignalComponent` / `hydrateSignalApp`); it exposes `send`, `getState`, `subscribe`, `dispose`, and `runReducer`.

### 3.7 `branch()` vs `show()`

`branch()` handles named/discriminated states; `show()` handles a boolean condition. The distinction is correct, but the LLM will use them interchangeably:

```typescript
// LLM will often write this (works but wrong pattern):
branch(state.at('open'), { true: () => modal(), false: () => [] })

// Canonical form — show takes a condition signal, a render arm, and an optional else:
show(state.at('open'), () => modal())
```

The inverse error — using `show` when a named discriminant is correct — is harder to detect because `show` offers no structural signal that only two states exist.

### 3.8 State Mutation in `update()`

The most catastrophic silent error:

```typescript
// WRONG — mutates state in place; the reconciler sees the same reference
// (Object.is(next, prev) is true), skips the update, and the DOM freezes:
update: (state, msg) => {
  if (msg.type === 'increment') {
    state.count++ // mutation
    return [state, []] // same reference
  }
  return [state, []]
}

// CORRECT:
update: (state, msg) => {
  if (msg.type === 'increment') {
    return [{ ...state, count: state.count + 1 }, []]
  }
  return [state, []]
}
```

LLMs with strong Redux training will get this right. LLMs that have seen more MobX or Vue Composition API will get it wrong. The rule must be in the system prompt.

### 3.9 `send()` Is Synchronous

In the signal runtime, `send(msg)` runs the reducer, reconciles the DOM, and dispatches effects synchronously before it returns. There is no message queue and no microtask deferral. So reading DOM state immediately after `send()` already sees the updated DOM:

```typescript
send({ type: 'showPanel' })
const height = panelEl.offsetHeight // already reflects the update
```

LLMs trained on React (`setState` is async) may reach for a flush. The handle exposes `flush()` for harness/agent parity, but it is a no-op — there is nothing to flush. The system prompt should state: "`send()` applies updates synchronously; you never need `flush()`." An LLM that calls `flush()` anyway produces correct (if redundant) code — a no-op, not a bug.

---

## 4. What Seems Helpful But Isn't

### 4.1 Very Short API Surface (Under 5 Functions)

An API that exposes only `component`, `text`, `div`, and `mountApp` forces the LLM to reinvent `branch`, `each`, `show`, and `onMount` using imperative DOM manipulation. The LLM's reinventions will be incorrect: they will mutate state, leak event listeners, or produce non-reactive output. The right API size is one export per distinct concept. Cutting the API to reduce "cognitive load" produces more errors, not fewer.

### 4.2 Heavy Scaffolding in Generated Code

An LLM that generates 60 lines of boilerplate before the first interesting line has 60 lines in which to make errors. Every line of boilerplate is a line where a type might be wrong, a name might be misspelled, or a convention might be violated. The `component()` wrapper should require the minimum amount of setup code for the simplest case. Currently, a counter requires approximately 20 lines including blank lines. That is acceptable.

### 4.3 "Helpful" Default Behaviors That Change Semantics

Auto-deduplicating identical derivations behind the LLM's back seems like it would help. In practice it makes the LLM's mental model wrong: the LLM reasons about when computation happens and produces incorrect analysis, because the framework silently changed the evaluation semantics. The signal model is already predictable without hidden memoization — each `state.map(...)` is a derivation gated by its read paths and skipped on unchanged output, with no shared-cell aliasing the LLM has to track.

### 4.4 Aliases for the Same Concept

If `show(cond, render)` were a pure alias for `branch(cond, { true: render, false: () => [] })`, and both were exported for the same job, the LLM's probability mass would split. The signal API keeps the distinction semantic: `show(cond, render, orElse?)` narrows a boolean/nullable condition (the render arm receives the NON-NULLABLE narrowed signal), while `branch` discriminates a tagged union (each arm receives the narrowed variant signal). Pick one canonical form per concept and let the type signatures carry the distinction.

### 4.5 JSDoc on Every Function Instead of Accurate Types

Prose descriptions require the LLM to parse natural language and map it to code structure. Type signatures require the LLM to parse TypeScript syntax it already understands. The signature:

```typescript
function each<T>(
  items: Signal<readonly T[]>,
  opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => readonly Node[]
  },
): Node
```

communicates more about usage than a paragraph of prose. `items: Signal<readonly T[]>` makes explicit that the source is a derived signal (`state.map(s => s.items)`), not a plain array. `item: Signal<T>` in the `render` callback tells the LLM that `item` is a signal — to read a field reactively it must `item.at('text')`, and to read imperatively in a handler it must `item.at('id').peek()`. The `.at`/`.map` vocabulary mirrors the component-level `state.at(...)` / `state.map(...)`, so the LLM's existing probability mass applies directly.

---

## 5. Evaluation Methodology

Measuring LLM-friendliness by intuition produces confident but wrong conclusions. The only rigorous method is empirical: give the LLM a task, evaluate its output mechanically, and report rates.

### Setup

- **Model**: Fix the model across a comparison period. Use `claude-sonnet-4-6` or equivalent. Do not mix model versions within a comparison; capability differences dwarf framework differences.
- **Temperature**: 0 for deterministic output. If the API supports a `seed` parameter, use it. At temperature 0, most runs are identical; the N=5 protocol below catches the rare cases of variance.
- **System prompt**: Fixed (see Section 8). The system prompt is a variable in the experiment; changing it requires re-running all tasks.
- **Task prompt**: Each task is a self-contained natural language description of what to build, with no code snippets. Code snippets in the task prompt are a separate experiment (few-shot prompting) not mixed into the baseline.
- **Output format**: The LLM produces a single TypeScript file containing the component. No prose, no markdown blocks — just the file content.
- **Evaluation pipeline**: `tsc --noEmit` → `@llui/test` assertions (`testComponent`, `assertEffects`, `testView`) → Playwright for a11y/transitions only.

### Metrics Per Task

| Metric          | Range   | Description                                                                                                                                                                                                                                                                         |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile rate    | 0 or 1  | `tsc --noEmit` exits 0 with zero errors                                                                                                                                                                                                                                             |
| Render rate     | 0 or 1  | Initial DOM matches spec (correct elements, correct text, correct attributes)                                                                                                                                                                                                       |
| Full pass rate  | 0 or 1  | All assertions pass                                                                                                                                                                                                                                                                 |
| Assertion score | 0.0–1.0 | Fraction of individual assertions that pass (partial credit)                                                                                                                                                                                                                        |
| Console clean   | 0 or 1  | Zero console errors or warnings during the entire test run                                                                                                                                                                                                                          |
| Idiomatic score | 0 or 1  | Human review: correct `each(state.map(...), { key, render })` with per-row `item` signals, no state mutation, `show` vs `branch` correct, reactive reads via `state.map`/`state.at` (not captured plain values), tests use `testComponent`/`assertEffects` (not manual DOM queries) |

Compile rate is a prerequisite gate. If the output does not compile, skip all subsequent metrics and record 0 for each. The compile gate is the most important single metric: a framework that produces compilable output on the first attempt is measurably more usable than one that requires iteration.

Idiomatic score requires human review of each passing output. The reviewer checks:

- Reactive reads go through `state.map(...)` / `state.at('path')`; handlers/effects read with `.peek()`, never a frozen plain value
- `each(state.map(s => s.items), { key, render })` with per-row `item` signals (`item.at('field')`), not `Array.prototype.map` over a state array
- `update()` returns a new state object, not a mutation
- `show` used for boolean/nullable conditions, `branch` for tagged-union states
- Composition uses view functions with the `(props, send)` convention; props are signals derived from the parent state; there is no `child`/`combine`/`subApp`/`propsMsg`/`onMsg` primitive
- Reducer composition is a plain switch routing namespaced messages (`{ type: 'toolbar'; msg }`) to slice reducers
- Forms use a `setField` pattern when there are 3+ text fields, not one message type per field
- Cross-component coordination happens through shared parent state and view-function callbacks (or context) — no addressed effects, no global registries
- No hardcoded DOM manipulation that bypasses the signal binding system

### Aggregation

Report each metric per task and as macro-averages (unweighted mean across tasks).

Full pass rate is the primary metric for comparing framework versions or system prompts. Use full pass rate for headlines; report all metrics for diagnostics.

### Run Protocol

Run each task N=5 times. At temperature 0 with the same seed, runs are deterministic — if all 5 produce identical output, record it once and note "5/5 identical." If variance occurs (network temperature, API non-determinism), report the majority-vote result and note the variance count.

When comparing two framework versions or system prompt variants, hold all other variables constant. Run all 15 tasks × 5 runs for each variant. Compute macro-averages. The minimum detectable difference at N=15 tasks is approximately 6 percentage points on full pass rate at 80% power. Differences smaller than this are noise.

---

## 6. Canonical Task Set

The task set covers the full range of LLui concepts from the simplest (counter) to the complex (multi-component coordination, async, real-time). Difficulty tiers are labeled for diagnostic use.

**Tier 1 — Core pattern (stateless-adjacent)**

**TASK 01 — Counter**
Build a counter that shows a number and has +/- buttons. Clicking + increments; clicking - decrements; the value never goes below 0.
Assertions: initial value shows 0; after 3 clicks of +, shows 3; after clicking - once, shows 2; clicking - when showing 0 leaves the value at 0.

**TASK 02 — Character counter**
A textarea paired with a character counter below it. The counter shows "N / 280". The counter element gains the class `over-limit` when the character count exceeds 260.
Assertions: initial counter shows "0 / 280"; typing 5 characters → shows "5 / 280"; at exactly 260 characters, `over-limit` class absent; at 261 characters, `over-limit` class present.

**Tier 2 — State shape + structural primitives**

**TASK 03 — Filterable list**
A static list of 10 hardcoded items. A text input filters the list by substring (case-insensitive). The visible list updates as the user types.
Assertions: all 10 items visible initially; typing "an" → only items whose text contains "an" (case-insensitive) visible; clearing the input → all 10 visible again.

**TASK 06 — Accordion**
Three panels, each with a title and body text. Clicking a title expands or collapses that panel. Only one panel is open at a time. Clicking an open panel closes it.
Assertions: all three panels closed initially; clicking panel 1 opens it; clicking panel 2 closes panel 1 and opens panel 2; clicking panel 2 again closes it.

**TASK 07 — Multi-step form**
Four steps: name → email → summary → confirm. Each step validates before allowing advancement. "Next" is disabled when the current step's field is invalid. "Back" is always enabled except on step 1. "Submit" appears on step 4.
Assertions: starts on step 1; empty name field → Next disabled; valid name → Next enabled; clicking Next → step 2 visible, step 1 not; Back → step 1 visible, name value preserved; reaching step 4 → shows entered name, email, and summary.

**Tier 3 — Effects and async**

**TASK 04 — Async data fetch**
On mount, fetch a list of items from a URL provided as a component prop. Show a loading spinner while fetching. Show the list on success. Show an error message and a "Retry" button on failure.
Assertions: loading element visible immediately; mock fetch resolves → items visible, loading gone; mock fetch rejects → error message visible, Retry button visible; clicking Retry → loading visible again, triggers a new fetch call.

**TASK 09 — Debounced search**
A text input. After 300ms of inactivity, fetch results from a URL with the query appended. Show "Searching..." while the fetch is in flight. Show results on success. Cancel any in-flight fetch when a new character is typed.
Assertions: typing rapidly for less than 300ms → no fetch call yet; pausing 300ms → exactly one fetch call; new character typed while fetch in flight → previous fetch result ignored when it arrives; empty query → no fetch.

**TASK 14 — Form with async validation**
An email field that checks uniqueness via an API after 500ms of idle time. Show "checking..." while the request is in flight; "available" on success; "taken" on failure. The Submit button is disabled while checking or when the email is taken.
Assertions: typing an email, waiting 500ms → "checking..." shown; mock returns taken → "taken" shown, Submit disabled; mock returns available → "available" shown, Submit enabled; typing again while checking → previous check is cancelled (its result does not affect field state).

**Tier 4 — Lists, keys, DOM identity**

**TASK 08 — Reorderable list**
A list of 5 items. Each item has an Up and a Down button. Up moves the item one position earlier (no-op at top). Down moves the item one position later (no-op at bottom). Items must be keyed by ID.
Assertions: initial order correct; clicking Up on item 2 (1-indexed) swaps it with item 1; the DOM node for the item at position 1 after the swap is the same DOM node that was at position 2 before (verified by `data-testid` set at render time, not by text content); clicking Down on the last item makes no change.

**TASK 13 — Infinite scroll**
A list of items. A "Load more" button (or intersection observer on a sentinel element) appends 20 more items per load. A loading indicator is shown while fetching. "No more items" text is shown when the source is exhausted.
Assertions: 20 items visible initially; clicking Load more → 40 items visible, the first 20 DOM nodes are unchanged (verified by data attributes set at render time); third load → source exhausted, "No more items" shown, Load more button absent.

**Tier 5 — Multi-component**

**TASK 10 — Parent-child communication (view functions)**
A parent component owns an array of counter slices. Each counter is rendered by a `counterView()` view function. Each counter has its own increment button. The parent shows the total count across all counters. An "Add counter" button appends a new counter slice.
Assertions: total shows 0 initially; clicking Increment on counter 1 → total shows 1; clicking Add counter → total unchanged; clicking Increment on the new counter → total shows 2.

**TASK 10b — Slice reducer composition (hand-routed)**
Same requirements as Task 10, but the parent's `update()` delegates to slice reducers (`countersUpdate`, `uiUpdate`) via a plain switch on namespaced messages (`{ type: 'counters'; msg: CountersMsg }`). Tests reducer composition correctness and reference-equality preservation (the top-level state object reference, and unaffected slice references, must be preserved when only one slice changes — so the reconciler skips bindings that read only unchanged paths).
Assertions: same as Task 10, plus: dispatching a slice message updates only that slice; bindings reading from non-affected slices do not re-evaluate (observable through a coverage tracker or DOM-mutation observer).

**TASK 15 — Real-time updates (WebSocket)**
A list that receives items from a WebSocket connection. New items are prepended. At most 50 items are shown; the oldest is removed when item 51 arrives. A Pause button halts visible updates (new messages are buffered); Resume applies buffered messages.
Assertions: mock WebSocket sends a message → item prepended; after 50 items, a 51st message removes the oldest; clicking Pause, then 3 messages arrive → list unchanged; clicking Resume → all 3 messages applied.

**Tier 6 — Complex interaction**

**TASK 05 — Stopwatch**
Start, Stop, and Reset buttons. Display MM:SS:ms. The "Best lap" field records the shortest elapsed time at each Stop press. Start is disabled while running. Stop is disabled while stopped.
Assertions: initially shows "00:00:000"; after Start + ~500ms + Stop, shows approximately 500ms; Reset → "00:00:000"; two lap times, shorter one shown in "Best lap".

**TASK 11 — Drag and drop list**
Five items. Drag an item to a new position using HTML5 drag events (`dragstart`, `dragover`, `drop`). No external libraries.
Assertions: `dragstart` sets the dragged item's ID in the data transfer; `dragover` prevents default (allows drop); `drop` reorders the list to the correct new order; DOM nodes for items are the same after reorder (verified by data attributes).

**TASK 12 — Modal dialog**
A button opens a modal overlay. The modal has a title, body text, a close button (×), and a Confirm button. Clicking outside the modal closes it. Focus is trapped inside the modal while open (Tab and Shift-Tab cycle through modal focusable elements only).
Assertions: modal absent initially; Open button → modal present; × button → modal absent; Escape key → modal absent; Confirm button → modal absent and a confirmation message is sent to the parent; while modal is open, Tab does not move focus outside the modal.

---

## 7. Scoring

Report a scoring table after each evaluation run.

### Per-Task Scorecard (Example)

| Task               | Compile  | Render   | Full pass | Assertion score | Console clean | Idiomatic |
| ------------------ | -------- | -------- | --------- | --------------- | ------------- | --------- |
| 01 Counter         | 1        | 1        | 1         | 1.00            | 1             | 1         |
| 02 Char counter    | 1        | 1        | 1         | 1.00            | 1             | 1         |
| 03 Filterable list | 1        | 1        | 0         | 0.75            | 1             | 1         |
| 04 Async fetch     | 1        | 1        | 0         | 0.50            | 0             | 0         |
| 05 Stopwatch       | 0        | —        | —         | —               | —             | —         |
| ...                | ...      | ...      | ...       | ...             | ...           | ...       |
| **Macro avg**      | **0.87** | **0.92** | **0.73**  | **0.81**        | **0.85**      | **0.78**  |

Compile rate is the most informative single number. A compile rate below 0.80 indicates the system prompt is inadequate or the framework's API surface is too complex for zero-shot generation. Full pass rate below 0.60 indicates either complex tasks or systematic pattern errors (likely `each()` closure usage or state mutation).

### Diagnosing Systematic Errors

Group failures by symptom:

- **Compile fails, type errors in `update()`**: LLM is not reading `Msg` union; check that `Msg` type is in context.
- **Compile passes, render fails**: LLM is generating incorrect reactive vs static prop syntax (missing or misplaced arrow functions).
- **Render passes, assertions fail**: LLM is not handling edge cases correctly (debounce, floor at 0, key identity).
- **List never updates**: LLM used `Array.prototype.map` over a state array instead of `each(state.map(...), { key, render })`. Check the `view` body for `.map(` applied to a plain array rather than to a signal.
- **Idiomatic fails on passing tasks**: LLM is using `branch` where `show` belongs, capturing a frozen plain value instead of deriving with `state.map`, inventing a component boundary instead of a view function, or defining N message types for N form fields instead of `setField`.
- **Invented composition primitive**: LLM reached for `child`/`combine`/`subApp` (none exist). The fix is a view function with `(props, send)` and a plain switch in the parent reducer.
- **Console / build errors on passing tasks**: a signal lint rule fired (`peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`) — these are hard compile errors, so they actually show up as a compile failure, not a runtime console error.
- **Test harness misuse**: LLM writes raw `assert.deepEqual` on `update()` instead of using `testComponent()` and `assertEffects()` from `@llui/test`. This still passes but misses effect accumulation and state tracking. The system prompt should include a correct `testComponent` example for tasks that require test output.

### Regression Protocol

When a framework change is made (new API, removed alias, changed signature), run the full 15-task suite before and after. Report the delta in each column. A change that improves compile rate by 5 percentage points at the cost of 10 percentage points in full pass rate is a regression, not an improvement.

---

## 8. The System Prompt

### Design Principles

The system prompt must:

- Provide the type signatures for `SignalComponentSpec`, `Signal`, `each`, `branch`, `show`, and `onMount` — not prose descriptions, actual TypeScript.
- Show one complete minimal example (under 50 lines) with `init`, `update`, `view`, and (where relevant) `onEffect`.
- State the rules that are frequently violated: no mutation, reactive reads via `state.map`/`state.at`, `.peek()` only in handlers/effects.
- Stay under 300 words for the core system prompt. Task-specific type definitions may bring the total under 450 words. Longer prompts dilute the LLM's attention on the task. The system prompt is not documentation — it is context injection.
- Not explain the lowered emitters (`el`/`signalText`), the Vite plugin, the reconciler, or any internal mechanism.
- Not duplicate information that is in the task prompt.

### Concrete System Prompt

````
# LLui Component

You are writing a TypeScript component using the LLui framework.

## Pattern

LLui uses The Elm Architecture: `init` returns initial state (optionally with
effects); `update(state, msg)` returns the next state (optionally `[state, effects]`);
`view({ state, send })` returns DOM nodes once at mount. State is immutable.
Effects are plain data objects. `send` applies updates synchronously.
`state` is a `Signal<State>`: read it reactively with `.map`/`.at`.

## Key Types

```typescript
interface SignalComponentSpec<S, M, E = never> {
  name?: string
  init: () => S | [S, E[]]
  update: (state: S, msg: M) => [S, E[]] | S
  view: (bag: { state: Signal<S>; send: (msg: M) => void }) => readonly Node[]
  onEffect?: (effect: E, api: { send: (msg: M) => void; state: Signal<S> }) => void | (() => void)
}

// Signal — the reactive read surface:
interface Signal<T> {
  at<P extends ValidPath<T>>(path: P): Signal<PathValue<T, P>> // narrow into a sub-signal
  map<U>(fn: (value: T) => U): Signal<U>                       // derive a value
  peek(): T                                                    // one-shot read (handlers/effects)
}

// Element + structural helpers are MODULE IMPORTS from '@llui/dom':
function text(value: Signal<string | number> | string | number): Node
function each<T>(items: Signal<readonly T[]>, opts: {
  key: (item: T) => string | number
  render: (item: Signal<T>, index: Signal<number>) => readonly Node[]
}): Node
// show(cond, render, orElse?) — render arm gets the NON-NULLABLE narrowed signal:
function show<T>(cond: Signal<T>, render: (v: Signal<NonNullable<T>>) => readonly Node[],
  orElse?: () => readonly Node[]): Node
// branch — discriminate a tagged union; each arm gets the narrowed variant signal:
function branch<U extends object, D extends keyof U>(value: Signal<U>, discriminant: (u: U) => U[D],
  arms: { [K in U[D] & (string | number)]: (v: Signal<Extract<U, Record<D, K>>>) => readonly Node[] }): Node
function onMount(cb: (rootEl: Element) => void | (() => void)): Node

// Effect consumption — import from @llui/effects:
function handleEffects<E extends { type: string }, M>(): {
  use(plugin): this
  else(handler: (ctx: { effect: E; send: (m: M) => void; signal: AbortSignal }) => void):
    (ctx: { effect: E; send: (m: M) => void; signal: AbortSignal }) => void
}
````

## Example

```typescript
import { component, mountApp, div, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

export const Counter = component<State, Msg>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: Math.max(0, state.count - 1) }, []]
    }
  },
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.at('count').map(String)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
  ],
})

mountApp(document.getElementById('app')!, Counter)
```

## Rules

- Never mutate state in `update()`. Always return a new object: `{ ...state, field: newValue }`.
- `view` returns an ARRAY of nodes and destructures `{ state, send }`. Helpers (`div`, `text`, `each`, `show`, `branch`, `onMount`, …) are imports from `@llui/dom`.
- Reactive values come from `state`: `text(state.map(s => s.label))`, `div({ class: state.at('active').map(a => a ? 'on' : '') })`. Static values are literals: `div({ class: 'container' })`.
- In handlers/effects, read the current value with `.peek()`: `onClick: () => send({ type: 'pick', id: item.at('id').peek() })`. Never `.peek()` inside a slot.
- Lists: `each(state.map(s => s.todos), { key: t => t.id, render: (item) => [li([text(item.at('text'))])] })`. `item` is a `Signal<T>`. Never build DOM with `Array.prototype.map` over a state array.
- `show(cond, render, orElse?)` for boolean/nullable conditions; `branch(value, u => u.kind, { ... })` for tagged unions.
- `.map`/`derived` bodies must be pure and must not build DOM (both are compile errors).
- Composition: write a view function `viewFn(props, send)` where props are signals derived from the parent state (`state.map`/`state.at`); the parent owns all state and routes namespaced messages (`{ type: 'toolbar'; msg }`) to slice reducers with a plain switch. There is no `child`/`combine`/`subApp` primitive.
- For forms with many fields, use a single `setField` message instead of one message per field.
- Cross-component coordination goes through shared parent state and callbacks, or context (`createContext`/`provide`/`useContext`). Adapters holding the handle can call `handle.send(msg)`.
- Imperative libraries (editors, maps, charts): `foreign({ tag?, state: { x: state.map(...) }, mount: ({ el, state }) => { state.x.bind(v => ...); return inst }, unmount: inst => ... })`. Declared `state` signals become `LiveSignal`s (`peek` + `bind`) for `mount`.
- Effects: `update` returns `[state, [effect, ...]]`. Core `delay`/`log` are handled automatically. For `http`/`cancel`/`debounce`/`sequence`/`race`, import `handleEffects` from `@llui/effects` and bridge it in `onEffect`:
  `onEffect: (effect, api) => handler({ effect, send: api.send, signal })` where `handler = handleEffects<Effect, Msg>().else(({ effect, send }) => { ... })` and `signal` comes from a lifecycle `AbortController`.
  `cancel(token, inner)` cancels and replaces; `cancel(token)` cancels only. Wrap cancellable effects: `cancel(token, http({ ... }))`.
- `send()` is synchronous — it updates the DOM before returning; you never need `flush()`.
- Accessibility: every `img()` needs `alt`. Every `button()`/`a()` needs visible text or `aria-label`. `onClick` on non-interactive elements (div, span) requires `role` and `tabIndex`. Every form input needs a label. The compiler enforces these — violations are hard errors (see 02 Compiler.md).

````

### System Prompt Variants for Complex Tasks

For tasks involving async effects, prepend the effect type definitions relevant to that task. Do not pad the system prompt with information irrelevant to the task. A system prompt for the Async Fetch task should include:

```typescript
// In the system prompt for async tasks:
import { handleEffects, http, cancel, debounce } from '@llui/effects'

// http() builds an effect; onSuccess/onError are functions that build a Msg:
//   http({ url, onSuccess: (data, headers) => ({ type: 'ok', data }),
//          onError: (err) => ({ type: 'fail', err }) })
// cancel(token, inner) cancels+replaces; debounce(key, ms, inner) delays.
// In update(): return [next, [cancel('search', debounce('search', 300, http({ ... })))]]
// In onEffect, bridge handleEffects into the (effect, api) shape:
const handler = handleEffects<Effect, Msg>().else(({ effect, send }) => {
  /* custom effect types only */
})
const lifecycle = new AbortController()
// onEffect: (effect, api) => handler({ effect, send: api.send, signal: lifecycle.signal })
```

For composition tasks that introduce view functions, add:

```typescript
// View functions — the decomposition primitive. Parent owns state.
// toolbar.ts — props are SIGNALS derived from the parent state.
import type { Signal } from '@llui/dom'
export type ToolbarProps = { tools: Signal<Tool[]>; toolbar: Signal<ToolbarSlice> }
export function toolbarView(props: ToolbarProps, send: (msg: ToolbarMsg) => void): readonly Node[] {
  /* ... build view from props.tools.map(...), props.toolbar.at('menuOpen'), ... */
}
export function toolbarUpdate(slice: ToolbarSlice, msg: ToolbarMsg): ToolbarSlice {
  /* ... */
}

// parent.ts — derive the child's slice signals, wrap its messages:
toolbarView(
  { tools: state.map(s => s.tools), toolbar: state.at('toolbar') },
  (msg) => send({ type: 'toolbar', msg }),
)
// parent update routes: case 'toolbar': return [{ ...state, toolbar: toolbarUpdate(state.toolbar, msg.msg) }, []]
```

See 08 Ecosystem Integration §2 for imperative-library embedding via `foreign()`.

Task-specific context injected into the system prompt produces measurably better results than a single universal system prompt. Keep the core system prompt under 300 words; add task-specific type definitions to bring the total under 450 words.

---

## 9. How to Improve LLM-Friendliness

Steps are ordered by expected impact on compile rate and full pass rate, based on the failure patterns documented in Section 3.

### Step 1 — Publish a `.d.ts` type reference file

A single `llui.d.ts` that defines `SignalComponentSpec`, `Signal`, all element helpers, `each`, `branch`, `show`, `onMount`, `portal`, `foreign`, and the context primitives with accurate signatures. This file should be importable into the LLM's context window directly. Type signatures communicate more information per token than prose, and LLMs reason about TypeScript types reliably.

The file should be under 150 lines. Every additional line reduces the attention the LLM pays to individual types.

### Step 2 — Leverage `Signal<T>` type safety in `each()`

`each(items: Signal<readonly T[]>, { key, render: (item: Signal<T>, index: Signal<number>) })` is type-safe by construction: `items` must be a signal (so the LLM derives it with `state.map(s => s.items)`, not a plain array), and `item` is a `Signal<T>` (so reads go through `item.at('field')`, never raw property access). The signal lint rules catch the residual misuse: `.peek()` in a reactive slot, or using a signal directly as an operand.

The remaining LLM error patterns are: (1) forgetting that a handler reads the current value with `.peek()` (`item.at('id').peek()`), correctable in one round of TypeScript feedback; and (2) feeding a plain array to `each`. For (1), add JSDoc to the `render` parameter:

```typescript
/**
 * @param render - Called once per row at build time. Receives:
 *   - `item: Signal<T>` — narrow a field for a reactive slot with `item.at('text')`;
 *     read the current value in a handler/effect with `item.at('id').peek()`.
 *   - `index: Signal<number>` — the row's reactive index.
 */
function each<T>(
  items: Signal<readonly T[]>,
  opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => readonly Node[]
  },
): Node
```

### Step 3 — Frame composition as a view function

All composition uses view functions with the `(props, send)` convention: the function takes props that are signals derived from the parent state, plus a `send` callback. The LLM exports a function and a `Props` type, and the parent calls it with derived signals. This pattern is identical to how React composition works (props down, callbacks up) and generates correctly from existing training data.

There is no separate component boundary for sub-components, and no `child`/`combine`/`subApp`/`propsMsg`/`onMsg` primitive. State lives in one tree, owned by the root component. The system prompt must state this explicitly because the most common LLM failure mode — driven by React training data — is to instantiate "child components" for every reusable piece of UI. Direct that instinct toward view functions.

The parent's `update()` routes namespaced messages (`{ type: 'toolbar'; msg }`) to slice reducers with a plain switch — no helper. For a genuinely independent embedded app, the boundary is `foreign()` (an imperative library that owns its own DOM and lifecycle).

### Step 4 — Include a correct `each()` example in the system prompt for list tasks

A single `each()` API with `Signal<T>` rows is learnable from one example. For tasks involving lists (tier 2+), include a correct `each()` example in the system prompt:

```typescript
// System prompt example for list tasks:
each(state.map((s) => s.items), {
  key: (t) => t.id,
  render: (item, index) => [
    li([
      text(item.at('label')),
      span({ class: item.at('done').map((d) => (d ? 'done' : '')) }),
      text(index.map((i) => `#${i}`)),
    ]),
  ],
})
```

This example communicates: `item.at('field')` is a reactive field slot, `.map(...)` derives a computed value, and `index` is a `Signal<number>` (derive its display with `.map`). The vocabulary mirrors the component-level `state.at(...)` / `state.map(...)` idiom applied to row scope.

### Step 5 — Enforce compilation and `@llui/test` in the evaluation pipeline

Compile failures that produce helpful TypeScript error messages are the strongest feedback signal available to an LLM in a tool-assisted workflow. The evaluation pipeline should run `tsc --noEmit` first, report the errors, and allow the LLM to attempt a correction. One correction round with compiler feedback increases full pass rate significantly for tier 3–6 tasks.

The pipeline's second stage should use `@llui/test` primitives, not raw DOM assertions. `testComponent()` validates `update()` logic in Node without a browser. `assertEffects()` structurally matches effect trees, catching incorrect nesting (e.g., `cancel` wrapping `debounce` wrapping `http`). `testView()` validates DOM structure via a lightweight mount. `propertyTest()` fuzzes message sequences against invariants, catching edge cases the hand-written task assertions miss. Playwright runs only for the small set of assertions that require real browser behavior: focus trapping, CSS transitions, intersection observers, and accessibility audits.

Without tool use (pure generation), compile rate is the ceiling for all subsequent metrics. Every improvement to type accuracy — more precise `Msg` union types in the system prompt, accurate `each()` signature — directly raises the compile-rate ceiling.

### Step 6 — Surface the signal lint rules as actionable errors

The signal lint rules — `peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body` — are hard compile errors with messages that name the fix (e.g. `operator-on-signal`: "Signal used in …; operate on the value with .map() instead"). Because they fail the build, they feed the LLM's tool-assisted correction loop directly — the error text tells the LLM exactly what to change. There is no `memo()` footgun to lint for (the primitive does not exist); the equivalent class of error in the signal model is impure/DOM-building derive bodies, which these rules already catch.

### Step 7 — Add difficulty-tiered example sets to the system prompt

For tier 3+ tasks (async, multi-step), the single counter example in the base system prompt is insufficient. Add one additional example relevant to the task's domain:

- Async task: show a fetch effect example with loading/success/error states using `@llui/effects` (`http`, `cancel`) and the `handleEffects` → `onEffect` bridge.
- Multi-component task: show a view function `viewFn(props, send)` where props are signals derived from the parent state, plus the parent's plain-switch routing to the slice reducer.
- Each/list task: show a correct `each(state.map(s => s.items), { key, render })` with per-row `item` signals (`item.at('field')`).

Each additional example adds approximately 20–30 lines to the system prompt. Keep the total system prompt under 450 words by removing examples unrelated to the task when adding task-specific ones.

### Step 8 — Publish a scored example library

Maintain a repository of LLM-generated components that passed the evaluation pipeline and received an idiomatic score of 1. These become few-shot examples that can be included in the system prompt for related task types. A few-shot example of a correct async fetch component, included in the system prompt for the debounced search task, transfers the correct pattern for debounce + effect + generation counter without requiring the LLM to invent it.

---

## 10. LLM Debug Protocol

Sections 1–9 address LLMs _generating_ LLui code. This section addresses LLMs _debugging_ running LLui applications — inspecting state, sending messages, replaying traces, and diagnosing failures without relying on DOM screenshots or event simulation.

### Why LLui enables this

Most frameworks force an LLM to debug through the DOM layer: take a screenshot, infer what state produced it, click a button, take another screenshot, compare. The LLM is reconstructing the state machine from its observable outputs. This is lossy (the DOM is a projection of state, not state itself), slow (each observation requires a screenshot + visual reasoning), and ambiguous (the same DOM can result from different state paths).

LLui's TEA architecture eliminates this indirection. State is a plain serializable object. Messages are a typed discriminated union. Effects are data objects returned from a pure function. `replayTrace()` deterministically reproduces any execution path from a JSON file. An LLM connected to these internals operates on the state machine directly — it reads state, sends typed messages, observes effects, and replays traces without ever needing to interpret pixels.

This is not an incremental improvement over DOM-level debugging. It is a category shift: from observing a black box to conversing with a transparent state machine.

### Layer 1: the debug API (`installSignalDebug` / `LluiDebugAPI`)

The foundation. The signal runtime registers a structured debug API in development mode (gated on `import.meta.env.DEV`, tree-shaken in production) via `installSignalDebug(...)` — see `@llui/dom`'s exported `LluiDebugAPI` and `installSignalDebug`. This API is the contract that all higher layers build on — the MCP server (`@llui/mcp`), the DevTools surface, and manual console debugging all call the same functions. `installSignalDebug` registers a required subset; binding/scope/effect introspection methods are optional and present only when the build emits them.

```typescript
interface LluiDebugAPI {
  // ── Read ──────────────────────────────────────────────────
  /** Current state object, JSON-serializable. */
  getState(): unknown

  /** Component tree: name, state summary, binding count, child scopes. */
  getComponentTree(): ComponentDebugNode[]

  /** Chronological log of effects dispatched since mount or last clearLog(). */
  getEffectsLog(): EffectRecord[]

  /** Full message history with state-before, state-after, effects. */
  getMessageHistory(): MessageRecord[]

  /** Active bindings: dependency paths, last value, accessor source location, DOM target. */
  getBindings(): BindingDebugInfo[]

  // ── Write ─────────────────────────────────────────────────
  /** Send a message. Applies synchronously (reducer → reconcile → effects). */
  send(msg: unknown): void

  /** No-op in the signal runtime (send is synchronous). Kept for parity. */
  flush(): void

  // ── Replay ────────────────────────────────────────────────
  /** Export current session as a LluiTrace JSON object. */
  exportTrace(): LluiTrace

  /** Replay a trace, optionally stopping at step N. Returns final state. */
  replayTrace(trace: LluiTrace, options?: { stopAtIndex?: number }): unknown

  // ── Diagnostic ────────────────────────────────────────────
  /** Dry-run: call update(state, msg) without applying. Returns [newState, effects]. */
  evalUpdate(msg: unknown): { state: unknown; effects: unknown[] }

  /** Explain why a binding re-evaluated: which dependency paths changed, what the accessor returned, what the previous value was. */
  whyDidUpdate(bindingId: string): UpdateExplanation

  /** Validate a message against the component's Msg type. Returns errors or null. */
  validateMessage(msg: unknown): ValidationError[] | null

  /** JSONPath query against current state. */
  searchState(query: string): unknown[]

  /** Clear the effects and message logs. */
  clearLog(): void
}

interface ComponentDebugNode {
  name: string
  id: string
  stateSnapshot: unknown
  bindingCount: number
  children: ComponentDebugNode[]
}

interface MessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
  /** Present only on the (deleted) legacy runtime, which computed a dirty mask per update. Absent on the signal runtime. */
  dirtyMask?: number
}

interface EffectRecord {
  index: number
  timestamp: number
  effect: unknown
  status: 'pending' | 'resolved' | 'cancelled' | 'error'
  cancelToken?: string
  error?: unknown
}

interface BindingDebugInfo {
  index: number
  mask: number
  lastValue: unknown
  kind: string
  key: string | undefined
  dead: boolean
  perItem: boolean
}

interface UpdateExplanation {
  bindingIndex: number
  bindingMask: number
  lastDirtyMask: number
  matched: boolean
  accessorResult: unknown
  lastValue: unknown
  changed: boolean
}

interface ValidationError {
  path: string
  expected: string
  received: string
  message: string
}
```

> The `LluiDebugAPI` type contract (exported from `@llui/dom`) is the single source of truth for what a relay may call. `installSignalDebug` registers the REQUIRED subset — `getState`, `send`, `evalUpdate`/`pureUpdate`, message history, message-schema validation. The binding/scope/effect-introspection methods (`getBindings`, `whyDidUpdate`, scope-tree walks, effect timelines) and the per-binding `mask` fields above are carried in the contract for relay compatibility but are LEGACY-runtime concepts the signal runtime does not implement yet; tools probe for the method and degrade gracefully (the relay reports "unknown method") when it is absent. Treat the mask-bearing shapes as forward-compatible placeholders, not signal-runtime guarantees.

**Key capabilities that DOM debugging cannot provide:**

`evalUpdate(msg)` is the most powerful diagnostic. The LLM sends a hypothetical message and sees what `update()` would return — without touching the running app. It can explore "what happens if the user clicks delete?" by calling `evalUpdate({ type: 'deleteItem', id: '123' })` and reading the resulting state and effects. This is pure computation — `update()` is a pure function, so the dry-run is identical to the real execution. The signal handle backs this directly via `runReducer(msg)`.

`validateMessage(msg)` catches malformed messages before dispatch. The compiler emits `__msgSchema` type metadata for each component's `Msg` union (a JSON-schema subset). The validator checks discriminant field, required properties, and property types against this metadata. An LLM constructing a message from the type signature gets immediate structured feedback if it makes a mistake — before any state transition occurs.

`whyDidUpdate(bindingId)` answers the question "why did this text change?" at the framework level — which mask bits were dirty, what the accessor returned, what the previous value was. The LLM does not need to diff screenshots; it asks the framework directly.

`searchState(query)` enables targeted state inspection without reading the full state tree. For a large state object, `searchState('$.cart.items[*].price')` returns just the prices. The LLM navigates state with the same precision it would use on a database.

### Layer 2: `@llui/mcp` — Model Context Protocol Server

The MCP server is a thin adapter over `window.__lluiDebug`, connected to a running LLui dev app via WebSocket. It exposes the debug API as native LLM tools — no Playwright boilerplate, no `page.evaluate` wrapping, no CDP round-trips.

**Architecture:**

```
┌─────────────┐    MCP protocol     ┌──────────────┐    WebSocket     ┌─────────────────┐
│  LLM Agent  │ ◄──────────────────► │  @llui/mcp   │ ◄──────────────► │  Vite dev server │
│ (Claude,    │    (tool calls)      │  (Node.js)   │  (llui:debug     │  + LLui plugin   │
│  Cursor,    │                      │              │   channel)       │  + debug runtime  │
│  etc.)      │                      │              │                  │                   │
└─────────────┘                      └──────────────┘                  └─────────────────┘
```

The Vite dev server already maintains a WebSocket for HMR. The LLui Vite plugin extends this with a `llui:debug` channel that proxies calls to `window.__lluiDebug` in the browser. The MCP server connects to this channel and translates MCP tool calls into debug API calls.

**MCP Tool Definitions:**

| Tool                       | Parameters                          | Returns                           | Notes                                                                        |
| -------------------------- | ----------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `llui_get_state`           | `component?: string`                | State object                      | Defaults to root component.                                                  |
| `llui_get_component_tree`  | —                                   | Component hierarchy               | Includes state summaries and binding counts.                                 |
| `llui_send_message`        | `msg: object`                       | `{ state, effects, validation? }` | Validates first. Returns new state + effects. Calls `flush()` automatically. |
| `llui_eval_update`         | `msg: object`                       | `{ state, effects }`              | Dry-run. Does not modify app state.                                          |
| `llui_validate_message`    | `msg: object`                       | `ValidationError[] \| null`       | Type-checks against the component's Msg union.                               |
| `llui_get_message_history` | `since?: number`                    | `MessageRecord[]`                 | Filter by index.                                                             |
| `llui_get_effects_log`     | `status?: string`                   | `EffectRecord[]`                  | Filter by status (pending, resolved, cancelled, error).                      |
| `llui_replay_trace`        | `trace: LluiTrace, stopAt?: number` | Final state at stop point         | Replays from init through message N.                                         |
| `llui_export_trace`        | —                                   | `LluiTrace` JSON                  | Exports current session.                                                     |
| `llui_why_did_update`      | `bindingId: string`                 | `UpdateExplanation`               | Explains a specific binding's re-evaluation.                                 |
| `llui_search_state`        | `query: string`                     | Query results                     | JSONPath against current state.                                              |
| `llui_get_bindings`        | `filter?: string`                   | `BindingDebugInfo[]`              | Filter by DOM selector or mask.                                              |

**Phase 1 additions (21 new tools):**

| Tool                      | Description                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `llui_inspect_element`    | Rich report: tag, attrs, classes, data-\*, text, computed style, box, binding list. |
| `llui_get_rendered_html`  | outerHTML of a selector (default = mount root), truncatable.                        |
| `llui_dom_diff`           | Compare expected HTML against rendered HTML; returns unified diff.                  |
| `llui_dispatch_event`     | Synthesize a browser event; returns messages produced + resulting state.            |
| `llui_get_focus`          | Active element info: selector, tag, selection range.                                |
| `llui_force_rerender`     | Re-evaluate all bindings; returns indices that changed.                             |
| `llui_each_diff`          | Per-each-site add/remove/move/reuse records per update.                             |
| `llui_scope_tree`         | Scope hierarchy with kind (root/show/each/branch/child/portal).                     |
| `llui_disposer_log`       | Recent scope disposals with cause.                                                  |
| `llui_list_dead_bindings` | Bindings that are detached or have never changed value.                             |
| `llui_binding_graph`      | state path → binding indices (inverts compiler mask legend).                        |
| `llui_pending_effects`    | Queued and in-flight effects.                                                       |
| `llui_effect_timeline`    | Phased log: dispatched → in-flight → resolved/cancelled.                            |
| `llui_mock_effect`        | Register match→response mock; next matching effect resolves with mock.              |
| `llui_resolve_effect`     | Manually resolve a specific pending effect.                                         |
| `llui_step_back`          | Rewind N messages by replaying from init (pure mode default).                       |
| `llui_coverage`           | Per-Msg variant fire counts + list of never-fired variants.                         |
| `llui_diff_state`         | Structured JSON diff between two state values.                                      |
| `llui_assert`             | Evaluate eq/neq/exists/gt/lt/in against a state path.                               |
| `llui_search_history`     | Filter history by type, statePath change, effectType, or index range.               |
| `llui_eval`               | Arbitrary JS in page context; returns result + observability envelope.              |

**Phase 2 additions (6 CDP tools):**

| Tool                   | Description                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `llui_screenshot`      | Capture a screenshot of the browser page or a specific element. Returns base64 PNG or JPEG. |
| `llui_a11y_tree`       | Return the accessibility tree for the page or element. Verifies ARIA roles and labels.      |
| `llui_network_tail`    | Return recent network requests with URL, method, status, timing, and failure info.          |
| `llui_console_tail`    | Return recent browser console entries (log, info, warn, error, debug).                      |
| `llui_uncaught_errors` | Return recent uncaught JavaScript exceptions captured since the CDP session started.        |
| `llui_browser_close`   | Close the Playwright-owned fallback browser. No-op for user-owned browsers (:9222).         |

**Phase 3 additions (3 compiler metadata tools):**

| Tool                       | Description                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `llui_show_compiled`       | Return pre- and post-transform source for the active component's view function.        |
| `llui_explain_mask`        | Look up the mask bit and related state paths for a given state-path key.               |
| `llui_goto_binding_source` | Return the source file, line, and column of the view() expression for a binding index. |

**Phase 4 additions (4 source-scan tools):**

| Tool                      | Description                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `llui_find_msg_producers` | Grep the project for send({type: "..."}) call sites. Returns file, line, and context.     |
| `llui_find_msg_handlers`  | Grep the project for update() case branches for a specific Msg variant.                   |
| `llui_run_test`           | Run a vitest test file and return pass/fail status with captured output.                  |
| `llui_lint_project`       | Run the `@llui/compiler` signal lint rules across a directory. Returns a score and per-file violations. |

**Phase 5 additions (2 SSR tools):**

| Tool                    | Description                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `llui_hydration_report` | Compare server-rendered HTML against client DOM; return divergences (attribute/text/structural). |
| `llui_ssr_render`       | Server-render the active component with its current state; returns the HTML string.              |

**`llui_send_message` validates before dispatching.** When the LLM calls `llui_send_message({ type: 'addItem', text: 'test' })`, the MCP server first calls `validateMessage` against the component's Msg type. If validation fails, the tool returns the validation errors _without sending the message_. This feedback loop is immediate and structured — the LLM sees `{ errors: [{ path: '.id', expected: 'string', received: 'undefined', message: 'missing required field "id"' }] }` and corrects its next attempt. No other framework derives runtime-accessible message validation metadata directly from TypeScript discriminated union types at compile time — other approaches require manually written schemas (Zod, io-ts) or lose type information at runtime.

**`llui_eval_update` enables speculative debugging.** The LLM can ask "what would happen if the user clicked 'submit' right now?" without changing the app. It calls `llui_eval_update({ type: 'submit' })` and reads the resulting state and effects. If the result reveals a bug ("the state transitions to `loading` but no `http` effect is emitted"), the LLM has found the problem without executing any side effects. It can then inspect the `update()` source, identify the missing effect, and propose a fix — all without the app ever leaving its current state.

**Connection lifecycle:** The MCP server auto-discovers running LLui dev servers on `localhost` by scanning for the `llui:debug` WebSocket channel on the HMR port. When multiple LLui apps are running, the server exposes a `llui_list_apps` tool that lists them by name and port, and a `llui_connect` tool that switches the active target. Disconnection (app stopped, page navigated away) produces a structured error on the next tool call, not a silent failure.

### LLM Debugging Workflows

The debug protocol enables workflows that are impossible with DOM-level debugging:

**Workflow 1: Bug reproduction from a trace file.**
A user files a bug report with a trace file (exported from DevTools or `@llui/test`). The LLM loads the trace via `llui_replay_trace`, steps through messages one by one (`stopAt: N` for each N), and inspects state at each step. It identifies the exact message where state diverges from expectations — not by reading logs or screenshots, but by querying the state machine directly.

```
1. llui_replay_trace(trace, stopAt: 0)   → initial state looks correct
2. llui_replay_trace(trace, stopAt: 5)   → state still correct at step 5
3. llui_replay_trace(trace, stopAt: 8)   → state is wrong at step 8
4. llui_replay_trace(trace, stopAt: 6)   → still correct
5. llui_replay_trace(trace, stopAt: 7)   → BUG: step 7 transitions to wrong state
6. Read trace.entries[7].msg             → { type: 'removeItem', id: 'xyz' }
7. Read update() source for removeItem   → found: filter uses === instead of !==
```

**Workflow 2: Speculative diagnosis.**
The LLM suspects a binding is not updating. Rather than diff screenshots, it queries the state machine: it dry-runs the message with `llui_eval_update` (`runReducer`) and compares the proposed state to the current state — the dependency path the binding reads is unchanged, so the reconciler correctly skipped it. The bug is upstream: the `update()` function is not modifying the field the binding reads. The LLM now knows exactly where to look. (On builds that emit per-binding introspection, `llui_why_did_update` returns the same conclusion directly; the signal runtime treats that method as optional.)

**Workflow 3: State exploration.**
The LLM needs to understand a complex state shape. It calls `llui_search_state('$.orders[?(@.status=="pending")]')` and gets back only the pending orders, not the entire state tree. For a state object with 200 fields, this targeted query is the difference between useful context and context window pollution.

**Workflow 4: Interactive fix verification.**
The LLM proposes a fix to `update()`. Before writing it to disk, it uses `llui_eval_update` to simulate the fixed behavior: "if I change `update()` to return `{ ...state, items: state.items.filter(i => i.id !== msg.id) }`, what would happen for this message?" The dry-run confirms the fix produces the correct state and effects. The LLM commits the change with confidence, without a manual test cycle.

### Implementation Notes

**Dev-only, zero production cost.** The entire debug API is gated behind `import.meta.env.DEV`. The Vite plugin strips all `__lluiDebug` code in production builds via dead-code elimination. The WebSocket channel, the type metadata, the message history buffer — none of it exists in the production bundle. The `@llui/mcp` package is a devDependency.

**Message history buffer size.** The `getMessageHistory()` buffer is a ring buffer capped at 1000 entries by default (configurable via `lluiDebug.historySize` in the Vite plugin config). Older entries are evicted FIFO. The LLM can call `exportTrace()` before the buffer wraps if it needs the full history.

**Type metadata emission.** `validateMessage` requires runtime access to the component's `Msg` type structure. The compiler emits a `__msgSchema` object alongside each component definition in dev mode:

```typescript
// Emitted by compiler (dev mode only)
MyComponent.__msgSchema = {
  discriminant: 'type',
  variants: {
    addItem: { id: 'string', text: 'string' },
    removeItem: { id: 'string' },
    toggleItem: { id: 'string' },
    setFilter: { filter: { enum: ['all', 'active', 'completed'] } },
  },
}
```

This is a simplified JSON Schema subset — enough for structural validation, not a full TypeScript type checker. The schema is derived from the `Msg` type's AST during compilation. Complex types (generics, mapped types, conditional types) fall back to `unknown` in the schema, which passes validation unconditionally. The coverage is sufficient for the common case: discriminated unions with literal and primitive fields.

**Playwright interop.** The `window.__lluiDebug` API works with Playwright out of the box. An LLM agent that drives Playwright (rather than using the MCP server) calls `page.evaluate(() => window.__lluiDebug.getState())` etc. The Playwright path is lower-ceremony for CI scripts and automated testing. The MCP path is better for interactive debugging sessions where the LLM needs rapid back-and-forth with the app.

```typescript
// Playwright usage example
const state = await page.evaluate(() => (window as any).__lluiDebug.getState())
const result = await page.evaluate((msg) => (window as any).__lluiDebug.evalUpdate(msg), {
  type: 'addItem',
  id: '1',
  text: 'test',
})
expect(result.state.items).toHaveLength(1)
expect(result.effects).toContainEqual({ type: 'http', url: '/api/items', method: 'POST' })
```

**Security.** The debug API is dev-only and runs on localhost. It does not expose any network-accessible endpoint in production. The WebSocket channel uses the same origin policy as the HMR connection. The MCP server binds to `127.0.0.1` only. No authentication is required because the threat model is identical to the Vite dev server itself — if an attacker has localhost access, the debug API is not the vulnerability.

---

## 11. Resolved Questions

**Temperature 0 reproducibility.** Resolved: pin model versions and record them in evaluation metadata. The N=5 protocol (§5) handles intra-session variance. Cross-session variance from model updates is addressed by: (1) always use a pinned model version string in API calls (e.g., `claude-sonnet-4-6-20260301`, not `claude-sonnet-4-6-latest`), (2) record the exact model string in the evaluation output JSON alongside scores, (3) when a new model version is released, re-run the full canonical task set and compare against the previous version's results. Temperature 0 is deterministic within a model version; it is not deterministic across versions. The evaluation protocol treats model version as an independent variable, not a constant.

**`list()` vs. `each()`.** Resolved: `each(items: Signal<readonly T[]>, { key, render })` is the single list primitive. Its types enforce the correct shape — `items` must be a derived signal (`state.map(s => s.items)`) and each row is a `Signal<T>` read via `item.at('field')`. Adding `list()` would split probability mass. The most common LLM error — building DOM with `Array.prototype.map` over a state array — produces static nodes; the signal types steer toward `each` because a plain array is not assignable to `Signal<readonly T[]>`.

**System prompt length sweet spot.** Resolved: the universal system prompt (§8) targets 300–400 words. Task-specific variants (§8 "System Prompt Variants for Complex Tasks") extend to 400–500 words by appending relevant type definitions. This is validated empirically: run each tier of the canonical task set with 200-, 300-, 400-, and 500-word system prompts, plot compile rate and full pass rate vs. prompt length. The hypothesis is that 300–400 words is optimal for zero-shot tiers 1–3, and 400–500 words (with task-specific types) is optimal for tiers 4+. If the data contradicts this — for example, if 200 words produces equivalent results to 400 — shorten the prompt. The evaluation pipeline (§5) already specifies N=5 repetitions per task, providing sufficient statistical power to detect a 15+ percentage point difference in compile rate.

**Hard-fail vs. warning on TypeScript errors.** Resolved: hard-fail. `tsc --noEmit` errors cause the evaluation pipeline to record a compile failure for that sample. TypeScript errors indicate the LLM's model of the API is incorrect, even when the specific error is harmless at runtime. A framework where the LLM routinely produces type errors is not type-safe in practice — the type system's value is that it catches mistakes before runtime, and an LLM that bypasses it defeats the purpose. Hard-fail produces a cleaner signal: it forces improvements in either the system prompt, the type definitions, or the API surface design, rather than accumulating silently passing type-incorrect code.

**Automated idiomatic scoring.** Resolved: implement as a TypeScript AST visitor that detects the canonical anti-patterns and produces a numeric score. Note that several of these are already hard compile errors via the `@llui/compiler` signal lint rules (`peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`), so the idiomatic visitor focuses on the patterns the lint rules do not gate. The patterns, each worth equal weight (1 point deduction per violation):

1. **State mutation:** AST pattern `state.field = ...` or `state.field.push(...)` in `update()` body. Detection: assignment expression where the left-hand side's root identifier matches the `update()` function's state parameter name.
2. **`Array.prototype.map` for lists:** `.map(...)` building DOM over a plain (non-signal) state array inside the view, rather than `each(state.map(...), { key, render })`. Detection: a `.map` whose receiver resolves to a plain array (not a `Signal`) and whose callback returns nodes.
3. **Frozen plain value in a slot:** reading a value out of `state.peek()` (or capturing a plain local) and placing it in a reactive slot, so it never updates. (The `peek-in-slot` lint rule already hard-fails the direct `state.at(...).peek()`-in-slot form; this catches the indirect variants.)
4. **Wrong conditional primitive:** `branch` used for a boolean/nullable where `show` is canonical, or `show` forcing a tagged union into a boolean.
5. **Invented composition primitive:** any reference to `child`/`combine`/`subApp`/`propsMsg`/`onMsg` (none exist) instead of a view function + plain-switch routing.
6. **Form boilerplate:** Multiple message types in the `Msg` union that differ only by a field name string (e.g., `SetName`, `SetEmail`, `SetPhone` instead of `SetField`). Detection: structural comparison of union members after normalizing string literal types.

The AST visitor runs as part of the evaluation pipeline (§5) after the compile check passes. Human review is required only when the visitor reports ambiguous cases.

**Few-shot vs. zero-shot for tier 4+ tasks.** Resolved: measure empirically and adopt few-shot when the data justifies it. Protocol: run all tier 4, 5, and 6 tasks with 0-shot, 1-shot, and 3-shot prompts. The examples for few-shot are drawn from the scored example library (§9 Step 8). Compute full pass rate improvement per additional example. Decision rule: if 1 example raises full pass rate by ≥20 percentage points on any tier, adopt 1-shot as the standard for that tier and above. If 3 examples provide ≥10 additional percentage points over 1-shot, adopt 3-shot. If the improvement is <20 points even with 3 examples, the issue is in the system prompt or API surface, not in example count — investigate root causes instead. Few-shot examples must be excluded from the evaluation task set to avoid data contamination.

**Effect type vocabulary.** Resolved: the core runtime ships `delay` and `log` as built-in effects with unprefixed names. The `@llui/effects` package ships `http`, `cancel`, `debounce`, `sequence`, and `race` as composable effect descriptions. The names match what LLMs naturally produce — no `llui:` prefix. The `@llui/effects` package is tree-shakeable; unused effect types add zero bytes. The system prompt includes effect types relevant to each task (see §8 variants).
````
