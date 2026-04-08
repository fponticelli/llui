# LLui Vite Plugin Compiler

The LLui Vite plugin is a compile-time transformation that converts high-level component authoring syntax into a lower-level representation optimised for surgical DOM updates. It runs inside Vite's `transform()` hook, operates on `.ts` and `.tsx` files that import from `'@llui/dom'`, and produces output that is semantically identical but structurally pre-classified for the runtime update loop.

This document describes the technology choice, the three compiler passes and their ordering rationale, what genuinely benefits from compile-time analysis, what should not be attempted, common patterns that appear valuable but are not, and directions worth exploring.

---

## Recommended Technology Stack

**Use the TypeScript Compiler API exclusively.** The recommendation is to stay on `ts.createSourceFile` / `ts.transform` / `ts.factory` for all AST work and not migrate to Babel, SWC, or any custom parser.

### Why not Babel

Babel's TypeScript support is a best-effort syntax strip. It does not typecheck; it does not expose `ts.TypeChecker`; and its plugin API operates on a different AST shape (Babel AST vs TypeScript AST) that requires maintaining two mental models if the surrounding codebase is otherwise pure TypeScript. More concretely: Babel cannot answer questions like "what is the declared type of `s.count`?" — a capability this compiler will need as it matures (see Open Questions). Babel is also slower to adopt new TypeScript syntax; users writing TypeScript 5.x features (const type parameters, `using` declarations, variadic tuple improvements) will hit transform failures before Babel catches up.

### Why not SWC

SWC is a syntax transformer. It has no type information in its transform pass and no stable public Rust API for writing custom transforms from JavaScript/TypeScript. The only entry point for custom logic is the experimental `@swc/plugin-transform-visit` WASM interface, which is immature, has no access to type information, and requires compiling Rust. SWC is excellent for production minification but the wrong tool for semantic analysis.

### Why not a custom parser

A custom parser would need to handle: type annotations, generics, decorators, template literal types, satisfies expressions, and every subsequent TypeScript syntax addition. This is an ongoing maintenance commitment with no upside. The TypeScript Compiler API handles all of this for free.

### Why the TypeScript Compiler API

- **Accurate AST.** `ts.createSourceFile` produces the canonical TypeScript AST. Every node kind, every edge case in the language grammar is handled correctly.
- **Stability.** The AST node kinds and factory API have been stable since TypeScript 4.0. `ts.factory` replaced the older mutating API and is the correct modern entry point.
- **Type information is available.** A `ts.Program` and `ts.TypeChecker` can be constructed from the same source. The current compiler does not use it, but it is one function call away. This matters for future passes (see Open Questions).
- **`ts.transform` and `ts.NodeFactory` are ergonomic.** The visitor pattern used by `ts.transform` is well-understood, and `ts.factory.update*` methods preserve source positions for source map generation.
- **Same language.** The plugin is TypeScript itself. Debugging, profiling, and extending it requires no context switch.

The practical cost of the TypeScript Compiler API is verbosity — constructing a call expression with four arguments takes about fifteen lines of factory calls. This is a reasonable trade-off. The alternative costs are higher.

### Vite Integration

The plugin registers with `enforce: 'pre'` so it runs before Vite's own TypeScript stripping. This is required: if Vite strips types first, the AST the compiler sees has already lost structural information. By running pre, the compiler receives raw TypeScript source and can use `ts.createSourceFile` with `ts.ScriptKind.TS` (or `ts.ScriptKind.TSX` for `.tsx` files).

The `transform()` hook is invoked per file, on demand, as the module graph is resolved. This is the correct granularity: each file is independent. Vite handles HMR invalidation and module caching; the compiler does not need to track which files have been seen.

---

## The Three Passes

The compiler performs three logically distinct passes over each source file. They run in a specific order because each pass produces information that the next depends on.

> **Execution order:** Despite the numbering, the actual execution order is: (1) Pass 2 pre-scan runs first to build the `fieldBits` map, (2) Pass 1 transformation + Pass 2 mask injection run together in a single AST visitor, (3) Pass 3 import cleanup runs last. The passes are numbered by conceptual concern, not by execution sequence.

### Pass 1: Static/Dynamic Prop Split

**Input:**

```typescript
div({ class: 'foo', title: s => s.title, onClick: handler }, [...])
```

**Output:**

```typescript
elSplit(
  'div',
  __e => { __e.className = String('foo' ?? ''); },
  [['click', handler]],
  [[1, 'attr', 'title', s => s.title]],
  [...]
)
```

Pass 1 classifies every property in a literal props object into one of three categories:

1. **Static** — the value is not an arrow function or function expression. It is applied once at mount via a generated `staticFn(elem)`. The DOM mutation is inlined directly: `elem.className = ...`, `elem.setAttribute(key, ...)`, `elem.style.setProperty(...)`, or `elem[key] = ...` depending on the prop kind. This runs once and is then garbage-collected along with the closure.

2. **Event handler** — the key matches `/^on[A-Z]/`. The event name is extracted by lowercasing after `on` (e.g. `onClick` → `'click'`). The handler is emitted into an events array as `[eventName, handler]`. `elSplit` wires these via `addEventListener` at mount, registering a disposer on the current scope so they are properly removed when the component is destroyed.

3. **Reactive binding** — the value is an arrow function or function expression, and the key is not an event key. The prop is emitted as a `[mask, kind, key, accessor]` tuple in the bindings array. The mask comes from Pass 2 and is initially unknown at this stage — which is why Pass 2 must be a pre-scan.

**Classification of binding kind:**

| Key pattern                                                                                                                                       | Kind      | DOM mutation in runtime                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------- |
| `class` or `className`                                                                                                                            | `'class'` | `elem.className = value`                            |
| `style.X`                                                                                                                                         | `'style'` | `elem.style.setProperty('X', value)`                |
| `value`, `checked`, `selected`, `disabled`, `readOnly`, `multiple`, `indeterminate`, `defaultValue`, `defaultChecked`, `innerHTML`, `textContent` | `'prop'`  | `elem[key] = value`                                 |
| anything else                                                                                                                                     | `'attr'`  | `elem.setAttribute(key, value)` / `removeAttribute` |

