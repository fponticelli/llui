# @llui/cli

`llui add <item>` — copy registry components into your LLui app.

This is shadcn/ui's distribution model: components are **source you own**, not a
dependency you import. It fits LLui better than it fits React, because the copied file
is compiled by _your_ `@llui/vite-plugin` — so it gets view lowering, the compile-time
lint rules, and the agent metadata (`$ms` / `$ss` / `__lluiVariants`) that a precompiled
library cannot give you.

```bash
pnpm add -D @llui/cli
pnpm llui init
pnpm llui list
pnpm llui add button card dialog
```

Then import the **tokens** in your app CSS — not `styles/theme.css`:

```css
@import 'tailwindcss';
@import '@llui/components/styles/tokens.css';
@import '@llui/components/styles/tokens-dark.css';
```

`theme.css` is the opt-in baseline stylesheet. Its `[data-scope][data-part]` rules are
unlayered, and unlayered CSS beats `@layer utilities` — importing it alongside registry
components makes every one of their classes lose, with nothing to tell you.

## Commands

|                      |                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `llui init`          | Write `components.json`. `--ui`/`--lib` set target dirs, `--alias` sets an import prefix. |
| `llui add <item...>` | Copy items and their `registryDependencies`. `--overwrite`, `--dry-run`.                  |
| `llui list`          | Show copied artifacts beside their related public machine imports and styling modes.      |

All commands accept `--registry <url|path>` and `--cwd <dir>`.

`llui add` and `@llui/components/*` are deliberately different surfaces. `add` copies a
registry/Tailwind skin, pattern or presentational component into your app; a package
subpath imports a headless state machine. Run `llui list` to see the relationship instead
of guessing from a shared name. It labels machine-only products, machine-backed skins,
patterns, presentational items, intentional application-owned-state skins and direct
aliases. A dash in the **ADD NAME** or **MACHINE IMPORT** column means that artifact has no
equivalent on that surface.

Every copied row is resolved from its own typed artifact record, rather than borrowing a
machine's title or kind. That keeps variant installs such as `calendar`/`date-picker` and
`drawer`/`sheet` distinct, and labels aliases by the copied artifact they actually install
(`alias pattern`, `alias skin` or `alias presentational`).

## Presentation scenario protocol

Gallery and visual-regression consumers import the browser-safe protocol directly from
`@llui/cli/presentation-scenarios`; it is intentionally absent from the Node-backed
`@llui/cli` root entry. `ProductContract` remains the only product inventory and the only
source of product metadata. A family supplies semantic cases keyed by the contract's
`scenarioId`, and `compileScenarioFamily` performs the exact join in canonical contract order.

