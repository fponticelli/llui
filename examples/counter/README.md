# Counter

The smallest possible LLui app — the canonical "hello world" of The Elm Architecture. A single number you can increment, decrement, and reset.

## What it demonstrates

- The full `component({ init, update, view })` shape with a discriminated `Msg` union.
- Reading reactive state with `state.at('count')` and transforming it with `.map(...)`.
- Wiring DOM events back into the loop with `onClick` handlers that `send` messages.
- `show(...)` conditional mounting — the **Reset** button only appears once the count is above zero.

## UI

Three buttons (**+**, **−**, **Reset**) around a live count. Reset is hidden while the count is `0`.

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-counter dev
```
