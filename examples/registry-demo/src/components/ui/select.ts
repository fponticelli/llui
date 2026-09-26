import {
  button,
  div,
  option,
  select as selectEl,
  span,
  type ChildNode,
  type ElProps,
  type Mountable,
} from '@llui/dom'
import { classPart, mergeClass, splitArgs } from '../../lib/utils'
import { floatingSyncMotionRecipe } from '../../lib/floating-motion'
import { CheckIcon, ChevronDownIcon } from './icons'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn) with the same `focus:` →
 * `data-[highlighted]:` translation `dropdown-menu.ts` explains, and with the
 * Radix positioning variables dropped (`max-h-(--radix-select-content-available-height)`,
 * `origin-(--radix-select-content-transform-origin)`, and the trigger-width
 * clamp on the viewport — all written by Radix's positioner, not LLui's).
 *
 * Two things to actually render:
 *  - `hiddenSelect` / `hiddenOption`, which carry the value into a native form
 *    submit. `sr-only`, NOT `hidden` — a hidden control is excluded from
 *    `FormData` in some browsers.
 *  - The trigger's `data-size`: shadcn drives the height from it
 *    (`data-[size=default]:h-9`), and LLui's machine does not emit it, so pass
 *    `'data-size': 'default'` yourself or the trigger has no height.
 *
 * `*:data-[part=select-value]:…` styles the value span the caller places inside
 * the trigger — shadcn spells that attribute `data-slot`.
 */
const selectTriggerRecipe =
  "flex w-fit max-w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] *:data-[part=select-value]:line-clamp-1 *:data-[part=select-value]:flex *:data-[part=select-value]:min-w-0 *:data-[part=select-value]:items-center *:data-[part=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground"

/**
 * SelectTrigger — renders its OWN chevron, as shadcn's does. A caller supplies
 * only the value; the affordance is part of the component.
 *
 * `data-size` is applied before the spread (so a caller can override it) because
 * the recipe takes its HEIGHT from it — `data-[size=default]:h-9`. Without it the
 * trigger collapses to its padding, which is what a bare port of the class
 * string produces.
 */
export function SelectTrigger(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return button(
    {
      type: 'button',
      'data-size': 'default',
      ...rest,
      class: mergeClass(selectTriggerRecipe, className),
    },
    [...children, ChevronDownIcon({ class: 'size-4 opacity-50' })],
  )
}

/** The value span. `data-part` is what the trigger's `*:data-[part=select-value]`
 * rules target, so it is not optional decoration. */
export const SelectValue = classPart(span, 'min-w-0 truncate')
/**
 * `@llui/components/select` is a SYNCHRONOUS boolean machine: its content's
 * `data-state` is only ever `open`/`closed`, never `opening`/`closing` — there
 * is no four-phase presence machine here the way there is for Dialog/Menu/
 * Popover/Tooltip/HoverCard (each of which owns a real `PresenceStatus`
 * reducer). `floatingSyncMotionRecipe` is the twin of the presence recipe
 * (`floatingOverlayMotionRecipe`) scoped to exactly the two states this
 * machine can reach, so no selector here can ever fail to match for lack of
 * an event that never fires (#265 finding 5). `Combobox` re-exports THIS
 * export (`ComboboxContent`, see `combobox.ts`), so the fix covers it too.
 */
export const SelectContent = classPart(
  div,
  `relative z-50 min-w-[8rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto overscroll-contain wrap-break-word rounded-md border bg-popover text-popover-foreground shadow-md forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] ${floatingSyncMotionRecipe}`,
)
export const SelectViewport = classPart(div, 'p-1')
export const SelectItem = classPart(
  div,
  "relative flex w-full min-w-0 cursor-default items-center gap-2 rounded-sm py-1.5 pe-8 ps-2 text-sm wrap-break-word outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground aria-selected:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50 forced-colors:data-[highlighted]:bg-[Highlight] forced-colors:data-[highlighted]:text-[HighlightText] forced-colors:data-[highlighted]:[outline:2px_solid_Highlight] forced-colors:data-[highlighted]:outline-offset-[-2px] forced-colors:aria-selected:[outline:2px_solid_Highlight] forced-colors:aria-selected:outline-offset-[-2px] forced-colors:data-[disabled]:text-[GrayText] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:min-w-0 *:[span]:last:items-center *:[span]:last:gap-2",
)
const selectItemIndicatorRecipe = 'absolute end-2 flex size-3.5 items-center justify-center'

/** The selected tick. Renders its own `CheckIcon`, as shadcn's does; the
 * component's `data-state` decides whether it is shown. */
export function SelectItemIndicator(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return span({ ...rest, class: mergeClass(selectItemIndicatorRecipe, className) }, [
    CheckIcon({ class: 'size-4' }),
  ])
}
export const SelectGroup = classPart(div, '')
export const SelectLabel = classPart(div, 'px-2 py-1.5 text-xs text-muted-foreground')
export const SelectSeparator = classPart(div, 'pointer-events-none -mx-1 my-1 h-px bg-border')
export const SelectHiddenSelect = classPart(selectEl, 'sr-only')
export const SelectHiddenOption = classPart(option, '')