The `key` in the tuple for `style.X` is stripped to just `X` (the CSS property name), since that is what `style.setProperty` expects.

**Bail-out conditions.** Pass 1 only transforms literal `ObjectLiteralExpression` as the first argument. Any of the following causes the helper call to be left unchanged:

- The first argument is an identifier, a variable, a spread (`...props`), or a computed property.
- Any property in the object is not a `PropertyAssignment` or `ShorthandPropertyAssignment`.
- The property key is not a static identifier or string literal (e.g., `[Symbol.iterator]`).

This conservative stance avoids semantic breakage. A prop object in a variable might be mutated elsewhere; the compiler cannot know. Spreads merge unknown properties. Computed keys could alias static keys in unknown ways. The cost of not transforming these cases is that those call sites run through the uncompiled `div()` / `span()` path, which is functionally correct but unoptimised.

### Pass 2: Dependency Analysis and Mask Injection

Pass 2 computes a bitmask for every reactive accessor in the file, injecting masks into the binding tuples and into `text()` calls, and synthesising a `__dirty` function into `component()` definitions.

**Pre-scan phase.** Before the main AST visitor runs, Pass 2 traverses the entire source file to collect all unique state **access paths** referenced by any reactive accessor. A reactive accessor is any arrow function or function expression that:

- Appears as a prop value that would be classified as a reactive binding (Pass 1 criterion).
- Appears as the first argument to `text()`.

The pre-scan extracts access paths through four recognition patterns, listed in order of specificity:

1. **Direct property access** — `param.field` or `param['field']` where `param` is the first parameter name. This is the most common pattern. Nested chains up to depth 2 are tracked: `param.user.name` produces the path `user.name`, distinct from `user.email`.

2. **Destructuring of the state parameter** — `const { count, title } = param` where `param` is the first parameter name. Each destructured name maps to a top-level path. Nested destructuring (`const { user: { name } } = param`) maps `name` to the path `user.name`.

3. **Single-assignment alias** — `const c = param.count` where the initializer is a `PropertyAccessExpression` on the first parameter, and the variable is declared with `const` (or is never reassigned within the accessor body). Subsequent uses of `c` within the accessor map to the path `count`. Chained aliases (`const n = param.user.name`) map to the path `user.name`.

4. **Element access with string literal** — `param['fieldName']` where the index is a string literal. This is handled as equivalent to `param.fieldName`.

Patterns that the pre-scan **does not follow**, and which trigger the conservative `0xFFFFFFFF` bail-out with a compiler diagnostic warning:

- Computed property access with a non-literal key: `param[variable]`, `param[expr()]`.
- Multi-hop aliases: `const u = param.user; const n = u.name` — the second assignment is not traced.
- Closure-captured variables from outside the accessor body.
- Access through a function call: `getUser(param).name`.
- Spread or rest patterns that obscure which fields are read.

When a bail-out occurs, the compiler emits a warning identifying the exact accessor (file, line, column), the unresolvable expression, and a suggested rewrite. For example: `"Cannot determine state dependency for expression 'u.name' in accessor at line 42. Consider using 'param.user.name' directly."` This ensures the developer always knows when and why mask precision is lost.

This gives the set of all access paths referenced anywhere in the file.

**Path bits map.** Each unique access path is assigned a power-of-two bit position, in the order first encountered. Paths are the deepest observed property chain, not just top-level fields:

```
user.name   → 0x0001 (bit 0)
user.email  → 0x0002 (bit 1)
user.avatar → 0x0004 (bit 2)
filter      → 0x0008 (bit 3)
todos       → 0x0010 (bit 4)
```

An accessor reading `s.user` as a whole object (not drilling into a sub-property) gets the **union** of all `user.*` bits — in this example, `0x0001 | 0x0002 | 0x0004 = 0x0007`. This is correct: a binding that consumes the entire `user` object depends on any sub-field change.

**Mask capacity and overflow.** The compiler uses a single `number` mask with graceful overflow:

- **≤31 paths**: each path gets one bit (positions 0–30). The Phase 2 check is one bitwise AND. Common case, fastest path.
- **32+ paths**: the first 31 paths still get individual bits; paths 32+ receive `FULL_MASK` (-1). Their bindings re-evaluate on every dirty cycle. The compiler emits a warning naming the top-level state fields sorted by path count, so authors know exactly which slice to extract. Example: `Component at line 120 has 45 unique state access paths (14 past the 31-path limit). Top-level fields by path count: form (18), user (12), ui (8), filter (7). Extract the largest fields into child components or slice handlers.`

The 31-path cap is a hard constraint of JavaScript's 32-bit signed integer bitwise operations (bit 31 is the sign bit). The overflow path is cheap (~1–4 microseconds per update at 40–80 paths), but components at that scale almost always benefit from decomposition on architectural grounds — clearer effect lifecycle, easier testing, independent state. The warning pushes authors to that structure before any runtime cost becomes a concern.

**Per-accessor mask computation.** For each reactive accessor, the compiler re-traverses its body to collect the specific paths it accesses, then ORs together their assigned bits. An accessor reading `s.user.name` and `s.filter` gets mask `0x0001 | 0x0008 = 0x0009`. An accessor reading `s.user` (the whole object) gets the union `0x0007`. An accessor that accesses no tracked paths (e.g., it reads a captured local variable `() => String(x)`) gets the conservative full mask `0xFFFFFFFF`, meaning it will be re-evaluated on every update regardless of which paths changed. A compiler diagnostic warning is emitted for every accessor that receives the conservative mask, identifying the specific expression that could not be resolved.

**Mask injection into binding tuples.** The mask is placed as the first element of the `[mask, kind, key, accessor]` tuple. The runtime update loop uses it as:

```typescript
if ((binding.mask & dirty) === 0) continue
```

Where `dirty` is the bitmask computed by `__dirty` comparing old and new state. If no bits overlap, the accessor cannot produce a new value, and the binding is skipped with a single bitwise AND — no function call, no DOM access.

**`text()` mask injection.** `text(s => s.count)` becomes `text(s => s.count, 1)`. The `text` function uses the mask to register a binding with the correct skip logic.

