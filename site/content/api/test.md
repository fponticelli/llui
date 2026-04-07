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

## License

MIT

<!-- auto-api:start -->

## Functions

### `testComponent()`

```typescript
function testComponent<S, M, E>(def: ComponentDef<S, M, E>, initialData?: unknown): TestHarness<S, M, E>
```

### `testView()`

Mount a component against a fresh container and return an interactive harness.
Simulates events + auto-flushes so tests can chain assertions naturally.

```typescript
function testView<S, M, E>(def: ComponentDef<S, M, E>, state: S): ViewHarness<M>
```

### `assertEffects()`

```typescript
function assertEffects<E>(actual: E[], expected: Array<Partial<E>>): void
```

### `propertyTest()`

```typescript
function propertyTest<S, M, E>(def: ComponentDef<S, M, E>, config: {
    invariants: Array<(state: S, effects: E[]) => boolean>
    messageGenerators: Record<string, ((state: S) => M) | (() => M)>
    runs?: number
    maxSequenceLength?: number
  }): void
```

### `replayTrace()`

```typescript
function replayTrace<S, M, E>(def: ComponentDef<S, M, E>, trace: LluiTrace<S, M, E>): void
```


<!-- auto-api:end -->
