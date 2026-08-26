import { button, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * The SKIN only — the state machine, keyboard handling and ARIA stay in
 * `@llui/components/switch`. Spread the part bag in; every visual state is
 * driven by the `data-state` / `data-disabled` attributes the bag emits:
 *
 *   const parts = switchConnect(state.at('enabled'), switchSend)
 *   Switch({ ...parts.root }, [SwitchThumb({ ...parts.thumb })])
 *
 * `data-size` drives the dimensions and is read by the thumb through the
 * `group/switch` name, so the two stay in step from one attribute. LLui's
 * machine does not emit it, so pass `'data-size': 'default'` (or `'sm'`).
 */
export const Switch = classPart(
  button,
  'peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80',
)
export const SwitchThumb = classPart(
  span,
  'pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground',
)
