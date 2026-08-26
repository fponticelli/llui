import { type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { classPart, customTag, mergeClass, splitArgs } from '@/lib/utils'

// `<kbd>` has no named helper in `@llui/dom`; `customTag` adapts `el` for it.
// The semantic tag is not decoration — screen readers announce keyboard input.
const kbdEl = customTag('kbd')

export const Kbd = classPart(
  kbdEl,
  'inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none',
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
