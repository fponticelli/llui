---
title: '@llui/lint-idiomatic'
description: '15 anti-pattern rules for idiomatic LLui code'
---

# @llui/lint-idiomatic

AST linter for idiomatic [LLui](https://github.com/fponticelli/llui) patterns. Catches common anti-patterns at the source level.

```bash
pnpm add -D @llui/lint-idiomatic
```

## Usage

```ts
import { lintIdiomatic } from '@llui/lint-idiomatic'

const source = `
  function update(state: State, msg: Msg): [State, Effect[]] {
    switch (msg.type) {
      case 'increment':
        state.count++ // mutation!
        return [state, []]
    }
  }
`

const { violations, score } = lintIdiomatic(source, 'counter.ts')

console.log(score) // 5 (out of 6)
console.log(violations) // [{ rule: 'state-mutation', line: 5, message: '...' }]
```

## API

```ts
lintIdiomatic(source: string, filename?: string) => { violations: Violation[], score: number }
```

| Field        | Type          | Description                                 |
| ------------ | ------------- | ------------------------------------------- |
| `violations` | `Violation[]` | List of rule violations found               |
| `score`      | `number`      | Idiomatic score 0-15 (15 = fully idiomatic) |

### Violation

| Field     | Type     | Description                |
| --------- | -------- | -------------------------- |
| `rule`    | `string` | Rule identifier            |
| `line`    | `number` | Source line number         |
| `message` | `string` | Human-readable explanation |

## Rules

| Rule                         | Description                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `state-mutation`             | Direct mutation of state in `update()` instead of returning a new object   |
| `missing-memo`               | Expensive derived computation in `view()` without `memo()`                 |
| `each-closure-violation`     | Capturing mutable outer variable inside `each()` render callback           |
| `map-on-state-array`         | Calling `.map()` on a state array in `view()` (use `each()` instead)       |
| `unnecessary-child`          | Using `child()` boundary when a view function would suffice                |
| `form-boilerplate`           | Repetitive form field pattern that could use a view function               |
| `async-update`               | Using `async`/`await` in `update()` -- must be synchronous and pure        |
| `direct-state-in-view`       | Stale state capture in event handler instead of using an accessor          |
| `exhaustive-effect-handling` | Empty `.else()` handler silently drops unhandled effects                   |
| `effect-without-handler`     | Component returns effects but has no `onEffect` handler                    |
| `forgotten-spread`           | `show()`/`branch()`/`each()` used without spread in children array         |
| `string-effect-callback`     | Deprecated string-based `onSuccess`/`onError` in effect declarations       |
| `nested-send-in-update`      | Calling `send()` inside `update()` causes recursive dispatch               |
| `imperative-dom-in-view`     | Using `document.querySelector` etc. in `view()` instead of primitives      |
| `accessor-side-effect`       | Side effects (fetch, console.log, etc.) inside reactive accessor functions |

<!-- auto-api:start -->

## Functions

### `lintIdiomatic()`

Lint a single source file for LLui idiomatic anti-patterns.
Returns violations and a numeric score (17 = perfect).

```typescript
function lintIdiomatic(source: string, filename = 'input.ts', options: LintOptions = {}): LintResult
```

### `pos()`

```typescript
function pos(node: ts.Node, sf: ts.SourceFile): { line: number; column: number }
```

### `isStatePropertyAccess()`

```typescript
function isStatePropertyAccess(node: ts.Node, stateName: string): boolean
```

### `isInsideViewFunction()`

```typescript
function isInsideViewFunction(node: ts.Node): boolean
```

### `referencesStateParam()`

```typescript
function referencesStateParam(node: ts.Node): boolean
```

### `checkStateMutation()`

```typescript
function checkStateMutation(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkMutationsInBody()`

```typescript
function checkMutationsInBody(node: ts.Node, stateName: string, sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkMissingMemo()`

```typescript
function checkMissingMemo(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `collectModuleLevelNames()`

Collect every identifier declared at the module (file) level. These
are safe to capture inside an each() render callback because they
share a single value across all iterations — typical cases are
imports, top-level consts, and function declarations.
Identifiers declared INSIDE a function (as `let`, `var`, or function
parameters) are not collected — those are the genuinely mutable
captures the rule is designed to catch.

```typescript
function collectModuleLevelNames(sf: ts.SourceFile): Set<string>
```

### `collectBindingIdentifiers()`

```typescript
function collectBindingIdentifiers(name: ts.BindingName, out: Set<string>): void
```

### `checkEachClosureViolation()`

```typescript
function checkEachClosureViolation(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkClosureCaptures()`

```typescript
function checkClosureCaptures(renderFn: ts.ArrowFunction | ts.FunctionExpression, sf: ts.SourceFile, filename: string, violations: LintViolation[], moduleScopeNames: Set<string>): void
```

### `isInBindingContext()`

```typescript
function isInBindingContext(node: ts.Node, boundary: ts.ArrowFunction | ts.FunctionExpression): boolean
```

### `checkMapOnStateArrays()`

```typescript
function checkMapOnStateArrays(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkUnnecessaryChild()`

```typescript
function checkUnnecessaryChild(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `countStateAccesses()`

```typescript
function countStateAccesses(node: ts.Node, accesses: Set<string>): void
```

### `checkFormBoilerplate()`

```typescript
function checkFormBoilerplate(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkAsyncUpdate()`

```typescript
function checkAsyncUpdate(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkForAwait()`

```typescript
function checkForAwait(node: ts.Node, sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkDirectStateInView()`

```typescript
function checkDirectStateInView(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `findStateInEventHandlers()`

```typescript
function findStateInEventHandlers(node: ts.Node, sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `findStateAccess()`

```typescript
function findStateAccess(node: ts.Node, sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkExhaustiveEffectHandling()`

```typescript
function checkExhaustiveEffectHandling(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `isEmptyFunctionBody()`

```typescript
function isEmptyFunctionBody(fn: ts.ArrowFunction | ts.FunctionExpression): boolean
```

### `checkEffectWithoutHandler()`

```typescript
function checkEffectWithoutHandler(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `bodyReturnsEffects()`

```typescript
function bodyReturnsEffects(node: ts.Node): boolean
```

### `checkForgottenSpread()`

```typescript
function checkForgottenSpread(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkStringEffectCallback()`

```typescript
function checkStringEffectCallback(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkNestedSendInUpdate()`

```typescript
function checkNestedSendInUpdate(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `isInsideComponentCall()`

```typescript
function isInsideComponentCall(node: ts.Node): boolean
```

### `findSendCalls()`

```typescript
function findSendCalls(node: ts.Node, sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkImperativeDomInView()`

```typescript
function checkImperativeDomInView(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `isInsideOnMountCall()`

```typescript
function isInsideOnMountCall(node: ts.Node): boolean
```

### `isInsideImperativeCallback()`

Returns true if the node is inside a function that serves as an
event handler (onClick, onInput, onMouseDown…) or a deferred
callback (setTimeout, queueMicrotask, requestAnimationFrame,
Promise.then, addEventListener). All of these execute imperatively,
not reactively — imperative DOM inside them is fine.

```typescript
function isInsideImperativeCallback(node: ts.Node): boolean
```

### `findImperativeDom()`

```typescript
function findImperativeDom(node: ts.Node, sf: ts.SourceFile, filename: string, violations: LintViolation[], imperativeMethods: Set<string>): void
```

### `checkAccessorSideEffect()`

```typescript
function checkAccessorSideEffect(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `isAccessorArrow()`

```typescript
function isAccessorArrow(node: ts.ArrowFunction): boolean
```

### `findSideEffectsInAccessor()`

```typescript
function findSideEffectsInAccessor(node: ts.Node, sf: ts.SourceFile, filename: string, violations: LintViolation[], sideEffectNames: Set<string>, consoleMethods: Set<string>): void
```

### `collectMsgVariantShapes()`

```typescript
function collectMsgVariantShapes(type: ts.TypeNode): MsgVariantShape[]
```

### `fileDefinesComponent()`

Detect whether the file defines a component. Only in that case does
a direct `import { text } from '@llui/dom'` compete with the
bag-provided form — in standalone helper modules (Level-1 view
functions, shared UI utilities), imports are the only way to
reference these primitives and are idiomatic.
A `component()` call is sufficient on its own — even if the `view:`
callback currently has no parameter, the developer can add one and
destructure, so the direct import is still redundant.

```typescript
function fileDefinesComponent(sf: ts.SourceFile): boolean
```

### `checkViewBagImport()`

```typescript
function checkViewBagImport(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

### `checkSpreadInChildren()`

```typescript
function checkSpreadInChildren(sf: ts.SourceFile, filename: string, violations: LintViolation[]): void
```

## Types

### `RuleName`

```typescript
export type RuleName = (typeof RULE_NAMES)[number]
```

## Interfaces

### `LintViolation`

```typescript
export interface LintViolation {
  rule: string
  message: string
  file: string
  line: number
  column: number
  suggestion?: string
}
```

### `LintResult`

```typescript
export interface LintResult {
  violations: LintViolation[]
  /** Score from 0 to 17. Starts at 17, -1 per violated rule category. */
  score: number
}
```

### `LintOptions`

```typescript
export interface LintOptions {
  /**
   * Rule names to skip. Useful for avoiding duplication when running
   * alongside `@llui/vite-plugin`, which already emits some of these
   * diagnostics from its own `diagnose()` pass.
   */
  exclude?: readonly string[]
}
```

### `MsgVariantShape`

```typescript
interface MsgVariantShape {
  typeName: string
  shape: string
}
```

## Constants

### `RULE_NAMES`

Every rule name emitted by `lintIdiomatic`. Stable list so callers
(like the Vite plugin wrapper) can reference them by name to exclude.

```typescript
const RULE_NAMES
```

### `VIEW_BAG_NAMES`

```typescript
const VIEW_BAG_NAMES
```


<!-- auto-api:end -->
