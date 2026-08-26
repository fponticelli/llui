import { div, type ElProps, type Mountable } from '@llui/dom'
import { classPart, mergeClass } from '@/lib/utils'
import { GripVerticalIcon } from '@/ui/icons'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). shadcn's name is Resizable; LLui's
 * machine is `splitter`. Both are exported.
 *
 * shadcn keys orientation off `aria-[orientation=…]` because
 * react-resizable-panels writes it; `@llui/components/splitter` publishes
 * `data-orientation`. ONLY the `data-` spelling is bound here, and that is the
 * whole point of this comment: THE TWO SPELLINGS MEAN OPPOSITE THINGS.
 *
 * react-resizable-panels reports the axis of the DIVIDER — a left/right split
 * gives `aria-orientation="vertical"`, because the rule itself runs vertically.
 * `splitter` reports the axis of the SPLIT and puts the same value on both the
 * group and the handle — a left/right split is `data-orientation="horizontal"`.
 * So for one and the same layout the handle carries
 * `data-orientation="horizontal"` AND `aria-orientation="vertical"`.
 *
 * Binding both — which this shipped doing, on the theory that a pasted shadcn
 * snippet should keep working — therefore applies BOTH rules at once and the
 * later one wins: the divider rendered as a full-width 1px bar across the top of
 * the group instead of a vertical rule between the panels. Every class
 * compiled, every part spread, and the check suite was green; it is visible only
 * in a render.
 *
 * A consumer pasting a shadcn snippet keeps `aria-orientation` for AT (the
 * machine publishes it correctly) and re-spells the utility classes.
 *
 * The handle's `after:` pseudo-element is not decoration: it widens a 1px visual
 * rule into a usable drag target. A hairline hit area is unusable on touch and
 * only slightly better with a mouse.
 *
 * The CURSOR and the hover/drag feedback are LLui additions, and they are the
 * same class of loss as a missing default prop: react-resizable-panels sets the
 * resize cursor itself, so shadcn's recipe never carries one, and a port that
 * copies only the classes leaves a drag handle showing the default arrow with no
 * hover state — it reads as decoration rather than a control. `touch-none` is
 * required too, or the browser claims the gesture for scrolling and the drag
 * never starts on touch.
 *
 * The drag colour comes through `group/resizable` on the panel group, because
 * `data-dragging` is published on the splitter's ROOT and not on the trigger.
 */
export const ResizablePanelGroup = classPart(
  div,
  'group/resizable flex h-full w-full data-[orientation=vertical]:flex-col',
)
export const ResizablePanel = classPart(div, 'overflow-hidden')
export const ResizableHandle = classPart(
  div,
  'relative flex w-px cursor-col-resize touch-none items-center justify-center bg-border transition-colors hover:bg-ring group-data-dragging/resizable:bg-ring data-[orientation=vertical]:cursor-row-resize after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:translate-x-0 data-[orientation=vertical]:after:-translate-y-1/2 [&[data-orientation=vertical]>div]:rotate-90',
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
