import { button, div, h2, p, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/**
 * Dialog — the SKIN for `@llui/components/dialog`. The focus trap, scroll lock,
 * sibling `aria-hidden`, portal and focus restoration are the package's
 * `overlay()` helper; these are the classes that go on its parts.
 *
 *   const parts = dialogConnect(dialogState, dialogSend, { id: 'confirm' })
 *   [
 *     Button({ ...parts.trigger }, [text('Delete')]),
 *     dialogOverlay({ state: dialogState, send: dialogSend, parts, content: () => [
 *       DialogBackdrop({ ...parts.backdrop }),
 *       DialogPositioner({ ...parts.positioner }, [
 *         DialogContent({ ...parts.content }, [
 *           DialogTitle({ ...parts.title }, [text('Are you sure?')]),
 *         ]),
 *       ]),
 *     ] }),
 *   ]
 *
 * `z-dialog` and `z-popover` are real utilities here (theme.css declares them in
 * Tailwind's `--z-index-*` namespace). Written as `--z-*` they compile to nothing
 * and every overlay renders unstacked — the defect this registry replaced.
 */
export function DialogBackdrop(props?: ElProps): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div({
    ...rest,
    class: mergeClass(
      'fixed inset-0 z-dialog bg-black/50 transition-opacity duration-fast data-[state=closed]:opacity-0 data-[state=open]:opacity-100',
      className,
    ),
  })
}

export function DialogPositioner(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div(
    {
      ...rest,
      class: mergeClass('fixed inset-0 z-dialog flex items-center justify-center p-4', className),
    },
    children,
  )
}

export function DialogContent(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div(
    {
      ...rest,
      class: mergeClass(
        'relative w-full max-w-lg rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-lg transition-all duration-normal data-[state=closed]:scale-95 data-[state=closed]:opacity-0',
        className,
      ),
    },
    children,
  )
}

export function DialogTitle(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
  return h2(
    { ...rest, class: mergeClass('text-lg leading-none font-semibold', className) },
    children,
  )
}

export function DialogDescription(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
  return p(
    { ...rest, class: mergeClass('mt-2 text-sm text-muted-foreground', className) },
    children,
  )
}

export function DialogClose(
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
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
  props: ElProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { class: className, ...rest } = props ?? {}
  return div(
    {
      ...rest,
      class: mergeClass('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className),
    },
    children,
  )
}
