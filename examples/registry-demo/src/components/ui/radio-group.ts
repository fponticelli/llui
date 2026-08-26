import { button, div, label, span, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass } from '../../lib/utils'
import { CircleIcon } from './icons'

/** Ported verbatim from shadcn/ui (MIT © 2023 shadcn). */
export const RadioGroup = classPart(div, 'grid gap-3')
export const RadioGroupItem = classPart(
  button,
  'aspect-square size-4 shrink-0 rounded-full border border-input text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
)
/** The dot — shadcn's `CircleIcon` with `fill-primary`, absolutely centred. */
export function RadioGroupIndicator(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return span(
    { ...rest, class: mergeClass('relative flex items-center justify-center', className) },
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
