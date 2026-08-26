import { div, p } from '@llui/dom'
import { classPart } from '@/lib/utils'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
export const Empty = classPart(
  div,
  'flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12',
)
export const EmptyHeader = classPart(div, 'flex max-w-sm flex-col items-center gap-2 text-center')
export const EmptyMedia = classPart(
  div,
  "mb-2 flex shrink-0 items-center justify-center size-10 rounded-lg bg-muted text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6",
)
export const EmptyTitle = classPart(div, 'text-lg font-medium tracking-tight')
export const EmptyDescription = classPart(
  p,
  'text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
)
export const EmptyContent = classPart(
  div,
  'flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance',
)
