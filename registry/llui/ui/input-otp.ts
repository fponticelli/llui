import { div, input, label } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). shadcn's name is Input OTP; LLui's
 * machine is `pin-input`, which owns paste-splitting, auto-advance and
 * backspace-to-previous. Both names are exported.
 *
 * The slots are FUSED — `border-y border-r` with `first:border-l` — so the group
 * reads as one control. shadcn keys the active slot off `data-[active=true]`,
 * driven by cmdk-style state; `@llui/components/pin-input` moves real focus
 * between the inputs instead, so the same ring is bound to `focus-visible:`.
 * That is the one translation in this file.
 */
export const InputOTP = classPart(div, 'flex items-center gap-2 has-disabled:opacity-50')
export const InputOTPGroup = classPart(div, 'flex items-center')
export const InputOTPSlot = classPart(
  input,
  'relative flex h-9 w-9 items-center justify-center border-y border-r border-input text-center text-sm shadow-xs transition-all outline-none first:rounded-l-md first:border-l last:rounded-r-md aria-invalid:border-destructive focus-visible:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:aria-invalid:border-destructive focus-visible:aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:focus-visible:aria-invalid:ring-destructive/40',
)
export const InputOTPCaret = classPart(
  div,
  'pointer-events-none absolute inset-0 flex items-center justify-center',
)
export const InputOTPSeparator = classPart(div, 'text-muted-foreground')
export const InputOTPLabel = classPart(label, 'text-sm leading-none font-medium')

export { InputOTP as PinInput, InputOTPSlot as PinInputControl, InputOTPLabel as PinInputLabel }
