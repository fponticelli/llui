import { div, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass } from '../../lib/utils'
import { GripVerticalIcon } from './icons'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). shadcn's name is Resizable; LLui's
 * machine is `splitter`. Both are exported.
 *
 * shadcn keys orientation off `aria-[orientation=…]` because
 * react-resizable-panels writes it; `@llui/components/splitter` publishes
 * `data-orientation`. BOTH spellings are bound rather than picking one, so the
 * upstream classes are present verbatim AND the LLui machine drives them — a
 * consumer porting a shadcn snippet in gets the same result either way.
 *
 * Note the axis names differ by design: react-resizable-panels calls a
 * left/right split `horizontal` at the GROUP, while the HANDLE it produces is
 * `aria-orientation="horizontal"` when the divider itself runs horizontally.
 *
 * The handle's `after:` pseudo-element is not decoration: it widens a 1px visual
 * rule into a usable drag target. A hairline hit area is unusable on touch and
 * only slightly better with a mouse.
 */
export const ResizablePanelGroup = classPart(
  div,
  'flex h-full w-full aria-[orientation=vertical]:flex-col data-[orientation=vertical]:flex-col',
)
export const ResizablePanel = classPart(div, 'overflow-hidden')
export const ResizableHandle = classPart(
  div,
  'relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:translate-x-0 data-[orientation=vertical]:after:-translate-y-1/2 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[data-orientation=vertical]>div]:rotate-90 [&[aria-orientation=horizontal]>div]:rotate-90',
)
/** The optional grip shadcn renders inside the handle. */
export function ResizableHandleGrip(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div(
    {
      ...rest,
      class: mergeClass(
        'z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border',
        className,
      ),
    },
    [GripVerticalIcon({ class: 'size-2.5' })],
  )
}

export {
  ResizablePanelGroup as Splitter,
  ResizablePanel as SplitterPanel,
  ResizableHandle as SplitterResizeTrigger,
}
