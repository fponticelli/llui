import { div } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'
import { mergeClass, splitArgs } from '@/lib/utils'
import { button, type ChildNode, type ElProps, type Mountable } from '@llui/dom'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). Like Pagination, shadcn's prev/next
 * are not their own recipe — they are `Button` with `variant="outline"
 * size="icon"` plus positioning. Reusing the button recipe is what keeps the
 * arrows looking like the app's other buttons.
 *
 * shadcn's carousel wraps Embla and has no indicator dots;
 * `@llui/components/carousel` provides them, so the indicator recipe is LLui's.
 */
export const Carousel = classPart(div, 'relative')
export const CarouselViewport = classPart(div, 'overflow-hidden')
export const CarouselContent = classPart(div, 'flex')
export const CarouselSlide = classPart(div, 'min-w-0 shrink-0 grow-0 basis-full')

function arrow(position: string) {
  return (a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable => {
    const { props, children } = splitArgs(a0, a1)
    const { class: className, ...rest } = props
    return button(
      {
        type: 'button',
        ...rest,
        class: mergeClass(
          `${buttonVariants({ variant: 'outline', size: 'icon' })} absolute size-8 rounded-full ${position}`,
          className,
        ),
      },
      children,
    )
  }
}

export const CarouselPrevious = arrow('top-1/2 -left-12 -translate-y-1/2')
export const CarouselNext = arrow('top-1/2 -right-12 -translate-y-1/2')
export const CarouselIndicatorGroup = classPart(
  div,
  'mt-3 flex items-center justify-center gap-1.5',
)
export const CarouselIndicator = classPart(
  button,
  'size-2 rounded-full bg-border transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-primary',
)
