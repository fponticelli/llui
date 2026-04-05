# LLM-Friendliness of the LLui Framework

This document is about LLMs generating application code that uses LLui — not about LLMs implementing LLui internals. The distinction matters. An LLM implementing a framework needs deep knowledge of browser APIs, scope trees, and bitmask arithmetic. An LLM writing a component needs to know: what is the shape of state, how do I express a message, how do I render a list. These are very different knowledge surfaces, and friendliness for one does not imply friendliness for the other.

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

The pattern `init → state; update(state, msg) → [newState, effects]; view(send) → DOM` appears in thousands of training examples under many names: The Elm Architecture, Redux + middleware, the Model-View-Update loop, Hyperapp, Imba. When an LLM sees `ComponentDef<S, M, E>`, it immediately maps this to a known template. The `init`, `update`, and `view` fields are predictable: the LLM has high confidence about their signatures and their relationships.

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
  | { type: 'http'; url: string; onSuccess: Msg; onError: Msg }
  | { type: 'cancel'; token: string; inner?: Effect }
  | { type: 'analytics'; event: string } // custom
```

Effects as discriminated unions give the LLM the same benefit for side effects that Msg unions give for messages. The LLM can see what effects exist. It can enumerate them. `update()` returning `[newState, [cancel('search', http({ ... }))]]` is a pattern the LLM has seen in Elm (Cmd) and in Hyperapp.

The consumption model is equally LLM-friendly: `handleEffects<Effect>().else(...)` is the canonical `onEffect` handler. The LLM generates a single line — `handleEffects<Effect>()` — that consumes all `@llui/effects` types, and writes a switch in `.else()` for custom types only. TypeScript narrows the `.else()` callback to the custom variants, so exhaustiveness checking works. The pattern is mechanical: if the `Effect` union includes `http`/`cancel`/`debounce`, use `handleEffects`; handle the rest in `.else()`.

### 2.4 `view()` Is a Pure Function

The LLM generates DOM construction code in a style virtually identical to React's JSX or lit-html's tagged templates:

```typescript
view: ({ send, text }) => {
  return div({ class: 'counter' }, [
    text((s) => String(s.count)),
    button({ onClick: () => send({ type: 'increment' }) }, [text('+')]),
  ])
}
```

The `view` argument is a bundle of state-bound helpers (`View<State, Msg>`). Destructuring the helpers the component uses — `{ show, each, branch, text, memo }` — removes per-call generics (`show<State>` becomes `show`) because `S` is pinned by the enclosing `component<State, Msg, _>` call. The LLM never has to repeat the state type.

No lifecycle rules apply. There is no `useEffect` with a dependency array that the LLM will get wrong. There are no class components. The function runs once at mount time and the bindings handle updates automatically. The LLM's strong intuition about "return a tree of nodes" applies directly.

### 2.5 Reactive Values Are Arrow Functions

The distinction between static and reactive prop values is expressed as the presence or absence of an arrow function:

```typescript
// Static — applied once at mount:
div({ class: 'container' }, [...])

// Reactive — re-evaluated on state change:
div({ class: s => s.active ? 'on' : 'off' }, [...])
```

The pattern `(s) => expression` is the same pattern the LLM uses for array callbacks, React selectors, and every other accessor-style API. It requires no new concept. The LLM's existing probability mass over "when do I use an arrow function here" is correct: always when the value depends on state, never when it is constant.

### 2.6 No Hook Rules

React hooks have ordering constraints that produce confusing errors ("hooks must not be called inside conditions or loops") that LLMs violate with regularity. This is a significant source of generated code failures. LLui has no hooks. `onMount` is a simple callback registered during `view()`:

```typescript
view: ({ send }) => {
  onMount((el) => {
    el.focus()
  })
  return input({ type: 'text' })
}
// Helpers are the second arg (`view: ({ send, ... }) => …`). `onMount` is
// imported directly — it does not depend on the component's state type.
```

No ordering constraints. No dependency arrays. The function registers a callback; the callback fires after DOM insertion. LLMs handle this pattern correctly.

### 2.7 Plain Object Literal Component Definition

```typescript
export const Counter = component<State, Msg, Effect>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => { ... },
  view: ({ send }) => { ... },
  onEffect: handleEffects<Effect>().else((effect, send, signal) => { ... }),
});
```

LLMs are excellent at filling in object literal fields. Given `ComponentDef<S, M, E>` in context, the LLM knows exactly which fields to populate and what their types are. TypeScript's excess property checking catches any field the LLM invents. The pattern (export a plain object, pass it to a wrapper function) appears throughout modern TypeScript codebases. The `handleEffects<Effect>().else(...)` pattern for `onEffect` is a single canonical form — the LLM does not need to decide which effects to handle; `handleEffects` consumes the known types and `.else()` narrows to the rest.

### 2.8 Plain `.ts` Files

LLui components are TypeScript files. There is no `.llui` extension, no `.svelte` format, no Vue SFCs. The LLM needs no knowledge of custom file formats. It writes TypeScript; it imports from `'@llui/dom'`; it exports a component definition. This is the smallest possible conceptual footprint.

---

## 3. What Hurts LLMs

### 3.1 `elSplit` in Compiled Output

`elSplit` is an implementation detail of the Vite plugin. It never appears in source files written by developers. However, if an LLM sees compiled output — in error messages that quote transformed code, in stack traces, or in examples that use the compiled form — it encounters a function with no documentation and a non-obvious signature:

```typescript
elSplit(
  'div',
  (__e) => {
    __e.className = 'counter'
  },
  [['click', handler]],
  [[1, 'attr', 'title', (s) => s.title]],
  [children],
)
```

An LLM that sees this and tries to write it directly will produce uncompilable code — the signature is internal and subject to change. The rule is absolute: `elSplit` must never appear in user-facing documentation, examples, or error messages that surface to the developer. If a runtime error quotes a compiled stack frame, the error message should reference the original source location via source maps.

### 3.2 `each()` Scoped Accessor Pattern

```typescript
each({
  items: (s) => s.todos,
  key: (todo) => todo.id,
  render: ({ item }) => li([text(item.text)]),
})
```

The `each()` render callback receives a **scoped accessor** `item` — a proxy-function with two forms: `item.text` (property-access shorthand) returns a per-field accessor, and `item(t => expr)` remains available for computed expressions. Both return `() => V`. Invoke the accessor (`item.text()`) to read imperatively inside event handlers.

A common LLM error pattern is bypassing the scoped accessor to read state directly:

```typescript
// WRONG — accessing state directly, bypassing the scoped accessor:
each({
  items: (s) => s.todos,
  key: (t) => t.id,
  render: ({ item }) => li([text((s) => s.todos[0].text)]), // hardcoded index, not per-item
})

