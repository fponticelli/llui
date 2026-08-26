import { button as buttonEl, type ChildNode, type ElProps, type Mountable } from '@llui/dom'
import { createVariants, type VariantProps } from '@llui/components/styles'
import { mergeClass } from '@/lib/utils'

const variants = {
  variant: {
    default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
    destructive:
      'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover focus-visible:ring-destructive',
    outline:
      'border border-border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
    secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-accent-strong',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    link: 'text-primary underline-offset-4 hover:underline',
  },
  size: {
    default: 'h-9 px-4 py-2',
    sm: 'h-8 rounded-md px-3 text-xs',
    lg: 'h-10 rounded-md px-6',
    icon: 'size-9',
  },
}

export const buttonVariants = createVariants({
  base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  variants,
  defaultVariants: { variant: 'default', size: 'default' },
})

export type ButtonVariants = VariantProps<typeof variants>
export type ButtonProps = ElProps & ButtonVariants

/**
 * Button — a presentational element helper, NOT a TEA component: no state, no
 * `update`, no scope of its own. It returns a `Mountable` the caller places in a
 * view like any other element helper.
 *
 * `props` is a plain `ElProps` bag, so a `connect()` part bag spreads in and
 * keeps its handlers, ARIA and `data-*`:
 *
 *   Button({ ...parts.trigger, variant: 'outline' }, [text('Open')])
 *
 * `type: 'button'` is applied BEFORE the spread so a part bag that declares its
 * own `type` (dialog's trigger does) still wins.
 */
export function Button(
  props: ButtonProps | undefined,
  children: readonly ChildNode[] = [],
): Mountable {
  const { variant, size, class: className, ...rest } = props ?? {}
  return buttonEl(
    { type: 'button', ...rest, class: mergeClass(buttonVariants({ variant, size }), className) },
    children,
  )
}
