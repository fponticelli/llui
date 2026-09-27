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
 * `'default'` exactly as upstream defaults its own prop. `data-density` is
 * the machine's own two-rung axis (no `lg` — `AvatarDensity` has exactly two
 * members, see `packages/components/src/components/avatar.ts` and
 * `navigation-data-contract.test.ts`'s non-circular density-cap check), and
 * `compact` maps onto the SAME geometry as `data-size=sm` by carrying a
 * SECOND, duplicate `group-data-[density=compact]/avatar:` declaration
 * alongside every `group-data-[size=sm]/avatar:` one — harmless CSS
 * (Tailwind applies the identical utility twice), and it is what lets a
 * live-machine consumer spread `{ ...parts.root }` (no `data-size` at all)
 * and still get the `sm` rung's look the moment density goes `compact`,
 * without a hand-rolled translation living in one consumer only
 * (`registry/test/navigation-data-scenario-renderer.ts`'s avatar adapter did
 * exactly that before #264 review item 7, and the translation was invisible
 * to every other consumer). `comfortable` maps onto `default`'s geometry the
 * same way. A consumer combining both axes explicitly (`data-size='lg'` on a
 * machine reporting `compact`) gets `lg` PLUS the compact-mapped rules — the
 * two axes are independent, so `lg` is never capped by density having no
 * equivalent rung.
 */
export const Avatar = classPartWithDefaults(
  div,
  'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6 data-[density=compact]:size-6',
  // Defaulted so the fallback/badge's `group-data-[size=default]/avatar:`
  // rules match even when no machine and no explicit `data-size` are wired up
  // at all (a static render) — mirrors upstream defaulting its own `size`
  // prop to `'default'`.
  { 'data-size': 'default' },
)
export const AvatarImage = classPart(img, 'aspect-square size-full')
export const AvatarFallback = classPart(
  span,
  'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs group-data-[density=compact]/avatar:text-xs',
)
export const AvatarBadge = classPart(
  span,
  'absolute end-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2 group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2 group-data-[density=compact]/avatar:size-2 group-data-[density=compact]/avatar:[&>svg]:hidden group-data-[density=comfortable]/avatar:size-2.5 group-data-[density=comfortable]/avatar:[&>svg]:size-2',
)

/**
 * A stack of overlapping avatars. Both `data-size` (upstream's own axis,
 * verbatim) and `data-density` (the machine's, mapping `compact` onto the
 * same rung as `size=sm`) resize every member through
 * `group-has-data-[…]/avatar-group:`, which is why the members read the
 * group rather than each carrying their own size/density.
 */
export const AvatarGroup = classPart(
  div,
  'group/avatar-group flex -space-x-2 *:ring-2 *:ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 group-has-data-[density=compact]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3 group-has-data-[density=compact]/avatar-group:[&>svg]:size-3',
)