**This is a deliberate, final API split, not an in-progress one:** `compileScenarioFamily` and
`resolveScenarioSelection` require a STATICALLY KNOWN `Definitions` literal — there is no
`unknown` fallthrough, so an invalid literal (an extra field on a case, an unrecognized
`environmentAxes` value, a function in `input`, …) is a compile error rather than a value
silently accepted and narrowed away to `CompiledPresentationScenarioFamily`'s erased,
`string`-keyed shape. For a definitions, catalog, or selection value received from a genuinely
untyped or serialized boundary (a network response, `JSON.parse`, a dynamic import), decode it
with the separately named `decodeScenarioFamily` / `decodeScenarioSelection` instead — the same
validation and diagnostics, deliberately without static narrowing. Do not reintroduce an
`unknown` overload on the typed pair to "simplify" the surface: that overload is exactly what let
an invalid literal silently degrade instead of failing to compile (#270).

**Compile-time exactness has known limits — the runtime decoder is the actual backstop.**
`compileScenarioFamily`'s generic parameter closes the most common excess-property holes,
including a union-typed cases array where only ONE member carries the excess field (`keyof` a
union is normally the INTERSECTION of its members' keys, which hides a key only one arm has; the
exactness check distributes `keyof` itself instead, to surface it). It cannot close all of
them: once a value is WIDENED to (or simply annotated as) `PresentationScenarioCase`, its excess
fields are structurally invisible to any type-level check — TypeScript does not track "this value
used to have more properties before it was widened," so there is no conditional or mapped-type
trick that recovers that information. This is not specific to this protocol; it is a general
limit of structural typing. The RUNTIME `exactFields` check inside `decodeCase` is unaffected by
either gap: it reads a value's own keys directly, at the moment it is actually decoded, regardless
of what static type the caller's code gave it on the way in.

A `scenarioId` identifies a product presentation across renderer paths. A case `id` is instead
a stable, product-local state such as `open` or `loading`. Each case owns only JSON data, the
environment axes it supports, and any copied-artifact targets it applies to. Theme, direction,
motion, viewport and forced-colors axes compose independently; the resolver fills canonical
defaults and rejects unsupported route selections.

The compiled catalog is the only shared seam. Baseline and registry/Tailwind adapters consume
the same resolved data but keep their DOM, CSS, selectors and LLui runtime code isolated.
Compilation and resolution snapshot through own data descriptors and return deeply frozen
values, so neither adapter can mutate the other adapter's cases, metadata or environment.
Serialized callers may pass `unknown`; malformed definitions, catalogs and selections fail with
sorted, path-qualified `PresentationScenarioError` diagnostics. Ordinary same-realm,
cross-realm and null-prototype data is inspected through own descriptors: getters, `toJSON`, and
iteration hooks are never invoked. JavaScript proxies are deliberately outside that no-hook
guarantee because standard reflection necessarily invokes their traps; throwing or mutating
traps still produce typed failures, and all work after `ownKeys` returns is bounded. Hidden
properties, accessors, symbols, decorated arrays, noncanonical serialization/iteration hooks and
over-budget payloads are rejected.

The serialized boundary's complexity budget is exported as `PRESENTATION_SCENARIO_COMPLEXITY_LIMITS`
and sized with generous headroom against a realistic family, not a flat cap tuned for a single
demo product — one whole family submission (all of its scenarios and cases combined) may contain
up to 64 nested levels, 288,000 decoded nodes, 576,000 own fields, 11,520,000 total string units,
100,000 units in any one string, and 2,000 entries in any one array (these numbers are derived,
not independent — see `PRESENTATION_SCENARIO_COMPLEXITY_LIMITS`'s own value and the sizing-basis
constants beside it in `presentation-scenarios.ts` for the exact arithmetic, since this prose
copy can drift and a test asserts it does not). The basis: ~40 products x ~12 cases x a
few-hundred-node payload each, times a headroom multiplier — a real 30-product x 5-case x
20-row-table family is comfortably inside it, where the flat 5,000-node cap an earlier revision
shipped was not (#270).

**One cost model governs a family's definitions and every catalog compiled from it.**
`compileScenarioFamily` builds its catalog from ALREADY-decoded, already-budgeted definitions
structurally — it does not re-decode its own output under a second, independent budget. But a
compiled catalog is not merely definitions restated: it adds real scaffolding (`version`,
`family`, and, per scenario, `productId`/`scenarioId`) that the raw definitions payload never
contained. A caller can still hand that catalog back through the untyped boundary at any
time — most commonly a `JSON.parse(JSON.stringify(catalog))` or `structuredClone`, but any
serialize/deserialize round trip — and `decodeScenarioSelection` must decode it under the SAME
family budget. To make that provably hold at the exact boundary, `decodeScenarioSelection`'s own
decoder widens its budget by the catalog's EXACT scaffolding cost (never an estimate) once it
knows the real scenario count, derived from the same constants. The result: a definitions
payload that fits the family budget is guaranteed to still fit when the catalog built from it is
later decoded from a genuinely untyped/serialized source — at any family size, not merely a small
one (#270).

Compiler/resolver failures additionally share one exported diagnostic policy
(`PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS`): at most 100 issues and 16,384 UTF-16 units across the
final `Error.message`, including newline separators and the explicit truncation diagnostic. Each
issue's own path and reason text are independently clipped to a small, fixed budget before being
measured against that aggregate — so one pathologically long path segment or quoted value can
only ever cost its OWN issue a bounded amount, never collapse the whole report to the pathless
truncation marker before any real issue, including the one naming the actual problem, is ever
recorded. A clipped PATH elides from the MIDDLE, always keeping the root and the leaf segment
(never a plain head-keep/tail-cut clip, which would make two issues that differ only in their
leaf — e.g. two different bad fields under the same long, shared, deeply nested prefix —
byte-identical and undistinguishable); a clipped REASON (free-form text with no root/leaf
structure) keeps its head and cuts its tail. Either way, the elision carries a deterministic
`…(<count>)` marker (the original length for reason/segment text, the number of elided segments
for a path), so replaying the same oversized input renders byte-identical output.

The array decoder's cost is bounded by an array's REAL own-key count, never by its claimed
`length`: a shared reference to one sparse or over-long array used to cost `length` reflection
work at EVERY place it is referenced, however few real elements it actually has — a length-only
peek rejects an over-long array before ever enumerating its keys, and a sparse array's first
missing index is found by walking only its real own keys (in the order the platform guarantees
they arrive), never by scanning `0..length`.

`resolveScenarioSelection` skips re-decoding a catalog THIS MODULE produced and the caller still
holds a live reference to (tracked by object identity, never by structural shape — a
`JSON.parse(JSON.stringify(catalog))` copy is a different object and is always decoded and
integrity-checked in full). The contract integrity cross-check still always runs regardless,
because a cached catalog can legitimately be resolved against a different (e.g. stale) contract
than the one it was compiled against.

Source case objects are exact protocol data: `id`, `label`, `input`, `environmentAxes`, and the
optional `copiedArtifactNames` are the only fields. Renderer adapters live in each app as
separate maps keyed by `scenarioId` and case `id`; functions or renderer metadata beside a case
are rejected without reading their values.

The compiled TypeScript surface is a `scenarioId`-discriminated union: each scenario retains its
literal default and case/input union, and resolver results narrow through that same discriminator.
JSON snapshots, environment-axis arrays, and copied-artifact arrays are recursively readonly even
when a caller supplies ordinary mutable definitions without `as const`.
The direct subpath's declaration graph depends only on browser-pure structural ProductContract
types—not the CLI's Zod schema or Node runtime. It carries exactly ONE runtime import, to
`product-contract-types.ts` (the one canonical source for `PRESENTATION_FAMILY_VALUES` and the
`ProductContract` structural types) — that file is itself dependency-free, so the whole graph
stays transitively pure; it is not the same claim as "this file has no imports at all."

**Prototype policy:** a decoded JSON snapshot's nested objects are rebuilt as ORDINARY plain
objects (`Object.prototype`), not `Object.create(null)` — every key was copied from an own,
enumerable, data-descriptor property of already-inspected source data (never a getter, `toJSON`,
or iteration hook), so a normal prototype is safe and matches what every other value in the
protocol already has. `${input}` and `Object.prototype.hasOwnProperty.call(input, key)` work as
expected; a null-prototype value would throw on both. A source key literally named `__proto__` is
still handled safely: the decoder always creates its slot with `Object.defineProperty` (which
makes a genuine own data property regardless of the key's name) BEFORE the key's value is ever
assigned, so the later plain assignment writes to that now-shadowing own property rather than
invoking `Object.prototype`'s `__proto__` accessor and reassigning the object's prototype.

The package-boundary suite imports and repackages emitted files. Run `pnpm run build` before a
direct `pnpm run test`; the workspace Turbo task encodes that own-package build edge automatically.

## `components.json`

```json
{
  "registry": "https://llui.dev/r",
  "paths": { "ui": "src/components/ui", "lib": "src/lib" }
}
```

Add `"aliases": { "ui": "@/components/ui", "lib": "@/lib" }` **only if** your tsconfig
declares those paths. Without it the CLI rewrites the registry's `@/lib/utils` import to
a **relative** specifier computed from where the file landed. That is the default, not a
fallback: an alias the project does not declare produces a file that type-checks
nowhere, which is a worse outcome than a longer path.

## Safety

- **`llui add` never overwrites.** The copied file is your source and is expected to
  have been edited; a second `add` reports it as skipped. `--overwrite` is the opt-in.
- **Registry file targets are validated at load.** A registry is remote third-party
  content, so `..` and absolute paths are rejected before anything is written.
- **Unknown registry keys are ignored**, so a registry that is ahead of your CLI still
  installs rather than failing closed.

## Using a different registry

The registry format is a subset of shadcn's `registry-item.json`. Point at any host, a
local directory, or a checkout:

```bash
llui add button --registry ./registry
llui add button --registry https://example.com/r
```

A local source may leave file contents on disk (`files[].path`); a remote one must serve
them inlined (`files[].content`), which `scripts/build-registry.mjs` produces.
