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

// Spring physics
export { spring } from './spring'
export type { SpringOptions } from './spring'

// Reorder animation + composition
export { flip, mergeTransitions } from './flip'
export type { FlipOptions } from './flip'

// Route transitions
export { routeTransition } from './route-transition'
export type { RouteTransitionOptions } from './route-transition'

// Stagger
export { stagger } from './stagger'
export type { StaggerOptions } from './stagger'

// Types
export type { TransitionSpec, TransitionValue, Styles } from './types'
