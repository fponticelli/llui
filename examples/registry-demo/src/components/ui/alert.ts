import { div } from '@llui/dom'
import { classPart, createVariantsPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * A GRID, not a flex row: the icon occupies the first column only when one is
 * present (`has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr]`), and the title
 * and description both start in column 2. That is what keeps the text block
 * aligned under itself rather than wrapping beneath the icon.
 *
 * `role="alert"` is applied before the caller's spread so a caller wiring a
 * `status`/`log` live region instead can override it.
 */
export const Alert = createVariantsPart(div, {
  base: 'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      destructive:
        'bg-card text-destructive *:data-[part=alert-description]:text-destructive/90 [&>svg]:text-current',
    },
  },
  defaultVariants: { variant: 'default' },
})

export const AlertTitle = classPart(
  div,
  'col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight',
)
export const AlertDescription = classPart(
  div,
  'col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed',
)
