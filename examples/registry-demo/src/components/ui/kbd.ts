import { type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, customTag, mergeClass, splitArgs } from '../../lib/utils'

// `<kbd>` has no named helper in `@llui/dom`; `customTag` adapts `el` for it.
// The semantic tag is not decoration — screen readers announce keyboard input.
const kbdEl = customTag('kbd')

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten to
 * LLui's `data-part`. The last rule inverts the key inside a tooltip, whose
 * surface is dark — without it a muted key on a dark tooltip is unreadable.
 */
export const Kbd = classPart(
  kbdEl,
  "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3 [[data-part=tooltip-content]_&]:bg-background/20 [[data-part=tooltip-content]_&]:text-background dark:[[data-part=tooltip-content]_&]:bg-background/10",
)

/** A group of keys rendered as one chord (`⌘ K`). */
export function KbdGroup(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props
  return kbdEl(
    { ...rest, class: mergeClass('inline-flex items-center gap-1', className) },
    children,
  )
}
