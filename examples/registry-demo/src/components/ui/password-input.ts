import { button, div, input } from '@llui/dom'
import { classPart } from '../../lib/utils'
import { inputRecipe } from './input'

/**
 * Password input — skin for `@llui/components/password-input`. shadcn has no
 * counterpart, so this composes the registry's own vocabulary rather than
 * inventing one: the `Input` recipe verbatim, and the trailing control styled
 * like `ComboboxTrigger`, which is the established shape here for a button that
 * sits inside a field.
 *
 * `pr-9` on the input is not decoration — without it the value runs under the
 * reveal button. The button is `absolute`, so it takes no space of its own.
 *
 * The reveal control is a TOGGLE and the machine says so with `aria-pressed`,
 * not `data-state`: it is a two-state button, not a disclosure. Style its
 * pressed look from `aria-pressed:`, and note the root also publishes
 * `data-visible` if a rule needs to reach across from the container.
 */
export const PasswordInput = classPart(div, 'relative')
export const PasswordInputControl = classPart(input, `${inputRecipe} pr-9`)
export const PasswordInputVisibilityTrigger = classPart(
  button,
  "absolute top-0 right-0 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
)