// CORRECT — scoped accessor (property-access shorthand):
each({
  items: (s) => s.todos,
  key: (t) => t.id,
  render: ({ item }) => li([text(item.text)]),
})
```

The accessor proxy gives `item.text` — typed as `() => T['text']` — which threads naturally into bindings. TypeScript infers field types from `T`, so `item.text` and `item.done` are distinct types. The compiler also emits diagnostics for common misuse patterns.

The main residual risk is forgetting that `item.field` is the _accessor_, not the value — e.g. writing `item.text + '!'` inside an event handler (concatenating a function). The correct imperative read is `item.text()`.

### 3.3 `memo()` Omission

LLMs do not know when `memo()` is needed. The incorrect form:

```typescript
const filteredTodos = (s: State) => s.todos.filter((t) => !t.done)

// view:
each({ items: filteredTodos, key: (t) => t.id, render: renderItem })
text((s) => `${filteredTodos(s).length} remaining`)
```

This produces a filter computation for every binding that references `filteredTodos`, every update cycle. The correct form:

```typescript
const filteredTodos = memo((s: State) => s.todos.filter((t) => !t.done))
```

The difference is invisible to the LLM: both forms compile, both produce correct output, the performance difference only manifests at scale. An LLM has no way to know it should use `memo()` without being told explicitly. The rule to communicate: "wrap any accessor used in multiple places, or any accessor that performs significant computation, in `memo()`."

### 3.4 Level 1 vs Level 2 Composition Choice

The LLM must choose between Level 1 (view functions — the default) and Level 2 (`child()` — for isolation). LLMs trained on React will default to component instances for everything. In LLui, most composition should use Level 1: the child is a module with `update` and `view` functions, the parent owns the state.

```typescript
// LLM default (wrong — uses child() for simple composition):
child({ def: Toolbar, key: 'toolbar', props: (s) => ({ tools: s.tools }) })

// Correct LLui default — Level 1 view function with (props, send) convention:
toolbarView({ tools: (s) => s.tools, toolbar: (s) => s.toolbar }, (msg) =>
  send({ type: 'toolbar', msg }),
)
```

The system prompt must state: "Use view functions (Level 1) for composition. Only use `child()` for library components with encapsulated internals or 30+ state paths."

When the LLM does use `child()` (Level 2), it must get four things right: `def`, `key`, reactive `props` (accessor, not static object), and `onMsg`. The most common failure: using `props` as a static object, which is captured at mount time and never updates. TypeScript won't catch this.

### 3.5 `.map()` vs `each()` for Lists

LLMs trained on React will use `.map()` for list rendering. In LLui, `.map()` inside `view()` creates static DOM nodes from the initial state — they never update when the array changes. This is the single most common LLM error for LLui.

```typescript
// WRONG — static nodes, never update:
div(state.items.map((item) => div([text(item.name)])))

// CORRECT — reactive keyed list:
each({
  items: (s) => s.items,
  key: (t) => t.id,
  render: ({ item }) => div([text(item.name)]),
})
```

The compiler emits a diagnostic warning for `.map()` on state-derived arrays, but the system prompt should also include an explicit rule: "Never use `.map()` on state arrays in `view()`. Always use `each()`."

### 3.6 Typed Addressed Effects

Inter-component messaging uses typed addressed effects. The sender imports the target's `address` builder and gets full autocomplete:

```typescript
import { toToastManager } from './toast-manager'

// Correct — typed, compiler-verified:
return [state, [toToastManager.show({ message: 'Saved!' })]]
```

The LLM must know to import the target's address builder. The import is the key — it makes the coupling explicit and discoverable. The system prompt should include: "For cross-component commands, import the target's address builder."

### 3.7 `branch()` vs `show()`

`branch()` handles named states; `show()` handles a boolean condition. The distinction is correct, but the LLM will use them interchangeably:

```typescript
// LLM will often write this (works but wrong pattern):
branch({
  on: (s) => (s.open ? 'shown' : 'hidden'),
  cases: {
    shown: () => modal(),
    hidden: () => [],
  },
})

