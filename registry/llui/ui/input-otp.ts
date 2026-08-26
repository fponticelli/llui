import { div, input, label } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * InputOTP — skin for `@llui/components/pin-input`. shadcn's name is Input OTP;
 * LLui's machine is `pin-input`, which owns paste-splitting, auto-advance and
 * backspace-to-previous. Both names are exported.
 */
export const InputOTP = classPart(div, 'flex items-center gap-2')
export const InputOTPGroup = classPart(div, 'flex items-center gap-1')
export const InputOTPSlot = classPart(
  input,
  'flex h-10 w-10 items-center justify-center rounded-md border border-border bg-transparent text-center text-sm shadow-sm transition-colors duration-fast outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
)
export const InputOTPLabel = classPart(label, 'text-sm leading-none font-medium')
export const InputOTPSeparator = classPart(div, 'text-muted-foreground')

export { InputOTP as PinInput, InputOTPSlot as PinInputControl, InputOTPLabel as PinInputLabel }