**`__dirty` injection.** For each `component()` call site where reactive bindings were found, the compiler synthesises and injects a `__dirty` property into the config object. The generated function compares at the **path level**, not just the top-level field level:

```typescript
// For a component accessing user.name, user.email, filter, and todos:
__dirty: (o, n) =>
  (Object.is(o.user?.name, n.user?.name) ? 0 : 1) |
  (Object.is(o.user?.email, n.user?.email) ? 0 : 2) |
  (Object.is(o.filter, n.filter) ? 0 : 4) |
  (Object.is(o.todos, n.todos) ? 0 : 8)
```

Nested path comparisons use optional chaining (`o.user?.name`) to safely handle cases where an intermediate object is `null` or `undefined`. If the parent reference is nullish, `Object.is(undefined, undefined)` returns `true`, correctly reporting no change.

In overflow (32+ paths), the generator follows the same structure but emits `FULL_MASK` (-1) as the bit for any path beyond position 30. Since `__dirty` ORs all bits together, a single mutation to an overflow path yields FULL_MASK, which matches all bindings in Phase 2 — the expected fallback behavior.

`Object.is` is used rather than `!==` because it handles `NaN` and `-0` correctly. The generated function returns a bitmask (or bitmask pair) of which paths changed. The update loop uses this to set `dirty`, which is then used to skip individual bindings. If `__dirty` is absent (uncompiled component), the runtime falls back to `dirty = 0xFFFFFFFF`, re-evaluating all bindings on every update — correct but not optimal.

The compiler checks for an existing `__dirty` property before injecting, so manually written `__dirty` functions are preserved verbatim.

**Why Pass 2 is a pre-scan, not integrated into Pass 1.** Mask injection requires knowing the full set of fields used across the entire file before emitting any tuple. If masks were computed on-the-fly during Pass 1, the bit assignments would depend on the traversal order, and a field first seen late in the file would have a different bit than if it had been seen first. The pre-scan ensures deterministic bit assignment and means Pass 1 can be redone conceptually as a single visitor that embeds masks with stable values.

In practice, `collectAllDeps` (the pre-scan) and the main `visitor` are distinct functions. `collectAllDeps` runs first over the `SourceFile`, builds `fieldBits`, and only then does the transformation visitor run.

### Pass 3: Import Cleanup

After the main transform, the llui import declaration is rewritten:

- Element helper names that were actually compiled (i.e., their call sites were transformed) are removed from the import specifier list.
- `elSplit` is added if not already present.
- Non-element helpers (`text`, `branch`, `each`, `component`, `mountApp`, etc.) are left untouched.

**Before:**

```typescript
import { div, span, text, branch } from '@llui/dom'
```

**After:**

```typescript
import { text, branch, elSplit } from '@llui/dom'
```

The consequence is that `elements.ts` — the module that defines the uncompiled `div`, `span`, etc. helpers — has no references in the bundle. Rollup/Vite's tree-shaker eliminates it entirely. This is not a micro-optimisation: `elements.ts` contains all HTML element helper implementations. For a large application using many elements, eliminating the module removes dead code that would otherwise inflate the bundle.

Note that only helpers that were _actually compiled_ are removed. If a helper was imported but called with a non-literal props object (bail-out condition), the compiler leaves the import intact because the runtime `div()` implementation is still needed.

**Why Pass 3 runs last.** It rewrites the `ImportDeclaration` node. If it ran first, the visitor in Pass 1/2 would lose track of which local names map to which element helpers (since those names could be aliased or renamed). Running it last, after the visitor has accumulated the set of `transformedHelpers`, makes it a simple filter over the import specifier list.

---

## What Adds Value

### Compile-time prop classification eliminates runtime branching

Without the compiler, the runtime `div()` helper must inspect each prop key at mount time to decide whether to call `addEventListener`, `setAttribute`, `className =`, etc. With the compiler, this classification is done once at build time and baked into the emitted structure. The runtime `elSplit` function has no branching per prop: it calls `staticFn` once, loops over the events array, and loops over the bindings array. The kind-dispatch in `applyBinding` is a switch over a string literal that the JS engine JIT-compiles to a jump table.

This matters most for components that mount frequently (list items, table rows) where mount-time prop classification would otherwise run thousands of times per render.

### Bitmask dirty tracking: O(1) skip per binding per update

The update loop in `update.ts` is:

```typescript
for (const binding of instance.bindings) {
  if ((binding.mask & dirty) === 0) continue
  // ...
}
```

A single bitwise AND decides whether an accessor needs to be re-evaluated. Without masks, the loop must call every accessor and compare its result against `lastValue`. With masks, most accessors are skipped before any JavaScript function call.

For a component with 50 bindings spread across 5 state fields, a message that changes only one field results in a `dirty` value with one bit set. At most 10 bindings (those tracking that one field) run their accessor. The other 40 are skipped with 40 bitwise ANDs.

This is the highest-leverage optimisation the compiler produces. The improvement is proportional to the number of bindings and inversely proportional to how many fields change per message — both of which are favourable in real applications.

### `__dirty` eliminates full state diffing in the update loop

Without `__dirty`, the runtime has no way to compute which fields changed without diffing the entire state object. It could walk all keys and compare values, but that is O(fields) work per update regardless of what changed. `__dirty` is a specialised, generated function that only compares the fields that actually have reactive bindings. It is also JIT-friendly: the generated shape is always a chain of ternary expressions ORed together, which the engine can optimise aggressively.

### Import elision enables tree-shaking of element implementations

As described in Pass 3. The `elements.ts` module is eliminated from production bundles when all element calls were compiled. This is a correctness-preserving transformation: the compiled `elSplit` call carries all the information that the runtime element helper would have computed.

### Per-binding masks decouple binding update cost from component size

Without masks, a component with 100 bindings re-evaluates all 100 on every state change. With per-binding masks, the cost of an update scales with the number of bindings that depend on the changed fields, not the total number of bindings. This makes large components with many independent sub-trees cheap to update when only one sub-tree's data changes.

### `each()` scoped accessor diagnostic

The `each()` render callback receives a scoped accessor `item` typed as `<R>(selector: (t: T) => R) => R` and an index accessor `index` typed as `() => number`. The compiler performs a targeted diagnostic pass on `each()` render callbacks to detect common misuse patterns:

1. **Direct property access on `item`** — `item.text` where `item` is the scoped accessor parameter. Since `item` is a function, `item.text` accesses `Function.prototype.text` (which is `undefined`). The compiler detects `PropertyAccessExpression` on the `item` parameter name and emits: `"Direct property access 'item.text' on each() scoped accessor at line 42. Use 'item(t => t.text)' to read the item's property reactively."`

2. **Bare call without selector** — `item()` with no arguments. This is a type error (the selector argument is required), but the compiler provides a more helpful message than TypeScript's generic error: `"each() scoped accessor 'item' requires a selector function: item(t => t.text), not item()."`

3. **Item captured from outer scope** — inside an `each()` render callback, accessing `s.todos[i]` or another expression that reads from the component state parameter to obtain the item, rather than using the provided `item` accessor. The compiler detects references to the component's state parameter inside `each()` render callbacks and warns: `"Accessing state directly inside each() render callback bypasses per-item stability. Use the 'item' scoped accessor instead."`

These diagnostics are emitted during Pass 2 as part of the accessor analysis. They do not affect code generation — they are advisory warnings that help the developer use the correct pattern.

### `.map()` on state arrays inside `view()`

Because `view()` runs once at mount time, calling `.map()` on a state-derived array inside a view function creates static DOM nodes from the initial array that never update when the array changes. The correct pattern is `each()`.

The compiler detects `CallExpression` nodes of the form `<expr>.map(...)` inside view function bodies where `<expr>` contains a reference to the component's state parameter. It emits: `"Array .map() on state-derived value at line 15. Use each() for reactive lists that update when the array changes. .map() creates static nodes that do not react to state changes."`

This diagnostic catches the most common LLM error pattern: LLMs trained on React default to `.map()` for list rendering. In LLui, `.map()` is only valid for truly static arrays (constants defined outside view) that never change for the component's lifetime.

### Exhaustive `update()` enforcement

The `update()` function must handle every variant in the component's `Msg` discriminated union. A missing case is not a style issue — it means a message dispatched at runtime will hit the default branch (if one exists) or fall through silently, producing incorrect state. The compiler enforces exhaustiveness as a hard diagnostic.

The compiler identifies the `update` property of the `ComponentDef` object literal, resolves the `Msg` type parameter, enumerates the discriminant values of the union, and checks the `switch` statement in the `update` body for coverage.

**Detection:** The compiler reads the `switch` statement's `case` clauses and collects the set of handled discriminant values. It then compares against the full set of discriminant values from the `Msg` type. Missing values produce a diagnostic error (not a warning):

`"update() does not handle message type 'removeItem' at line 25. All Msg variants must be handled. Missing: 'removeItem', 'clearCompleted'."`

**Scope of analysis:** The compiler handles the common patterns:

- `switch (msg.type)` with `case` clauses — enumerate handled string literals.
- `if (msg.type === 'x')` / `else if` chains — enumerate compared string literals.
- `default` clause or final `else` — treated as covering all remaining variants, suppressing the diagnostic. The `default` may still be flagged by TypeScript's `noImplicitReturns` if it doesn't return, but the LLui compiler considers coverage satisfied.

**What the compiler does NOT do:** It does not perform flow analysis on delegated switches (e.g., `update()` that calls a helper function for some cases). If the switch delegates `case 'toolbar': return handleToolbar(state, msg)`, the compiler does not enter `handleToolbar` to verify it handles sub-cases. This is a limitation of syntactic analysis; TypeScript's own exhaustiveness checking (via `never` in the default case) covers delegated patterns. The LLui compiler's diagnostic is a first-line defense, not a replacement for TypeScript's type system.

**Interaction with the type system:** When `noImplicitReturns` and `strictNullChecks` are enabled (which LLui requires), TypeScript itself enforces that `update()` returns `[S, E[]]` for every code path. The LLui compiler's diagnostic provides a more specific and actionable error message than TypeScript's generic "not all code paths return a value" — it names the exact missing message types and points to the `update` function.

### Exhaustive `branch()` cases enforcement

`branch({ on: s => s.phase, cases: { idle: () => ..., loading: () => ... } })` must cover every possible value the discriminant can produce. If `s.phase` is typed as `'idle' | 'loading' | 'error'` and the `cases` object only has `idle` and `loading`, the `error` case will produce no DOM nodes at runtime — a silent rendering gap.

The compiler detects `branch()` calls, resolves the return type of the `on` accessor, and compares it against the keys of the `cases` object literal.

**Detection for string/number literal unions:** If the `on` accessor's return type is a union of string or number literals, the compiler enumerates them and checks that every member appears as a key in `cases`. Missing keys produce a diagnostic:

`"branch() at line 42 does not handle discriminant value 'error'. The accessor returns 'idle' | 'loading' | 'error' but cases only covers: 'idle', 'loading'."`

**Detection for boolean:** If the `on` accessor returns `boolean`, the compiler checks for both `true` and `false` keys (or suggests using `show()` instead if only one branch is needed).

**Fallback for non-literal types:** If the return type is `string` or `number` (not a literal union), the compiler cannot enumerate possible values and does not emit a diagnostic. This is the expected behavior for dynamic discriminants where the case set is open-ended.

**Interaction with `show()`:** `show()` is a two-case branch (render or nothing). It does not need exhaustiveness checking because the "else" case is always "render nothing" — that is the semantic contract of `show()`.

### Accessibility diagnostics

The compiler walks the full element tree during Pass 2. It already classifies every prop and child for every element. This gives it enough information to detect common accessibility violations at compile time — something no other framework does, because no other framework has compile-time visibility into the DOM tree structure.

These diagnostics are warnings, not errors. They are emitted during Pass 2 alongside the bitmask analysis.

**1. Image without `alt`.** Any `img()` call without an `alt` prop — static or reactive — produces: `"<img> at line 42 has no 'alt' attribute. Add alt text for screen readers, or alt='' for decorative images."` The check is trivial: after prop classification, verify that the string `'alt'` appears in the prop keys. Both `alt: 'photo'` (static) and `alt: s => s.imageDesc` (reactive) satisfy the check. An explicit `alt: ''` satisfies it — the developer has consciously marked the image as decorative.