// Canonical form:
show({ when: (s) => s.open, render: () => modal() })
```

The inverse error — using `show` when a named discriminant is correct — is harder to detect because `show` offers no structural signal that only two states exist.

### 3.8 State Mutation in `update()`

The most catastrophic silent error:

```typescript
// WRONG — mutates state in place; __dirty returns 0; DOM freezes:
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

### 3.9 `send()` Batching and `flush()`

`send()` does not update the DOM synchronously — it enqueues a message and defers the update cycle to a microtask. LLMs trained on React (`setState` is also async) will have some prior knowledge here, but the specific pattern of using `flush()` to force synchronous updates is novel and unlikely to appear in training data.

The common LLM mistake: reading DOM state immediately after `send()` without `flush()`.

```typescript
// WRONG — DOM not yet updated:
send({ type: 'showPanel' })
const height = panelEl.offsetHeight // reads pre-update value

// CORRECT:
send({ type: 'showPanel' })
flush()
const height = panelEl.offsetHeight // reads post-update value
```

In practice, most component code never needs `flush()` — reactive bindings handle DOM updates automatically. The foot-gun appears in `onMount` callbacks or effect handlers that need to measure layout after a state change. The system prompt rule ("use `flush()` only when you need to read DOM state immediately") is sufficient to prevent misuse. LLMs that over-apply `flush()` (calling it after every send) will produce correct but suboptimally batched code — a performance issue, not a correctness issue, which is the safer failure mode.

---

## 4. What Seems Helpful But Isn't

### 4.1 Very Short API Surface (Under 5 Functions)

An API that exposes only `component`, `text`, `div`, and `mount` forces the LLM to reinvent `branch`, `each`, `show`, `memo`, and `onMount` using imperative DOM manipulation. The LLM's reinventions will be incorrect: they will mutate state, leak event listeners, or produce non-reactive output. The right API size is one export per distinct concept. Cutting the API to reduce "cognitive load" produces more errors, not fewer.

### 4.2 Heavy Scaffolding in Generated Code

An LLM that generates 60 lines of boilerplate before the first interesting line has 60 lines in which to make errors. Every line of boilerplate is a line where a type might be wrong, a name might be misspelled, or a convention might be violated. The `component()` wrapper should require the minimum amount of setup code for the simplest case. Currently, a counter requires approximately 20 lines including blank lines. That is acceptable.

### 4.3 "Helpful" Default Behaviors That Change Semantics

Auto-memoizing every accessor by default seems like it would help. In practice it makes the LLM's mental model wrong: the LLM will reason about when computation happens and produce incorrect analysis, because the framework silently changed the evaluation semantics. Explicit `memo()` is better even though it requires extra knowledge, because the LLM's model of the code matches reality.

### 4.4 Aliases for the Same Concept

If `show(condition, builder)` is an alias for `branch(condition, { true: builder, false: () => [] })`, and both are exported, the LLM has two valid spellings. The LLM's probability mass is split. Some generations will use `show`, some will use `branch`. More importantly, the LLM may use `branch` when `show` was the canonical choice and produce code that fails the idiomatic review criterion. Pick one canonical form per concept. If both are needed for different semantic reasons, make the semantic distinction airtight in the type signatures.

### 4.5 JSDoc on Every Function Instead of Accurate Types

Prose descriptions require the LLM to parse natural language and map it to code structure. Type signatures require the LLM to parse TypeScript syntax it already understands. The signature:

```typescript
function each<S, T, M>(opts: {
  items: (state: S) => T[]
  key: (item: T) => string | number
  render: (opts: {
    send: Send<M>
    item: <R>(selector: (t: T) => R) => Binding<R>
    index: () => number
  }) => Node[]
}): Node[]
```

communicates more about usage than a paragraph of prose. The object parameter means the LLM cannot mix up positional arguments — every field is named. The `item: <R>(selector: (t: T) => R) => Binding<R>` type in the `render` callback makes explicit that `item` is a function that takes a selector and returns a reactive binding — the LLM cannot plausibly produce `item.text` because the type has no properties. The selector pattern `item(t => t.text)` mirrors the component-level `text(s => s.count)` pattern, so the LLM's existing probability mass over "pass an arrow function to read a value" applies directly.

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

| Metric          | Range   | Description                                                                                                                                                                                        |
| --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile rate    | 0 or 1  | `tsc --noEmit` exits 0 with zero errors                                                                                                                                                            |
| Render rate     | 0 or 1  | Initial DOM matches spec (correct elements, correct text, correct attributes)                                                                                                                      |
| Full pass rate  | 0 or 1  | All assertions pass                                                                                                                                                                                |
| Assertion score | 0.0–1.0 | Fraction of individual assertions that pass (partial credit)                                                                                                                                       |
| Console clean   | 0 or 1  | Zero console errors or warnings during the entire test run                                                                                                                                         |
| Idiomatic score | 0 or 1  | Human review: correct use of `memo()`, correct `each()` scoped accessor pattern, no state mutation, `show` vs `branch` correct, tests use `testComponent`/`assertEffects` (not manual DOM queries) |

Compile rate is a prerequisite gate. If the output does not compile, skip all subsequent metrics and record 0 for each. The compile gate is the most important single metric: a framework that produces compilable output on the first attempt is measurably more usable than one that requires iteration.

Idiomatic score requires human review of each passing output. The reviewer checks:

