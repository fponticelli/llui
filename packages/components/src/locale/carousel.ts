import { resolveLocaleSlice, type Locale } from './context.js'

export const enCarousel: Locale['carousel'] = {
  label: 'Carousel',
  indicators: 'Slide indicators',
  next: 'Next slide',
  prev: 'Previous slide',
  slide: (index) => `Slide ${index + 1}`,
  goToSlide: (index) => `Go to slide ${index + 1}`,
}

export const carouselLocale = (): Locale['carousel'] => resolveLocaleSlice('carousel', enCarousel)
