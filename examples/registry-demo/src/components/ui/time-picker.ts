import { button, div, input, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Time picker — skin for `@llui/components/time-picker`. No shadcn counterpart.
 *
 * The GROUP owns the border and the focus ring and the segments give them up —
 * the same inversion `input-group.ts` documents, and for the same reason: a ring
 * drawn on a segment would sit inside the group's border. Here it is driven by
 * `focus-within:` rather than a `has-[]` marker, because every segment is a real
 * focusable input.
 *
 * The segments are `type="number"` with `role="spinbutton"`, so the native
 * spinner arrows are suppressed — they would sit inside a two-character field
 * and the machine already owns Up/Down. `tabular-nums` keeps the two digits from
 * shifting as they change.
 *
 * `periodTrigger` carries its own reactive `hidden` (absent in 24-hour format)
 * and a `data-period` of 'AM'/'PM'; the root publishes `data-format`.
 */
export const TimePicker = classPart(
  div,
  'flex h-9 w-fit items-center rounded-md border border-input bg-transparent px-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-disabled:pointer-events-none has-disabled:opacity-50 md:text-sm dark:bg-input/30',
)
export const TimePickerSegment = classPart(
  input,
  'w-7 bg-transparent p-0 text-center tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
)
export const TimePickerSeparator = classPart(span, 'px-0.5 text-muted-foreground select-none')
export const TimePickerPeriodTrigger = classPart(
  button,
  'ml-1 rounded-sm px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
)
