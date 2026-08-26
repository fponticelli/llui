import { button, div } from '@llui/dom'
import { classPart } from '../../lib/utils'

/** Carousel — skin for `@llui/components/carousel`. */
export const Carousel = classPart(div, 'relative')
export const CarouselViewport = classPart(div, 'overflow-hidden rounded-lg')
export const CarouselSlide = classPart(div, 'min-w-0 shrink-0 grow-0 basis-full')
export const CarouselPrevious = classPart(
  button,
  'absolute top-1/2 left-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-colors duration-fast outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const CarouselNext = classPart(
  button,
  'absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-colors duration-fast outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
)
export const CarouselIndicatorGroup = classPart(
  div,
  'mt-3 flex items-center justify-center gap-1.5',
)
export const CarouselIndicator = classPart(
  button,
  'size-2 rounded-full bg-border transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-primary',
)
