import { button, div, li, ol } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** Steps — skin for `@llui/components/steps`. A stepper/wizard indicator;
 * `data-state` is `complete` / `current` / `incomplete`. */
export const Steps = classPart(
  ol,
  'flex w-full items-center gap-2 data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-start',
)
export const StepsItem = classPart(li, 'flex flex-1 items-center gap-2')
export const StepsTrigger = classPart(
  button,
  'inline-flex items-center gap-2 rounded-md text-sm font-medium transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[status=current]:text-foreground data-[status=pending]:text-muted-foreground data-[status=completed]:text-foreground data-[status=error]:text-destructive data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const StepsSeparator = classPart(
  div,
  'h-px flex-1 bg-border data-[status=completed]:bg-primary',
)
