---
title: Using the components
description: A walkthrough from an empty app to a styled, state-wired screen — and how to customize what you copied.
---

# Using the components

LLui ships components in two halves that you assemble yourself:

- **`@llui/components`** — the machines. State, keyboard handling, ARIA, focus and
  dismissal. No classes, no opinions about how anything looks.
- **the registry** — the skins. shadcn/ui's class recipes, copied into _your_ project by
  `llui add`, spread onto the machine's parts.

You can use either half alone. A machine with no skin is a fully accessible headless
component; a skin with no machine is a styled element. This page walks the normal case:
both, together.

> Everything here is live in [the registry demo](/examples) — every component on that page
> is a machine plus a registry skin, and its source is the closest thing to a reference
> implementation.

## Choosing a styling path

The machines carry no classes, so the CSS has to come from somewhere. There are two places it
can come from, and **you pick one** — see the warning at the end of this section for why they
cannot be combined.

|                        | **Registry** (`llui add`)                           | **Baseline** (`theme.css`)                   |
| ---------------------- | --------------------------------------------------- | -------------------------------------------- |
| Where the CSS lives    | your repo, one file per component                   | the package, one 1748-line stylesheet        |
| Needs Tailwind         | yes                                                 | no                                           |
| Looks like             | shadcn/ui, verbatim                                 | LLui's own look                              |
| To restyle a component | edit your copy                                      | override its `[data-scope][data-part]` rules |
| To restyle everything  | override tokens in `:root`                          | override tokens in `:root`                   |
| Upgrades               | you own the file; `llui add --overwrite` to re-pull | arrives with the package                     |

Both drive the identical machines through the identical `data-*` contract. Nothing about your
component wiring changes between them; only the source of the classes does.

### When the registry is the right answer

- **You want shadcn's look**, or you want to paste a shadcn theme, tutorial or screenshot and
  have it still describe what you get. Recipes are ported verbatim — a measured 98% class-set
  match, 38 of 45 components identical.
- **You expect to restyle.** The copied file is yours: change a class, delete a variant, add
  one. No override layer, no specificity fight, no waiting on the package.
- **You are already using Tailwind.** The recipes are Tailwind utilities; without a Tailwind
  build they produce nothing.

The cost is that you own what you copied. `llui add` never overwrites, so an upstream recipe
fix does not reach you until you re-pull it deliberately — which is the same trade shadcn makes,
and the reason it is a distribution model rather than a dependency.

### When the baseline is the right answer

- **You do not want a Tailwind pipeline.** One `@import` and every component looks finished.
  `examples/markdown-showcase` uses it for exactly this reason.
- **You are prototyping**, or the app's look is not the point yet.
- **You want restyling to arrive with the package** rather than being your maintenance.

The cost is that you are further from the CSS. Restyling means overriding
`[data-scope][data-part]` rules rather than editing a recipe, and the look is LLui's rather
than something a designer will recognise.

### They cannot be combined

> **Import one, not both.** `theme.css` styles components with UNLAYERED
> `[data-scope][data-part]` rules, and unlayered CSS beats `@layer utilities` — so with both
> imported, every registry recipe silently loses to the baseline. Both stylesheets are present
> and correct; the wrong one wins.
>
> This is not a specificity problem you can out-write: layer precedence ignores specificity
> entirely. Measured, not theorised — the registry `Switch`'s thumb rendered at the baseline's
> 20px and ignored its own `size-4` until the demo's import was narrowed.
>
> `llui init` and `llui add` warn when they find `theme.css` imported in your project, because
> nothing else will.

If you are on the baseline and want to move: replace the `theme.css` / `theme-dark.css` imports
with `tokens.css` / `tokens-dark.css`, add Tailwind, then `llui add` the components you use. The
tokens are the same in both, so your theme survives the move.

> **The rest of this page assumes the registry.** Only three parts of it differ by path —
> setup (below), copying components (§2), and customizing (§6). **Wiring a machine (§3),
> placing an overlay (§4) and building a form (§5) are identical either way**, because the
> machine and its `data-*` contract are identical. Baseline readers: skim §1's second tab,
> skip §2, and read §3–§5 as written.

## 1. Set up

