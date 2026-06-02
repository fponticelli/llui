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
propertyTest(gen, prop) => void
```

Property-based testing. Generates random inputs via `gen` and checks `prop` holds for all.

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

### `withBlurOnRemoval()`

Run `fn` with {@link emulateBlurOnRemoval} installed, uninstalling afterwards
even if `fn` throws. Returns whatever `fn` returns.

```typescript
function withBlurOnRemoval<T>(fn: () => T, doc: Document = document): T
```

<!-- auto-api:end -->
