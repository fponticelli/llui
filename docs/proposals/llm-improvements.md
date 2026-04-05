# Proposals: Improving LLui for LLM Usage

Based on a deep analysis of the codebase, design docs, and the gap between what's specified and what's implemented, here are concrete proposals ordered by expected impact on LLM code generation quality.

---

## Proposal 1: Build the `@llui/mcp` Server

**Status:** Designed in `07 LLM Friendliness.md` §10, not implemented.
**Impact:** High — transforms LLM debugging from DOM-level observation to direct state machine interaction.

The `window.__lluiDebug` API is fully implemented (`packages/core/src/devtools.ts`) with `getState()`, `send()`, `evalUpdate()`, `exportTrace()`, and message history. What's missing is the MCP server that exposes these as native LLM tools over WebSocket.

**What to build:**

- New package `packages/mcp/` with MCP tool definitions for `llui_get_state`, `llui_send_message`, `llui_eval_update`, `llui_replay_trace`, `llui_why_did_update`, `llui_search_state`, etc.
- WebSocket bridge to the Vite dev server's HMR channel (extend with `llui:debug` channel)
- Auto-discovery of running LLui dev servers on localhost

**Why it matters for LLMs:**

- `evalUpdate()` lets an LLM test hypothetical state transitions without side effects — no other framework offers this
- `validateMessage()` gives structured feedback on malformed messages before they enter the queue
- `replayTrace()` enables binary-search debugging of user-filed bug reports
- Eliminates the need for screenshot-based debugging entirely

**Estimated scope:** ~500-800 LOC. The hard work (the debug API itself) is done; this is a protocol adapter.

---

## Proposal 2: Publish a Consolidated `.d.ts` Reference File

**Status:** Designed in `07 LLM Friendliness.md` §9 Step 1, not implemented.
**Impact:** High — type signatures communicate more per token than prose.

Currently, type information is scattered across source files. An LLM agent or system prompt must either include the full source or rely on prose descriptions. A single `llui.d.ts` under 150 lines would give LLMs the complete API surface in minimal tokens.

**What to include:**

- `ComponentDef<S, M, E>`, `Send<M>`, `AppHandle`
- All structural primitives: `each`, `branch`, `show`, `portal`, `foreign`, `child`, `memo`, `onMount`, `errorBoundary`
- `text()` and a representative subset of element helpers
- Effect types from `@llui/effects`: `handleEffects`, `http`, `cancel`, `debounce`, `sequence`, `race`
- `testComponent`, `assertEffects`, `testView` from `@llui/test`

**Design consideration:** This file should be auto-generated from the actual source types to prevent drift. A build step that extracts and simplifies the public API surface would ensure it stays accurate.

---

## Proposal 3: Implement the `@llui/lint-idiomatic` AST Visitor

**Status:** Fully specified in `07 LLM Friendliness.md` §11, not implemented.
**Impact:** High — provides automated feedback for the errors LLMs make most often.

The six anti-patterns to detect are already specified:

1. **State mutation in `update()`** — `state.field = value` or `state.field.push(...)`
2. **Missing `memo()`** — same accessor arrow function passed to 2+ binding sites
3. **`each()` closure violation** — parent-scope variable used instead of scoped accessor `item(t => t.field)`
4. **`.map()` on state arrays** — in `view()` body instead of `each()`
5. **Unnecessary `child()`** — fewer than 10 state paths and no `receives`
6. **Form boilerplate** — N message types for N form fields instead of `setField`

**Implementation approach:**

- TypeScript AST visitor using `ts-morph` or the raw TS Compiler API (already used by the Vite plugin)
- Runnable as both a standalone lint tool and as part of the evaluation pipeline
- Each violation produces a structured diagnostic with file, line, rule ID, and suggested fix
- Numeric score: base 6, minus 1 per violation category

**Why it matters:** An LLM in a tool-use loop (Claude Code, Cursor, etc.) can run this after generating code and self-correct. Without it, idiomatic violations are invisible — the code compiles and runs, but performs poorly or uses wrong patterns.

---

## Proposal 4: Build the Canonical Evaluation Pipeline

**Status:** Fully specified in `07 LLM Friendliness.md` §5-7, not implemented as runnable code.
**Impact:** High — without measurement, improvements are guesswork.

The 15-task canonical evaluation set is specified (counter through WebSocket real-time), with clear metrics (compile rate, render rate, full pass rate, assertion score, console clean, idiomatic score). What's missing is the automation.

