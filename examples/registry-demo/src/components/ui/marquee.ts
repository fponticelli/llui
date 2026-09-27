import { div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Marquee — skin for `@llui/components/marquee`. No shadcn counterpart.
 *
 * The machine supplies animation variables as an inline `style` on the root
 * and publishes `data-axis`, `data-direction` and `data-running`. This skin
 * owns the CLIP, axis layout and edge fade; the consumer still supplies the
 * duplicated loop content and an animation that reads those variables.
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
  'group/marquee relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] data-[axis=vertical]:flex-col data-[axis=vertical]:[mask-image:linear-gradient(to_bottom,transparent,black_10%,black_90%,transparent)] data-[disabled]:opacity-50',
)
export const MarqueeContent = classPart(
  div,
  'flex shrink-0 items-center gap-4 group-data-[axis=vertical]/marquee:flex-col',
)
