import { div, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** RatingGroup — skin for `@llui/components/rating-group`. No shadcn equivalent;
 * the package supplies keyboard navigation and half-star support. */
export const RatingGroup = classPart(div, 'inline-flex items-center gap-0.5')
export const RatingGroupItem = classPart(
  span,
  'cursor-pointer text-muted-foreground transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[highlighted]:text-primary data-[state=half]:text-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-5',
)