- `memo()` present wherever a derived value is referenced in multiple places or involves significant computation
- `each()` renderItem uses the scoped accessor pattern `item(t => t.field)`, not direct property access or captured outer variables
- `each()` used for state-derived arrays in `view()`, never `.map()`
- `update()` returns a new state object, not a mutation
- `show` used for boolean conditions, `branch` for named states
- Composition uses Level 1 (view functions) unless isolation is clearly needed; no unnecessary `child()` usage
- Forms use `setField` pattern when there are 3+ text fields, not one message type per field
- Cross-component effects use typed address builders, not string-keyed `AddressedEffect`
- No hardcoded DOM manipulation that bypasses the reactive binding system

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

**TASK 10 — Parent-child communication (Level 1)**
A parent component owns an array of counter slices. Each counter is rendered by a `counterView()` view function. Each counter has its own increment button. The parent shows the total count across all counters. An "Add counter" button appends a new counter slice.
Assertions: total shows 0 initially; clicking Increment on counter 1 → total shows 1; clicking Add counter → total unchanged; clicking Increment on the new counter → total shows 2.

**TASK 10b — Parent-child communication (Level 2)**
Same requirements as Task 10, but each counter is a `child()` component with its own state machine. The parent receives `{ type: 'incremented' }` via `onMsg` and maintains the total. Tests the `propsMsg` and `onMsg` plumbing.
Assertions: same as Task 10, plus: parent state and child state are independent objects (child cannot directly access parent state).

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
- **List never updates**: LLM used `.map()` instead of `each()` on a state-derived array. Check for `.map()` in `view()` body.
- **Idiomatic fails on passing tasks**: LLM is using `branch` where `show` belongs, omitting `memo()`, using `child()` where a view function suffices, or defining N message types for N form fields instead of `setField`.
- **Level 2 props stale**: LLM passed a static object to `child({ props: { ... } })` instead of a reactive accessor `s => ({ ... })`.
- **Console errors on passing tasks**: LLM is generating uncaught promise rejections or calling `text()` outside `view()`.
- **Test harness misuse**: LLM writes raw `assert.deepEqual` on `update()` instead of using `testComponent()` and `assertEffects()` from `@llui/test`. This still passes but misses effect accumulation and state tracking. The system prompt should include a correct `testComponent` example for tasks that require test output.

### Regression Protocol

When a framework change is made (new API, removed alias, changed signature), run the full 15-task suite before and after. Report the delta in each column. A change that improves compile rate by 5 percentage points at the cost of 10 percentage points in full pass rate is a regression, not an improvement.

---

## 8. The System Prompt

### Design Principles

The system prompt must:

- Provide the type signatures for `ComponentDef`, `each`, `branch`, `show`, `memo`, `child`, and `onMount` — not prose descriptions, actual TypeScript.
- Show one complete minimal example (under 50 lines) with `init`, `update`, `view`, and `onEffect`.
- State the rules that are frequently violated: no mutation, reactive vs static, scoped accessor (`item(t => t.field)`) usage.
- Stay under 300 words for the core system prompt. Task-specific type definitions may bring the total under 450 words. Longer prompts dilute the LLM's attention on the task. The system prompt is not documentation — it is context injection.
- Not explain `elSplit`, the Vite plugin, bitmask arithmetic, or any internal mechanism.
- Not duplicate information that is in the task prompt.

### Concrete System Prompt

````
# LLui Component

You are writing a TypeScript component using the LLui framework.

## Pattern

LLui uses The Elm Architecture: `init` returns initial state and effects;
`update(state, msg)` returns `[newState, effects]`; `view(send, h)` returns
DOM nodes once at mount and binds state to the DOM through accessor functions.
State is immutable. Effects are plain data objects returned from `update()`.

## Key Types

```typescript
interface ComponentDef<S, M, E> {
  name: string;
  init: (props?: Record<string, unknown>) => [S, E[]];
  update: (state: S, msg: M) => [S, E[]];
  view: (h: View<S, M>) => Node[];
  onEffect?: (effect: E, send: (msg: M) => void, signal: AbortSignal) => void;
  // Level 2 only (optional):
  propsMsg?: (props: Record<string, unknown>) => M;
  receives?: Record<string, (params: any) => M>;
}

// `h: View<S, M>` is a bundle of state-bound helpers. Destructure it in
// `view` to drop per-call generics — every accessor infers `s: S`:
//   view: ({ send, show, each, branch, text, memo }) => [...]

// Effect consumption — import from @llui/effects:
function handleEffects<E extends { type: string }>(): EffectChain<E>;
// EffectChain methods:
//   .else(handler: (eff: CustomEffects<E>, send, signal) => void): EffectHandler<E>
//   .on(type, handler): EffectChain<E, narrowed>
//   .done(): EffectHandler<E>  // compile error if unhandled types remain

// Structural primitives (call only inside view()) — all use object parameters:
function branch<S, M>(opts: {
  on: (s: S) => string | number | boolean,
  cases: Record<string, (send: Send<M>) => Node[]>,
  enter?: (nodes: Node[]) => void | Promise<void>,
  leave?: (nodes: Node[]) => void | Promise<void>,
  onTransition?: (ctx: { entering: Node[], leaving: Node[], parent: Node }) => void | Promise<void>,
}): Node[];
function show<S, M>(opts: {
  when: (s: S) => boolean,
  render: (send: Send<M>) => Node[],
  enter?: ..., leave?: ..., onTransition?: ...,
}): Node[];
function each<S, T, M>(opts: {
  items: (s: S) => T[],
  key: (item: T) => string | number,
  render: (opts: { send: Send<M>, item: <R>(sel: (t: T) => R) => Binding<R>, index: () => number }) => Node[],
  enter?: ..., leave?: ..., onTransition?: ...,
}): Node[];
function portal(opts: { target: Element | string, render: () => Node[] }): Node[];
function foreign<S, T extends Record<string, unknown>, Instance>(opts: {
  mount: (container: HTMLElement, send: (msg: Msg) => void) => Instance,
  props: (s: S) => T,
  sync:
    | ((instance: Instance, props: T, prev: T | undefined) => void)
    | { [K in keyof T]?: (instance: Instance, value: T[K], prev: T[K] | undefined) => void },
  destroy: (instance: Instance) => void,
  container?: { tag?: string; attrs?: Record<string, string> },
}): Node[];
function memo<S, T>(accessor: (s: S) => T): (s: S) => T;
function onMount(callback: (el: Element) => (() => void) | void): void;
````

## Example

```typescript
import { component, div, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }
type Effect = never

