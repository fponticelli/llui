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

The Step-1 demand check for [#49](https://github.com/fponticelli/llui/issues/49) found two
in-repo consumers of the former `@llui/components/utils` entry point:

- `@llui/a2ui` also imports the checkbox, combobox, date-picker, dialog, slider, and tabs
  component subpaths.
- `@llui/markdown-editor` also imports the dialog component subpath.

Neither is a standalone interactions consumer. The checked external consumers were:

- `buildlab-com/dungeonlogs/packages/ui/src/atoms/modal.ts` and `popover.ts` qualify: both
  implement custom overlays with the interaction primitives and no LLui component machine.
- `buildlab-com/stillkeel/packages/web/src/components/spark-tooltip.ts` does not qualify: it
  contains tooltip presentation behavior but does not consume these interaction primitives.

The two dungeonlogs modules establish separate install-graph demand. The existing
`@llui/components/utils` entry point remains as a compatibility re-export.
