import { div, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** RatingGroup — skin for `@llui/components/rating-group`. No shadcn equivalent;
 * the package supplies keyboard navigation and half-star support. */
export const RatingGroup = classPart(div, 'inline-flex items-center gap-0.5')
export const RatingGroupItem = classPart(
  span,
  'cursor-pointer text-muted-foreground transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[fill=full]:text-primary data-[fill=half]:bg-[linear-gradient(to_right,var(--primary)_50%,var(--muted-foreground)_50%)] data-[fill=half]:bg-clip-text data-[fill=half]:text-transparent rtl:data-[fill=half]:bg-[linear-gradient(to_left,var(--primary)_50%,var(--muted-foreground)_50%)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 forced-colors:forced-color-adjust-none forced-colors:text-[GrayText] forced-colors:data-[fill=full]:text-[Highlight] forced-colors:data-[fill=half]:bg-[linear-gradient(to_right,Highlight_50%,GrayText_50%)] forced-colors:data-[fill=half]:bg-clip-text forced-colors:data-[fill=half]:text-transparent rtl:forced-colors:data-[fill=half]:bg-[linear-gradient(to_left,Highlight_50%,GrayText_50%)] [&_svg]:size-5',
)
