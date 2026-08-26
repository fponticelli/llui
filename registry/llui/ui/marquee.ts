import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Marquee — skin for `@llui/components/marquee`. No shadcn counterpart.
 *
 * The machine supplies the animation itself as an inline `style` on the
 * content, and publishes `data-axis`, `data-direction` and `data-running`. This
 * skin therefore owns only the CLIP and the edge fade: overriding the animation
 * from here would fight the inline style it cannot win against, and `-running`
 * is already reflected in the style the machine writes.
 *
 * The fade is a `mask-image`, not a pair of gradient overlays, so it works over
 * any background — an overlay has to know the surface colour, and gets it wrong
 * the moment the marquee is placed on a card.
 *
 * `overflow-hidden` is load-bearing: without it the duplicated track is simply
 * visible running off both edges.
 */
export const Marquee = classPart(
  div,
  'relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] data-[axis=vertical]:flex-col',
)
export const MarqueeContent = classPart(
  div,
  'flex shrink-0 items-center gap-4 data-[axis=vertical]:flex-col',
)
