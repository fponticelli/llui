import { button, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '../../lib/utils'
import { buttonVariants } from './button'
import { CalendarIcon } from './icons'
import { PopoverContent } from './popover'

/**
 * Date picker.
 *
 * shadcn ships NO `date-picker.tsx` — its docs compose Button + Popover +
 * Calendar, so there is no upstream recipe file to port and inventing one would
 * guarantee drift from the docs it is meant to match. This module therefore
 * carries only the two things that composition actually adds — the trigger's
 * recipe and the content's `w-auto p-0` override — and re-exports the rest.
 *
 * Both are taken verbatim from the docs example, `data-[empty=true]` included:
 * that is upstream's own spelling for "no date chosen yet", set by the CONSUMER
 * (`'data-empty': value === null ? 'true' : undefined`), because
 * `@llui/components/date-picker` has no trigger part at all — the trigger
 * belongs to whatever surface is hosting the calendar.
 *
 * `w-auto p-0` on the content is not cosmetic. `PopoverContent`'s own `w-72 p-4`
 * would both squeeze the month grid and pad it away from its own border; the
 * calendar draws its own padding (`p-3`) and sizes itself from `--cell-size`.
 */
const datePickerTriggerRecipe = `${buttonVariants({ variant: 'outline' })} w-[280px] justify-start text-left font-normal data-[empty=true]:text-muted-foreground`

/** Renders its own calendar glyph, as shadcn's docs example does. */
export function DatePickerTrigger(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return button(
    { type: 'button', ...rest, class: mergeClass(datePickerTriggerRecipe, className) },
    [CalendarIcon({ class: 'size-4' }), ...children],
  )
}

export const DatePickerContent = classPart(PopoverContent, 'w-auto p-0')

export {
  Calendar as DatePickerCalendar,
  CalendarCaption as DatePickerCaption,
  CalendarCaptionLabel as DatePickerCaptionLabel,
  CalendarDay as DatePickerDay,
  CalendarDayButton as DatePickerDayButton,
  CalendarGrid as DatePickerGrid,
  CalendarMonth as DatePickerMonth,
  CalendarMonths as DatePickerMonths,
  CalendarNav as DatePickerNav,
  CalendarNext as DatePickerNext,
  CalendarPrevious as DatePickerPrevious,
  CalendarRow as DatePickerRow,
  CalendarWeekday as DatePickerWeekday,
  CalendarWeekdays as DatePickerWeekdays,
} from './calendar'
