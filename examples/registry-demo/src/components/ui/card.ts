import { div, h3, p } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten
 * to LLui's `data-part`.
 *
 * The header is a GRID, not a flex column, and that is what makes `CardAction`
 * work: the action occupies `col-start-2 row-span-2`, so a trailing button sits
 * beside the title AND description without either wrapping around it. The second
 * column only exists when an action is present
 * (`has-data-[part=card-action]:grid-cols-[1fr_auto]`), so a header without one
 * is unaffected.
 *
 * `[.border-b]:pb-6` / `[.border-t]:pt-6` add the padding only when the caller
 * has put a divider on that part — the padding and the rule arrive together
 * rather than the caller having to remember both.
 */
export const Card = classPart(
  div,
  'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm',
)
export const CardHeader = classPart(
  div,
  '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[part=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
)
export const CardTitle = classPart(h3, 'leading-none font-semibold')
export const CardDescription = classPart(p, 'text-sm text-muted-foreground')
export const CardAction = classPart(
  div,
  'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
)
export const CardContent = classPart(div, 'px-6')
export const CardFooter = classPart(div, 'flex items-center px-6 [.border-t]:pt-6')
