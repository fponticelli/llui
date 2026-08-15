# @llui/interactions

Standalone DOM interaction primitives for custom UI: focus containment, dismiss layers,
outside-interaction detection, floating positioning, modal isolation, scroll locking, direction,
and roving focus. The package contains no LLui component state machines or component markup.

```bash
pnpm add @llui/interactions @llui/dom
```

`@llui/dom` is a peer dependency, so an LLui application and all of its libraries share one
runtime instance.

```ts
import { attachFloating, pushDismissable, pushFocusTrap } from '@llui/interactions'
```

## Why this is a separate package

The demand check for [#49](https://github.com/fponticelli/llui/issues/49) found two in-repo
consumers of the former `@llui/components/utils` entry point:

- `@llui/a2ui` also imports the checkbox, combobox, date-picker, dialog, slider, and tabs
  component subpaths.
- `@llui/markdown-editor` also imports the dialog component subpath.

Neither needs interactions independently of components. An owner-accessible downstream source
census did find custom modal and popover implementations that use these interaction primitives
without LLui component machines, which establishes the separate install-graph demand. The
existing `@llui/components/utils` entry point remains as a compatibility re-export.
