import { button, div, input } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Combobox — skin for `@llui/components/combobox`: a text input that filters an
 * anchored list. Pass `positionerClass: 'z-popover'` to `overlay()`.
 *
 * Render the `liveRegion` part. It is `sr-only` and announces the result count
 * as the query changes — without it a screen-reader user gets no feedback that
 * typing did anything.
 */
export const ComboboxRoot = classPart(div, 'relative w-full')
export const ComboboxControl = classPart(
  input,
  'flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors duration-fast outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
)
export const ComboboxTrigger = classPart(
  button,
  'absolute top-0 right-0 flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors duration-fast hover:text-foreground',
)
export const ComboboxContent = classPart(
  div,
  'max-h-72 min-w-32 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-opacity duration-fast data-[state=closed]:opacity-0',
)
export const ComboboxItem = classPart(
  div,
  'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const ComboboxGroup = classPart(div, '')
export const ComboboxGroupLabel = classPart(
  div,
  'px-2 py-1.5 text-xs font-medium text-muted-foreground',
)
export const ComboboxEmpty = classPart(div, 'px-2 py-6 text-center text-sm text-muted-foreground')
export const ComboboxLiveRegion = classPart(div, 'sr-only')