**2. Interactive element without accessible name.** A `button()` or `a()` call that has neither text content children nor an `aria-label` / `aria-labelledby` prop produces: `"<button> at line 18 has no accessible name. Add text content or an aria-label attribute."` Detection: check whether the element has at least one `text()` child (static or reactive) or an `aria-label` / `aria-labelledby` prop. Elements with only icon children (e.g., `span({ class: 'icon-close' })`) need explicit labelling.

**3. Click handler on non-interactive element.** An `onClick` prop on a `div()`, `span()`, `li()`, or other non-interactive element without `role` and `tabIndex` props produces: `"onClick on <div> at line 25 without role and tabIndex. Non-interactive elements with click handlers are not keyboard-accessible. Add role='button' and tabIndex={0}, or use <button>."` Detection: maintain a set of interactive element tags (`button`, `a`, `input`, `select`, `textarea`, `details`, `summary`). If the element tag is not in the set and `onClick` is present, check for `role` and `tabIndex`.

**4. Form input without label association.** An `input()`, `select()`, or `textarea()` without an `id` prop (for external `<label for="">` association) and without `aria-label` / `aria-labelledby` produces: `"<input> at line 30 has no associated label. Add an id and a matching <label>, or add aria-label."` Detection: check for `id`, `aria-label`, or `aria-labelledby` in the prop keys. The compiler cannot verify that a matching `<label>` exists elsewhere in the tree (that requires cross-element analysis), so the `id` check is a necessary-but-not-sufficient heuristic. The diagnostic is advisory.

**5. Missing controlled input handler.** An `input()` or `textarea()` with a reactive `value` prop but no `onInput` handler produces: `"<input> at line 35 has a reactive value binding but no onInput handler. Without onInput, the user cannot type — the binding will overwrite each keystroke."` This is both an accessibility and a correctness diagnostic. Detection: if `value` is classified as a reactive prop (has an accessor), check that `onInput` (or `onChange` for checkboxes/selects) is present in the prop keys.

**Scope of analysis.** These diagnostics are per-element, per-file. The compiler does not perform cross-element analysis (e.g., verifying that a `<label for="email">` matches an `<input id="email">`). Cross-element accessibility analysis requires a full tree walk that spans structural primitives (`branch`, `each`, `show`), which the compiler does not have visibility into because those subtrees are built at runtime. The per-element checks catch the most impactful violations — the ones that appear in every accessibility audit.

### Controlled input without handler (forms diagnostic)

Beyond the accessibility angle, the missing-handler diagnostic has a correctness dimension specific to LLui's binding model. In LLui, a reactive `value` binding on an `<input>` means the DOM property is overwritten on every Phase 2 pass where the mask matches. If the user types a character, the browser updates the input's value, but the next update cycle re-evaluates the binding and resets it to the state value — erasing the keystroke. This is the "controlled input" problem.

The compiler detects this pattern: `input({ value: s => s.field })` without a corresponding `onInput` (or `onChange` for checkboxes and selects). The diagnostic:

`"Controlled input at line 35: reactive 'value' binding without 'onInput' handler. The binding will overwrite user input on every state update. Add onInput to dispatch a message that updates the state field."`

This diagnostic applies to `input()`, `textarea()`, and `select()`. It does not apply to inputs with a static `value` prop (those are not controlled — the value is set once at mount). It does not apply to `input({ type: 'hidden' })` or `input({ type: 'submit' })` which are not user-editable.

---

## What to Avoid

### Regex-based transforms

Regex transforms on source text are fragile in ways that are difficult to enumerate at design time. They break on:

- Multiline prop objects.
- Props with string values containing the regex target.
- Template literal prop values.
- Comments inside prop objects.
- Prettier or ESLint reformatting changing whitespace.

A regex that works on `div({ class: 'foo' }, [])` fails on `div({\n  class: 'foo'\n}, [])`. The TypeScript AST is immune to formatting. Never use regex for structural transforms.

### Single-pass transforms

A single-pass transform that tries to classify props and inject masks simultaneously cannot work correctly. Mask injection requires knowing the full field set before visiting any call site. If pass 1 and pass 2 are merged, the compiler would need to either backpatch already-emitted tuples (which requires a second traversal anyway) or emit placeholder masks and fix them up (which is complex and error-prone). The two-pass structure (pre-scan then transform) is the correct factoring.

### Transforming non-literal prop objects

Transforming `div(myProps, [])` where `myProps` is a variable would require alias analysis to determine the object's shape. This is not safe in general. `myProps` could be mutated between definition and use; it could come from an import; it could be conditionally assigned. The conservative bail-out — only transform inline `ObjectLiteralExpression` — is correct and should not be relaxed without a type-aware analysis path.

### Dataflow analysis beyond the supported patterns

The compiler handles four access patterns: direct property access, destructuring, single-assignment `const` aliases, and string-literal element access (see Pass 2). It is tempting to extend this further — tracking values through conditional expressions (`const cls = s.count > 0 ? 'pos' : 'neg'`), following multi-hop aliases (`const u = s.user; const n = u.name`), or tracing through function calls (`getName(s)`). This requires general-purpose dataflow analysis that is expensive to implement correctly, fragile in the face of reassignment and aliasing, and wrong in cases involving closures over mutable variables. The payoff is marginal — the conservative `0xFFFFFFFF` mask for such accessors is correct, just not maximally precise. The compiler emits a diagnostic warning for every bail-out, giving the developer a clear path to rewrite the accessor using a supported pattern. Do not implement dataflow analysis beyond the four supported patterns.

### Per-file compilation caching

Vite already caches `transform()` results keyed by file content hash. Adding a secondary cache inside the plugin would duplicate this mechanism, add memory pressure, and introduce cache invalidation bugs (e.g., when the compiler itself changes but cached outputs are stale). Trust Vite's caching.

### Transforming `key` props

The `key` prop is a framework-level identity hint for `each()`. It is explicitly skipped during prop classification (`if (key === 'key') continue`). Never generate DOM mutations for `key` — it has no corresponding DOM attribute.

