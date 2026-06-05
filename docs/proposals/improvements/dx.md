# Proposal: developer experience & API ergonomics

**Status:** proposed · **Audience:** future session. Items below come from a survey of the authoring API, compiler lint rules, types, and the agent/MCP surface. **Each cites a file as a starting point but should be re-verified against current code before implementing** (memory/code drift). Ranked by impact × (1/effort).

Guiding principle for this repo: **compile-time errors are the primary guardrail** (LLMs ignore warnings → framework lint rules are non-bypassable build errors in `@llui/compiler`, never ESLint). So error-message quality is a first-class DX lever, especially for LLM authoring.

## Tier 1 — error-message clarity (low effort, high LLM-authoring impact)

The lint messages decide whether an LLM fixes on the first retry. Make every one say **what's wrong AND the exact fix**, ideally quoting the offending expression. Files: `packages/compiler/src/signals/rules.ts`.

- **`operator-on-signal`** (~`rules.ts:184`) — include the operator/expression text: e.g. `comparison (>) on a signal in a ternary; use sig.map(v => v.x > 5 ? a : b)` instead of the generic "Signal used in a ternary condition".
- **`peek-in-slot`** (~`rules.ts:349`) — suggest the context-specific fix (`state.peek()` → `state.at('field')` for a field read vs `.map(...)` for a transform), not just "use .at()/.map()".
- **Uncompiled-helper runtime error** (`packages/dom/src/signals/authoring.ts` `compiledAway`) — add setup checklist (vite-plugin wired? file is .ts? build ran?) so a misconfigured project self-diagnoses.

## Tier 2 — API ergonomics

- **`.at()` after `.map()` is a runtime throw** (`packages/dom/src/signals/handle.ts` — `derivedHandle.at` throws). Catch it earlier: make the type return `never` (so it's a compile error), and/or a lint rule suggesting "slice with `.at()` before `.map()`". High value — it's a foot-gun that currently fails at runtime.
- **`derived([a,b], fn)` boilerplate** — add a variadic overload `derived(a, b, (va, vb) => …)` for the common 2–3 source case (keep the array form for N). Verify it doesn't regress inference.
- **Event-handler typing** — element-helper handler params are loosely typed (`(ev: any)`); explore per-event narrowing or a `handler<K>()` wrapper so handlers get real event types. Medium effort (inference-sensitive); verify against the existing prop-typing tests.
- **`peek()` discoverability** — consider a `snapshot()` alias to signal "non-reactive one-shot read" intent (peek is easy to misuse in reactive slots — which `peek-in-slot` already catches, but a clearer name helps prevention).

## Tier 3 — type-level DX

- **Deep-path `.at()` hits TS2589** on deeply-recursive State (noted in `packages/dom/test/signals/map-structural-reactivity.test.ts`). Users get a cryptic recursion error and must fall back to `.map()`. Document the limit in `Signal.at`'s JSDoc with a "when to use `.map()`" note; consider a depth guard that degrades to `Signal<unknown>` with a readable message instead of TS2589.
- **`component<S, M, E>` generics** — add JSDoc spelling out S/M/E (state shape / discriminated-union Msg / Effect union) so LLMs pick the right shapes; consider a type that nudges M/E toward discriminated unions.

## Tier 4 — LLM-authoring & agent surface

These reduce agent retry loops (each failed dispatch is a round-trip).

- **Validation errors should include a valid example** — `validateMessage` (`packages/dom/src/signals/devtools.ts`) returns `{path, message}`; add an optional `example` of a valid Msg so an LLM can construct the corrected message in one shot. Wire through the MCP `validate_message` tool.
- **Affordance "why unavailable"** — `list_actions` / dispatch rejections (`packages/agent/src/protocol.ts`) don't say _why_ an action is unavailable (gated, disabled, state precondition). Add `unavailableReason` / richer `LapError.detail` so the agent reasons instead of retrying blindly.
- **Dependency-graph tool** — an MCP tool returning `{ binding → state paths it reads }` (inverts the mask legend) would let an LLM reason about reactivity boundaries / state shape. There may already be partial support (`binding_graph` is mentioned in the mcp docs) — verify before building.

## Process note

Several Tier-1/2 items are tiny and independently shippable — good "warm-up" PRs. The agent-surface items (Tier 4) are higher-leverage for the LLM-first goal but need protocol/schema changes; scope each against `docs/designs/10 Agent Protocol.md` + `11 Agent Annotations and Tools.md`.