**What to build:**

- A runner script that takes a model, system prompt variant, and task ID
- Calls the LLM API with the system prompt + task description
- Writes the output to a `.ts` file
- Runs `tsc --noEmit` (compile gate)
- Runs `@llui/test` assertions (per-task test files)
- Runs `@llui/lint-idiomatic` (idiomatic score)
- Outputs a JSON scorecard
- N=5 repetition support with variance detection

**Why it matters:** Every other proposal's value is measured by its effect on these scores. Building this first (or in parallel with proposals 1-3) creates a feedback loop for all subsequent improvements.

---

## Proposal 5: Reduce the `each()` Scoped Accessor Cognitive Load

**Status:** Current API works but has residual LLM confusion patterns.
**Impact:** Medium — `each()` is involved in ~60% of non-trivial components.

The scoped accessor `item(t => t.field)` is a significant improvement over the previous closure approach, but two patterns still trip up LLMs:

### 5a: The double-call pattern for imperative reads

```typescript
// Current — confusing double parens:
button({ onClick: () => send({ type: 'remove', id: item((t) => t.id)() }) })
```

The `item(selector)` returns a `Binding<R>`, but inside event handlers the LLM needs the current value, requiring `item(selector)()`. This double-invocation is unintuitive.

**Proposal:** Add a `peek` helper or allow `item.get(selector)` for imperative (non-reactive) reads inside event handlers:

```typescript
// Option A: peek() function
button({ onClick: () => send({ type: 'remove', id: peek(item, (t) => t.id) }) })

// Option B: item.get() method
button({ onClick: () => send({ type: 'remove', id: item.get((t) => t.id) }) })
```

### 5b: Strengthen the type to prevent bare `item()` calls

The current type `<R>(sel: (t: T) => R) => Binding<R>` correctly prevents `item.text` but doesn't prevent `item()` (calling with no arguments). Adding a required parameter makes this a compile error:

```typescript
// Ensure TypeScript errors on item() with no args
type ScopedAccessor<T> = <R>(sel: (t: T) => R) => Binding<R>
// Already the case — item() with no args is a TS error since sel is required
// Verify this is enforced and produces a clear error message
```

---

## Proposal 6: Improve Compiler Diagnostics for LLM Feedback Loops

**Status:** Compiler has good diagnostics but missing key cases.
**Impact:** Medium — better error messages directly improve LLM self-correction.

### 6a: Report compilation bail-outs

When `tryTransformElementCall()` bails out (non-literal props, complex expressions), it silently falls back to unoptimized code. Add a diagnostic:

```
Warning: Could not compile div() at line 42 — non-literal props object.
  Compile-time optimizations skipped. Consider using an object literal.
```

### 6b: Report unresolved state paths

When a reactive accessor reads state but the path can't be resolved for mask computation, the compiler silently uses `FULL_MASK`. This means every state change re-evaluates that binding. Add:

```
Warning: Accessor at line 15 reads state but path could not be resolved.
  Using full mask (updates on every state change). Consider simplifying the accessor.
```

### 6c: Warn on 32+ state fields approaching the bitmask limit

The bitmask is a single 31-bit word; components with more paths overflow to FULL_MASK. A warning near the boundary helps authors preempt the overflow:

```
Warning: Component 'Dashboard' has 28 unique state access paths.
  Consider decomposing into child components to keep below the 31-path limit.
```

---

## Proposal 7: Add a `setFields` Pattern to the Core Types

**Status:** Mentioned in the idiomatic rules but not provided as a utility.
**Impact:** Medium — forms are one of the most common LLM generation tasks.

LLMs frequently generate one message type per form field (`SetName`, `SetEmail`, `SetPhone`). The system prompt tells them to use `setField`, but there's no framework-level support.

**Proposal:** Provide a type utility in `@llui/dom`:

```typescript
// Type utility for form field messages
type FieldMsg<Fields extends Record<string, unknown>> = {
  type: 'setField'
  field: keyof Fields
  value: Fields[keyof Fields]
}

// Or more precisely with correlated types:
type FieldMsg<Fields extends Record<string, unknown>> = {
  [K in keyof Fields]: { type: 'setField'; field: K; value: Fields[K] }
}[keyof Fields]
```

And a helper for the update function:

```typescript
function applyField<S, F extends keyof S>(state: S, field: F, value: S[F]): S {
  return { ...state, [field]: value }
}
```

This gives LLMs a concrete import to reach for rather than reinventing the pattern each time.