export const Counter = component<State, Msg, Effect>({
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
  view: ({ send, text }) =>
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
})
```

## Rules

- Never mutate state in `update()`. Always return a new object: `{ ...state, field: newValue }`.
- Reactive values in `view()` are arrow functions: `text(s => s.label)`, `div({ class: s => s.active ? 'on' : '' })`.
- Static values are literals: `div({ class: 'container' })`.
- Never use `.map()` on state arrays in `view()`. Always use `each()` for reactive lists.
- Structural primitives use object parameters:
  `each({ items: s => s.todos, key: t => t.id, render: ({ item, index }) => ... })`
  `branch({ on: s => s.phase, cases: { idle: () => ..., loading: () => ... } })`
  `show({ when: s => s.open, render: (send) => ... })`
  `portal({ target: document.body, render: () => ... })`
- In `each()`, `render` receives `item` (a scoped accessor) and `index` (a getter).
  Read item properties via selector: `item(t => t.text)`, not `item.text`.
- Wrap derived values used in multiple places in `memo()`:
  `const filtered = memo((s: State) => s.items.filter(i => i.active))`.
- Use `show` for boolean conditions. Use `branch` for named states (3+ cases or non-boolean).
- For composition, use view functions (Level 1) with `(props, send)` convention:
  `function toolbarView<S>(props: ToolbarProps<S>, send: (msg: ToolbarMsg) => void)`.
  Only use `child()` (Level 2) for library components with encapsulated internals or 30+ state paths.
- For forms with many fields, use a single `setField` message:
  `{ type: 'setField'; field: keyof Fields; value: string }` instead of one message per field.
- For cross-component commands, import the target's typed address builder:
  `import { toToastManager } from './toast-manager'` then `toToastManager.show({ message: '...' })`.
- For third-party imperative components (editors, maps, charts), use `foreign()`:
  `foreign({ mount: (el, send) => lib.create(el), props: s => s.config, sync: ..., destroy: inst => inst.dispose() })`
  `sync` is a function `(inst, props, prev) => void` for manual diffing, or a record `{ field: (inst, val, prev) => void }` for per-field handlers.
  The library owns the DOM inside the container. LLui owns the container. `sync` pushes config changes; `send` in `mount` pushes events back to LLui.
- Effects are dispatched after DOM updates via `onEffect(effect, send, signal)`.
  Core effects `delay` and `log` are handled by the runtime automatically.
  For `http`, `cancel`, `debounce`, `sequence`, `race`: import `handleEffects` from `@llui/effects`.
  Use `onEffect: handleEffects<Effect>().else((eff, send, signal) => { switch... })`.
  `cancel(token, inner)` cancels and replaces; `cancel(token)` cancels only (no replacement).
  Wrap cancellable effects: `cancel(token, http({ ... }))`.
- `send()` batches via microtask. Multiple sends coalesce into one DOM update.
  Use `flush()` after `send()` only when you need to read DOM state immediately.
- Accessibility: every `img()` needs `alt`. Every `button()`/`a()` needs visible text or `aria-label`.
  `onClick` on non-interactive elements (div, span) requires `role` and `tabIndex`.
  Every form input needs a label (`id` + `label({ for: id })` or `aria-label`).
  The compiler enforces these — violations are hard errors (see 02 Compiler.md).

````

### System Prompt Variants for Complex Tasks

For tasks involving async effects, prepend the effect type definitions relevant to that task. For tasks involving `child()`, add the `child()` signature. Do not pad the system prompt with information irrelevant to the task. A system prompt for the Async Fetch task should include:

```typescript
// In the system prompt for async tasks:
import { handleEffects, http, cancel, debounce } from '@llui/effects'

type Effect =
  | { type: 'http'; url: string; onSuccess: Msg; onError: Msg }
  | { type: 'delay'; ms: number; onDone: Msg }
  | { type: 'cancel'; token: string; inner?: Effect }
  | { type: 'debounce'; key: string; ms: number; inner: Effect };

// In update(): return cancel('search', http({ url, onSuccess: ..., onError: ... }))
// In onEffect: handleEffects<Effect>().done()  // no custom effects, all handled by chain
// Or if custom effects exist:
// onEffect: handleEffects<Effect>().else((eff, send, signal) => { switch (eff.type) { ... } })
````

