---
title: '@llui/vike'
description: 'SSR/SSG adapter: onRenderHtml, onRenderClient, createOnRenderHtml/createOnRenderClient factories'
---

# @llui/vike

[Vike](https://vike.dev) SSR/SSG adapter for [LLui](https://github.com/fponticelli/llui). Server-side rendering with client hydration, or static site generation via prerendering.

```bash
pnpm add @llui/vike
```

## Setup

Use sub-path imports to keep jsdom out of the client bundle:

```ts
// pages/+onRenderHtml.ts
export { onRenderHtml } from '@llui/vike/server'
```

```ts
// pages/+onRenderClient.ts
export { onRenderClient } from '@llui/vike/client'
```

### Custom Document Template

Use `createOnRenderHtml` to control the full HTML document — add stylesheets, meta tags, favicons:

```ts
// pages/+onRenderHtml.ts
import { createOnRenderHtml } from '@llui/vike/server'

export const onRenderHtml = createOnRenderHtml({
  document: ({ html, state, pageContext }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app">${html}</div>
    <script>window.__LLUI_STATE__ = ${state}</script>
  </body>
</html>`,
})
```

### Custom Container

Use `createOnRenderClient` to configure the mount container or add lifecycle hooks:

```ts
// pages/+onRenderClient.ts
import { createOnRenderClient } from '@llui/vike/client'

export const onRenderClient = createOnRenderClient({
  container: '#root',
  onMount: () => console.log('Page ready'),
})
```

## How It Works

### Server (`onRenderHtml`)

Renders the component to HTML via `renderToString()`. Automatically initializes jsdom for server-side DOM (lazy-loaded to avoid client bundle pollution). Serializes state into a `<script>` tag for hydration.

### Client (`onRenderClient`)

Hydrates the server-rendered HTML on the client. Attaches event listeners and reactive bindings to existing DOM nodes without re-rendering. Falls back to fresh `mountApp()` for client-side navigations.

## API

| Export                 | Sub-path            | Description                                 |
| ---------------------- | ------------------- | ------------------------------------------- |
| `onRenderHtml`         | `@llui/vike/server` | Default server hook — minimal HTML template |
| `createOnRenderHtml`   | `@llui/vike/server` | Factory for custom document templates       |
| `onRenderClient`       | `@llui/vike/client` | Default client hook — hydrate or mount      |
| `createOnRenderClient` | `@llui/vike/client` | Factory for custom container/lifecycle      |

The barrel export (`@llui/vike`) re-exports everything, but prefer sub-path imports to avoid bundling jsdom into the client.

## License

MIT
