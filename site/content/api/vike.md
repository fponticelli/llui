---
title: "@llui/vike"
description: "SSR/SSG adapter: onRenderHtml, onRenderClient, createOnRenderHtml factory"
---

# @llui/vike

[Vike](https://vike.dev) SSR adapter for [LLui](https://github.com/fponticelli/llui). Server-side rendering with client hydration.

```bash
pnpm add @llui/vike
```

## Setup

Export the hooks from your Vike render files:

```ts
// pages/+onRenderHtml.ts
export { onRenderHtml } from '@llui/vike'
```

```ts
// pages/+onRenderClient.ts
export { onRenderClient } from '@llui/vike'
```

## How It Works

### Server (`onRenderHtml`)

Renders the component tree to an HTML string on the server. Runs `resolveEffects()` to prefetch async data before serializing the initial state into the page.

```ts
// What happens internally:
// 1. resolveEffects(componentDef) -- resolve SSR data
// 2. renderToString(componentDef, resolvedState) -- generate HTML
// 3. Serialize state into <script> tag for hydration
```

### Client (`onRenderClient`)

Hydrates the server-rendered HTML on the client. Attaches event listeners and reactive bindings to existing DOM nodes without re-rendering.

```ts
// What happens internally:
// 1. Read serialized state from the page
// 2. hydrateApp(componentDef, existingDOM, state)
// 3. Component is now interactive
```

## API

| Export           | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `onRenderHtml`   | Vike server hook -- renders component to HTML string |
| `onRenderClient` | Vike client hook -- hydrates server-rendered DOM     |

## License

MIT