For the Parent-Child Communication task (Level 2 `child()`), add:

```typescript
// Level 2 composition — isolated child with own state machine:
const MyChild = component<ChildState, ChildMsg, ChildEffect>({
  init: (props) => [{ ... }, []],
  propsMsg: (props): ChildMsg => ({ type: 'propsChanged', props }),
  receives: {
    scrollTo: (params: { id: string }) => ({ type: 'scrollTo' as const, id: params.id }),
  },
  update: (state, msg) => { ... },
  view: ({ send }) => { ... },
})

// Parent mounts it:
child({ def: MyChild, key: 'table-1', props: s => ({ rows: s.data }), onMsg: handleChildMsg })

// Parent sends typed commands:
import { toMyChild } from './my-child'
return [state, [toMyChild.scrollTo({ id: '42' })]]
```

For composition tasks that need only Level 1 (view functions), add:

```typescript
// Level 1 — parent owns state, child is a view function with (props, send) convention:
// toolbar.ts
export type ToolbarProps<S> = {
  tools: (s: S) => Tool[]
  toolbar: (s: S) => ToolbarSlice
}
export function toolbarView<S>(
  props: ToolbarProps<S>,
  send: (msg: ToolbarMsg) => void,
) { ... }

// parent.ts — wraps child messages:
toolbarView({ tools: s => s.tools, toolbar: s => s.toolbar }, msg => send({ type: 'toolbar', msg }))
```

See 08 Ecosystem Integration §1 for the full `@llui/zag` adapter specification, component anatomy, and the `foreign()` vs Ark distinction.

Task-specific context injected into the system prompt produces measurably better results than a single universal system prompt. Keep the core system prompt under 300 words; add task-specific type definitions to bring the total under 450 words.

---

## 9. How to Improve LLM-Friendliness

Steps are ordered by expected impact on compile rate and full pass rate, based on the failure patterns documented in Section 3.

### Step 1 — Publish a `.d.ts` type reference file

A single `llui.d.ts` that defines `ComponentDef`, all element helpers, `each`, `branch`, `show`, `memo`, `child`, `onMount`, and `portal` with accurate signatures. This file should be importable into the LLM's context window directly. Type signatures communicate more information per token than prose, and LLMs reason about TypeScript types reliably.

The file should be under 150 lines. Every additional line reduces the attention the LLM pays to individual types.

### Step 2 — Leverage `each()` scoped accessor type safety

The `each()` scoped accessor API (`item: <R>(sel: (t: T) => R) => R`) is significantly more type-safe than the previous closure-based approach. The type system now catches the most common error — direct property access on `item` — because `item` is typed as a function, not as `T`. The compiler additionally emits diagnostics for direct property access on the `item` parameter.

The remaining LLM error patterns are: (1) calling `item()` without a selector, which is a TypeScript error the LLM can correct with one round of feedback, and (2) destructuring the result of `item(t => t)` into a local variable and using it across multiple bindings, losing reactivity. For (2), add JSDoc to the `renderItem` parameter:

```typescript
/**
 * @param renderItem - Called once per item at mount time. Receives:
 *   - `item` — a scoped accessor. Read properties via selector: `item(t => t.text)`.
 *     Each `item(...)` call creates a reactive binding. Do not store the result in a
 *     variable and reuse it — each binding site should call `item(...)` independently.
 *   - `index` — call `index()` to read the current index.
 */
function each<S, T, M>(opts: {
  items: (state: S) => T[]
  key: (item: T) => string | number
  render: (opts: {
    send: Send<M>
    item: <R>(sel: (t: T) => R) => Binding<R>
    index: () => number
  }) => Node[]
}): Node[]
```

### Step 3 — Guide the Level 1 vs Level 2 composition choice

Most composition should use Level 1 (view functions) with the `(props, send)` convention: the view function takes a typed props object (generic over `<S>`) and a `send` callback. The LLM exports a function, defines a `Props<S>` type, and the parent calls it with named accessors. This pattern is identical to how React composition works (props down, callbacks up) and will be generated correctly from existing training data.

Level 2 (`child()`) is needed only for library components with encapsulated state (data tables, rich text editors) or when the component has 30+ state paths where isolating the state machine reduces complexity. The call site requires: `def`, `key`, reactive `props` (accessor, not static object), and optionally `onMsg`. The most common LLM error is passing `props` as a static object — the system prompt must emphasize: "props must be an accessor function `s => ({ ... })`, not a literal object."

The `propsMsg` mechanism converts prop changes into messages the child handles in `update()` like any other message — no special lifecycle. The `receives` declaration provides typed addressed effects that senders import as `toComponentName.action({ ... })`. Both patterns are predictable and type-checked.

### Step 4 — Include a correct `each()` example in the system prompt for list tasks

The scoped accessor pattern eliminates the need for a separate `list()` primitive. A single `each()` API with the `item(t => t.text)` selector pattern is learnable from one example. For tasks involving lists (tier 2+), include a correct `each()` example in the system prompt:

