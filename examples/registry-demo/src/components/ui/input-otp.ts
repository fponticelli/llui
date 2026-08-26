import { div, input, label } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn). shadcn's name is Input OTP; LLui's
 * machine is `pin-input`, which owns paste-splitting, auto-advance and
 * backspace-to-previous. Both names are exported.
 *
 * The slots are FUSED — `border-y border-r` with `first:border-l` — so the group
 * reads as one control.
 *
 * shadcn keys the active slot off `data-[active=true]`, driven by
 * `input-otp`'s state; `@llui/components/pin-input` moves REAL focus between the
 * inputs. Both are bound rather than picking one, so the upstream classes are
 * present verbatim for anyone pasting a shadcn snippet, and the LLui machine
 * lights the same ring through `focus-visible:` with no extra wiring.
 */
export const InputOTP = classPart(div, 'flex items-center gap-2 has-disabled:opacity-50')
export const InputOTPGroup = classPart(div, 'flex items-center')
export const InputOTPSlot = classPart(
  input,
  'relative flex h-9 w-9 items-center justify-center border-y border-r border-input text-center text-sm shadow-xs transition-all outline-none first:rounded-l-md first:border-l last:rounded-r-md aria-invalid:border-destructive data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-[3px] data-[active=true]:ring-ring/50 data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/20 focus-visible:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:aria-invalid:border-destructive focus-visible:aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:data-[active=true]:aria-invalid:ring-destructive/40 dark:focus-visible:aria-invalid:ring-destructive/40',
)
/** The fake caret upstream draws in the active slot, since the real one is
 * hidden. Its keyframes ship in `@llui/components/styles/tokens.css`. */
export const InputOTPCaret = classPart(
  div,
  'pointer-events-none absolute inset-0 flex items-center justify-center',
)
export const InputOTPCaretBar = classPart(
  div,
  'h-4 w-px animate-caret-blink bg-foreground duration-1000',
)
export const InputOTPSeparator = classPart(div, 'text-muted-foreground')
export const InputOTPLabel = classPart(label, 'text-sm leading-none font-medium')

export { InputOTP as PinInput, InputOTPSlot as PinInputControl, InputOTPLabel as PinInputLabel }
