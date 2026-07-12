# @llui/dom

Runtime for the [LLui](https://github.com/fponticelli/llui) web framework — The Elm Architecture on a compile-time-optimized **signal** runtime.

No virtual DOM. `view()` runs once at mount, building real DOM nodes with reactive bindings; a **chunked-mask reconciler** updates only the bindings whose dependency paths actually changed.

## Install

```bash
pnpm add @llui/dom
```

## Quick Start

```typescript
import { component, mountApp, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

const Counter = component<State, Msg>({
  name: 'Counter',
  init: () => ({ count: 0 }),
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return { ...state, count: state.count + 1 }
      case 'dec':
        return { ...state, count: state.count - 1 }
    }
  },
  // `state` is a Signal<State> — derive reactive values with `.map` / `.at`.
  view: ({ state, send }) => [
    button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
    text(state.map((s) => String(s.count))),
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
  ],
})

mountApp(document.getElementById('app')!, Counter)
```

`init()` may return bare state (as above) or a `[state, effects]` tuple; likewise `update()`. Effects are handled in `onEffect` (see [Effects](#effects)).

## The view bag and signal handles

`view` receives `{ state, send, batch }`:

- **`state`** is a **`Signal<State>`** — a read handle, not the value:
  - `state.at('field')` — narrow to a sub-path signal (`state.at('user').at('name')`).
  - `state.map((s) => …)` — derive a reactive value; the binding's mask tracks exactly the paths read.
  - `state.peek()` — one-shot read, for handlers / effects / `onMount` (never as a slot value).
- **`send(msg)`** dispatches a message. It is synchronous — the reducer runs and the DOM updates before it returns.
- **`batch(fn)`** coalesces a burst of `send`s into ONE reconcile (reducers/effects still run per message; only the DOM commit is deferred to the outermost `batch` exit).

Element helpers (`div`, `button`, …) and structural primitives (`each`, `show`, `branch`, …) are **module imports**, not bag members. Combine multiple signals with `derived([a, b], (av, bv) => …)`.

## Mountable — everything you build is a lazy description

Every authoring helper (`el`/`div`/`text`/`each`/`show`/`branch`/`unsafeHtml`/`lazy`/`virtualEach`/`foreign`/`portal`/`provide`) returns a **`Mountable`** — a recipe materialized into live DOM at the point it is _placed_ (as an element child, or in a view / arm / row return). Consequences:

- **Annotate view helpers `Renderable`** (`readonly Mountable[]` — a list) or **`Mountable`** (a single element) — not `Node`/`Node[]`.
- **Capture and reuse freely.** A `Mountable` stored in a variable and reused across a `show`/`branch` remount rebuilds fresh each time; placing one twice yields two independent live instances.
- **Side-effect helpers must be placed.** `onMount(cb)` registers nothing unless its returned `Mountable` is in the view array — it is not an eager side effect.
- **Raw DOM interop:** wrap an existing node with `mountable(() => node)`.

## Structural primitives

```typescript
import { show, each, branch } from '@llui/dom'

// Conditional — the condition signal is narrowed for the arm
show(
  state.at('user'),
  (user) => [text(user.map((u) => u.name))],
  () => [text('signed out')],
)

// Keyed list — each row gets its own `item` / `index` signal
each(state.at('todos'), {
  key: (t) => t.id,
  render: (item) => [text(item.map((t) => t.label))],
})

// Discriminated union — each arm receives the narrowed variant signal
branch(state.at('route'), (r) => r.kind, {
  home: () => [text('home')],
  entity: (r) => [text(r.map((e) => e.id))],
})

// Keyed form: branch(value, arms) when the value is already the key
branch(
  state.map((s) => s.tab),
  { one: () => [text('one')], two: () => [text('two')] },
)
```

All three accept an optional trailing `transition?: TransitionOptions` (from `@llui/transitions`) to animate arm/row swaps.

## Composition

Factor sub-views as plain functions that take signal handles — they run via the runtime authoring helpers, so they compose without compilation:

```typescript
import type { Signal, Renderable } from '@llui/dom'

function header(title: Signal<string>, send: (m: Msg) => void): Renderable {
  return [h1([text(title)]), button({ onClick: () => send({ type: 'menu' }) }, [text('☰')])]
}

// in view:
view: ({ state, send }) => [...header(state.at('title'), send)]
```

## Effects

`update()` returns `[state, effects]`; each effect is passed to the component's `onEffect` handler. Use `@llui/effects` for the builders and `asOnEffect` to adapt a handler chain:

```typescript
import { http, handleEffects, asOnEffect } from '@llui/effects'

const onEffect = asOnEffect(
  handleEffects<Effect>().else(({ effect, send }) => {
    // handle your effect union
  }),
)

component<State, Msg, Effect>({ name, init, update, view, onEffect })
```

## API

### Core

| Export                                       | Purpose                                                       |
| -------------------------------------------- | ------------------------------------------------------------- |
| `component(spec)`                            | Define a component (`init` / `update` / `view` / `onEffect?`) |
| `mountApp(el, def, opts?)`                   | Mount a component into a container element                    |
| `mountSignalComponent(target, def, opts?)`   | Lower-level mount — container or `{ anchor }` target          |
| `hydrateSignalApp(target, def, serverState)` | Hydrate server-rendered HTML                                  |
| `derived(sigs, fn)`                          | Combine N signals into one derived signal                     |
| `isSignalHandle(v)`                          | Detect a runtime signal handle                                |

### View content

| Export                              | Purpose                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `text(value)`                       | Reactive (or static) text node                                              |
| `unsafeHtml(value)`                 | Render a raw HTML string (escape hatch; caller owns sanitization)           |
| `each(items, { key, render })`      | Keyed list                                                                  |
| `show(cond, render, orElse?)`       | Conditional render (the condition signal is narrowed for the arm)           |
| `branch(value, discriminant, arms)` | Discriminated-union render (or `branch(value, arms)` when value is the key) |
| `virtualEach(opts)`                 | Windowed keyed list                                                         |
| `lazy(opts)`                        | Async-loaded child component with `fallback` / `error`                      |
| `foreign(spec)`                     | Imperative-library boundary (declared signals → LiveSignals)                |
| `portal(content, target?)`          | Render into a different DOM location (default `document.body`)              |
| `onMount(cb)`                       | Run after mount; return a cleanup. **Place the returned marker.**           |
| `mountable(build)`                  | Wrap a build closure / raw node as placeable content                        |
| element helpers                     | `div`, `span`, `button`, `input`, `a`, `h1`–`h6`, `ul`/`li`, `table`/…, 60+ |

### Context

| Export                          | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `createContext(default, name?)` | Create a context                                 |
| `provide(ctx, value, render)`   | Provide a value to everything `render` builds    |
| `useContext(ctx)`               | Read the nearest provided value (or the default) |

### SSR

Exported from the main `@llui/dom` entry (pass a `DomEnv` from a sub-entry — see below):

| Export                            | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `renderToString(def, state, env)` | Render a component to an HTML string   |
| `renderNodes(def, state, env)`    | Render to detached nodes (adapter use) |
| `serializeNodes(nodes)`           | Serialize nodes to an HTML string      |

## Sub-path Exports

```typescript
import { installSignalDebug } from '@llui/dom/devtools' // dev/agent relay — kept out of prod bundles
import { browserEnv, type DomEnv } from '@llui/dom/ssr' // SSR env contract + browser-globals env
import { jsdomEnv } from '@llui/dom/ssr/jsdom' // server: jsdom-backed DomEnv
import { linkedomEnv } from '@llui/dom/ssr/linkedom' // server: linkedom-backed DomEnv
import { subApp } from '@llui/dom/escape-hatch' // isolated child TEA loop (rare)
// '@llui/dom/internal' — render-context glue for sibling adapter packages (e.g. @llui/vike)
```

## Performance

Competitive with the fastest fine-grained reactive frameworks on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) — see the [benchmarks page](https://llui.dev/benchmarks).
