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

## Capping a floating surface at the space it has

`attachFloating` writes the space left beside the anchor, on the side the element actually
lands, as two custom properties on the floating element: `--llui-floating-available-height`
and `--llui-floating-available-width` (exported as `FLOATING_AVAILABLE_HEIGHT` /
`FLOATING_AVAILABLE_WIDTH`). They are LLui's version of Radix's
`--radix-*-content-available-height`. Cap a tall surface with them, and keep a viewport cap as
the fallback for the frame before the first measurement:

```css
.my-menu {
  max-height: var(--llui-floating-available-height, calc(100dvh - 2rem));
  overflow-y: auto;
}
```

A viewport cap alone is not enough: an anchor halfway down the page leaves far less than the
viewport below it, and the surface runs off the bottom edge. Like every inline style it writes,
both properties are restored to their prior values on cleanup.

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
  imports `attachFloating`, but also builds on the LLui tooltip component machine.

The two dungeonlogs modules establish separate install-graph demand. The existing
`@llui/components/utils` entry point remains as a compatibility re-export.
