// Core primitive
export { transition } from './transition.js'

// Presets
export { fade, slide, scale, collapse } from './presets.js'
export type {
  FadeOptions,
  SlideOptions,
  SlideDirection,
  ScaleOptions,
  CollapseOptions,
} from './presets.js'

// Spring physics
export { spring } from './spring.js'
export type { SpringOptions } from './spring.js'

// Reorder animation + composition
export { flip, mergeTransitions } from './flip.js'
export type { FlipOptions } from './flip.js'

// Route transitions
export { routeTransition } from './route-transition.js'
export type { RouteTransitionOptions } from './route-transition.js'

// Stagger
export { stagger } from './stagger.js'
export type { StaggerOptions } from './stagger.js'

// Types
export type { TransitionSpec, TransitionValue, Styles } from './types.js'
