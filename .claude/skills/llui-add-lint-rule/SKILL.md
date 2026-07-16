---
name: llui-add-lint-rule
description: >-
  Follow this exact procedure when adding a NEW compile-time lint rule to the LLui
  compiler (@llui/compiler, packages/compiler/src/signals/rules.ts). Use it whenever
  you want the build to reject an unsafe or non-idiomatic LLui authoring pattern — a
  new signal/view/reducer check that should fail compilation, not merely warn. This is
  framework-internals work. Critical doctrine it enforces: LLui framework rules are
  NON-BYPASSABLE compiler ERRORS, never ESLint rules (LLMs and humans ignore warnings),
  so the rule must be wired to halt the build and ship with BOTH positive and negative
  tests. Load it before writing the rule; getting the ScriptKind, the root-tracking, or
  the negative case wrong produces false positives that block valid builds.
---

# Adding a compile-time lint rule to `@llui/compiler`

**File:** `packages/compiler/src/signals/rules.ts`. **Test:** `packages/compiler/test/signals/rules.test.ts`.

## Doctrine (state this in the PR)

Framework rules are **compile-time ERRORS in `@llui/compiler`, run by `@llui/vite-plugin` —
NEVER ESLint rules.** The reason: LLMs (and humans in a hurry) ignore lint _warnings_, so a
non-bypassable build error is the only channel that actually changes behavior. Do **not**
reintroduce `@llui/eslint-plugin` or recreate a rule as an ESLint rule.

## How rules work here

There is **no rule-registry object**. Rules are inlined checks inside the single AST walk in
`lintSignals(sf: ts.SourceFile): SignalDiagnostic[]` (rules.ts). Each check calls the local
helper `push(rule, message, node, fix?)`, which records
`{ rule, message, start: node.getStart(sf), length: node.getWidth(sf), fix? }`. There is **no
severity field** — every diagnostic that is not the auto-fixed `convention` rule blocks the
build.

## Steps

1. **Add your check** inside `visit(node, roots, peekOk)` (the main recursion) or as a focused
   helper alongside `lintDeriveBody` / `lintElementCall` / `visitEach`. Use `ts.isX(node)`
   type guards.
2. **Use the root/signal machinery, don't re-derive it:**
   - `roots: Roots` tracks which identifiers are live signals (`state` is seeded via
     `STATE_ROOTS`; structural render callbacks augment roots via `withParams`).
   - Decide "is this a live signal expression?" with `isSignalExpr` / `isSignalRootedAccess`
     — not string matching.
   - Resolve helper calls through `bindings.resolve(node)` / `bindings.resolveCall(node)`
     (`HelperBindings`) so a user's _own_ function named `text`/`each`/`map` does not misfire.
   - Respect shadowing — the walk already sheds root names rebound by params/locals via
     `scopeShadowedNames`; a plain value named `state` is not a signal.
3. **Emit the diagnostic:** `push('<rule-name>', '<actionable message that QUOTES the offending
text and states the fix>', node, optionalFix)`. Use the `snippet()` helper to quote the
   offending expression — that quote is what lets an LLM patch on the first retry.
4. **Optional auto-fix:** if the rule is mechanically fixable, build a `LintFix` (e.g. via
   `renameFix(nameNode, to)`) and treat it like the `convention` rule (see wiring below).
   Otherwise leave it blocking.

## The entry point + ScriptKind (REQUIRED)

The public entry is `lintSignalSource(source, fileName)`. It creates the `SourceFile` with the
correct `ScriptKind` via `scriptKindForFilename(fileName)` (from `script-kind.ts`). **Always
thread the real `id`/filename** — parsing a `.ts` file as TSX misparses generic-arrow syntax
(`const id = <T>(x: T) => x`) as JSX and fires spurious `operator-on-signal` errors on valid
code. The vite-plugin already passes `id`; keep it.

## Non-bypassable build error (vite-plugin)

`packages/vite-plugin/src/index.ts` calls `lintSignalSource(code, id)` and splits diagnostics:
`convention` auto-fixables are applied silently (`applyLintFixes` + `this.warn`); **everything
else is blocking** and goes through `this.error({ message, loc })`, which throws and halts the
build. Errors are reported _before_ fixes are applied so positions stay correct.

**A new correctness rule needs NO vite-plugin change — it blocks automatically.** Only add
vite-plugin handling if you intend a silent auto-fix path (mirror the `convention` handling).

## Test convention — positive AND negative (both required)

`rules.test.ts` provides `lint(src)` → `lintSignals`, plus `rules(src)` (unique sorted rule
names) and `messageFor(src, rule)`. Give the rule a `describe` block asserting all three:

```ts
// positive: multiple shapes that MUST trigger
expect(rules('<bad code A>')).toContain('<rule>')
expect(rules('<bad code B>')).toContain('<rule>')
// negative: the legitimate lookalike that must NOT fire
expect(rules('<good code that resembles the bad one>')).not.toContain('<rule>')
// message quality: quotes the offending expression + names the fix
expect(messageFor('<bad code>', '<rule>')).toContain('<offending snippet>')
```

The negative case is the load-bearing one: pick the closest valid pattern (e.g. operating on a
`.peek()` snapshot, or a plain `Array.map`, or a shadowed local named `state`) and prove it
stays clean. A rule with only positives is how you ship a false positive that blocks real builds.

## Existing rule names (don't collide)

`operator-on-signal`, `no-node-construction-in-body`, `pure-derive-body`, `prefer-at-over-map`,
`at-after-map`, `peek-in-slot`, `async-update`, `controlled-input`, `exhaustive-update`, `a11y`,
`convention` (auto-fixed), `event-handler-casing`, `attr-name`.

Finish with `pnpm --filter @llui/compiler build test`, then a smoke build of an example
(`pnpm smoke:examples` or a `pnpm turbo build`) to confirm the rule doesn't false-positive on
real app code.
