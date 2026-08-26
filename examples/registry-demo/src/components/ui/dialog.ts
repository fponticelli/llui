import { button, div, h2, p, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass, splitArgs } from '../../lib/utils'

/**
 * Dialog — the SKIN for `@llui/components/dialog`. The focus trap, scroll lock,
 * sibling `aria-hidden`, portal and focus restoration are the package's
 * `overlay()` helper; these are the classes that go on its parts.
 *
 *   const parts = dialogConnect(dialogState, dialogSend, { id: 'confirm' })
 *   [
 *     Button({ ...parts.trigger }, [text('Delete')]),
 *     dialogOverlay({
 *       state: dialogState, send: dialogSend, parts,
 *       positionerClass: 'fixed inset-0 z-dialog grid place-items-center p-4',
 *       content: () => [
 *         DialogBackdrop({ ...parts.backdrop }),
 *         DialogContent({ ...parts.content }, [
 *           DialogTitle({ ...parts.title }, [text('Are you sure?')]),
 *         ]),
 *       ],
 *     }),
 *   ]
 *
 * Two things about that shape are easy to get wrong and have no error to tell
 * you so — the dialog simply renders in the page flow with nothing dimmed:
 *
 *  - **The positioner needs `fixed inset-0` from you.** `overlay()` builds the
 *    div, but the part bag it spreads carries only `data-*`; nothing positions
 *    it. (The opt-in baseline stylesheet does it in CSS, which is why this is
 *    invisible until you style with utilities instead.)
 *  - **The backdrop is yours to render**, inside `content()`. The engine does
 *    not emit one. It sits INSIDE the positioner, hence `absolute inset-0`
 *    below rather than `fixed`.
 *
 * There is deliberately no `DialogPositioner` here. `overlay()` BUILDS the
 * positioner div itself, so a component wrapping the part bag would never be
 * placed; the class for that node goes through the helper's `positionerClass`
 * option instead. Same for popover and tooltip.
 *
 * `z-dialog` / `z-popover` / `z-tooltip` are real utilities (theme.css declares
 * them in Tailwind's `--z-index-*` namespace). Spelled `--z-*` they compile to
 * nothing and every overlay renders unstacked — the defect this registry replaced.
 */
/** The dimming layer. `absolute`, not `fixed`: it renders INSIDE the positioner,
 * which is the element carrying `fixed inset-0` and the z-index. */
export function DialogBackdrop(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div({
    ...rest,
    class: mergeClass(
      'absolute inset-0 bg-black/50 transition-opacity duration-fast data-[state=closed]:opacity-0',
      className,
    ),
  })
}

export function DialogContent(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return div(
    {
      ...rest,
      class: mergeClass(
        // `relative` so it stacks above the absolutely-positioned backdrop that
        // shares the positioner with it.
        'relative w-full max-w-lg rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-lg transition-all duration-normal data-[state=closed]:scale-95 data-[state=closed]:opacity-0',
        className,
      ),
    },
    children,
  )
}

export function DialogTitle(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return h2(
    { ...rest, class: mergeClass('text-lg leading-none font-semibold', className) },
    children,
  )
}

export function DialogDescription(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return p(
    { ...rest, class: mergeClass('mt-2 text-sm text-muted-foreground', className) },
    children,
  )
}

export function DialogClose(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return button(
    {
      type: 'button',
      ...rest,
      class: mergeClass(
        'absolute top-3 right-3 rounded-sm text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        className,
      ),
    },
    children,
  )
}

export function DialogFooter(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { class: className, ...rest } = props as ElProps
  return div(
    {
      ...rest,
      class: mergeClass('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className),
    },
    children,
  )
}
