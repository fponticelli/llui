/**
 * CSS style properties as a plain object. Numeric values are automatically
 * suffixed with `px` for known dimensional properties.
 *
 * Example: `{ opacity: 0, transform: 'scale(0.95)', width: 200 }`
 */
export type Styles = Record<string, string | number>

/**
 * One "state" in a transition.
 *
 * - `string` — space-separated class names (applied via classList)
 * - `Styles` — inline style object (applied via element.style)
 * - `Array<string | Styles>` — mix both (useful for utility classes + dynamic styles)
 */
export type TransitionValue = string | Styles | Array<string | Styles>

export interface TransitionSpec {
  /** Initial state before enter animation (removed once enter completes). */
  enterFrom?: TransitionValue
  /** Final state during enter animation (removed once enter completes). */
  enterTo?: TransitionValue
  /** Applied throughout enter (typically the `transition-*` / `animation` properties). */
  enterActive?: TransitionValue
  /** Initial state before leave animation. */
  leaveFrom?: TransitionValue
  /** Final state during leave animation. */
  leaveTo?: TransitionValue
  /** Applied throughout leave. */
  leaveActive?: TransitionValue
  /**
   * Explicit duration in milliseconds. When omitted, the duration is read from
   * the element's computed `transition-duration` / `transition-delay` after the
   * active classes are applied.
   */
  duration?: number
  /** If true, run the enter transition on initial mount (default: true). */
  appear?: boolean
}
