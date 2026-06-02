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

## A complete example

```ts
import { describe, it, expect } from 'vitest'
import { component, type ComponentDef } from '@llui/dom'
import { testComponent, testView, assertEffects } from '@llui/test'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }
type Effect = { type: 'logged'; level: 'info' | 'warn'; payload: unknown }

const Counter: ComponentDef<State, Msg, Effect> = component<State, Msg, Effect>({
  name: 'Counter',
  init: () => [{ count: 0 }, [{ type: 'logged', level: 'info', payload: 'mount' }]],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ count: state.count + 1 }, []]
      case 'dec':
        return [{ count: state.count - 1 }, []]
      case 'reset':
        return [{ count: 0 }, [{ type: 'logged', level: 'warn', payload: { reason: 'reset' } }]]
    }
  },
  view: () => [],
})

describe('Counter', () => {
  it('drives state via send + flush, reads effects', () => {
    const harness = testComponent(Counter)
    harness.send({ type: 'inc' })
    harness.send({ type: 'inc' })
    harness.flush()
    expect(harness.state.count).toBe(2)

    // assertEffects deep-equals the recorded effect log; init() emits
    // a 'logged' on mount, then nothing for inc/inc.
    assertEffects(harness.effects, [{ type: 'logged', level: 'info', payload: 'mount' }])
  })
})
```

For DOM-level assertions (clicking buttons, reading text), use `testView` against a component whose `view()` renders elements — see the [Usage](#usage) snippet above.

## API

### testComponent

```ts
// @doc-skip — API signature illustration, not runnable code
testComponent(def) => { state, send, flush, effects }
```

Mount a component definition headlessly. Returns current state snapshot and message dispatch.

### testView

```ts
// @doc-skip — API signature illustration
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
// @doc-skip — API signature illustration
assertEffects(effects, expected) => void
```

Deep-equal assertion on effect arrays. Provides clear diff output on mismatch.

### propertyTest

```ts
// @doc-skip — API signature illustration
propertyTest(gen, prop) => void
```

Property-based testing. Generates random inputs via `gen` and checks `prop` holds for all.

### replayTrace

```ts
// @doc-skip — API signature illustration
replayTrace(def, trace) => void
```

Replay a recorded message trace against a component definition. Asserts state at each step.

### emulateBlurOnRemoval / withBlurOnRemoval

```ts
// @doc-skip — API signature illustration
emulateBlurOnRemoval(doc?) => () => void   // returns an uninstall fn
withBlurOnRemoval(fn, doc?) => ReturnType<fn>
```

Browser-faithful blur emulation for jsdom. The HTML "removing steps" run a focus
fixup: when the focused element (or an ancestor) is removed from the document,
real browsers synchronously fire `blur` then `focusout` on it. jsdom resets
`document.activeElement` but fires **no events**, so the most reentrancy-prone
view pattern — an inline-edit `<input>` whose `onBlur` commits, inside a `branch`
arm the commit itself swaps out — can't be exercised on its real path.

`emulateBlurOnRemoval()` patches `removeChild` / `remove` / `replaceChild` to
dispatch the missing events synchronously, in browser order. It returns an
uninstall function (call it in `afterEach`); `withBlurOnRemoval(fn)` scopes the
patch around `fn` and always uninstalls.

```ts
import { emulateBlurOnRemoval } from '@llui/test'

it('commits an inline edit when the focused input is swapped out', () => {
  const uninstall = emulateBlurOnRemoval()
  // …focus the input, trigger the arm swap; blur now fires synchronously…
  uninstall()
})
```
