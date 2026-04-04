// Core primitive
export { transition } from './transition'

// Presets
export { fade, slide, scale, collapse } from './presets'
export type {
  FadeOptions,
  SlideOptions,
  SlideDirection,
  ScaleOptions,
  CollapseOptions,
} from './presets'

// Reorder animation + composition
export { flip, mergeTransitions } from './flip'
export type { FlipOptions } from './flip'

// Types
export type { TransitionSpec, TransitionValue, Styles } from './types'
