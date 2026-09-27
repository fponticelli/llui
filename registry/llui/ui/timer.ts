import { button, div, span } from '@llui/dom'
import { classPart } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

/**
 * Timer — skin for `@llui/components/timer`. No shadcn counterpart.
 *
 * `tabular-nums` on the display is the whole point of this recipe: proportional
 * digits change width as they tick, so the readout jitters and the buttons
 * beside it shuffle every second.
 *
 * The display is an `aria-live` region and `data-direction` says whether it
 * counts up or down; `data-running` is on the ROOT so the controls can respond
 * without reaching into the display. A finished countdown publishes
 * `data-complete` on the root: the readout turns destructive (and gains a `Mark`
 * outline under forced colors, where the colour alone would be lost) (#266).
 */
export const Timer = classPart(div, 'group/timer flex items-center gap-3')
export const TimerDisplay = classPart(
  div,
  'text-2xl font-semibold tabular-nums select-none group-data-complete/timer:text-destructive forced-colors:group-data-complete/timer:outline-2 forced-colors:group-data-complete/timer:outline-offset-2 forced-colors:group-data-complete/timer:outline-[Mark]',
)
export const TimerStartTrigger = classPart(
  button,
  buttonVariants({ variant: 'default', size: 'sm' }),
)
export const TimerPauseTrigger = classPart(
  button,
  buttonVariants({ variant: 'outline', size: 'sm' }),
)
export const TimerResetTrigger = classPart(button, buttonVariants({ variant: 'ghost', size: 'sm' }))
export { span as TimerUnit }
