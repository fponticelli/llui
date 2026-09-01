import { div } from '@llui/dom'
import { classPart, classPartWithDefaults } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'
import { mergeClass, splitArgs } from '@/lib/utils'
import { button, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { ChevronLeftIcon, ChevronRightIcon } from '@/ui/icons'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). Like Pagination, shadcn's prev/next
 * are not their own recipe — they are `Button` with `variant="outline"
 * size="icon"` plus positioning. Reusing the button recipe is what keeps the
 * arrows looking like the app's other buttons.
 *
 * shadcn's carousel wraps Embla and has no indicator dots;
 * `@llui/components/carousel` provides them, so the indicator recipe is LLui's.
 * Its active rule is `data-active:` — bare presence, which is what the machine
 * publishes. It shipped as `data-[state=active]:`, a spelling nothing emits, so
 * the current dot never highlighted; the class compiled, so nothing caught it.
 */
export const Carousel = classPart(div, 'relative')
export const CarouselViewport = classPart(
  div,
  'overflow-hidden data-[dragging]:[--carousel-track-duration:0ms]',
)
export const CarouselContent = classPartWithDefaults(
  div,
  'flex transition-transform ease-out [transition-duration:var(--carousel-track-duration,200ms)] [transform:translateX(var(--carousel-drag-offset,0px))] motion-reduce:transition-none!',
  { 'data-scope': 'carousel', 'data-part': 'track' },
)
export const CarouselSlide = classPart(div, 'min-w-0 shrink-0 grow-0 basis-full')

function arrow(position: string, glyph: (props?: ElProps) => Mountable) {
  return (a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable => {
    const { props, children } = splitArgs(a0, a1)
    const { class: className, ...rest } = props
    return button(
      {
        type: 'button',
        ...rest,
        class: mergeClass(
          `${buttonVariants({ variant: 'outline', size: 'icon' })} absolute size-8 rounded-full motion-reduce:transition-none! rtl:[&>svg]:rotate-180 ${position}`,
          className,
        ),
      },
      children.length > 0 ? children : [glyph({ class: 'size-4' })],
    )
  }
}

export const CarouselPrevious = arrow('top-1/2 start-2 -translate-y-1/2', ChevronLeftIcon)
export const CarouselNext = arrow('top-1/2 end-2 -translate-y-1/2', ChevronRightIcon)
export const CarouselIndicatorGroup = classPart(
  div,
  'mt-3 flex items-center justify-center gap-1.5',
)
export const CarouselIndicator = classPart(
  button,
  "inline-flex size-6 items-center justify-center rounded-full bg-transparent outline-none before:size-2 before:rounded-full before:bg-border before:content-[''] before:transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 data-active:before:bg-primary aria-selected:before:bg-primary motion-reduce:before:transition-none!",
)