---

## What Seems Valuable But Isn't

### Incremental AST (reusing a parsed AST across builds)

`ts.createSourceFile` parses a file in under 2ms for files of typical component size (under 500 lines). Vite triggers `transform()` only when a file changes or is first requested. Storing the parsed AST between invocations would add memory pressure and a cache invalidation mechanism for a saving that is immeasurable in practice. The parse step is not the bottleneck.

### Shared cross-file analysis

Element props do not cross file boundaries. A component in `counter.ts` declares its own state type and its own bindings. No information from `counter.ts` is needed to compile `todo-list.ts`. The path-bit map is computed per file, not per application. There is no cross-file optimization opportunity that the current model misses. Introducing a cross-file analysis pass would require a persistent program object (`ts.Program` rather than `ts.createSourceFile`), which has significant overhead and complicates the Vite plugin lifecycle.

### AST caching at the plugin level

As noted in What to Avoid — Vite handles this. Additionally, Vite's module graph invalidation is fine-grained and correct. A plugin-level cache would need to replicate this logic.

### Inlining `applyBinding` mutations into each reactive tuple

An earlier design considered emitting the DOM mutation directly into the accessor:

```typescript
// hypothetical — not the current design
;[
  1,
  (__e) => {
    __e.setAttribute('title', String(s.title ?? ''))
  },
  (s) => s.title,
]
```

This would eliminate the `applyBinding` switch at runtime. However, it bloats the emitted code significantly (each binding carries its own mutation logic), defeats the `applyBinding` optimisations (boolean → `removeAttribute`, `true` → `setAttribute('')`), and makes the tuple format opaque. The current `[mask, kind, key, accessor]` format is compact and the `applyBinding` switch is a negligible cost compared to the DOM mutation itself.

### Emitting TypeScript type annotations in generated code

The compiler emits plain JavaScript-style TypeScript (no type annotations in generated nodes). Adding explicit type annotations to generated arrow functions and arrays would make the output harder to read and add no runtime benefit. The TypeScript type checker does not see the intermediate output; it checks the source. Generated type annotations would be stripped immediately by Vite's TypeScript handling anyway.

---

## Open Questions and Future Directions

### Type-level analysis via `ts.TypeChecker`

The compiler's dependency analysis is syntactic: it recognises direct property access, destructuring, single-assignment aliases, and nested chains up to depth 2. These patterns cover the vast majority of real accessor code. However, `ts.TypeChecker` integration would enable two capabilities that syntactic analysis cannot provide:

1. **Exhaustive path enumeration.** Given a state type `{ user: { name: string; email: string } }`, the type checker can enumerate all leaf paths without requiring the compiler to see them in accessor bodies. This would allow the compiler to assign bits proactively for all paths, not just those it observes — useful for `__dirty` generation where the full set of comparable paths is needed.

2. **Computed access resolution.** For `const field: 'count' | 'title' = condition ? 'count' : 'title'; s[field]`, the type checker can determine that `field` is a union of string literals, allowing the compiler to assign the union of their bits rather than bailing out.

The cost is constructing a `ts.Program` (which requires a `CompilerHost` and full resolution) rather than a bare `ts.SourceFile`. This is a meaningful increase in complexity but not a fundamental architectural change — the plugin would need to cache the `ts.Program` and invalidate it on file changes. This is a v2 enhancement; the syntactic analysis with bail-out warnings is sufficient for v1.

### Automatic memo injection for repeated accessors

If the same accessor expression appears in multiple bindings within a component's view — for example, `s => s.todos.filter(t => !t.done)` used both for a count display and a list render — the compiler could recognise the duplication and emit a single memoised value:

```typescript
const __m0 = memo((s) => s.todos.filter((t) => !t.done), mask)
// bindings use () => __m0.value
```

This is valuable when the accessor is expensive (filtering, mapping, sorting). The challenge is detecting semantic equality of accessor expressions: two syntactically identical arrow functions are not guaranteed to be semantically equivalent if they close over different variables. This requires care and should be limited to pure state accessors (no closure captures).

### Dead code elimination for unreachable `branch()` cases

`branch()` takes a discriminant accessor and a cases record. If the state type makes certain case keys unreachable — e.g., the discriminant returns `'a' | 'b'` but a case `'c'` is provided — the compiler could eliminate the unreachable case from the bundle. This requires `ts.TypeChecker` to determine the return type of the discriminant accessor, and Rollup-level tree-shaking to eliminate the dead case factory function.

### Prerendering static subtrees to HTML strings

A component subtree with no reactive bindings, no event handlers, and no structural blocks is entirely static. It produces the same HTML every time it mounts. The compiler could detect this and replace the subtree with:

```typescript
const __static0 = (() => {
  const t = document.createElement('template')
  t.innerHTML = '<div class="footer"><p>Version 1.0</p></div>'
  return t.content
})()
// at mount: container.appendChild(__static0.cloneNode(true))
```

This eliminates the recursive element construction at mount time for static subtrees. Detecting "fully static" requires that all props are literals (no reactive bindings), all children are also fully static, and there are no event handlers. This is detectable with the current AST analysis.

### Code splitting for `branch()` cases

`branch()` factory functions for inactive cases are included in the initial bundle even if they will never render on first load. If a `branch()` discriminant starts in state `'list'`, the `'detail'` case's view factory does not need to be in the initial chunk. The compiler could emit:

```typescript
branch({
  on: (s) => s.view,
  cases: {
    list: () => renderList(send),
    detail: () => import('./detail-view.js').then((m) => m.render(send)),
  },
})
```

This requires the compiler to understand which cases are "hot" at startup (either via annotation or heuristic) and to cooperate with Rollup's dynamic import chunking.

### Dev-mode `__msgSchema` emission for LLM debug protocol

In development mode, the compiler emits a `__msgSchema` property on each component definition. This is a simplified JSON Schema subset derived from the component's `Msg` discriminated union type, enabling runtime message validation by the LLM debug protocol (`window.__lluiDebug.validateMessage()` and the `llui_validate_message` MCP tool — see 07 LLM Friendliness §10).

