import { div, img, span } from '@llui/dom'
import { classPart, classPartWithDefaults } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). Upstream keys its size scale off
 * its own `size` prop (`sm`/`default`/`lg`, `data-size` below, classes
 * VERBATIM) — restored as its OWN axis (#264 item F5), after a prior revision
 * of this file replaced it outright with `@llui/components/avatar`'s
 * `connect()`-published `data-density` (`'comfortable' | 'compact'` —
 * `AvatarDensity`) and lost upstream's `lg` rung entirely, which
 * `registry-attrs.test.ts`'s allowance for `avatar.ts: data-size` ("a
 * presentational size the consumer sets") had already anticipated staying
 * live.
 *
 * Both axes now coexist rather than one replacing the other: `data-size` is
 * the full three-rung upstream scale, set directly by a consumer (a static
 * render, or one that never wires up the machine at all) and defaulted to
 * `'default'` exactly as upstream defaults its own prop — that default is
 * what makes the COMPOUND selectors below (`data-[size=default]:data-[density=…]:`)
 * match a live-machine instance that never sets `data-size` itself, and it
 * is the one thing this file relies on `classPartWithDefaults` for; nothing
 * here depends any more on a rung's own rule being conditioned on
 * `size=default` (see BLOCK 1's note on `AvatarBadge` below). `data-density`
 * is the machine's own two-rung axis (no `lg` — `AvatarDensity` has exactly
 * two members, see `packages/components/src/components/avatar.ts` and
 * `navigation-data-contract.test.ts`'s non-circular density-cap check), and
 * `compact` maps onto the SAME geometry as `data-size=sm`.
 *
 * **Every density-driven declaration is GATED on `data-size=default`,
 * deterministically, never as a same-specificity same-property duplicate
 * (#264 review LOW — `size=lg` + `density=compact` measured as an
 * unpredictable tie: root and badge WIDTH happened to resolve to `lg`'s
 * value, but the badge's icon and the fallback's text size did NOT,
 * resolving to `compact`'s instead — a tie broken by Tailwind's internal
 * declaration order, not by anything this file controls or a reader can
 * predict from the source alone).** A bare `data-[density=compact]:` /
 * `group-data-[density=compact]/avatar:` competes on EQUAL specificity with
 * `data-[size=lg]:` / `group-data-[size=lg]/avatar:` whenever a consumer sets
 * BOTH axes explicitly, and which one wins is an implementation detail of
 * Tailwind's utility ordering. The fix is a genuine AND, spelled as a
 * DIRECT compound selector (`data-[size=default]:data-[density=compact]:…` /
 * chained `group-data-[…]/avatar:group-data-[…]/avatar:…` for a descendant
 * reading the root's group state) rather than two independent declarations
 * of the same property: it structurally CANNOT match once a consumer has
 * set `data-size` to anything other than `'default'` (the only value
 * `classPartWithDefaults` ever supplies on its own), so an explicit `lg`/`sm`
 * always wins over density, by construction, regardless of stylesheet order.
 * `comfortable` needs no rule of its own anywhere in this file — it is
 * exactly `default`'s look, so once `AvatarBadge`'s default rung is
 * unconditional (below) there is nothing left to state for it.
 *
 * **`AvatarBadge`'s DEFAULT rung must be UNCONDITIONAL, not a
 * `group-data-[size=default]/avatar:` variant (#264 review, BLOCK 1).**
 * Upstream spells every rung — including default — as a conditional variant,
 * which works there because `size` is upstream's ONLY axis: with `data-size`
 * ALWAYS present (defaulted), `group-data-[size=default]/avatar:size-2.5`
 * and `group-data-[size=sm]/avatar:size-2` never compete on the SAME
 * element, since only one value can ever be present at a time. Adding
 * `data-density` as a SECOND, independent axis broke that precondition
 * before the compound-selector fix above existed: a machine-wired instance
 * carries `data-size="default"` (the `classPartWithDefaults` default, never
 * overridden by the machine) AND `data-density="compact"` simultaneously, so
 * `group-data-[size=default]/avatar:size-2.5` and a bare
 * `group-data-[density=compact]/avatar:size-2` were EQUAL specificity on the
 * same element — measured, the compiled stylesheet resolved that tie to
 * `size-2.5` (badge rendered 10px instead of 8px), silently un-mapping
 * `compact` back onto `default`'s look. The fix is to stop the default rung
 * from being conditional AT ALL: it is a bare, unconditional class
 * (`size-2.5 [&>svg]:size-2`), so there is nothing for `sm`'s or `compact`'s
 * OVERRIDE to tie against — an override wins simply by being a more specific
 * STATE, not by winning a same-specificity tie. `lg` needs no `[&>svg]`
 * override at all, since its icon is the same size as the (now unconditional)
 * default.
 */
export const Avatar = classPartWithDefaults(
  div,
  'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6 data-[size=default]:data-[density=compact]:size-6',
  // Defaulted so a live-machine consumer that never sets `data-size` itself
  // still matches the `data-[size=default]:data-[density=…]:` compound
  // selectors above/below — mirrors upstream defaulting its own `size` prop
  // to `'default'`.
  { 'data-size': 'default' },
)
export const AvatarImage = classPart(img, 'aspect-square size-full')
export const AvatarFallback = classPart(
  span,
  'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs group-data-[size=default]/avatar:group-data-[density=compact]/avatar:text-xs',
)
export const AvatarBadge = classPart(
  span,
  'absolute end-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none size-2.5 [&>svg]:size-2 group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden group-data-[size=lg]/avatar:size-3 group-data-[size=default]/avatar:group-data-[density=compact]/avatar:size-2 group-data-[size=default]/avatar:group-data-[density=compact]/avatar:[&>svg]:hidden',
)

/**
 * A stack of overlapping avatars. Both `data-size` (upstream's own axis,
 * verbatim) and `data-density` (the machine's, mapping `compact` onto the
 * same rung as `size=sm`) resize every member through
 * `group-has-data-[…]/avatar-group:`, which is why the members read the
 * group rather than each carrying their own size/density. Density's rules
 * are gated on `data-size=default` for the identical reason `Avatar`'s own
 * root sizing is above.
 */
export const AvatarGroup = classPart(
  div,
  'group/avatar-group flex -space-x-2 *:ring-2 *:ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 group-has-data-[size=default]/avatar-group:group-has-data-[density=compact]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3 group-has-data-[size=default]/avatar-group:group-has-data-[density=compact]/avatar-group:[&>svg]:size-3',
)