### On the registry path

```bash
pnpm add @llui/dom @llui/components clsx tailwind-merge
pnpm add -D @llui/cli @llui/vite-plugin tailwindcss @tailwindcss/vite tw-animate-css
pnpm llui init
```

`init` writes `components.json` and prints the CSS you need. Your app stylesheet:

```css
@import 'tailwindcss';
@import 'tw-animate-css';
@import '@llui/components/styles/tokens.css';
@import '@llui/components/styles/tokens-dark.css';
```

`tw-animate-css` is not optional polish. `animate-in`, `fade-in-0`, `zoom-in-95` and
`slide-in-from-*` are the entire enter/exit vocabulary of every overlay recipe, and they are
not Tailwind core.

### On the baseline path

```bash
pnpm add @llui/dom @llui/components
pnpm add -D @llui/vite-plugin
```

```css
@import '@llui/components/styles/theme.css';
@import '@llui/components/styles/theme-dark.css';
```

That is the whole setup — no Tailwind, no CLI, no per-component files. `theme.css` imports
the same tokens the registry uses and adds ~207 `[data-scope][data-part]` rules on top, so
every component you wire is styled the moment you spread its part bag.

Import one set or the other, never both — see [choosing a styling
path](#choosing-a-styling-path).

## 2. Copy a component

> Registry path only. On the baseline there are no per-component files to copy — skip to §3.

```bash
pnpm llui list
pnpm llui add button
```

You now own `src/components/ui/button.ts`. It is your source — edit it. `llui add` never
overwrites an existing file; pass `--overwrite` when you really mean to discard your edits.

```ts
import { text } from '@llui/dom'
import { Button } from './components/ui/button'

Button({ variant: 'outline' }, [text('Cancel')])
Button({ variant: 'destructive', size: 'sm' }, [text('Delete')])
```

`button` is **presentational** — a styled element with no state. So are `card`, `input`,
`label`, `badge`, `separator`, `skeleton`, `alert` and `table`. Nothing to wire.

## 3. Wire a machine

> **Identical on both paths.** The machine, its `connect`, its part bags and its `data-*`
> contract do not know how you are styling. The only difference below is where `Switch` and
> `SwitchThumb` come from: your copied `./components/ui/switch` on the registry path, or
> plain `button` / `span` element helpers from `@llui/dom` on the baseline, where
> `theme.css` styles them from the `data-scope` / `data-part` the bag already carries.

Most components are a **skin**: classes and the right tag for a machine's parts. The state
lives in your app, like any other TEA slice.

```bash
pnpm llui add switch
```

```ts
import { component, div, text, type Mountable } from '@llui/dom'
import * as switchC from '@llui/components/switch'
import { Switch, SwitchThumb } from './components/ui/switch'
import { Label } from './components/ui/label'

interface State {
  wifi: switchC.SwitchState
}
type Msg = { type: 'wifi'; msg: switchC.SwitchMsg }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ wifi: switchC.init({ checked: true }) }, []],
  update: (state, msg) => [{ ...state, wifi: switchC.update(state.wifi, msg.msg)[0] }, []],
  view: ({ state, send }): readonly Mountable[] => {
    // `connect` projects the state slice into part bags. Spread each bag onto
    // the matching skin element — that is the whole contract.
    const wifi = switchC.connect(state.at('wifi'), (msg) => send({ type: 'wifi', msg }))
    return [
      div({ class: 'flex items-center gap-2' }, [
        Switch({ ...wifi.root, id: 'wifi' }, [SwitchThumb({ ...wifi.thumb })]),
        Label({ for: 'wifi' }, [text('Wi-Fi')]),
      ]),
    ]
  },
})
```

Three rules that cover almost every skin:

1. **Spread the bag, do not nest it.** `{ ...parts.root }`, never
   `{ parts: parts.root }`. A part factory that returns a bag OF bags —
   `accordion.item(v)` gives `{ item, trigger, content }` — needs the inner one:
   `{ ...parts.item(v).trigger }`. Spreading the wrapper emits
   `trigger="[object Object]"` and drops every real attribute.
2. **The machine owns state, you own layout.** No `connect()` emits a `class`, which is
   what makes a skin purely additive: it cannot regress focus, dismissal or ARIA.
3. **`state.at('slice')` keeps the reactivity narrow.** A part bag built from
   `state.at('wifi')` only re-commits when that slice changes.

## 4. Overlays

Dialogs, popovers, menus, tooltips and selects go through `overlay()`, which portals the
content and owns focus, dismissal and floating position.

> **Identical on both paths**, with one asymmetry worth knowing: the two omissions below are
> what the baseline stylesheet fills in for you. It targets `[data-part='positioner']` and
> paints a backdrop directly, which is exactly why they are invisible until you style with
> utilities — and why they bite on the registry path.

Two things `overlay()` deliberately does **not** give you:

```ts
import * as dialogC from '@llui/components/dialog'
import { DialogBackdrop, DialogContent, DialogTitle } from './components/ui/dialog'

dialogC.overlay({
  state: state.at('confirm'),
  send: confirmSend,
  parts,
  // 1. The POSITIONER is yours to place. `overlay()` builds the wrapper div,
  //    but its part bag carries only `data-*` — nothing positions it, and
  //    nothing gives it a z-index.
  positionerClass: 'fixed inset-0 z-50 grid place-items-center p-4',
  content: () => [
    // 2. The BACKDROP is yours to render, INSIDE `content()`. The engine emits
    //    none. It sits inside the positioner, so it wants `absolute inset-0`.
    DialogBackdrop({ ...parts.backdrop }),
    DialogContent({ ...parts.content }, [DialogTitle({ ...parts.title }, [text('Sure?')])]),
  ],
})
```

`DialogContent` positions _itself_ (`fixed top-[50%] left-[50%] translate-x-[-50%]`), as
shadcn's does. For that one, pass `positionerClass: 'contents'` so the wrapper drops out
of layout entirely and the content behaves exactly like upstream.

## 5. Forms

A validated form is the one composition most apps need on day one, and it is where LLui
differs most from what a shadcn tutorial will show you. React's answer is
**react-hook-form**: a `Controller` per field, a context deriving ids and error state, and
a resolver seam for a schema. LLui's answer is that **validation is a reducer concern** —
it runs in `update` and produces errors as ordinary data.

> **Identical on both paths.** `form` is a registry item, but everything below it —
> the machine, the messages, the ARIA — is the same on the baseline.

`@llui/components/patterns/form-field` composes the whole thing. Your values stay ordinary
state; the pattern holds validity, touched, submission status, and every derived id.

```bash
pnpm llui add form input label
```

### The state

```ts
import { formField, type FormFieldState } from '@llui/components/patterns/form-field'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  name: z.string().min(2, 'Name must be at least 2 characters.'),
})

interface State {
  values: { email: string; name: string }
  ff: FormFieldState
}

const init = (): [State, never[]] => [
  {
    values: { email: '', name: '' },
    ff: formField.init({ id: 'signup', fields: ['email', 'name'] }),
  },
  [],
]
```

Any [Standard Schema](https://standardschema.dev) works — Zod, Valibot, ArkType. The
pattern never imports one; it reads the `~standard` interface.

### The reducer

```ts
function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'setValue': {
      const values = { ...state.values, [msg.field]: msg.value }
      // Re-validate on every keystroke. Errors do not BECOME VISIBLE yet — the
      // pattern gates that on touched-or-submitted — so this only means a field
      // stops showing an error the moment it is fixed.
      const [ff] = formField.update(state.ff, { type: 'validate', schema, values })
      return [{ ...state, values, ff }, []]
    }
    case 'submit': {
      const [validated] = formField.update(state.ff, {
        type: 'validate',
        schema,
        values: state.values,
      })
      const invalid = Object.values(validated.fields).some((f) => f.invalid)
      if (invalid) {
        // Reveal every error at once, including on fields never focused.
        const [ff] = formField.update(validated, { type: 'touchAll' })
        return [{ ...state, ff }, []]
      }
      const [ff] = formField.update(validated, { type: 'submit' })
      return [{ ...state, ff }, [saveEffect(state.values)]]
    }
  }
}
```

`submitSuccess` / `submitError` close the lifecycle from `onEffect`.

### The view

```ts
import { Form, FormItem, FormLabel, FormDescription, FormMessage } from './components/ui/form'
import { Input } from './components/ui/input'

view: ({ state, send }) => {
  const parts = formField.connect(state.at('ff'), (m) => send({ type: 'ff', msg: m }), {
    id: 'signup',
    fields: ['email', 'name'],
  })
  const email = parts.formField('email', { hasDescription: true })

  return [
    Form(
      {
        ...parts.root,
        onSubmit: (e) => {
          e.preventDefault()
          send({ type: 'submit' })
        },
      },
      [
        FormItem({ ...email.root }, [
          FormLabel({ ...email.label }, [text('Email')]),
          Input({
            ...email.control,
            type: 'email',
            value: state.at('values').at('email'),
            onInput: (e) => send({ type: 'setValue', field: 'email', value: e.target.value }),
          }),
          FormDescription({ ...email.description }, [text('We only use this to sign you in.')]),
          FormMessage({ ...email.errorText }, [text(email.error.message)]),
        ]),
        Button({ ...parts.submit }, [text('Create account')]),
      ],
    ),
  ]
}
```

Nothing here computes an id, an `aria-describedby`, or when to show an error. The bag does
all of it, reactively.

### What maps to what

| shadcn / react-hook-form   | LLui                                                  |
| -------------------------- | ----------------------------------------------------- |
| `useForm` + `zodResolver`  | a `validate` message + any Standard Schema            |
| `<Form>` (FormProvider)    | one `FormFieldState` slice in your own state          |
| `<FormField>` (Controller) | `parts.formField(name)`                               |
| `useFormField()`           | the returned bag — ids, ARIA, error, touched, pending |
| `<FormControl>` (a Slot)   | `{...field.control}` spread onto **your** control     |

### Three things that bite

**There is no `FormControl`.** Upstream's is a Radix `Slot`: it renders nothing and
forwards `id` / `aria-describedby` / `aria-invalid` onto its child. `field.control` already
carries exactly those, so spread it onto your `Input` directly.

**`FormMessage` stays mounted.** `errorText` carries its own reactive `hidden`, so the live
region is registered before it has anything to say. Wrapping it in `show(...)` unmounts and
rebuilds it on every transition, and a screen reader may announce nothing.

**Errors are gated on touched-or-submitted.** `email.error.visible` is
`invalid && (touched || status === 'submitted')`. That is why validating on every keystroke
is safe: a field that has never been focused stays quiet until submit calls `touchAll`.

### Async validation

For a uniqueness check, dispatch `validateAsync` with a `requestId`, run
`formField.validateSchemaAsync` in an effect, and dispatch `validateResult` with the same
id. A result whose id no longer matches is **dropped** — a slow earlier validation can
never overwrite a newer one. Every field reports `aria-busy` while one is in flight.

## 6. Customize

Four levels, cheapest first.

### Pass a `class`

Every part takes one, and it **wins** over the recipe — the registry routes `class` through
`mergeClass`, which is `tailwind-merge`, so `p-2` beats a recipe's `p-4` rather than losing
to it by source order.

```ts
Button({ variant: 'outline', class: 'w-full' }, [text('Save')])
```

A reactive class works too, but the conditional goes **inside** the `.map` body — the
compiler rejects an operator applied to a Signal:

```ts
// wrong — `&&` applied to a Signal, and a build error
class: cn('base', state.at('open') && 'is-open')
// right — one binding, plain values inside
class: state.at('open').map((open) => cn('base', open && 'is-open'))
```

### Style from `data-*` — the idiomatic way

You should rarely need a computed class. Every part already publishes its state as
attributes, so the branch belongs in the recipe:

```ts
'data-[state=open]:bg-muted data-[disabled]:opacity-50 data-[orientation=vertical]:flex-col'
```

**Check what the machine actually publishes** before writing the selector. A recipe naming
an attribute nobody emits is valid CSS that never matches — no error, no warning, just a
rule that does nothing. The part bag's TypeScript type is the list. The most common
mismatches are between similar-looking spellings: bare presence (`data-highlighted`) versus
an enum (`data-[state=highlighted]`), and `data-axis` versus `data-orientation`.

### Edit the recipe

It is your file. Change the classes.

The one thing to know: the repo's class checker reads recipes from named positions —
arguments to `cn` / `mergeClass` / `classPart`, and `createVariants`'s `base` / `variants` /
`compoundVariants[].class`. A recipe assembled some other way still works, it is just no
longer checked. Prefer `createVariants` over a template literal for anything conditional; a
template contributes only its static text.

### Restyle on the baseline path

There is no recipe to edit, so overrides go in your own CSS against the parts the machine
publishes:

```css
[data-scope='dialog'][data-part='content'] {
  max-width: 32rem;
}
[data-scope='switch'][data-part='root'][data-state='checked'] {
  background: var(--primary);
}
```

Your rules are unlayered like the sheet's, so plain source order decides — import
`theme.css` first, then your overrides. Most restyling should not need this: the tokens
below reach every rule in the sheet.

### Retheme

**Both paths share this.** `tokens.css` defines shadcn's token names (`--background`,
`--primary`, `--primary-foreground`, `--radius`, …) in `:root`, and `theme.css` imports the
same file — so **any shadcn theme generator's output pastes in verbatim**, and a theme you
build survives a move between the two paths:

```css
@import '@llui/components/styles/tokens.css';

:root {
  --primary: oklch(0.55 0.2 265);
  --radius: 0.75rem;
}
```

Derived interaction tokens (`--primary-hover`, `--accent-strong`, `--border-hover`) are
`color-mix()` expressions toward `--foreground`, so they follow a base token automatically
and darken in light mode while lightening in dark. Do not restate them per theme.

Dark mode activates on `.dark`, `[data-theme='dark']` **and** `prefers-color-scheme` — the
first is what shadcn tooling writes, the second is what `@llui/components/theme-switch`
writes.

## 7. Charts

`llui add chart` gives you shadcn's container, tooltip and legend recipes over
`@llui/components/chart` — a plotting machine that derives geometry as data and
lets you render it with ordinary SVG.

> **Identical on both paths**, except that the recipes are a registry item. The
> machine, the geometry and the `data-*` are the same either way.

### One field decides the coordinate system

```ts
send({ type: 'setCoord', coord: 'polar' })
```

That is the whole switch. Every mark, gridline, tick, hit test and tooltip anchor
re-projects from the same series and the same data:

| Series         | Cartesian        | Polar                  |
| -------------- | ---------------- | ---------------------- |
| `mark: 'line'` | a polyline       | a radar outline        |
| `mark: 'area'` | a filled band    | a filled radar polygon |
| `mark: 'bar'`  | a bar            | a wedge (rose / donut) |
| gridlines      | horizontal rules | rings, or a radar web  |

`horizontal` is the other projection flag, and it means the same thing in both
systems: the independent axis moves off its default screen axis. Cartesian, that
turns a column chart on its side. Polar, it moves the categories off the angle
and onto the radius — concentric rings whose arc length is the magnitude, which
is a radial bar chart.

Your view never asks which one it has. Everything the coordinate system touches
lives in `utils/projection.ts`, behind a `Projection` interface with two
implementations.

### Setting one up

```ts
import * as chartC from '@llui/components/chart'

chartC.init({
  series: [
    { key: 'desktop', label: 'Desktop', mark: 'bar' },
    { key: 'mobile', label: 'Mobile', mark: 'bar' },
  ],
  rows: [
    { label: 'Jan', values: { desktop: 186, mobile: 80 } },
    { label: 'Feb', values: { desktop: 305, mobile: 200 } },
  ],
  label: 'Visitors by device',
  description: 'Desktop and mobile visitors this year.',
})
```

Colours come from a `ChartConfig` on the container, which publishes them as
`--color-<key>` custom properties — upstream's `ChartStyle`, without the
generated id:

```ts
ChartContainer({ ...parts.root, config: {
  desktop: { label: 'Desktop', color: 'var(--chart-1)' },
  mobile: { label: 'Mobile', color: 'var(--chart-2)' },
} }, [ … ])
```

`--chart-1` … `--chart-5` are already in the theme, light and dark.

### Rendering the geometry

`connect` returns derived arrays as signals. Render them with `each` — this is
ordinary reactive DOM, not a black box:

```ts
ChartSvg({ ...parts.svg }, [
  ChartTitle({ ...parts.title }, [text(state.at('label'))]),
  ChartDesc({ ...parts.desc }, [text(state.at('description'))]),
  ChartLayer({ ...parts.layer }, [
    each(parts.gridLines, {
      key: (l) => String(l.value),
      render: (l) => [ChartGrid({ ...parts.grid, d: l.at('d') })],
    }),
  ]),
  ChartLayer({ ...parts.layer }, [
    each(parts.marks, {
      key: (m) => `${m.seriesKey}:${m.index ?? 'all'}`,
      render: (m) => {
        const mark = m.peek()
        return [
          ChartMark({
            ...parts.markProps(mark),
            d: m.at('d'),
            style: `--mark-color:var(--color-${mark.seriesKey})`,
          }),
        ]
      },
    }),
  ]),
])
```

### Sizing

`width` / `height` are user units and go straight into the `viewBox`, so the
geometry is a pure function of state — no layout read, no `ResizeObserver`, and
an SSR render matches the client. CSS scales it. For true 1:1 pixels, observe
your container and dispatch `setSize`; for a polar chart, a square box uses the
space a wide one wastes.

### Accessibility is a table

The `<svg>` is `role="img"`, named through its own `<title>` and `<desc>`. The
numbers live in a visually-hidden `<table>` beside it — render it from the same
rows and spread `parts.table`. That is the fallback that works today; support
for the WAI-ARIA graphics roles is still thin enough that a chart relying on
them announces a name and nothing else.

Arrow keys walk the rows, Home/End jump to the ends, Escape clears — and the
tooltip is a `role="status"` live region, so the cursor is announced as it moves.

### Two things that surprise people

**Polar draws `monotone` as `linear`, on purpose.** Monotone cubic's guarantee
is that it never overshoots between two samples, and it is defined on a function
`y = f(x)` with increasing `x`. A closed angular loop has no such ordering, so
honouring the request would draw values nobody measured. `projection.curves`
tells you what is supported.

**Unstacked bar series sit side by side, not on top of each other.** Overlaying
them hides the shorter series and reads as a stacked chart — the picture would
not merely omit data, it would misstate it. `setStacked` is the other layout.

### Pie and donut: there is no `pie` mark

A pie is a bar whose magnitude has moved from the value axis onto the
_independent_ one. `domain` picks which:

| `domain`  | The independent axis             | Magnitude is           |
| --------- | -------------------------------- | ---------------------- |
| `'value'` | one equal slot per category      | `v` — a bar's height   |
| `'share'` | a slot proportional to the value | `u` — a slice's extent |

```ts
chartC.init({
  series: [{ key: 'visitors', label: 'Visitors', mark: 'bar' }],
  rows: [
    { label: 'Chrome', values: { visitors: 275 } },
    { label: 'Safari', values: { visitors: 200 } },
  ],
  domain: 'share',
  coord: 'polar',
  innerRadius: 0.5, // 0 is a pie, 0.5 a donut
})
```

One series, many rows — the slices are the rows, which is how a pie is actually
shaped. Because it is a domain rather than a mark type, `coord` still
re-projects **one** dataset: flip it to `'cartesian'` and the same state is a
single full-width 100%-share bar, with the segment widths matching the wedge
angles exactly.

Three things it declines, each for the same reason polar declines `monotone`:

- **No padding between slices.** The slot _is_ the datum, so a gap would make
  every slice misstate its share and a full turn stop being 100%. Separate them
  with a stroke in the skin, which is what shadcn's own pie does.
- **A negative value takes no arc.** A share of a negative is undefined, and
  both silent readings are wrong: using the magnitude draws a slice for a number
  nobody measured, and letting it subtract pushes the total past 1.
- **`line` and `area` are not drawn.** An axis whose spacing already encodes the
  magnitude would place every point at a position meaning something else.

There are no value gridlines under `'share'` — the magnitude is the spacing, so
an iso-magnitude ring would say nothing about the data. `tooltipRows` carries a
`share` alongside each `value` (and `null` under `'value'`), which is what a pie
tooltip shows as a percentage.

## 8. Icons

`llui add icons` gives you the glyphs shadcn/ui bakes into its own components —
`SelectTrigger`'s chevron, `Checkbox`'s tick, `DialogClose`'s ✕ — plus a way to
name any other one.

```ts
import { CheckIcon, icon } from '@/ui/icons'

CheckIcon({ class: 'size-4' })
icon('lucide:star')({ class: 'size-5' })
icon('simple-icons:github')() // any Iconify set, by prefix
```

Glyphs are fetched from the [Iconify](https://iconify.design) HTTP API by
`prefix:name`, batched into **one request per prefix per tick**. What you get in
the DOM is a real `<svg>` — not an `<img>` and not the `iconify-icon` web
component, either of which would slip past the `[&_svg:not([class*='size-'])]:size-4`
hook every recipe uses to size its icons.

A glyph carries **no size of its own**. That is deliberate: the recipe sizes it,
and passing `class: 'size-3'` lets you override that. Colour comes from
`currentColor`, so it inherits from whatever it sits in.

Two consequences worth planning for:

- **Icons are async.** An SSR render emits the sized, empty `<svg>` and the
  glyph arrives after hydration. The box is sized up front, so nothing reflows.
- **They need the network.** A CSP that does not allow `api.iconify.design`, or
  an offline user, gets the empty box and one console warning. Point
  `iconConfig.api` at a self-hosted Iconify to remove the third-party
  dependency — the path shape is identical.

The API response is third-party markup and is never assigned to `innerHTML`:
every node is rebuilt from an element and attribute allowlist, so a `<script>`,
an `onload` or an `href` in the response is dropped with its subtree.

## Gotchas

These are the ones that have actually cost people time. Each is silent: the component works,
the types check, and something looks wrong or does nothing.

**Some machines do not track the pointer, on purpose.** `slider` and `splitter` are
keyboard-complete out of the box but ignore the mouse until you wire the drag, because only
your view knows which element's rect a percentage is measured against. Each exports the
helper (`valueFromPoint`, `positionFromPoint`) and expects an `onMount` that attaches
`pointermove`/`pointerup` **to the window** — a drag routinely outruns the handle and
`pointerup` lands anywhere on the page. Symptom: arrow keys work, the mouse does nothing.

**Some parts do not hide themselves.** Radix unmounts a radio indicator when unchecked;
LLui keeps it in the DOM and publishes `data-state` on the item, so the dot is gated in CSS
(`group-data-[state=unchecked]/radio-item:invisible`). Same shape for a command palette's
empty state (`hidden data-empty:block`). Ungated, you get every radio filled, or "No
results" above a full list.

**A live region's `text` is a CHILD, not an attribute.** `combobox`'s `liveRegion` bag
carries `text: Signal<string>`; spreading the whole bag emits a literal `text="…"` on an
`aria-live` element with no content, which announces nothing:

```ts
const { text: liveText, ...liveAttrs } = parts.liveRegion
ComboboxLiveRegion({ ...liveAttrs }, [text(liveText)])
```

**Do not wrap a field in a panel recipe.** `ComboboxRoot` is the `Command` recipe — a full
palette _surface_ with `overflow-hidden`, for the dropdown. Wrapping a labelled input in it
clips the input's focus ring on three sides, which paints as a thick dark band along one
edge and looks like a border bug.

**A live region must stay mounted.** Toggle it with `hidden` or a class, never `show` —
unmounting and remounting an `aria-live` element announces nothing.

**Keyed rows need a stable element root.** A row in `each` must be one or more real
elements, never a bare fragment or a top-level `show`/`branch`. Without a stable handle,
reorder throws `NotFoundError` or duplicates rows.

## Where to look next

- **[The registry demo](/examples)** — every component, wired. Its section files are the
  reference for any part bag you are unsure about.
- **[Styling & Registry](/styling)** — the token contract and the registry's own rules.
- **[Composition Patterns](/composition-patterns)** — factoring views, and when a child
  component boundary is worth it.
- **[API Reference](/api/components)** — every part bag's exact type, which is the
  authoritative answer to "what does this publish?".