```typescript
// Source type:
type Msg =
  | { type: 'addItem'; id: string; text: string }
  | { type: 'removeItem'; id: string }
  | { type: 'setFilter'; filter: 'all' | 'active' | 'completed' }

// Emitted (dev mode only, tree-shaken in production):
MyComponent.__msgSchema = {
  discriminant: 'type',
  variants: {
    addItem: { id: 'string', text: 'string' },
    removeItem: { id: 'string' },
    setFilter: { filter: { enum: ['all', 'active', 'completed'] } },
  },
}
```

The schema extraction is syntactic: the compiler reads the `Msg` type alias from the component file, identifies discriminated union members by the discriminant field (`type` by convention), and maps each variant's fields to primitive type names or `{ enum: [...] }` for string literal unions. Complex types (generics, mapped types, conditional types, intersection types) fall back to `'unknown'` in the schema, which passes validation unconditionally. This coverage is sufficient for the common case — discriminated unions with literal and primitive fields — which is exactly what well-structured LLui components use.

The `__msgSchema` emission is gated behind `import.meta.env.DEV` and uses the same dead-code elimination path as other dev-only features. Production bundles contain zero bytes for it. The schema is emitted alongside the component definition in the same file, not in a separate module, keeping the dev-mode cost to a single static property assignment per component.

### HMR with state preservation

Vite's HMR system notifies the plugin when a file changes. The plugin can accept the update and re-run the component without a full page reload. LLui's architecture makes state preservation across HMR straightforward because state is a plain serializable object with no instance variables, no closure state, and no hooks order dependency.

The HMR path:

1. **File changes.** Vite invalidates the module and calls the plugin's `handleHotUpdate` hook.
2. **Replace functions.** The plugin replaces the component's `update()`, `view()`, and `onEffect` functions with the new versions from the changed file. The `init()` function is NOT re-run — the current state is kept.
3. **Re-run `view()`.** The plugin calls `view(currentState, send)` to rebuild the DOM tree. This is the same one-shot imperative call that happens at mount time. New bindings are registered, old bindings are disposed.
4. **Re-run Phase 2.** All bindings are evaluated against the current state, bringing the DOM up to date with any view changes (new elements, restructured layout, changed accessors).

**Why this works cleanly.** In React, HMR must preserve hooks state, refs, effects, and their ordering — any mismatch corrupts the component. In Svelte, HMR must re-run reactive declarations and reconcile compiler-generated update blocks. In LLui, state is just data. The new `view()` function reads from the same state object. The new `update()` function will handle the next message. There is no hidden state to preserve or reconcile.

**What does not survive HMR.** In-flight effects — an HTTP request dispatched by `onEffect` before the HMR — continue running because they are owned by the browser, not by the component. The `AbortSignal` from the old component's scope is aborted during disposal, which cancels in-flight requests. The new component receives the current state but no pending effects. This is correct behavior: the developer changed the code, so the old effects may no longer be valid.

**Scope disposal on HMR.** When `view()` is re-run, the old root scope is disposed (cleaning up all bindings, listeners, child scopes, portals, and foreign instances). The new `view()` call creates a fresh scope tree. This is a full re-mount of the DOM subtree, not a patch. For most components, this is imperceptible (< 1ms). For components with expensive `foreign()` instances (Monaco, ProseMirror), the re-mount triggers `destroy` + `mount` on the foreign instance. To preserve foreign instance state across HMR, the plugin can optionally stash the instance reference and pass it to the new `mount` via a dev-only HMR context — this is an optimization, not a correctness requirement.

### Source map generation

The current compiler uses `ts.createPrinter` to emit the transformed source. The printer does not produce a source map. This means that when a runtime error occurs in transformed code, the stack trace points to generated line numbers, not the original source. `ts.createPrinter` supports a `sourceMapGenerator` option that can emit a source map. This should be added — it is a correctness and developer experience issue, not an optimisation.

The `magic-string` library (already a Vite dependency) provides an alternative: apply targeted string-level patches to the original source while tracking offset transformations, and emit a precise source map. This approach is more complex to implement but produces higher-fidelity maps because the untransformed parts of the source are mapped trivially.

---

## Correctness Invariants the Compiler Must Preserve

These are the guarantees that must hold for every transformed file. A compiler change that violates any of these is a bug, not an optimisation.

**1. Semantic equivalence at mount time.** The compiled `elSplit(...)` call must produce an element with exactly the same DOM state as the uncompiled `div(...)` call would have. Every static prop must be applied, every event listener must be registered, every reactive binding must be initialised and registered.

**2. Reactive bindings must be registered with the current scope.** `createBinding` calls `registerBinding`, which attaches the binding to `ctx.currentScope`. If the compiler emits code that calls `createBinding` outside the render context (e.g., at module initialisation time), the binding will not be associated with any scope and will not be cleaned up on unmount. The compiler must not hoist binding creation out of component view functions.

**3. Masks must be conservative.** A mask that is too narrow (missing a path bit that the accessor actually reads) causes silent stale values: the accessor is skipped on updates where the path changed, returning `lastValue` instead of the new value. A mask that is too broad (set to `0xFFFFFFFF` when a precise value is available) is merely suboptimal. The compiler must never emit a mask narrower than the actual path dependencies of the accessor. When uncertain, emit `0xFFFFFFFF` and a diagnostic warning. An accessor reading a parent path (`s.user`) must receive the union of all child path bits (`user.name | user.email | ...`), since the whole-object consumer depends on any sub-field change.

**4. The `__dirty` function must be a conservative superset.** `__dirty(o, n)` must return a non-zero bit for path `p` whenever the value at that path differs between `o` and `n` (by `Object.is`). It may return non-zero for paths that did not change (false positives are harmless — they cause unnecessary binding evaluations). It must never return zero for a bit corresponding to a path that did change (false negatives cause stale DOM). The compiler uses `Object.is` with optional chaining for nested path comparisons (`Object.is(o.user?.name, n.user?.name)`), which is the strictest possible equality and safely handles nullish intermediates. In overflow (32+ paths), paths beyond position 30 use `FULL_MASK` (-1), which satisfies the invariant trivially: any change to an overflow path causes \_\_dirty to return FULL_MASK, matching every binding in Phase 2.