---

## Proposal 8: Enrich the Scored Example Library

**Status:** Only `counter` and `todomvc` examples exist.
**Impact:** Medium — few-shot examples measurably improve generation quality for complex tasks.

**What to build:**

- LLM-generated solutions for all 15 canonical tasks that pass compilation + all assertions + idiomatic score = 1
- Organized by tier with metadata (task ID, model used, system prompt version, scores)
- Located at `examples/evaluation/` or similar
- Usable as few-shot examples in system prompts for related task types

**Priority examples to create first:**

- Tier 3: Async fetch with loading/error/retry (demonstrates `handleEffects`, `http`, `cancel`)
- Tier 4: Reorderable list (demonstrates `each()` with keyed reconciliation and DOM identity)
- Tier 5: Parent-child Level 1 and Level 2 (demonstrates both composition patterns)

---

## Proposal 9: Implement `whyDidUpdate` and `searchState` in DevTools

**Status:** Specified in `07 LLM Friendliness.md` §10, not in current `devtools.ts`.
**Impact:** Medium — enables precise debugging queries from LLM agents.

The current `devtools.ts` implements `getState`, `send`, `flush`, `evalUpdate`, `exportTrace`, `getMessageHistory`, and `clearLog`. Two high-value methods from the spec are missing:

### `whyDidUpdate(bindingId)`

Returns which mask bits were dirty, what the accessor returned, what the previous value was. This answers "why did this text change?" at the framework level without DOM diffing.

**Implementation:** Extend `Binding` with an `id` field (or use index), store dirty mask at time of last evaluation, and expose via the debug API.

### `searchState(query)`

JSONPath query against current state. For large state trees, `searchState('$.cart.items[*].price')` returns just the prices instead of the entire state.

**Implementation:** Integrate a lightweight JSONPath library (e.g., `jsonpath-plus`, ~3KB) behind the dev-mode gate.

---

## Proposal 10: Improve the `child()` Props Footgun

**Status:** Known LLM error pattern documented in §3.4.
**Impact:** Medium — prevents the most common Level 2 composition mistake.

The most frequent LLM error with `child()` is passing `props` as a static object instead of a reactive accessor:

```typescript
// WRONG — captured at mount, never updates:
child({ def: Counter, key: 'c', props: { initial: state.base }, onMsg: ... })

// CORRECT:
child({ def: Counter, key: 'c', props: s => ({ initial: s.base }), onMsg: ... })
```

TypeScript doesn't catch this because both forms satisfy the type.

**Proposal options:**

**Option A: Type-level enforcement.** Make `props` only accept functions, not plain objects:

```typescript
interface ChildOptions<S, ...> {
  props: (state: S) => Record<string, unknown>  // function required, not union with object
}
```

This would be a breaking change if anyone passes static props intentionally, but static props in `child()` are always a bug (if props never change, they should be passed via `init`).

**Option B: Runtime dev warning.** In dev mode, check if `typeof props !== 'function'` and emit a warning.

**Option C: Compiler diagnostic.** The Vite plugin already analyzes `child()` calls — add a check for non-function `props`.

Recommend Option A (type-level) combined with Option C (compiler diagnostic for extra clarity).

---

## Implementation Priority

| Priority | Proposal                   | Effort | Impact                              |
| -------- | -------------------------- | ------ | ----------------------------------- |
| 1        | P4: Evaluation pipeline    | Medium | Enables measuring everything else   |
| 2        | P2: `.d.ts` reference file | Small  | Immediate system prompt improvement |
| 3        | P3: Lint-idiomatic         | Medium | Automated feedback for LLM loops    |
| 4        | P1: `@llui/mcp` server     | Medium | Category shift in LLM debugging     |
| 5        | P6: Compiler diagnostics   | Small  | Better self-correction signals      |
| 6        | P10: `child()` props fix   | Small  | Eliminates a common silent bug      |
| 7        | P5: `each()` peek helper   | Small  | Reduces double-call confusion       |
| 8        | P7: `setFields` utility    | Small  | Standardizes form patterns          |
| 9        | P8: Scored examples        | Medium | Few-shot quality boost              |
| 10       | P9: DevTools enrichment    | Medium | Deeper debugging capability         |

The recommended order is: **P4 → P2 → P3 → P1**, then the rest in any order. P4 (evaluation pipeline) comes first because it creates the measurement infrastructure that validates whether every other change actually improves LLM generation quality.
