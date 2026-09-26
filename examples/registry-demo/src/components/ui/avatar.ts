import { div, img, span } from '@llui/dom'
import { classPart, classPartWithDefaults } from '../../lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with ONE deliberate departure
 * from verbatim: upstream keys its size scale off its own `size` prop
 * (`sm`/`default`/`lg`), but `@llui/components/avatar`'s `connect()` already
 * publishes a REACTIVE `data-density` (`'comfortable' | 'compact'` —
 * `AvatarDensity`) on `parts.root` for exactly this purpose. Reading a
 * SEPARATE `data-size` attribute nothing in this package ever publishes made
 * every consumer responsible for translating one into the other by hand —
 * `registry/test/navigation-data-scenario-renderer.ts`'s avatar adapter did
 * exactly that (`'data-size': input.density === 'compact' ? 'sm' :
 * 'default'`), and the translation lived ONLY there, invisible to every
 * other consumer (#264 review item 7). One vocabulary: `data-density`
 * drives the dimensions and the fallback's text size through the
 * `group/avatar` name, and a bare `Avatar({ ...parts.root }, …)` — the
 * spread every OTHER part in this file already does — is now enough.
 *
 * `AvatarDensity` has exactly two members (see
 * `packages/components/src/components/avatar.ts`, and
 * `navigation-data-contract.test.ts`'s non-circular density-cap check), so
 * upstream's THIRD `lg` rung has no live density value to key off — it is
 * dropped rather than left as dead CSS `registry-attrs.test.ts` would flag
 * (a selector value nobody publishes). Every upstream Tailwind class this
 * file keeps is unchanged; the departure is the selector attribute/value
 * names above it, not the geometry.
 */
export const Avatar = classPartWithDefaults(
  div,
  'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[density=compact]:size-6',
  // Defaulted so the fallback/badge's `group-data-[density=comfortable]/avatar:`
  // rules match even when no machine is wired up at all (a static render).
  { 'data-density': 'comfortable' },
)
export const AvatarImage = classPart(img, 'aspect-square size-full')
export const AvatarFallback = classPart(
  span,
  'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[density=compact]/avatar:text-xs',
)
export const AvatarBadge = classPart(
  span,
  'absolute end-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none group-data-[density=compact]/avatar:size-2 group-data-[density=compact]/avatar:[&>svg]:hidden group-data-[density=comfortable]/avatar:size-2.5 group-data-[density=comfortable]/avatar:[&>svg]:size-2',
)

/**
 * A stack of overlapping avatars. `data-density` on the GROUP resizes every
 * member through `group-has-data-[density=…]/avatar-group:`, which is why
 * the members read the group rather than each carrying their own density.
 */
export const AvatarGroup = classPart(
  div,
  'group/avatar-group flex -space-x-2 *:ring-2 *:ring-background group-has-data-[density=compact]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[density=compact]/avatar-group:[&>svg]:size-3',
)