**5. Import elision must only remove actually-compiled helpers.** If `div` was imported but one of its call sites bailed out (non-literal props), the `div` name must remain in the import. The compiler tracks `transformedHelpers` (the set of local names for which at least one call was compiled) separately from `helperLocalNames` (all imported element helpers). Only names in `transformedHelpers` are removed from the import. If a name is in `helperLocalNames` but not `transformedHelpers`, its import specifier is preserved.

**6. `__dirty` injection is idempotent.** The compiler checks for an existing `__dirty` property before injecting. If the user has written a custom `__dirty`, it is left verbatim. This check must be based on property name equality at the AST level, not string matching in the source text.

**7. The `key` prop is never emitted as a DOM binding.** It is silently dropped from all three output arrays (staticFn, events, bindings). The `key` prop is a framework identity hint with no DOM semantics.

**8. Children are passed through unmodified.** The compiler does not inspect or transform the children argument. It is taken as-is and passed as the last argument to `elSplit`. Child nodes may be other `elSplit` calls (which will be transformed by the visitor when encountered), but the compiler does not need to know this — the visitor handles nesting through `ts.visitEachChild`.

---

## Additional Compiler Passes (Implemented)

The following passes were added after the initial three-pass design. They run as part of the existing visitor pipeline.

### Pass 0: Item Selector Deduplication

Before element transformation, the compiler scans `each()` render callbacks for repeated `item(selector)` calls. When the same selector appears multiple times (matched by printed source text), the compiler hoists the selector to a local constant and caches the `item()` result:

```typescript
// Before:
render: ({ item }) => [
  tr({ class: (s) => s.selected === item((r) => r.id)() ? 'danger' : '' }, [
    td([text(item((r) => String(r.id)))]),
    a({ onClick: () => send({ type: 'select', id: item((r) => r.id)() }) }, [...]),
  ]),
]

// After:
render: ({ item }) => {
  const __s0 = (r) => r.id
  const __a0 = item(__s0)
  return [
    tr({ class: (s) => s.selected === __a0() ? 'danger' : '' }, [
      td([text(item((r) => String(r.id)))]),
      a({ onClick: () => send({ type: 'select', id: __a0() }) }, [...]),
    ]),
  ]
}
```

This eliminates redundant selector closure allocations and `item()` accessor closures per row.

### Subtree Collapse: Nested Elements → `elTemplate`

When the compiler detects nested element helper calls (e.g., `tr` containing `td` containing `a`), it collapses the entire subtree into a single `elTemplate(html, patchFn)` call. This replaces N `createElement` calls with 1 `cloneNode(true)`.

The analysis (`analyzeSubtree`) recursively checks eligibility:

- All children must be element helpers, `text('literal')`, or `text(accessor)`
- No structural primitives (`each`, `branch`, `show`)
- All props must be classifiable (literals, arrows, per-item calls)

The emission generates:

- A static HTML string with placeholder spaces for reactive text positions
- A patch function that walks to dynamic nodes via `childNodes[idx]`, attaches events, and calls `__bind` for reactive bindings

Reactive text uses **placeholder text nodes** embedded in the template HTML (a space character). The patch function references these existing text nodes via `parentNode.childNodes[idx]` rather than creating new ones with `document.createTextNode()`, saving 2 DOM operations per reactive text child.

### Structural Mask Injection (`tryInjectStructuralMask`)

The compiler injects a `__mask` property into the options object of every `each()`, `branch()`, and `show()` call. The mask is computed by `computeStructuralMask`: it ORs together all path bits read by the block's discriminant/accessor (the `on` function for `branch`/`show`, the `items` function for `each`). At runtime, Phase 1 uses this mask to skip entire structural blocks when none of their dependency paths are dirty (`(block.__mask & dirtyMask) === 0`).

### `__update` Function Generation (`tryInjectUpdate` / `buildUpdateBody`)

For each `component()` call site, the compiler generates a `__update` function that replaces the generic Phase 1 / Phase 2 loop. `tryInjectUpdate` detects component definitions and delegates to `buildUpdateBody`, which emits direct calls to each structural block's reconciler and each binding's apply function with inlined mask checks. This eliminates loop iteration overhead and enables V8 to inline the individual calls.

The generated `__update` function also triggers injection of the `__applyBinding` import (added to the `@llui/dom` import declaration alongside `elSplit`), so the compiled component can call the binding applicator directly rather than going through the generic dispatch.

### Per-Message-Type Handler Generation (`tryBuildHandlers` / `buildCaseHandler`)

The compiler analyzes each `case` in the component's `update()` switch via `analyzeUpdateCases` and generates specialized handler functions per message type. Each handler is a function that knows its exact dirty bits and the appropriate reconciler to call, bypassing the generic Phase 1/2 pipeline at runtime.

**`detectArrayOp`** classifies each case body's array mutation pattern:

- Empty array literal (`[]`) maps to `reconcileClear()`
- `.slice()` + index mutation maps to `reconcileItems()` (same keys, data-only change)
- `.filter()` maps to `reconcileRemove()` (parallel-walk removal)
- Full array replacement/append maps to generic `reconcile()`
- No array change (e.g., `select`) skips all structural blocks

**`buildCaseHandler`** emits a handler function per case that calls the detected reconciler directly with the pre-computed dirty mask. All handlers delegate to the shared `__handleMsg` runtime function, which handles the update-reconcile-Phase 2 boilerplate. This reduced per-handler generated code from 2039 to 292 bytes.

The generated `__handlers` map is injected as a property on the component definition alongside `__dirty` and `__update`. The runtime checks for `__handlers` and dispatches single-message updates directly; multi-message batches fall back to the generic path.

### Event Delegation in Templates

When multiple child elements within a collapsed template have event handlers of the same type (e.g., two `onClick` handlers), the compiler emits a single delegated listener on the template root using `element.contains(e.target)` dispatch:

```typescript
root.addEventListener('click', (__e) => {
  if (__n1.contains(__e.target)) {
    handler1(__e)
    return
  }
  if (__n2.contains(__e.target)) {
    handler2(__e)
    return
  }
})
```

This replaces N `addEventListener` calls with 1, reducing per-row DOM setup cost.
