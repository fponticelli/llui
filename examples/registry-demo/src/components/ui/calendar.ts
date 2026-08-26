import { button, div, td, tr } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Calendar / DatePicker — skin for `@llui/components/date-picker`. shadcn splits
 * these into Calendar (the grid) and Date Picker (grid inside a popover); LLui
 * has one machine, so both names point here.
 *
 * Day cells carry `data-state` (`selected` / `today` / `outside` / `disabled`)
 * and `data-in-range`, so a range selection needs no view logic.
 */
export const Calendar = classPart(div, 'w-fit rounded-lg border border-border bg-popover p-3')
export const CalendarGrid = classPart(div, 'w-full border-collapse')
export const CalendarRow = classPart(tr, 'flex w-full')
export const CalendarDay = classPart(
  td,
  'relative flex size-9 items-center justify-center p-0 text-center text-sm',
)
export const CalendarDayButton = classPart(
  button,
  'inline-flex size-9 items-center justify-center rounded-md text-sm font-normal transition-colors duration-fast outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=selected]:bg-primary data-[state=selected]:text-primary-foreground data-[state=today]:border data-[state=today]:border-border data-[state=outside]:text-muted-foreground data-[state=outside]:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
)
export const CalendarNav = classPart(
  button,
  'inline-flex size-7 items-center justify-center rounded-md border border-border transition-colors duration-fast outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const CalendarPreset = classPart(
  button,
  'rounded-md px-2 py-1 text-xs font-medium transition-colors duration-fast hover:bg-accent hover:text-accent-foreground',
)

export { Calendar as DatePicker, CalendarDayButton as DatePickerDay }
