import { button, div, td, tr } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { buttonVariants } from './button'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), condensed.
 *
 * shadcn's Calendar wraps `react-day-picker` and its recipe is a large
 * `classNames` map keyed to that library's internal slots; only the parts with
 * an `@llui/components/date-picker` counterpart are kept. The sizing idiom is
 * shadcn's and is load-bearing: `--cell-size` on the root drives every cell,
 * so one custom property resizes the whole grid.
 *
 * Day buttons reuse `buttonVariants({ variant: 'ghost' })`, as shadcn's do.
 */
export const Calendar = classPart(
  div,
  'group/calendar bg-background p-3 [--cell-size:--spacing(8)] [[data-part=card-content]_&]:bg-transparent [[data-part=popover-content]_&]:bg-transparent',
)
export const CalendarHeader = classPart(
  div,
  'flex w-full items-center justify-between gap-1 h-(--cell-size)',
)
export const CalendarGrid = classPart(div, 'flex w-full flex-col gap-4')
export const CalendarRow = classPart(tr, 'flex w-full')
export const CalendarWeekday = classPart(
  div,
  'flex-1 select-none rounded-md text-[0.8rem] font-normal text-muted-foreground',
)
export const CalendarDay = classPart(
  td,
  'relative aspect-square h-full w-full p-0 text-center select-none group/day',
)
export const CalendarDayButton = classPart(
  button,
  `${buttonVariants({ variant: 'ghost' })} flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal data-[state=selected]:bg-primary data-[state=selected]:text-primary-foreground data-[state=today]:bg-accent data-[state=today]:text-accent-foreground data-[state=outside]:text-muted-foreground data-[state=outside]:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:text-muted-foreground data-[disabled]:opacity-50 data-[in-range]:rounded-none data-[in-range]:bg-accent group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring/50`,
)
export const CalendarNav = classPart(
  button,
  `${buttonVariants({ variant: 'ghost' })} size-(--cell-size) p-0 aria-disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50`,
)
export const CalendarPreset = classPart(
  button,
  `${buttonVariants({ variant: 'ghost', size: 'sm' })} justify-start`,
)

export { Calendar as DatePicker, CalendarDayButton as DatePickerDay }