```typescript
// System prompt example for list tasks:
each({
  items: (s) => s.items,
  key: (t) => t.id,
  render: ({ item, index }) =>
    li([
      text(item.label),
      span({ class: item((t) => (t.done ? 'done' : '')) }),
      text(() => `#${index()}`),
    ]),
})
```

This example communicates: `item.field` is the shorthand for a reactive field binding, `item(fn)` handles computed expressions, `index()` is a zero-arg getter. The shorthand mirrors the component-level `text(s => s.count)` idiom applied to item scope.

### Step 5 — Enforce compilation and `@llui/test` in the evaluation pipeline

Compile failures that produce helpful TypeScript error messages are the strongest feedback signal available to an LLM in a tool-assisted workflow. The evaluation pipeline should run `tsc --noEmit` first, report the errors, and allow the LLM to attempt a correction. One correction round with compiler feedback increases full pass rate significantly for tier 3–6 tasks.

The pipeline's second stage should use `@llui/test` primitives, not raw DOM assertions. `testComponent()` validates `update()` logic in Node without a browser. `assertEffects()` structurally matches effect trees, catching incorrect nesting (e.g., `cancel` wrapping `debounce` wrapping `http`). `testView()` validates DOM structure via a lightweight mount. `propertyTest()` fuzzes message sequences against invariants, catching edge cases the hand-written task assertions miss. Playwright runs only for the small set of assertions that require real browser behavior: focus trapping, CSS transitions, intersection observers, and accessibility audits.

Without tool use (pure generation), compile rate is the ceiling for all subsequent metrics. Every improvement to type accuracy — more precise `Msg` union types in the system prompt, accurate `each()` signature — directly raises the compile-rate ceiling.

### Step 6 — Provide a `memo()` lint hint

Add a lint rule (or runtime warning in development mode) that detects when the same non-memoized accessor function reference is passed to multiple `text()` or prop bindings within the same component. The warning output: "Accessor `filteredTodos` is referenced in 3 bindings without `memo()`. Wrap it: `const filteredTodos = memo(...)`." This gives the LLM's tool-assisted correction loop a signal for a class of error that is otherwise invisible.

### Step 7 — Add difficulty-tiered example sets to the system prompt

For tier 3+ tasks (async, multi-step), the single counter example in the base system prompt is insufficient. Add one additional example relevant to the task's domain:

- Async task: show a fetch effect example with loading/success/error states using `@llui/effects` (`http`, `cancel`).
- Multi-component task: show Level 1 (view function) example for simple cases, Level 2 (`child()` with `propsMsg`) for isolated components.
- Each/list task: show a correct `each()` with scoped accessor `item(t => t.field)` usage.

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

### Layer 1: `window.__lluiDebug` API

The foundation. The LLui dev runtime (enabled by the Vite plugin in development mode, tree-shaken in production) exposes a structured debug API on `window`. This API is the contract that all higher layers build on — the MCP server, the DevTools extension, and manual console debugging all call the same functions.

```typescript
interface LluiDebugAPI {
  // ── Read ──────────────────────────────────────────────────
  /** Current state object, JSON-serializable. */
  getState(): unknown

  /** Component tree: name, state summary, binding count, child components. */
  getComponentTree(): ComponentDebugNode[]

  /** Chronological log of effects dispatched since mount or last clearLog(). */
  getEffectsLog(): EffectRecord[]

  /** Full message history with state-before, state-after, effects, dirtyMask. */
  getMessageHistory(): MessageRecord[]

  /** All active bindings: mask, lastValue, accessor source location, DOM target. */
  getBindings(): BindingDebugInfo[]

  // ── Write ─────────────────────────────────────────────────
  /** Send a message. Enqueues into the component's message queue. */
  send(msg: unknown): void

  /** Force synchronous update cycle (drain queue + Phase 1 + Phase 2). */
  flush(): void

  // ── Replay ────────────────────────────────────────────────
  /** Export current session as a LluiTrace JSON object. */
  exportTrace(): LluiTrace

  /** Replay a trace, optionally stopping at step N. Returns final state. */
  replayTrace(trace: LluiTrace, options?: { stopAtIndex?: number }): unknown

  // ── Diagnostic ────────────────────────────────────────────
  /** Dry-run: call update(state, msg) without applying. Returns [newState, effects]. */
  evalUpdate(msg: unknown): { state: unknown; effects: unknown[] }

  /** Explain why a binding re-evaluated: which mask bits were dirty, what the accessor returned, what the previous value was. */
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
  dirtyMask: number
  children: ComponentDebugNode[]
}

interface MessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
  dirtyMask: number
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
  id: string
  mask: number
  lastValue: unknown
  domTarget: string // CSS selector path to the bound DOM node
  accessorSource?: string // source location if available from compiler
}

interface UpdateExplanation {
  bindingId: string
  dirtyMask: number
  bindingMask: number
  matched: boolean // (dirtyMask & bindingMask) !== 0
  accessorResult: unknown
  lastValue: unknown
  changed: boolean // accessorResult !== lastValue
}

