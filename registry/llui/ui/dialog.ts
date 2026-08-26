import { button, div, p } from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Ported verbatim from shadcn/ui (MIT © 2023 shadcn).
 *
 * TWO LLui-specific things, both about the positioner:
 *
 *  1. `DialogContent` POSITIONS ITSELF (`fixed top-[50%] left-[50%]
 *     translate-x-[-50%] translate-y-[-50%]`), exactly as shadcn's does. So the
 *     wrapper `div` that `overlay()` builds must stay out of the way — pass
 *     `positionerClass: 'contents'`, which removes it from layout entirely and
 *     leaves the content behaving byte-for-byte like shadcn's.
 *  2. The BACKDROP is yours to render, inside `content()`. The engine does not
 *     emit one. With the positioner set to `contents` it is a sibling of the
 *     content in the layout, so it keeps shadcn's `fixed inset-0`.
 *
 *   const parts = dialogConnect(dialogState, dialogSend, { id: 'confirm' })
 *   dialogOverlay({
 *     state: dialogState, send: dialogSend, parts,
 *     positionerClass: 'contents',
 *     content: () => [
 *       DialogBackdrop({ ...parts.backdrop }),
 *       DialogContent({ ...parts.content }, [
 *         DialogHeader([DialogTitle({ ...parts.title }, [text('Are you sure?')])]),
 *       ]),
 *     ],
 *   })
 */
export const DialogBackdrop = classPart(
  div,
  'fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
)
export const DialogContent = classPart(
  div,
  'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
)
export const DialogHeader = classPart(div, 'flex flex-col gap-2 text-center sm:text-left')
export const DialogFooter = classPart(div, 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end')
export const DialogTitle = classPart(div, 'text-lg leading-none font-semibold')
export const DialogDescription = classPart(p, 'text-sm text-muted-foreground')
export const DialogClose = classPart(
  button,
  "absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
)

export { DialogBackdrop as DialogOverlay }
