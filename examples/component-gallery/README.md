# Component Gallery

Every LLui component and pattern once, with its deterministic scenarios, on both styling
paths — **Baseline theme** and **Registry skins** — side by side or one at a time. Search by
name, alias, `llui add` name or machine import; every entry has a stable URL.

## What it demonstrates

- **One information architecture, two isolated presentations.** The gallery shell frames two
  _separate documents_, each its own Vite build: the **Baseline theme** document loads
  `@llui/components/styles/theme.css` (plain CSS, no Tailwind anywhere in its build), and the
  **Registry skins** document compiles Tailwind v4 over `tokens.css` and renders the source
  `llui add` copied into [`examples/registry-demo`](../registry-demo). The baseline's
  unlayered `[data-scope][data-part]` rules would beat every Tailwind utility if the two ever
  shared a cascade; here they cannot, by construction.
- **Nothing is listed by hand.** Entries, categories, aliases, machine/skin badges, the
  per-path coverage (styled, partial, composed, styleless, not applicable) with its rationale,
  and the install/import lines all come from the canonical product contract
  (`registry/registry.json`). Scenarios — default, disabled, invalid, loading, empty, open,
  overflow, destructive … wherever a family declares them — come from the four presentation
  families' scenario catalogs, compiled against that contract.
- **Controls that only offer what a scenario declares.** Theme, direction, motion, viewport
  and forced-colors axes are enabled per scenario; switching path keeps the scenario and its
  environment, and a choice a scenario cannot vary is remembered for the next one that can.
- **Honest failure.** An unknown entry offers suggestions; an invalid link parameter is
  corrected with a notice; a document that fails to render (or never reports back) is shown
  as an error with a retry.

## URLs

The shell and both documents read one query vocabulary, owned by `@llui/cli/gallery`:

| Key                                            | Meaning                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `entry`                                        | canonical product, alias, or copied-artifact name          |
| `path`                                         | `baseline` or `registry` (default: the first that renders) |
| `view`                                         | `compare` for both paths side by side                      |
| `case`                                         | scenario id (default: the family's default case)           |
| `artifact`                                     | a copied registry artifact (e.g. `sheet` for Drawer)       |
| `theme`, `dir`, `motion`, `viewport`, `forced` | environment axes, where the scenario declares them         |
| `q`, `category`                                | index search and category filter                           |

```ts
import { galleryHref, galleryDocumentHref } from '@llui/cli/gallery'

galleryHref(contract, 'dropdown-menu') // '/apps/component-gallery/?entry=menu&path=registry&artifact=dropdown-menu'
galleryDocumentHref({ path: 'baseline', entry: 'tabs', caseId: 'disabled' })
// '/apps/component-gallery/baseline/?entry=tabs&case=disabled' — one scenario, no shell
```

A path document is addressable on its own. It sets `data-gallery-status` on `<html>`
(`loading` → `ready` or `error`, with the reason in `data-gallery-error`) so a headless driver
can wait for exactly one rendered scenario, and posts the same status to a framing parent.

## Running locally

```bash
pnpm install
pnpm gallery            # shell + both documents on one origin (http://localhost:5173)
pnpm gallery:baseline   # the Baseline theme document alone
pnpm gallery:registry   # the Registry skins document alone
pnpm gallery:build      # all three builds into dist/ (relative base; serve anywhere)
```

In dev, each document keeps its own Vite server and config, mounted under `/baseline/` and
`/registry/` on the shell's origin; production is three independent builds laid out the same
way.
