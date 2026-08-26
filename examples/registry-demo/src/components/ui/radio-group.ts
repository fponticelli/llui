import { button, div, label, span, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass } from '../../lib/utils'
import { CircleIcon } from './icons'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn) with ONE addition — `group/radio-item`
 * on the item, exactly as `checkbox.ts` carries `group/checkbox` and for the same
 * reason.
 *
 * Radix UNMOUNTS `RadioGroupPrimitive.Indicator` when an item is unchecked, so
 * shadcn's recipe never has to hide it. `@llui/components/radio-group` has no
 * indicator part at all — the dot is the consumer's element and stays in the DOM
 * — so without a rule gating it on the item's `data-state`, EVERY option renders
 * filled and the control looks like it has no state. Measured in the demo: three
 * radios all showing a dot, with `aria-checked` perfectly correct on exactly one.
 */
export const RadioGroup = classPart(div, 'grid gap-3')
export const RadioGroupItem = classPart(
  button,
  'group/radio-item aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
)
/** The dot — shadcn's `CircleIcon` with `fill-primary`, absolutely centred, and
 * hidden while the item is unchecked (see above). `invisible`, not `hidden`, so
 * the dot reserves layout either way and the row cannot shift as the selection
 * moves. */
export function RadioGroupIndicator(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return span(
    {
      ...rest,
      class: mergeClass(
        'relative flex items-center justify-center group-data-[state=unchecked]/radio-item:invisible',
        className,
      ),
    },
    [
      CircleIcon({
        class: 'absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary',
      }),
    ],
  )
}
export const RadioGroupLabel = classPart(
  label,
  'flex items-center gap-2 text-sm leading-none font-medium select-none',
)
