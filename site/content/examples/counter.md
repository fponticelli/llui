---
title: 'Counter'
description: 'The smallest possible LLui app — increment, decrement, reset.'
---

<div class="example-embed">
  <div class="example-embed-bar">
    <span class="example-embed-dots"><i></i><i></i><i></i></span>
    <span class="example-embed-url">/apps/counter/</span>
    <a class="example-embed-open" href="/apps/counter/" target="_blank" rel="noopener">Open ↗</a>
  </div>
  <iframe class="example-embed-frame" src="/apps/counter/" title="Counter — live demo" loading="lazy"></iframe>
</div>

<p class="example-source"><a href="https://github.com/fponticelli/llui/tree/main/examples/counter" target="_blank" rel="noopener">View source on GitHub ↗</a></p>

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
