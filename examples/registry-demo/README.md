# Registry Demo

All 58 components in the [LLui registry](../../registry), rendered from source that
`llui add` copied into this app. Nothing on the page is imported from a styling
package — `src/components/ui/` is ordinary project source, and editing it changes what
you see.

Coverage is shadcn/ui parity minus Chart and Sidebar, plus the components LLui has and
shadcn does not (rating group, tags input, tree view, steps, meter, number input,
toolbar).

## What it demonstrates

- **The two kinds of registry item.** Presentational element helpers (`Button`, `Card`,
  `Input`, `Textarea`, `Label`, `Badge`, `Separator`, `Skeleton`, `Alert`, `Table`) and
  skins over `@llui/components` (`Switch`, `Tabs`, `Accordion`, `Dialog`, `Popover`,
  `Tooltip`) where the state machine, keyboard handling and ARIA stay in the package.
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

One page in five groups — Presentational, Forms, Data display, Navigation & disclosure,
Overlays. The overlay triggers sit at the bottom; every overlay portals to `<body>`.

## Type-checked, unlike the other examples

This example has a `tsconfig.json` and a `check` script, so `turbo check` compiles it in
CI. That is deliberate: `src/components/ui/` is the CLI's real output, so if `llui add`
ever emits something that does not compile, this is where it surfaces. It caught four
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