interface ValidationError {
  path: string
  expected: string
  received: string
  message: string
}
```

**Key capabilities that DOM debugging cannot provide:**

`evalUpdate(msg)` is the most powerful diagnostic. The LLM sends a hypothetical message and sees what `update()` would return — without touching the running app. It can explore "what happens if the user clicks delete?" by calling `evalUpdate({ type: 'deleteItem', id: '123' })` and reading the resulting state and effects. This is pure computation — `update()` is a pure function, so the dry-run is identical to the real execution. No other framework offers this because no other framework guarantees `update()` purity at the type level.

`validateMessage(msg)` catches malformed messages before they enter the queue. The compiler emits type metadata for each component's `Msg` union. The validator checks discriminant field, required properties, and property types against this metadata. An LLM constructing a message from the type signature gets immediate structured feedback if it makes a mistake — before any state transition occurs.

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
The LLM suspects a binding is not updating. Instead of adding `console.log` and refreshing, it calls `llui_why_did_update(bindingId)`. The response tells it: the dirty mask was `0b0010`, the binding's mask is `0b0100`, and `(0b0010 & 0b0100) === 0` — the binding was correctly skipped because the relevant state path did not change. The bug is upstream: the `update()` function is not modifying the field the binding reads. The LLM now knows exactly where to look.

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

**`list()` vs. `each()`.** Resolved: `each()` with the scoped accessor API (`item(t => t.field)`) is the single list primitive. The compiler emits a diagnostic warning when `.map()` is used on state-derived arrays inside `view()`, catching the most common LLM error at compile time. Adding `list()` would split probability mass. The scoped accessor type signature makes the correct pattern structurally enforced — `item` is typed as a function, so `item.text` is a type error.

**System prompt length sweet spot.** Resolved: the universal system prompt (§8) targets 300–400 words. Task-specific variants (§8 "System Prompt Variants for Complex Tasks") extend to 400–500 words by appending relevant type definitions. This is validated empirically: run each tier of the canonical task set with 200-, 300-, 400-, and 500-word system prompts, plot compile rate and full pass rate vs. prompt length. The hypothesis is that 300–400 words is optimal for zero-shot tiers 1–3, and 400–500 words (with task-specific types) is optimal for tiers 4+. If the data contradicts this — for example, if 200 words produces equivalent results to 400 — shorten the prompt. The evaluation pipeline (§5) already specifies N=5 repetitions per task, providing sufficient statistical power to detect a 15+ percentage point difference in compile rate.

**Hard-fail vs. warning on TypeScript errors.** Resolved: hard-fail. `tsc --noEmit` errors cause the evaluation pipeline to record a compile failure for that sample. TypeScript errors indicate the LLM's model of the API is incorrect, even when the specific error is harmless at runtime. A framework where the LLM routinely produces type errors is not type-safe in practice — the type system's value is that it catches mistakes before runtime, and an LLM that bypasses it defeats the purpose. Hard-fail produces a cleaner signal: it forces improvements in either the system prompt, the type definitions, or the API surface design, rather than accumulating silently passing type-incorrect code.

**Automated idiomatic scoring.** Resolved: implement as a TypeScript AST visitor (`@llui/lint-idiomatic`) that detects the six canonical anti-patterns and produces a numeric score. The six patterns, each worth equal weight (1 point deduction per violation, from a base score of 5):

1. **State mutation:** AST pattern `state.field = ...` or `state.field.push(...)` in `update()` body. Detection: assignment expression where the left-hand side's root identifier matches the `update()` function's state parameter name.
2. **Missing `memo()`:** Same accessor arrow function (structurally identical AST) passed to two or more binding call sites without `memo()` wrapping. Detection: hash the AST of each accessor, group by hash, flag groups with count ≥ 2.
3. **`each()` closure violation:** In an `each()` render callback, an identifier is used that was assigned from the parent scope rather than obtained via the scoped accessor (`item(t => t.field)`). Detection: scope analysis — resolve each identifier in the render body, flag those whose declaration is outside the render callback and is not a function parameter.
4. **`.map()` on state arrays:** `.map()` call on a state-derived value inside `view()` body. Detection: call expression with `.map()` callee where the receiver is a call expression whose callee's parameters include the state type.
5. **Unnecessary `child()`:** `child()` used where the component has fewer than 10 state paths and does not declare `receives`. Detection: count unique state access paths in the child component definition; if < 10 and no `receives` field, flag.
6. **Form boilerplate:** Multiple message types in the `Msg` union that differ only by a field name string (e.g., `SetName`, `SetEmail`, `SetPhone` instead of `SetField`). Detection: structural comparison of union members after normalizing string literal types.

The AST visitor runs as part of the evaluation pipeline (§5) after the compile check passes. Human review is required only when the visitor reports ambiguous cases (e.g., pattern 5 where the component has exactly 10 paths).

**Few-shot vs. zero-shot for tier 4+ tasks.** Resolved: measure empirically and adopt few-shot when the data justifies it. Protocol: run all tier 4, 5, and 6 tasks with 0-shot, 1-shot, and 3-shot prompts. The examples for few-shot are drawn from the scored example library (§9 Step 8). Compute full pass rate improvement per additional example. Decision rule: if 1 example raises full pass rate by ≥20 percentage points on any tier, adopt 1-shot as the standard for that tier and above. If 3 examples provide ≥10 additional percentage points over 1-shot, adopt 3-shot. If the improvement is <20 points even with 3 examples, the issue is in the system prompt or API surface, not in example count — investigate root causes instead. Few-shot examples must be excluded from the evaluation task set to avoid data contamination.

**Effect type vocabulary.** Resolved: the core runtime ships `delay` and `log` as built-in effects with unprefixed names. The `@llui/effects` package ships `http`, `cancel`, `debounce`, `sequence`, and `race` as composable effect descriptions. The names match what LLMs naturally produce — no `llui:` prefix. The `@llui/effects` package is tree-shakeable; unused effect types add zero bytes. The system prompt includes effect types relevant to each task (see §8 variants).
