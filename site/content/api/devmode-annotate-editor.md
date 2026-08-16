---
title: '@llui/devmode-annotate-editor'
description: 'Optional rich Markdown editor upgrade for the annotation HUD'
---

# @llui/devmode-annotate-editor

The optional Lexical-powered note surface for [`@llui/devmode-annotate`](/api/devmode-annotate). Core always provides a plain Markdown textarea; importing this package before the HUD mounts registers the existing rich editor with its floating selection toolbar and slash commands.

```bash
pnpm add -D @llui/devmode-annotate @llui/devmode-annotate-editor
```

The LLui Vite plugin detects the package automatically in development. For a manual mount, import the registration entry first:

```ts
import '@llui/devmode-annotate-editor'
import { mountAnnotateHud } from '@llui/devmode-annotate'

mountAnnotateHud()
```

For production, dynamically import this package immediately before activating the core HUD so the Lexical graph stays deferred.

<!-- auto-api:start -->

## Functions

### `registerMarkdownAnnotateEditor()`

Register the rich editor explicitly and receive a scoped disposer.

```typescript
function registerMarkdownAnnotateEditor(): () => void
```

<!-- auto-api:end -->
