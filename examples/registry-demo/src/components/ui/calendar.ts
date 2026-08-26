import { button, div, td, th, tr } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { buttonVariants } from './button'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten to
 * LLui's `data-part`.
 *
 * shadcn's Calendar wraps `react-day-picker` and passes it a `classNames` map
 * keyed to that library's internal slots. There is no day-picker here, so the
 * map is re-expressed as named parts — the CLASS STRINGS are upstream's, only
 * the delivery differs.
 *
 * Two idioms carry the layout:
 *
 *  - **`--cell-size` on the root.** Every cell, the nav buttons and the caption
 *    row size from it (`size-(--cell-size)`, `min-w-(--cell-size)`), so one
 *    custom property resizes the whole grid. Overriding `[--cell-size:…]` on the
 *    root is the supported way to make a compact or a large calendar.
 *  - **`group/day` on the cell.** The focus ring lives on the day BUTTON but is
 *    driven by `data-focused` on its cell, via
 *    `group-data-[focused=true]/day:`. Dropping the group name silently removes
 *    keyboard focus indication from every day.
 *
 * Range selection is expressed entirely in `data-*` — `data-range-start`,
 * `-middle`, `-end`, `data-selected-single` — so a range never needs a view to
 * compute a class.
 */
export const Calendar = classPart(
  div,
  'group/calendar w-fit bg-background p-3 [--cell-size:--spacing(8)] [[data-part=card-content]_&]:bg-transparent [[data-part=popover-content]_&]:bg-transparent',
)
export const CalendarMonths = classPart(div, 'relative flex flex-col gap-4 md:flex-row')
export const CalendarMonth = classPart(div, 'flex w-full flex-col gap-4')
export const CalendarNav = classPart(
  div,
  'absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1',
)
const navButtonRecipe = `${buttonVariants({ variant: 'ghost' })} size-(--cell-size) p-0 select-none aria-disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50`
export const CalendarPrevious = classPart(button, navButtonRecipe)
export const CalendarNext = classPart(button, navButtonRecipe)
export const CalendarCaption = classPart(
  div,
  'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
)
export const CalendarCaptionLabel = classPart(div, 'text-sm font-medium select-none')
/** The caption label when the month/year DROPDOWN layout is used — it becomes a
 * control with a chevron rather than plain text. */
export const CalendarCaptionLabelDropdown = classPart(
  div,
  'font-medium select-none flex h-8 items-center gap-1 rounded-md pr-1 pl-2 text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground',
)
/** The month/year dropdown controls shadcn offers as an alternative caption. The
 * native `<select>` is transparent and stacked over a styled shell, which is how
 * it keeps the platform picker while looking like the rest of the theme. */
export const CalendarDropdowns = classPart(
  div,
  'flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium',
)
export const CalendarDropdownRoot = classPart(
  div,
  'relative rounded-md border border-input shadow-xs has-focus:border-ring has-focus:ring-[3px] has-focus:ring-ring/50',
)
export const CalendarDropdown = classPart(div, 'absolute inset-0 bg-popover opacity-0')
export const CalendarGrid = classPart(div, 'w-full border-collapse')
export const CalendarWeekdays = classPart(tr, 'flex')
export const CalendarWeekday = classPart(
  th,
  'flex-1 rounded-md text-[0.8rem] font-normal text-muted-foreground select-none',
)
export const CalendarRow = classPart(tr, 'mt-2 flex w-full')

/** The cell. `group/day` is read by the day button's focus ring, and the
 * `first-child` / `last-child` rules are what round the ends of a range. */
export const CalendarDay = classPart(
  td,
  'group/day relative aspect-square h-full w-full p-0 text-center select-none [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md data-[state=today]:rounded-md data-[state=today]:bg-accent data-[state=today]:text-accent-foreground data-[state=outside]:text-muted-foreground data-[state=outside]:opacity-50 data-[disabled]:text-muted-foreground data-[disabled]:opacity-50 data-[hidden]:invisible',
)

export const CalendarDayButton = classPart(
  button,
  `${buttonVariants({ variant: 'ghost' })} flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring/50 data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[state=selected]:bg-primary data-[state=selected]:text-primary-foreground dark:hover:text-accent-foreground [&>span]:text-xs [&>span]:opacity-70`,
)

/**
 * The day-modifier classes upstream applies to a cell. `CalendarDay` above
 * already carries them as `data-[state=…]:` variants, which is the shape
 * `@llui/components/date-picker` publishes; these exist unprefixed for a
 * consumer driving the modifiers themselves, and carry upstream's strings
 * verbatim.
 */
export const calendarDayModifiers = {
  today: 'rounded-md bg-accent text-accent-foreground data-[selected=true]:rounded-none',
  rangeStart: 'rounded-l-md bg-accent',
  rangeMiddle: 'rounded-none',
  rangeEnd: 'rounded-r-md bg-accent',
  outside: 'text-muted-foreground aria-selected:text-muted-foreground',
  disabled: 'text-muted-foreground opacity-50',
  hidden: 'invisible',
} as const

export const CalendarWeekNumber = classPart(td, 'text-[0.8rem] text-muted-foreground select-none')
export const CalendarWeekNumberHeader = classPart(th, 'w-(--cell-size) select-none')
export const CalendarPreset = classPart(
  button,
  `${buttonVariants({ variant: 'ghost', size: 'sm' })} justify-start`,
)

export { Calendar as DatePicker, CalendarDayButton as DatePickerDay }
