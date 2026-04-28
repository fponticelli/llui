# 11. Agent Annotations and Tools

Reference for the annotation grammar and tool surface that LLui exposes to LLM agents. Where doc 07 covers the design philosophy of LLM-friendliness and doc 10 covers the LAP wire protocol, this doc is the operational reference: what tags can a developer write, what tools can an agent call, and what each layer guarantees.

The terminology used throughout:

- **Variant** — one member of a Msg discriminated union, identified by its `type` literal.
- **Affordance** — a Msg variant the agent is allowed to dispatch right now, surfaced via `list_actions` (or its parent, `observe`).
- **Annotation** — a JSDoc tag on a variant or component definition that the compiler extracts and the agent reads.
- **Translator** — an app-defined `(libMsg) => dispatch({type:'AppMsg', ...})` function, typically passed to a library `*.connect`.

---

## 1. Annotation Grammar

LLui's compiler extracts JSDoc annotations from the Msg union members at build time. Authored annotations flow through to the runtime via `__msgAnnotations` on the component definition, surfacing in `list_actions` results and `describe_app.messages`.

### 1.1 Per-variant tags (Msg union members)

#### `@intent("text")`

Required for every variant the LLM can dispatch. Surfaced as the variant's `intent` field in `list_actions`. One short sentence that completes "this dispatch causes…":

```ts
type Msg =
  /** @intent("Save the matrix to the cloud") */
  { type: 'Cloud/Save' }
```

When absent, `intent` defaults to the bare variant string. The `agent-missing-intent` ESLint rule warns on un-annotated variants. Variants tagged `@humanOnly` are exempt.

#### `@warning("text")`

Non-blocking caution surfaced verbatim to the LLM. Distinct from `@requiresConfirm`, which is a runtime user-confirmation gate. `@warning` is informational — it tells the agent why the action is risky so it can decide whether to dispatch:

```ts
| /**
   * @intent("Save and overwrite the cloud version")
   * @warning("Overwrites any concurrent edits from other clients without merging.")
   */
  { type: 'Cloud/Save' }
```

Use for: irreversible operations, side effects that fire analytics, anything where the LLM should weigh consequences. The `agent-warning-on-confirm` rule warns when `@requiresConfirm` is set without `@warning` — confirm-gated dispatches without a stated reason are a documentation gap.

#### `@example("text")`

Concrete example dispatch the LLM can copy from. Multiple `@example` tags are allowed and collect in source order:

```ts
| /**
   * @intent("Set a cell value")
   * @example("typical: dispatch from inline cell editor")
   * @example("bulk: prefer Matrix/SetManyCells when setting >5 cells")
   */
  { type: 'Matrix/SetCellValue'; criterionId: string; value: number }
```

`@example` answers "when do I use it / how is it shaped in practice", complementing `@intent`'s "what does it do." The `agent-example-on-payload` rule warns when a payload-bearing variant has `@intent` but no `@example`.

#### `@emits("kind1", "kind2")`

Authored declaration of side effects this variant fires. Comma-separated list of effect kind strings, deduped:

```ts
| /**
   * @intent("Save and overwrite the cloud version")
   * @emits("cloud/save", "analytics/track")
   */
  { type: 'Cloud/Save' }
```

The agent reads this to reason about side effects ("don't dispatch X 100 times — each one fires cloud/save") and risk ("delete fires telemetry that can't be undone"). Authored rather than auto-extracted from `update.ts` because real-world reducers emit effects through helpers (`track('foo')`, `saveDelta(d)`) — auto-detection would require helper-return-shape analysis with fragile failure modes.

Documented limitation: nothing currently verifies declared `@emits` against actual `update.ts` emissions. A future `@emits`-verification pass could close this gap.

#### `@requiresConfirm`

Marks the variant as needing runtime user confirmation before it dispatches. The agent flow becomes: agent calls `send_message` → response is `{status: 'pending-confirmation', confirmId}` → app renders a confirm dialog → user approves/rejects → agent polls `get_confirm_result` for the outcome.

