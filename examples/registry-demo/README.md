# Registry skins showcase

A curated app on the **Registry skins** path: every item in the
[LLui registry](../../registry), rendered from source that `llui add` copied into this app.
Nothing on the page is imported from a styling package — `src/components/ui/` is ordinary
project source, and editing it changes what you see.

For each component's deterministic scenarios side by side with the Baseline theme, use the
[Component Gallery](../component-gallery) (`pnpm gallery`) — its Registry skins document
renders these same copied files.

It covers every registry item — shadcn/ui's set plus the components LLui has and shadcn
does not. The [component catalog](https://llui.dev/component-catalog) lists them, with the
machine each skin spreads and the items that deliberately have none.

## What it demonstrates

- **What `llui add` copies.** Presentational element helpers (`Button`, `Card`, `Input`,
  `Badge`, …) with no machine at all; skins over `@llui/components` machines (`Switch`,
  `Tabs`, `Dialog`, `Table`, …) where the state machine, keyboard handling and ARIA stay in
  the package; and the adapters of composed patterns (`form`, `data-table`). The copied file
  and the machine import are different artifacts, and their names can differ.
- **Tokens without the baseline stylesheet.** `src/main.css` imports
  `@llui/components/styles/tokens.css`, not `theme.css`. The baseline's
  `[data-scope][data-part]` rules are unlayered, and unlayered CSS beats
  `@layer utilities` — importing it here would make every registry recipe lose to it
  silently. This app is the reason that split exists.
- **State-driven styling as `data-*` variants.** No view on this page reads state to
  build a class. Every visual state — the Switch thumb, the active tab, the open
  accordion panel, the dialog's enter transition — is a `data-[state=…]:` variant over
  the attributes `connect()` already emits.
- **`cn` beating `cx`.** The Button section includes a `class: 'px-10'` override that
  wins over the recipe's `px-4`. With plain concatenation it would lose by source order.
- **What `overlay()` does and does not give you.** The floating wrapper is built by the
  helper, so its class arrives as `positionerClass` — and `fixed inset-0` plus the
  backdrop are the consumer's job, which is invisible until you style with utilities.

## UI

One page of groups — presentational items, icons, forms, data display, navigation and
disclosure, layout, menus, media, composed patterns, pickers and overlays. The overlay
triggers sit at the bottom; every overlay portals to `<body>`.

## Type-checked copied source

`turbo check` compiles this example in CI, like every example. Here it matters more:
`src/components/ui/` is the CLI's real output, so if `llui add` ever emits something that
does not compile, this is where it surfaces. It caught four
defects the day it was added, three of them the same one — a `connect()` accessor
returning a BAG OF BAGS (`item(value)` → `{ trigger, content, item }`), where spreading
the wrapper emits `trigger="[object Object]"` and silently drops every real attribute.

## Regenerating the copied source

`src/components/ui/` and `src/lib/utils.ts` are checked in — that is what a real
consumer's tree looks like, and it means CI compiles and boots the CLI's actual output.
They are kept in sync with the registry by `scripts/test/registry-demo-sync.test.ts`.
After changing a registry item:

```bash
pnpm build:registry
pnpm exec node packages/cli/dist/cli.js add <item> --registry ./registry \
  --cwd examples/registry-demo --overwrite
```

## Running locally

```bash
pnpm install
pnpm --filter @llui/example-registry-demo dev
```
