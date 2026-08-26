# @llui/registry

Component **source** served as JSON from [llui.dev/r](https://llui.dev/r) and copied
into consumer projects by [`@llui/cli`](../packages/cli). Private — it is never
published as an npm package.

```
registry/
  registry.json      index: one item per component
  llui/lib/          shared helpers (cn, mergeClass, classPart)
  llui/ui/           components
```

## Two kinds of item

- **Presentational** — `button`, `card`, `input`, `textarea`, `label`, `badge`,
  `separator`, `skeleton`, `alert`, `table`. Element helpers with a class recipe. No
  state, no `update`, no scope.
- **Skins** — `switch`, `tabs`, `accordion`, `dialog`, `popover`, `tooltip`. The right
  tag and the classes for `@llui/components` parts. The state machine, keyboard handling
  and ARIA stay in the package; the consumer spreads the part bag in.

## Rules for anything added here

1. **Route `class` through `mergeClass`, never `cn` directly.** `class` is
   `Reactive<string | …>`, so a caller may pass a Signal; `cn()` stringifies it to
   `"[object Object]"`. `mergeClass` maps it instead.
2. **Write recipes where the checker can read them** — as an argument to `cn` /
   `mergeClass` / `classPart`, or inside `createVariants`. A recipe reached through a
   new local helper is invisible to `scripts/lib/registry-classes.mjs` and silently
   unchecked. Prefer `createVariants` over a template literal for a conditional recipe:
   the checker reads a template's static text only.
3. **Express state with `data-*` variants**, not computed classes. Every part bag emits
   `data-state` / `data-disabled` / `data-orientation` / `data-side`.
4. **Use an intersection for prop types**, not `interface X extends ElProps` — an
   interface extending `ElProps` drops its index signature, so `props.class` and every
   spread `data-*` key stop type-checking.

## Checks

```bash
pnpm check:registry    # tsc over the source (nothing else in the repo compiles it)
pnpm test:scripts      # compiles every emitted class with real Tailwind; fails on dead ones
pnpm build:registry    # regenerate site/public/r/*.json
```

The second one is not optional decoration. The layer this replaced had 62 test files
asserting substrings of class strings that no build ever compiled, and 116 utility
occurrences across 55 of them produced no CSS at all.