Used for destructive or surprising operations (delete, sign-out, payment). Pair with `@warning` to explain why.

#### `@humanOnly` / `@agentOnly` / shared (default)

Mutually exclusive — controls which audience can dispatch the variant.

- **`@humanOnly`** — variant is filtered before reaching the LLM. Use for internal handoffs (`Auth/SignInSuccess`, `Cloud/SaveDone`) and operations that require physical presence (sign-out).
- **`@agentOnly`** — variant has no UI binding; agent is the sole dispatcher. Surfaced as `source: 'schema'` in `list_actions` with a synthesized `payloadHint`. Used for bulk-edit operations the human uses singular forms for in the UI.
- **(default, shared)** — both audiences can dispatch. Most variants.

The `agent-exclusive-annotations` rule errors on the malformed `@humanOnly @agentOnly` combination.

#### `@alwaysAffordable`

Marks the variant as always available regardless of UI binding state. Surfaced as `source: 'always-affordable'` in `list_actions` (alongside the app's `agentAffordances(state)` registry). The per-variant equivalent of `agentAffordances`: tag bulk seed ops (`Matrix/AddAlternatives`), navigation Msgs, and other agent-driven paths that have no UI counterpart — or whose UI counterpart is gated behind navigation the agent shouldn't have to perform first.

**Why this matters as a default.** `'shared'` variants (the unannotated default) reach the agent through one path only: a live binding in the currently-rendered scope tree. When the user closes the cell editor, the cell-edit Msgs leave `list_actions`. When the user is on the home page, matrix-edit Msgs aren't listed. This mirrors what the human user can click — and crucially, dispatching a `'shared'` Msg whose UI is closed would mutate state that drives `show()`/`branch()` gates, popping hidden subtrees into view in places the user didn't navigate to. `@alwaysAffordable` is the explicit opt-in for "yes, the agent should see this regardless of where the user is looking."

### 1.2 Per-field tags (within a Msg variant payload)

#### `@should("text")`

Marks an optional field (TS `?:`) as one the LLM should fill in unless it has a specific reason not to. Borrows RFC 2119's "SHOULD" vocabulary, well-conditioned in LLM training. The hint is freeform consequence-shaped text:

```ts
| {
    type: 'Matrix/SetCellMeta'
    criterionId: string
    /**
     * @should("Cite the source — URL, doc title, or 'manual estimate'.
     *   Cells without provenance can't be defended later.")
     */
    source?: string
  }
```

The compiler emits `{type: 'string', optional: true, priority: 'should', hint: '…'}` for the field's schema entry. The synthesizer in `list_actions.payloadHint` includes `@should`-flagged optional fields in the generated example (regular optional fields are omitted to keep examples focused).

The hint TEXT should describe consequence ("cells without provenance can't be defended later") rather than function ("the source URL"). Consequence drives whether the LLM bothers to fill it in.

### 1.3 Component-level annotations (on the component definition)

#### `agentDocs.purpose` / `.overview` / `.cautions` / `.examples`

Static app-level docs surfaced in `describe_app.docs`:

```ts
const App = component<State, Msg, Effect>({
  /* … */
})

App.agentDocs = {
  purpose: 'Decision matrix tool for scoring and ranking alternatives.',
  overview: 'Users create criteria (rows) and alternatives (columns)…',
  cautions: ['Deleting a matrix is permanent and requires user confirmation.'],
  examples: [
    'To delete a saved matrix: dispatch Confirm/Ask first, then on approve dispatch Cloud/Delete.',
    'Bulk-loading: use Matrix/AddCriteria then Matrix/AddAlternatives, save with Cloud/Save.',
  ],
}
```

The `examples` field captures multi-step idioms that don't fit on a single Msg variant.

#### `agentAffordances(state) => Msg[]`

Returns the variants the agent can dispatch right now, regardless of UI binding state. Use for navigation actions, search commands, and other affordances that don't have a specific clickable trigger:

```ts
App.agentAffordances = (state) => [
  { type: 'Router/Navigate', route: { kind: 'page', slug: 'reports' } },
  // … etc
]
```

Each entry is surfaced as `source: 'always-affordable'` with the entry's non-`type` fields used as a `payloadHint`.

#### `agentContext(state) => AgentContext`

Returns dynamic per-state docs. The `summary` is required; `hints` and `cautions` are optional arrays:

```ts
App.agentContext = (s) => ({
  summary: `Matrix "${s.title}" — ${count(s.criteria)} criteria, ${count(s.alternatives)} alternatives.`,
  hints:
    s.matrixState.kind === 'idle'
      ? ['Matrix is empty. Dispatch Cloud/NewMatrix to start a fresh editable matrix.']
      : [],
})
```

Use `hints` for state-derived recovery advice — when state is in a particular shape and the agent needs nudge text. Use `cautions` for transient warnings ("you have unsaved changes; saving now will overwrite the cloud copy").

---

## 2. Compiler Passes

### 2.1 `tagDispatchHandlers` (universal)

Walks every arrow / function expression in the source and wraps any whose body contains literal `<id>({type:'X', …})` dispatches with `Object.assign(arrow, {__lluiVariants: ['X', …]})`. The runtime reads `__lluiVariants` from event-handler bindings only — tags placed on functions in non-handler positions are runtime-inert.

Three patterns covered:

1. **Inline event-handler arrows** — `onClick: () => send({type: 'X'})`.
2. **Const-bound translator functions** — `const sendMenu = (m) => dispatch({type: 'Y'})`. The tag travels with the function reference; library `*.connect` impls propagate it via `tagSend`.
3. **Positional-arg helpers** — `navButton(label, () => send({type: 'Z'}))`. The arrow gets tagged at its declaration; when the helper binds it as an event handler, the runtime reads the tag.

Filter: only callees whose name matches `/^(send|dispatch)/i` are treated as dispatchers. This avoids false-tagging element helpers like `button({type: 'button'})`. Apps using non-conventional dispatcher names need to use the runtime `tagSend` / `tagVariants` helpers explicitly.

### 2.2 `injectScopeVariantRegistrations`

Detects `*.connect(get, sendFn, …)` patterns inside function bodies and inserts a runtime `__registerScopeVariants([…])` call adjacent. Variants come from the sendFn's body (which is a translator). Module-scope skipped because eager registration would no-op outside a render context.

### 2.3 `extractMsgSchema` + `extractMsgAnnotations`

Walk the Msg union type alias and produce:

- **`MsgSchema`** — per-variant field shape, used for synthesis (`payloadHint`) and validation (`send_message` / `would_dispatch` schema check).
- **`Record<variant, MessageAnnotations>`** — the JSDoc tags surfaced above.

Both are injected as `__msgSchema` and `__msgAnnotations` on the component definition. The cross-file resolver follows imports when the Msg type lives in a separate file from the `component()` call.

**Field-type coverage:**

| TypeScript shape                                | Schema emit                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `string` / `number` / `boolean`                 | bare keyword                                                            |
| `'a' \| 'b'` (string literals)                  | `{enum: ['a', 'b']}`                                                    |
| `1 \| 2 \| 3` (number literals)                 | `{enum: [1, 2, 3]}`                                                     |
| `true` / `false` / `true \| false`              | `{enum: [...]}` with native booleans                                    |
| `T[]`, `readonly T[]`, `Array<T>`               | `{kind: 'array', element: T-resolved}`                                  |
| inline `{a: number, b: string}`                 | `{kind: 'object', shape}`                                               |
| named interface / type alias                    | followed via local TypeIndex; same shape as inline                      |
| `{kind: 'a'} \| {kind: 'b', x: number}`         | `{kind: 'discriminated-union', discriminant: 'kind', variants: {a, b}}` |
| anything unresolved (cross-file, generic, etc.) | `'unknown'` — validator accepts; synthesizer emits `null` placeholder   |

Discriminated-union detection requires every member to share one literal-string property name with distinct values. Mixed-type unions (`'a' \| 1`) and unions of primitive + object stay `'unknown'` rather than emitting a partially-valid descriptor. Nested resolution is bounded by `MAX_FIELD_DEPTH = 5` — each recurse subtracts one, mutually-recursive types terminate at `'unknown'`.

### 2.3a Schema-driven validation

Both `would_dispatch` and `send_message` walk the same `MsgSchema` against incoming payloads before the reducer runs. Mismatches surface as structured errors with path-keyed details:

```ts
{ path: 'format(kind=range).max', code: 'missing', message: 'required field is missing' }
{ path: 'value', code: 'not-in-enum', message: "'6' is not in the enum. Legal values: 1, 2, 3, 4, 5." }
{ path: 'format.kind', code: 'unknown-discriminant-value', message: "'logarithmic' is not a legal 'kind'. Legal values: 'exact', 'range', 'compound'." }
```

The path uses dot-bracket notation rooted at the payload (excluding `type`). Discriminated-union branches carry a `(discriminant=value)` segment so the LLM can see which branch the error applies to. `'unknown'` schema fields are accepted permissively — the validator catches mistakes the schema can describe; deeper checks are the reducer's job.

### 2.4 `tagSend(send, libVariants, fn)` runtime helper

Exported from `@llui/dom`. Library `connect` implementations call this on returned event handlers:

```ts
return {
  trigger: {
    onClick: tagSend(send, ['open'], () => send({ type: 'open' })),
  },
}
```

`tagSend` resolves variants in priority order:

1. If `send.__lluiVariants` is set (translator pattern), use those.
2. Otherwise, use `libVariants`.

Result is mutated in place (`Object.assign(fn, {__lluiVariants})`); the returned reference is identical to `fn`.

---

## 3. Agent Tool Surface

The MCP bridge exposes these tools to the LLM. All except `connect_session` / `disconnect_session` operate against the currently-bound app session.

### 3.1 Read tools

#### `observe()`

Returns `{state, actions, description, context}` — the full snapshot. Default starting point: the LLM calls this once per turn to know "what can I see, what can I do."

#### `get_state(path?)`

Returns the app state, optionally narrowed via JSON-Pointer path (RFC 6901). Legacy compared to `query_state`; kept for back-compat.

#### `query_state(path)`

Surgical state read by JSON-Pointer:

```
""              → whole state
"/auth/user"    → state.auth.user
"/items/0/id"   → state.items[0].id
"/key~1slash"   → state['key/slash']  (escaped /)
"/key~0tilde"   → state['key~tilde']  (escaped ~)
```

Returns `{found: true, value}` on hit or `{found: false, detail: '…'}` on miss. Soft-miss is intentional — distinguishes "field is null" (`found: true, value: null`) from "field doesn't exist" (`found: false`).

#### `list_actions()`

Returns just the affordances slice of `observe()`. Each entry:

```ts
{
  variant: string                                          // discriminator
  intent: string                                           // from @intent
  requiresConfirm: boolean                                 // from @requiresConfirm
  dispatchMode: 'shared' | 'agent-only'                    // human-only filtered
  source: 'binding' | 'always-affordable' | 'schema'       // where it came from
  selectorHint: string | null                              // CSS selector if known
  payloadHint: object | null                               // synthesized example
  warning: string | null                                   // from @warning
  examples: string[]                                       // from @example tags
  emits: string[]                                          // from @emits
}
```

#### `describe_app()`

Returns the static app description: name, version, schemas, docs. Equivalent to `observe().description`.

#### `describe_context()`

Returns the dynamic context (from `agentContext(state)`): summary, hints, cautions. Equivalent to `observe().context`.

#### `query_dom(name, multiple?)`

Read elements tagged with `data-agent="<name>"`. Returns `{elements: [{text, attrs, path}]}` so the agent can introspect specific UI subtrees.

#### `describe_visible_content()`

Structured outline of all `data-agent`-tagged subtrees. Skeleton view of the rendered UI.

#### `describe_recent_actions(n?, kind?)`

Newest-first list of recent log entries for this session. Each `kind: 'dispatched'` entry includes a `stateDiff` showing what changed. Use to introspect own activity history without re-querying full state.

```ts
{ entries: [
  { id, at, kind: 'dispatched', variant: 'Cloud/Save', intent: '…',
    stateDiff: [{op: 'replace', path: '/isDirty', value: false}] },
  { id, at, kind: 'read', intent: 'observe' },
  …
]}
```

#### `would_dispatch({msg})`

Predict the result of dispatching `msg` without committing. Runs the reducer in isolation against current state and returns:

```ts
{
  status: 'predicted'
  stateDiff: JsonPatch[]   // would-be diff
  effects: object[]         // would-fire effects (NOT executed)
}
```

Pure-reducer assumption: TEA mandates `update` is pure. Apps with impure reducers (`Date.now()` / `localStorage` / `Math.random()`) see prediction drift from real dispatch by exactly that impurity.

### 3.2 Mutating tools

#### `send_message({msg, reason?, waitFor?, drainQuietMs?, timeoutMs?})`

Dispatch a message. Validates against the schema before dispatch; rejects malformed payloads with structured detail. Returns one of:

- `{status: 'dispatched', stateAfter, stateDiff, actions, drain}` — happy path. `stateDiff` is JSON-Patch shaped from pre to post-drain.
- `{status: 'pending-confirmation', confirmId}` — variant is `@requiresConfirm`. Poll `get_confirm_result` for the outcome.
- `{status: 'rejected', reason, detail?}` — `'invalid'`, `'human-only'`, or `'unsupported'`. The `detail` explains the specific issue (missing required field, type mismatch, enum miss).

`waitFor: 'drained'` (default) blocks until the message queue goes idle for `drainQuietMs` (default 100ms) or up to `timeoutMs` (default 5000ms). `'idle'` flushes once and yields a microtask. `'none'` is fire-and-forget.

#### `get_confirm_result({confirmId, timeoutMs?})`

Long-poll the result of a `@requiresConfirm`-gated dispatch. Returns `{status: 'confirmed', stateAfter}`, `{status: 'rejected', reason}`, or `{status: 'still-pending'}` after the timeout.

### 3.3 Session tools

#### `connect_session({url, token})`

Bind the conversation to a specific app via the URL + token from the app's connect snippet. Call once per chat. Returns the same shape as `observe()` so the first turn doesn't need a separate read.

#### `disconnect_session()`

Unbind. Subsequent tool calls fail until a fresh `connect_session`.

### 3.4 Wait

#### `wait_for_change({path?, timeoutMs?})`

Long-poll for a change at the given path (or anywhere if absent). Returns `{status: 'changed', stateAfter}` or `{status: 'timeout', stateAfter}`. Used when the agent needs to wait for an effect to complete (cloud save resolution, async data load).

---

## 4. Source Tier — `list_actions[*].source`

Every affordance entry carries a `source` discriminator explaining where it came from:

- **`'binding'`** — a tagged event handler is currently mounted in a live scope (refcount > 0). Variants inside dead branches — `show({when: false})`, unmounted `branch()` cases, removed `each` items — auto-vanish from this set as their lifetimes dispose. This is the framework's "what can the user click right now" answer, and it's the default surface for the agent.
- **`'always-affordable'`** — either the app's `agentAffordances(state)` hook listed the variant, or the variant carries the `@alwaysAffordable` JSDoc tag. Both are the explicit "agent can reach this even when no live UI binding maps to it" knob.
- **`'schema'`** — variant is annotated `@agentOnly` (the canonical "no UI button maps to this; the agent is the only dispatcher") and isn't already covered above. The `payloadHint` is schema-synthesized.

**`'shared'` variants without a binding, without `agentAffordances` mention, and without `@alwaysAffordable` are deliberately hidden.** They're reachable through UI navigation but not affordable from the current screen — the human user can't click them, and the agent shouldn't either, because dispatching them would flip hidden state and pop UI in places the user didn't navigate to. (Older versions of this doc described surfacing all `@intent`-tagged variants from schema; that default was wrong-by-default for non-trivial apps and was changed.)

---

## 5. ESLint Rules

The `@llui/eslint-plugin`'s `recommended` config gates Msg-annotation completeness:

- **`agent-missing-intent`** (`error`) — variants without `@intent` (or `@humanOnly`).
- **`agent-exclusive-annotations`** (`error`) — `@humanOnly` and `@agentOnly` together.
- **`agent-nonextractable-handler`** (`error`) — event handler whose body the compiler can't extract a literal `send({type:'X'})` from.
- **`agent-msg-resolvable`** (`error`) — the Msg union must be statically resolvable for schema extraction.
- **`agent-warning-on-confirm`** (`warn`) — `@requiresConfirm` without `@warning`.
- **`agent-example-on-payload`** (`warn`) — payload-bearing variant without `@example`.

The first four are LAP-correctness gates: missing them breaks what the agent sees over the wire. The last two are completeness nudges: missing them hides context from the LLM but doesn't break dispatch.

The standalone `agent` config preset includes the same rules without the rest of `recommended`, useful when an app ships `@llui/agent` without adopting the full LLui linting baseline.

---

## 6. Wire Format Cheat Sheet

The full schema entry the agent sees in `describe_app.messages[variant]`:

```ts
{
  payloadSchema: {
    discriminant: 'type',
    variants: {
      [variant]: {
        [field]: MsgField  // see below
      }
    }
  }
  annotations: {
    intent: string | null
    alwaysAffordable: boolean
    requiresConfirm: boolean
    dispatchMode: 'shared' | 'human-only' | 'agent-only'
    examples: string[]
    warning: string | null
    emits: string[]
  }
}
```

Where `MsgField` is one of:

```ts
type MsgField =
  // bare primitive
  | 'string'
  | 'number'
  | 'boolean'
  | 'unknown'
  // bare enum (string-literal union)
  | { enum: string[] }
  // bare nested object (followed type alias / inline literal)
  | { kind: 'object'; shape: Record<string, MsgField> }
  // bare array
  | { kind: 'array'; element: MsgField }
  // rich descriptor (only when there's something extra to say)
  | {
      type: BareType
      optional?: boolean
      priority?: 'should'
      hint?: string
    }
```

Bare forms are emitted for fields with no JSDoc and no optionality — keeps the schema compact for the typical case.

---

## 7. Open Questions / Future Work

**Cross-file deep type extraction.** The schema extractor follows local interfaces / type aliases for nested shapes (depth-bounded at 3) but doesn't cross module boundaries. Apps with payload types defined in a separate package see those fields as `'unknown'`. Expanding the cross-file resolver to chase nested type references would close this — at the cost of broader compile-time cost.

**`@emits` runtime verification.** Authors declare effects; the compiler doesn't verify they match `update.ts`. A static analyzer that walks reducer cases and reports drift would catch annotation rot. Out of scope for v1 because effect emissions through helpers (`track('foo')`) require resolving helper return shapes — non-trivial without typed lint.

**Per-confirm-result state diff.** `get_confirm_result` returns `stateAfter` after a confirmed dispatch but doesn't carry a `stateDiff`. The dispatch is mediated by the user's approval, so timing is ambiguous (effects may still be in flight when the approval lands). The current contract: agents poll `observe` after a confirmed dispatch to pick up a drained view.

**Effect schema introspection beyond `@emits`.** A future compiler pass could auto-extract effect kinds from `update.ts` cases, with helper-return-shape resolution for the common `track(name)` / `dispatch(action)` patterns. Would augment `@emits` rather than replace it (authored declarations still win for app-specific helpers).
