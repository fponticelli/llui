# @llui/devmode-annotate-editor

Rich Markdown editor upgrade for `@llui/devmode-annotate`.

The core HUD intentionally ships with a plain Markdown textarea and no Lexical
dependency. Import this package before mounting the HUD to register the same
Lexical-powered editor surface used by earlier releases:

```ts
import '@llui/devmode-annotate-editor'
import { mountAnnotateHud } from '@llui/devmode-annotate'

mountAnnotateHud()
```

The LLui Vite plugin performs this registration automatically in development
when both packages are installed. The package also exports
`registerMarkdownAnnotateEditor()` for scoped or custom bootstraps.

For production, do not eagerly import this entry unless the editor should be in
the initial bundle. Dynamically import it immediately before activating the
core HUD. See the concrete activation pattern in
[`@llui/devmode-annotate`](../devmode-annotate/README.md#shipping-it-in-a-live-app).
